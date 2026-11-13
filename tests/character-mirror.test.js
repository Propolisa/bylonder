// Mirrored poses (runtime/character/mirror.js): the basic rig's walk mirrored puts each foot where the other was,
// flipped across X, and mirroring twice gives the pose back.
import assert from 'node:assert/strict';
import { mirrorPose } from '../src/io_scene_babylon/runtime/character/mirror.js';
import { sampleClip } from '../src/io_scene_babylon/runtime/character/clip.js';
import { createWorldPose } from '../src/io_scene_babylon/runtime/character/procedural.js';
import { basicRig } from './fixtures/basic-rig.js';

const { skeleton, clips } = basicRig(), mirror = mirrorPose(skeleton), world = createWorldPose(skeleton);
const at = (pose, name) => { world.update(pose); const i = skeleton.boneIndex(`mixamorig:${name}`) * 3; return Array.from(world.position.subarray(i, i + 3)); };
for (const time of [0.1, 0.35, 0.8]) {
  const pose = Float32Array.from(skeleton.rest);
  sampleClip(clips.get('Walk'), time, pose);
  const original = Float32Array.from(pose);
  mirror(pose);
  for (const [a, b] of [['LeftFoot', 'RightFoot'], ['RightHand', 'LeftHand'], ['Head', 'Head']]) {
    const was = at(original, a), now = at(pose, b);
    assert.ok(Math.hypot(now[0] + was[0], now[1] - was[1], now[2] - was[2]) < 1e-4, `${b} mirrors ${a} at ${time} s: ${now} vs ${was}`);
  }
  mirror(pose);
  assert.ok(pose.every((v, i) => Math.abs(Math.abs(v) - Math.abs(original[i])) < 1e-4), 'twice is the pose again');
}

// Bones whose own axes differ from side to side: legs turned at rest by +0.3 and -0.3 about Z.
{
  const names = ['Hips', 'LeftLeg', 'LeftFoot', 'RightLeg', 'RightFoot'], parents = Int32Array.from([-1, 0, 1, 0, 3]);
  const rest = new Float32Array(5 * 10), set = (i, t, q) => rest.set([...t, ...q, 1, 1, 1], i * 10);
  const z = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
  set(0, [0, 1, 0], [0, 0, 0, 1]);
  set(1, [0.1, 0, 0], z(0.3)); set(2, [0, -0.4, 0], [0, 0, 0, 1]);
  set(3, [-0.1, 0, 0], z(-0.3)); set(4, [0, -0.4, 0], [0, 0, 0, 1]);
  const rig = { names, parents, rest, boneIndex: (n) => names.indexOf(n) }, flip = mirrorPose(rig), w = createWorldPose(rig);
  const pose = Float32Array.from(rest);
  // The left leg swung forward and twisted, on top of its rest turn.
  const turn = [Math.sin(0.3) * 0.8, Math.sin(0.3) * 0.6, 0, Math.cos(0.3)];
  const r = z(0.3), q = [r[3] * turn[0] + r[0] * turn[3] + r[1] * turn[2] - r[2] * turn[1], r[3] * turn[1] - r[0] * turn[2] + r[1] * turn[3] + r[2] * turn[0], r[3] * turn[2] + r[0] * turn[1] - r[1] * turn[0] + r[2] * turn[3], r[3] * turn[3] - r[0] * turn[0] - r[1] * turn[1] - r[2] * turn[2]];
  pose.set(q, 1 * 10 + 3);
  w.update(pose);
  const left = Array.from(w.position.subarray(2 * 3, 2 * 3 + 3));
  flip(pose);
  w.update(pose);
  const right = Array.from(w.position.subarray(4 * 3, 4 * 3 + 3));
  assert.ok(Math.hypot(right[0] + left[0], right[1] - left[1], right[2] - left[2]) < 1e-4, `turned rest: ${right} mirrors ${left}`);
}
console.log('character mirror ok');
