// The object modes Blender runs on Main without an editor of Bylonder's: an armature's Edit and Pose Modes
// (blenkernel/main-sync.js keeps the armature equal on both sides) and a mesh's Particle Edit, Sculpt and Weight Paint
// Modes. object.mode_set and the mode toggles are Object Mode's operators, Blender's in Main (object-operators.js); every
// armature.* and pose.* operator the module has, and the pose library's that make and blend pose assets, run
// by idname for Blender's Armature and Pose keymaps and menus (runBlenderOperator, modally from an event), particle.*,
// sculpt.*, paint.* and brush.* ones are Object Mode's fallbacks. A click and the box, circle and lasso selections are
// Blender's view3d operators, which pick bones by Blender's GPU selection (gpu-select.cc answers it from the bones the
// overlay draws); Bylonder's window manager runs the gestures, then their operator's exec. Transforms in these modes are Object Mode's, Blender's in Main.
import { registerOperator } from '../../windowmanager/wm-operators.js';
import { runBlenderOperator } from './object-operators.js';
import { OPERATOR_PASS_THROUGH, operatorNames } from '../../bmesh/bmesh-wasm.js';
import { startGestureBox } from '../../windowmanager/wm-gesture-box.js';
import { dragStart } from '../../windowmanager/wm-event-system.js';
import { regionView3D, viewProjection } from '../space_view3d/view3d-project.js';

// Each mode's context mode (CTX_data_mode_enum) and keymap; Edit Mode is Main's for armatures and Grease Pencil only.
const MODES = { EDIT: { context: 'EDIT_ARMATURE', keymap: 'Armature' }, POSE: { context: 'POSE', keymap: 'Pose' }, PARTICLE_EDIT: { context: 'PARTICLE', keymap: 'Particle' },
  SCULPT: { context: 'SCULPT', keymap: 'Sculpt' }, WEIGHT_PAINT: { context: 'PAINT_WEIGHT', keymap: 'Weight Paint' },
  VERTEX_PAINT: { context: 'PAINT_VERTEX', keymap: 'Vertex Paint' }, TEXTURE_PAINT: { context: 'PAINT_TEXTURE', keymap: 'Image Paint' },
  PAINT_GREASE_PENCIL: { context: 'PAINT_GREASE_PENCIL', keymap: 'Grease Pencil Draw Mode' },
  SCULPT_GREASE_PENCIL: { context: 'SCULPT_GREASE_PENCIL', keymap: 'Grease Pencil Sculpt Mode' },
  WEIGHT_GREASE_PENCIL: { context: 'WEIGHT_GREASE_PENCIL', keymap: 'Grease Pencil Weight Paint' },
  VERTEX_GREASE_PENCIL: { context: 'VERTEX_GREASE_PENCIL', keymap: 'Grease Pencil Vertex Paint' } };
const GREASE_PENCIL_EDIT = { context: 'EDIT_GREASE_PENCIL', keymap: 'Grease Pencil Edit Mode' };
const KEYMAPS = [...Object.values(MODES), GREASE_PENCIL_EDIT].map((m) => m.keymap);
const POSE_ASSETS = ['poselib.create_pose_asset', 'poselib.blend_pose_asset'];
// Create Pose Asset's dialog saves into the Current File, which the project keeps: Bylonder has no User Library on disk
// for its default (get_user_library_ref_for_save finds none, and Blender then refuses).
const presets = { 'poselib.create_pose_asset': { asset_library_reference: 'LOCAL' } };

//   sync: the scene's (createMainSync); selection; options: runBlenderOperator's host (transaction, notify, keying,
//   commit, wm, pointer, view).
export function createMainModes({ sync, selection, options }) {
  const active = () => selection.nodes.at(-1);
  // The active object's mode while it is one of these, else null.
  const greasePencil = () => active()?.metadata?.wbType === 'GREASEPENCIL';
  const mode = () => { const node = active(), m = node?.metadata?.wbMode; return MODES[m] && (m !== 'EDIT' || node.metadata.wbCreation?.armature || greasePencil()) ? m : null; };
  const modeOf = () => (mode() === 'EDIT' && greasePencil() ? GREASE_PENCIL_EDIT : MODES[mode()]);
  // Those that only invoke too (select_linked_pick, shortest_path_pick), which run from an event.
  for (const idname of operatorNames().filter((id) => /^(armature|pose)\./.test(id) || POSE_ASSETS.includes(id))) registerOperator(idname, {
    poll: () => { sync.flush(); return sync.blender.poll(idname); },
    run: (props, event) => runBlenderOperator(sync, idname, { ...presets[idname], ...props }, { ...options, event }),
    enumItems: (prop) => sync.blender.enumItems(idname, prop),
  });
  // A gesture Bylonder's window manager ran (wm-gesture-*.js) applied by its operator's exec in the view, as the
  // gesture's modal applies it (gesture_box_apply, gesture_lasso_apply, gesture_circle_apply): in region pixels.
  function applyGesture(view, idname, props, lasso = null) {
    const region = viewProjection(view);
    options.transaction(() => sync.run(() => {
      sync.blender.view = regionView3D(view);
      if (lasso) sync.blender.lassoPath = lasso.map((p) => region.toBlenderRegion(p).map(Math.round));
      sync.blender.run(idname, props);
    }));
  }

  return {
    mode,
    get contextMode() { return modeOf()?.context ?? null; },
    // Whether a keymap of Blender's runs now: Object Mode's outside these modes, a mode's own in it.
    keymapActive: (name) => (name === 'Object Mode' ? !mode() : KEYMAPS.includes(name) ? modeOf()?.keymap === name : true),
    keymaps: KEYMAPS,
    modes: Object.keys(MODES),
    // view3d.select: Blender's, from the event.
    selectOperator: (event, props) =>
      (runBlenderOperator(sync, 'view3d.select', props, { ...options, event }) & OPERATOR_PASS_THROUGH ? 'PASS_THROUGH' : 'FINISHED'),
    // view3d.select_box: a box gesture, begun at a drag's press or (from B) at the next press.
    selectBox(event, { mode = 'SET' }) {
      const view = event.view, dragged = /mouse$/.test(event.type);
      startGestureBox(options.wm(), { begin: dragged ? dragStart(event) : null, mode, select: (rect, m) => {
        const region = viewProjection(view), [xmin, ymax] = region.toBlenderRegion([rect.xmin, rect.ymin]), [xmax, ymin] = region.toBlenderRegion([rect.xmax, rect.ymax]);
        applyGesture(view, 'view3d.select_box', { xmin, xmax, ymin, ymax, mode: mode === 'SET' || mode === 'ADD' ? m : mode, wait_for_input: false });
      } });
    },
    // view3d.select_lasso's path and view3d.select_circle's circle, in client pixels.
    selectLasso: (view, path, mode) => applyGesture(view, 'view3d.select_lasso', { mode }, path),
    selectCircle(view, center, radius, mode) {
      const [x, y] = viewProjection(view).toBlenderRegion(center);
      applyGesture(view, 'view3d.select_circle', { x, y, radius, mode, wait_for_input: false });
    },
  };
}
