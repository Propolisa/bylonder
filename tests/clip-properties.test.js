// Exported clips play what Blender plays: an action whose one slot is not named for the rig (a pose library's "Legacy
// Slot") still animates it, the rig's own pose comes back after each clip is sampled, and a clip carries the custom
// properties its action keys (a rig's settings), per frame or as one value where they hold still, and none the rig lacks.
import assert from 'node:assert/strict';
import { clipGroup, withAction } from '../src/io_scene_babylon/clip-export.js';

const fcurve = (data_path, value) => ({ data_path, evaluate: (f) => value(f) });
const actionOf = (fcurves, slots = [{ identifier: 'OBLegacy Slot' }]) => ({ name: 'Acting', slots, layers: [{ strips: [{ channelbags: [{ fcurves }] }] }] });

// The custom properties a clip keys, by the page's control paths; transforms are not among them.
const action = actionOf([
  fcurve('pose.bones["Properties"]["ik_left_upperarm"]', () => 1),
  fcurve('pose.bones["Jaw"]["teeth_follow_mouth"]', (f) => (f - 10) / 10),
  fcurve('pose.bones["Jaw"].location', () => 0.2),
  fcurve('["armature_setting"]', () => 3),
  fcurve('pose.bones["Jaw"]["enable_bone_gizmo"]', () => 1),
]);
// The rig's own properties and its bones': a curve keying one it lacks ("enable_bone_gizmo") sets nothing.
const holding = (...names) => ({ get: (name) => (names.includes(name) ? 0 : undefined) });
const bones = { Properties: holding('ik_left_upperarm'), Jaw: holding('teeth_follow_mouth') };
const rig = { name: 'RIG-Snow', ...holding('armature_setting'), pose: { bones: { get: (name) => bones[name] } }, location: [0, 0, 0] };
const group = clipGroup({ name: 'Acting', action, ids: [rig], frame_start: 10, frame_end: 12, blend: 'REPLACE', influence: 1, speed: 1 }, []);
assert.deepEqual(group.metadata.bylonder.properties, {
  'objects["RIG-Snow"].pose.bones["Properties"]["ik_left_upperarm"]': 1,
  'objects["RIG-Snow"].pose.bones["Jaw"]["teeth_follow_mouth"]': [0, Math.fround(0.1), Math.fround(0.2)],
  'objects["RIG-Snow"]["armature_setting"]': 3,
}, 'a value per frame where it moves, one where it holds');
assert.equal(clipGroup({ name: 'Walk', action: actionOf([fcurve('pose.bones["Jaw"].location', () => 0)]), ids: [rig], frame_start: 0, frame_end: 2, blend: 'REPLACE', influence: 1, speed: 1 }, []).metadata.bylonder.properties,
  undefined, 'a clip keying no custom property carries none');

// An action's one slot is assigned while it is sampled, and the rig's own action and slot come back after.
const own = { identifier: 'OBRIG-Snow', handle: 1 };
const adt = { action: { name: 'Idle' }, action_slot: own, use_nla: true };
let assigned = null;
Object.defineProperty(adt, 'action', { get() { return this._action; }, set(a) { this._action = a; this._slot = null; }, configurable: true });
Object.defineProperty(adt, 'action_slot', { get() { return this._slot ?? null; }, set(s) { this._slot = s; }, configurable: true });
adt.action = { name: 'Idle' };
adt.action_slot = own;
withAction([{ animation_data: adt, pose: { bones: [] } }], action, () => { assigned = adt.action_slot; });
assert.equal(assigned, action.slots[0], 'the action plays through its only slot');
assert.equal(adt.action.name, 'Idle', 'the rig gets its own action back');
assert.equal(adt.use_nla, true, 'and its NLA');
console.log("Clip properties: a pose library's action plays through its one slot, clips carry their rig settings per frame or as one value");
