// Contacts found at export (io_scene_babylon/contacts-export.js) on an armature as Blender's evaluation gives it: the
// basic rig's walk with root motion, under a static top-level bone listed first (a rig's Properties bone), and with a
// helper bone as each foot's first child: the body's root is the top bone the action moves, the ball the foot's
// furthest child, and the walk's speed comes out as its truth.
import assert from 'node:assert/strict';
import { sampleContacts, ballOf } from '../src/io_scene_babylon/contacts-export.js';
import { createWorldPose } from '../src/io_scene_babylon/runtime/character/procedural.js';
import { sampleClip } from '../src/io_scene_babylon/runtime/character/clip.js';
import { STRIDE } from '../src/io_scene_babylon/runtime/character/pose.js';
import { basicRig } from './fixtures/basic-rig.js';

const { skeleton, clips, truth } = basicRig(), walk = clips.get('Walk'), { speed } = truth.Walk;
// Blender's axes (Z up) from the rig's (Y up), as the export's worldPoint turns them back.
const blender = (p) => [p[0], p[2], p[1]];
const rest = createWorldPose(skeleton);
rest.update(skeleton.rest);
const restHead = (i) => blender([...rest.position.slice(i * 3, i * 3 + 3)]);
/** Bones as bpy gives them: a static Properties bone first, then the rig's, each foot with a twist helper first. */
const extra = [{ name: 'Properties', parent: null, at: [0, 0, 2] }];
for (const side of ['Left', 'Right']) {
  const foot = skeleton.boneIndex(`mixamorig:${side}Foot`);
  extra.push({ name: `mixamorig:${side}FootTwist`, parent: `mixamorig:${side}Foot`, at: restHead(foot).map((v, k) => v + (k === 2 ? 0.02 : 0)) });
}
const byName = new Map();
for (const e of extra.slice(0, 1)) byName.set(e.name, { name: e.name, parent: null, head_local: e.at, children: [] });
skeleton.names.forEach((name, i) => byName.set(name, { name, parent: null, head_local: restHead(i), children: [] }));
for (const e of extra.slice(1)) byName.set(e.name, { name: e.name, parent: null, head_local: e.at, children: [] });
skeleton.names.forEach((name, i) => { if (skeleton.parents[i] >= 0) byName.get(name).parent = byName.get(skeleton.names[skeleton.parents[i]]); });
for (const e of extra.slice(1)) byName.get(e.name).parent = byName.get(e.parent);
for (const bone of byName.values()) if (bone.parent) bone.parent.children.push(bone);
// The helpers come first among the feet's children.
for (const side of ['Left', 'Right']) byName.get(`mixamorig:${side}Foot`).children.sort((a) => (a.name.endsWith('Twist') ? -1 : 1));
const ordered = [...byName.values()];
const bones = Object.assign(ordered, { get: (name) => byName.get(name) });

// Each frame's evaluated heads: the walk moved forward by its speed (root motion), the rig's root bone carrying it.
const posed = createWorldPose(skeleton), pose = Float32Array.from(skeleton.rest), heads = new Map();
const hips = skeleton.boneIndex('mixamorig:Hips'), size = walk.bones.length * STRIDE;
const evaluate = (frame) => {
  pose.set(skeleton.rest);
  sampleClip(walk, frame / walk.fps, pose);
  pose[hips * STRIDE + 2] += (frame / walk.fps) * speed;
  posed.update(pose);
  heads.clear();
  skeleton.names.forEach((name, i) => heads.set(name, blender([...posed.position.slice(i * 3, i * 3 + 3)])));
  heads.set('Properties', [0, 0, 2]);
  for (const side of ['Left', 'Right']) heads.set(`mixamorig:${side}FootTwist`, heads.get(`mixamorig:${side}Foot`).map((v, k) => v + (k === 2 ? 0.02 : 0)));
};
const armature = { type: 'ARMATURE', matrix_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], data: { bones }, pose: { bones: { get: (name) => ({ head: heads.get(name) }) } } };
const reads = [];
const range = { range: { fps: walk.fps }, sample: (read) => reads.push(read) };
const found = sampleContacts({ ids: [armature], frame_start: 0, action: { pose_markers: [] } }, range);
for (let f = 0; f < walk.frames; f++) { evaluate(f); for (const read of reads) read(f); }
const contacts = found();
assert.ok(contacts, 'contacts found');
assert.deepEqual(contacts.legs.map((l) => l.foot), ['mixamorig:LeftFoot', 'mixamorig:RightFoot']);
assert.ok(Math.abs(contacts.speed - speed) < 0.05 * speed, `the walk's speed from its root motion: ${contacts.speed.toFixed(2)} m/s, truth ${speed}`);
assert.ok(contacts.legs.every((l) => l.down.length >= 1), 'each foot has a contact');
assert.equal(ballOf(bones.get('mixamorig:LeftFoot')), 'mixamorig:LeftToeBase', 'the ball is the toe, past the twist helper listed first');
console.log('contacts at export: the moving root and the furthest child as the ball');
