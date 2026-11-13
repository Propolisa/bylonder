// The Pose an effect writes (runtime/character/pose-api.js): local writes and reads per bone, and world matrices from
// the parents, a write earlier in the same step showing at once in a child's world matrix.
import assert from 'node:assert/strict';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { createPoseApi } from '../src/io_scene_babylon/runtime/character/pose-api.js';
import { STRIDE } from '../src/io_scene_babylon/runtime/character/pose.js';

// A chain of two bones, the child 1 m along its parent's Y; the root moved 2 m along X.
const pose = new Float32Array(2 * STRIDE);
pose.set([0, 0, 0, 0, 0, 0, 1, 1, 1, 1], 0);
pose.set([0, 1, 0, 0, 0, 0, 1, 1, 1, 1], STRIDE);
const root = Matrix.Translation(2, 0, 0);
const p = createPoseApi(pose, Int32Array.of(-1, 0), () => root);
const near = (a, b, what) => assert.ok(Vector3.Distance(a, b) < 1e-6, `${what}: ${a} against ${b}`);

near(p.world(1).getTranslation(), new Vector3(2, 1, 0), 'the child at its rest');
p.addRotation(0, 'Z', Math.PI / 2);
near(p.world(1).getTranslation(), new Vector3(1, 0, 0), 'the parent turned 90 degrees about Z: the child swings to -X');
p.setLocation(0, new Vector3(0, 0, 3));
near(p.location(0, new Vector3()), new Vector3(0, 0, 3), 'a location reads back');
near(p.world(1).getTranslation(), new Vector3(1, 0, 3), 'and moves the child');
p.addLocation(1, new Vector3(0, 1, 0));
near(p.world(1).getTranslation(), new Vector3(0, 0, 3), 'an added location, in the bone own space');
p.setRotation(0, Quaternion.Identity());
assert.ok(p.rotation(0, new Quaternion()).equalsWithEpsilon(Quaternion.Identity(), 1e-6), 'a rotation reads back');
p.setScale(0, new Vector3(2, 2, 2));
near(p.world(1).getTranslation(), new Vector3(2, 4, 3), 'scale carries to the child');
assert.throws(() => p.world(5), /No bone 5/, 'an unknown bone throws');
console.log('Character pose API: local writes and reads, world matrices from the parents with this step\'s writes');
