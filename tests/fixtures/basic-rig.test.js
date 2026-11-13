// The basic test rig (fixtures/basic-rig.js) is true to its truth: each foot is still on the ground while its truth
// says it is down, and the existing ground-speed measure finds each gait's speed.
import assert from 'node:assert/strict';
import { STRIDE } from '../../src/io_scene_babylon/runtime/character/pose.js';
import { createWorldPose, clipSpeed } from '../../src/io_scene_babylon/runtime/character/procedural.js';
import { sampleClip } from '../../src/io_scene_babylon/runtime/character/clip.js';
import { basicRig } from './basic-rig.js';

const { skeleton, clips, truth } = basicRig();
const world = createWorldPose(skeleton), pose = Float32Array.from(skeleton.rest);
const ankle = (side) => skeleton.boneIndex(`mixamorig:${side === 'L' ? 'Left' : 'Right'}Foot`) * 3;
const feet = [ankle('L') / 3, ankle('R') / 3];
assert.equal(skeleton.rest.length, skeleton.names.length * STRIDE);
for (const [name, clip] of clips) {
  const { speed, period, contacts } = truth[name];
  assert.ok(Math.abs(clip.duration - period) < 1e-6, `${name} lasts ${period} s`);
  for (const side of ['L', 'R']) {
    for (const [start, end] of contacts[side])
    for (let t = Math.ceil(start * 30 - 1e-6) / 30; t < end - 1 / 30; t += 1 / 30) {
      sampleClip(clip, t % period, pose);
      world.update(pose);
      const y = world.position[ankle(side) + 1], z = world.position[ankle(side) + 2];
      sampleClip(clip, (t + 1 / 30) % period, pose);
      world.update(pose);
      const dz = world.position[ankle(side) + 2] - z;
      assert.ok(Math.abs(y - 0.08) < 1e-3, `${name} ${side} down at ${t.toFixed(2)} s (ankle at ${y.toFixed(3)})`);
      assert.ok(Math.abs(dz * 30 + speed) < 0.05, `${name} ${side} slides back at ${speed} m/s at ${t.toFixed(2)} s (${(-dz * 30).toFixed(2)})`);
    }
  }
  if (speed > 0) {
    const measured = clipSpeed(clip, skeleton, feet);
    assert.ok(Math.abs(measured - speed) < 0.1 * speed, `${name}: clipSpeed ${measured.toFixed(2)} vs ${speed}`);
  }
}
console.log('basic rig ok');
