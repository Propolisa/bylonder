// Armature objects' Edit and Pose Modes, Blender's own in Main (blenkernel/main-sync.js keeps the armature equal on both
// sides). object.mode_set and the mode toggles are Object Mode's operators, Blender's in Main (object-operators.js);
// every armature.* and pose.* operator the module has runs by idname for Blender's Armature and Pose keymaps and menus
// (runBlenderOperator, modally from an event), and a click selects with Blender's pick (armature_select_pick) the bone
// Bylonder's picking finds under the pointer. Transforms in these modes are Object Mode's, Blender's in Main.
import { registerOperator } from '../../windowmanager/wm-operators.js';
import { runBlenderOperator } from '../object/object-operators.js';
import { SEL_OP_ADD, SEL_OP_SUB, SEL_OP_SET, SEL_OP_XOR } from '../space_view3d/view3d-select.js';
import { selectBone } from '../../blenkernel/armature/armature.js';
import { boneOfFace } from '../../draw/overlay-armature.js';

// Blender's context mode (CTX_data_mode_enum) and the keymap of an armature's mode.
const CONTEXT_MODES = { EDIT: 'EDIT_ARMATURE', POSE: 'POSE' };
const KEYMAPS = { EDIT: 'Armature', POSE: 'Pose' };

// An object when it is an armature, and an armature's mode as the scene sync keeps it (OBJECT, EDIT or POSE).
const armatureOf = (node) => (node?.metadata?.wbCreation?.armature ? node : null);
const armatureMode = (node) => node.metadata.wbMode ?? 'OBJECT';

//   sync: the scene's (createMainSync); selection; views (pickPoint); options: runBlenderOperator's host (transaction,
//   notify, keying, commit, wm, pointer, view).
export function createArmatureModes({ sync, selection, views, options }) {
  const active = () => armatureOf(selection.nodes.at(-1));
  // EDIT or POSE while the active armature is in one, else null.
  const mode = () => { const node = active(), m = node && armatureMode(node); return m && m !== 'OBJECT' ? m : null; };
  for (const idname of sync.blender.operators().filter((id) => /^(armature|pose)\./.test(id))) registerOperator(idname, {
    poll: () => { sync.flush(); return sync.blender.poll(idname); },
    run: (props, event) => runBlenderOperator(sync, idname, props, { ...options, event }),
    enumItems: (prop) => sync.blender.enumItems(idname, prop),
  });

  // view3d.select in Edit and Pose Mode: the bone drawn under the pointer, picked as Blender picks it.
  function selectOperator(event, { extend, deselect, toggle, deselect_all, select_passthrough }) {
    const node = active(), view = event.view, p = views.pickPoint(view, event.x, event.y);
    const hit = node.getScene().pick(p.x, p.y, (mesh) => mesh === node, false, view.camera);
    const index = hit?.hit ? boneOfFace(node, hit.faceId) : -1;
    const sel_op = extend ? SEL_OP_ADD : deselect ? SEL_OP_SUB : toggle ? SEL_OP_XOR : SEL_OP_SET;
    let changed = false;
    options.transaction(() => sync.run(() => {
      changed = selectBone(sync.blender.C, sync.objectOf(node), index, { sel_op, deselect_all, select_passthrough });
    }));
    return select_passthrough && !changed ? 'PASS_THROUGH' : 'FINISHED';
  }

  return {
    mode,
    get contextMode() { return CONTEXT_MODES[mode()] ?? null; },
    // Whether a keymap of Blender's runs now: Object Mode's outside the armature's modes, the Armature and Pose ones in them.
    keymapActive: (name) => (name === 'Object Mode' ? !mode() : Object.values(KEYMAPS).includes(name) ? KEYMAPS[mode()] === name : true),
    keymaps: Object.values(KEYMAPS),
    selectOperator,
  };
}
