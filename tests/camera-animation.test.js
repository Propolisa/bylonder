// An animated camera's rotation, set one axis at a time by its action's channels, is Blender's Euler on the camera, which
// looks down Blender's -Z: Bike Ride's camera looked straight up when its keys were applied as an ordinary object's.
import assert from 'node:assert/strict';
import { FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { asObject } from '../src/runtime/object-transform.js';

const scene = new Scene(new NullEngine());
const camera = asObject(new FreeCamera('Camera', Vector3.Zero(), scene));
camera.metadata = { wbId: 'camera' };
const channels = new Map();
registerObjects({ register: (channel) => channels.set(channel.path, channel) }, [camera]);

// Blender's rotation (1.64, 0, -0.026) through the channels: each Babylon axis takes the negated Blender axis (model.js).
const blender = [1.64, 0, -0.026];
channels.get('rotation.x').set(-blender[0]);
channels.get('rotation.z').set(-blender[1]);
channels.get('rotation.y').set(-blender[2]);
const ob = createRNA({ world: { scene, objects: [camera] } }).pointer('Object', camera);
[...ob.rotation_euler].forEach((value, i) => assert.ok(Math.abs(value - blender[i]) < 1e-6, `rotation_euler[${i}] ${value}`));
// It looks along Blender's +Y (its -Z turned up by 1.64 about X), Babylon's +Z.
const forward = camera.getDirection(Vector3.Forward());
assert.ok(forward.z > 0.99, `looks forward: ${forward.asArray()}`);
assert.ok(Math.abs(channels.get('rotation.x').get() + blender[0]) < 1e-6, 'the channel reads back what it set');
// A rotation set whole reads back as set, not as an equivalent other triple: Pizza Delivery's sun at 3.92 about X was
// written back to Main as -2.36, which turns its keys the other way round.
const turned = [3.9199, -0.7596, -2.5729];
ob.rotation_euler = turned;
[...ob.rotation_euler].forEach((value, i) => assert.ok(Math.abs(value - turned[i]) < 1e-6, `rotation_euler[${i}] ${value} as set`));
console.log('Camera animation: an animated camera turns by Blender\'s Euler, looking down its -Z, and keeps the Euler it was given');
