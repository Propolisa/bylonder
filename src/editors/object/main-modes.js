// The object modes Blender runs on Main without an editor of Bylonder's: an armature's Edit and Pose Modes
// (blenkernel/main-sync.js keeps the armature equal on both sides) and a mesh's Particle Edit, Sculpt and Weight Paint
// Modes. object.mode_set and the mode toggles are Object Mode's operators, Blender's in Main (object-operators.js); every
// armature.* and pose.* operator the module has runs by idname for Blender's Armature and Pose keymaps and menus
// (runBlenderOperator, modally from an event), particle.*, sculpt.*, paint.* and brush.* ones are Object Mode's
// fallbacks. A click and the box, circle and lasso selections are Blender's view3d operators, which pick bones by
// Blender's GPU selection (gpu-select.cc answers it from the bones the overlay draws); Bylonder's window manager runs
// the gestures, then their operator's exec. Transforms in these modes are Object Mode's, Blender's in Main.
import { registerOperator } from '../../windowmanager/wm-operators.js';
import { runBlenderOperator } from './object-operators.js';
import { OPERATOR_PASS_THROUGH, operatorNames } from '../../bmesh/bmesh-wasm.js';
import { startGestureBox } from '../../windowmanager/wm-gesture-box.js';
import { dragStart } from '../../windowmanager/wm-event-system.js';
import { regionView3D, viewProjection } from '../space_view3d/view3d-project.js';

// Each mode's context mode (CTX_data_mode_enum) and keymap; Edit Mode is Main's for armatures only.
const MODES = { EDIT: { context: 'EDIT_ARMATURE', keymap: 'Armature' }, POSE: { context: 'POSE', keymap: 'Pose' }, PARTICLE_EDIT: { context: 'PARTICLE', keymap: 'Particle' },
  SCULPT: { context: 'SCULPT', keymap: 'Sculpt' }, WEIGHT_PAINT: { context: 'PAINT_WEIGHT', keymap: 'Weight Paint' } };
const KEYMAPS = Object.values(MODES).map((m) => m.keymap);

//   sync: the scene's (createMainSync); selection; options: runBlenderOperator's host (transaction, notify, keying,
//   commit, wm, pointer, view).
export function createMainModes({ sync, selection, options }) {
  const active = () => selection.nodes.at(-1);
  // The active object's mode while it is one of these, else null.
  const mode = () => { const node = active(), m = node?.metadata?.wbMode; return MODES[m] && (m !== 'EDIT' || node.metadata.wbCreation?.armature) ? m : null; };
  // Those that only invoke too (select_linked_pick, shortest_path_pick), which run from an event.
  for (const idname of operatorNames().filter((id) => /^(armature|pose)\./.test(id))) registerOperator(idname, {
    poll: () => { sync.flush(); return sync.blender.poll(idname); },
    run: (props, event) => runBlenderOperator(sync, idname, props, { ...options, event }),
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
    get contextMode() { return MODES[mode()]?.context ?? null; },
    // Whether a keymap of Blender's runs now: Object Mode's outside these modes, a mode's own in it.
    keymapActive: (name) => (name === 'Object Mode' ? !mode() : KEYMAPS.includes(name) ? MODES[mode()]?.keymap === name : true),
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
