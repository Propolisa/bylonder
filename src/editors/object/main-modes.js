// The object modes Blender runs on Main without an editor of Bylonder's: an armature's Edit and Pose Modes
// (blenkernel/main-sync.js keeps the armature equal on both sides) and a mesh's Particle Edit Mode. object.mode_set and
// the mode toggles are Object Mode's operators, Blender's in Main (object-operators.js); every armature.* and pose.*
// operator the module has runs by idname for Blender's Armature and Pose keymaps and menus (runBlenderOperator, modally
// from an event), particle.* ones are Object Mode's fallbacks, and a click on an armature selects with Blender's pick
// (armature_select_pick) the bone part the overlay draws under the pointer (overlay-armature-select.js). Transforms in
// these modes are Object Mode's, Blender's in Main.
import { registerOperator } from '../../windowmanager/wm-operators.js';
import { runBlenderOperator } from './object-operators.js';
import { SEL_OP_ADD, SEL_OP_SUB, SEL_OP_SET, SEL_OP_XOR } from '../space_view3d/view3d-select.js';
import { selectBone } from '../../blenkernel/armature/armature.js';
import { pickBone } from '../../draw/overlay-armature-select.js';

// Each mode's context mode (CTX_data_mode_enum) and keymap; Edit Mode is Main's for armatures only.
const MODES = { EDIT: { context: 'EDIT_ARMATURE', keymap: 'Armature' }, POSE: { context: 'POSE', keymap: 'Pose' }, PARTICLE_EDIT: { context: 'PARTICLE', keymap: 'Particle' } };
const KEYMAPS = Object.values(MODES).map((m) => m.keymap);

//   sync: the scene's (createMainSync); selection; views (pickPoint); options: runBlenderOperator's host (transaction,
//   notify, keying, commit, wm, pointer, view).
export function createMainModes({ sync, selection, views, options }) {
  const active = () => selection.nodes.at(-1);
  // The active object's mode while it is one of these, else null.
  const mode = () => { const node = active(), m = node?.metadata?.wbMode; return MODES[m] && (m !== 'EDIT' || node.metadata.wbCreation?.armature) ? m : null; };
  for (const idname of sync.blender.operators().filter((id) => /^(armature|pose)\./.test(id))) registerOperator(idname, {
    poll: () => { sync.flush(); return sync.blender.poll(idname); },
    run: (props, event) => runBlenderOperator(sync, idname, props, { ...options, event }),
    enumItems: (prop) => sync.blender.enumItems(idname, prop),
  });

  // view3d.select: Blender's in Particle Edit Mode, else the bone part drawn under the pointer, picked as Blender picks it.
  function selectOperator(event, props) {
    if (mode() === 'PARTICLE_EDIT') return runBlenderOperator(sync, 'view3d.select', props, { ...options, event });
    const { extend, deselect, toggle, deselect_all, select_passthrough } = props;
    const node = active(), view = event.view, p = views.pickPoint(view, event.x, event.y);
    const sel_op = extend ? SEL_OP_ADD : deselect ? SEL_OP_SUB : toggle ? SEL_OP_XOR : SEL_OP_SET;
    let changed = false;
    options.transaction(() => sync.run(() => {
      const ob = sync.objectOf(node), picked = pickBone(sync.blender.C, ob, { ...p, camera: view.camera, xray: view.state?.xray });
      changed = selectBone(sync.blender.C, ob, picked?.index ?? -1, { part: picked?.part, sel_op, deselect_all, select_passthrough });
    }));
    return select_passthrough && !changed ? 'PASS_THROUGH' : 'FINISHED';
  }

  return {
    mode,
    get contextMode() { return MODES[mode()]?.context ?? null; },
    // Whether a keymap of Blender's runs now: Object Mode's outside these modes, a mode's own in it.
    keymapActive: (name) => (name === 'Object Mode' ? !mode() : KEYMAPS.includes(name) ? MODES[mode()]?.keymap === name : true),
    keymaps: KEYMAPS,
    selectOperator,
  };
}
