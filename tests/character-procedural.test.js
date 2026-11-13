// Offline clip analysis (runtime/character/procedural.js): the world pose follows the local pose through parents and
// a turned, scaled root, and a walk's planted foot gives its ground speed.
import assert from 'node:assert/strict';
import { STRIDE, createPose } from '../src/io_scene_babylon/runtime/character/pose.js';
import { createWorldPose, clipSpeed } from '../src/io_scene_babylon/runtime/character/procedural.js';
import { createClip } from '../src/io_scene_babylon/runtime/character/clip.js';

const near = (a, b, tolerance, what) => assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) < tolerance, `${what}: ${a.map((v) => v.toFixed(4))} vs ${b}`);
const at = (world, i) => Array.from(world.position.subarray(i * 3, i * 3 + 3));

// A leg hanging down: hip at 1 m, thigh and shin 0.45 m each, the knee bent slightly forward (+z), then the ankle.
const skeleton = { names: ['hip', 'knee', 'ankle', 'neck', 'head'], parents: Int32Array.from([-1, 0, 1, -1, 3]) };
const pose = createPose(5);
const bend = (i, angle) => pose.set([Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)], i * STRIDE + 3);
pose.set([0, 1, 0], 0);
pose.set([0, -0.45, 0], 1 * STRIDE);
pose.set([0, -0.45, 0], 2 * STRIDE);
bend(0, -0.1);
bend(1, 0.2);
pose.set([0, 1.5, 0], 3 * STRIDE);
pose.set([0, 0.2, 0], 4 * STRIDE);
const world = createWorldPose(skeleton);
world.update(pose);
near(at(world, 0), [0, 1, 0], 1e-6, 'root placed');

// The root turned and scaled moves everything with it.
world.root.rotation = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
world.root.scale = 2;
world.update(pose);
near(at(world, 0), [0, 2, 0], 1e-6, 'scaled root');
world.root.rotation = [0, 0, 0, 1];
world.root.scale = 1;
world.update(pose);

// A step cycle: the foot moves back 0.5 m over the half second it is down, then swings forward in the air.
const frames = 31, data = new Float32Array(frames * STRIDE);
for (let f = 0; f < frames; f++) {
  const t = f / 30, down = t < 0.5, z = down ? 0.25 - t : -0.25 + (t - 0.5) * 1;
  data.set([0, down ? 0 : 0.1 * Math.sin(Math.PI * (t - 0.5) / 0.5), z, 0, 0, 0, 1, 1, 1, 1], f * STRIDE);
}
const step = createClip('Step', 30, [0], data);
const foot = { names: ['foot'], parents: Int32Array.from([-1]), rest: createPose(1) };
const speed = clipSpeed(step, foot, [0]);
assert.ok(Math.abs(speed - 1) < 0.15, `ground speed 1 m/s (${speed.toFixed(3)})`);

console.log('character procedural: ok');
