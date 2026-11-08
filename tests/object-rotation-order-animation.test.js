// An animated object in Blender's default XYZ Euler order turns by its keys in that order, set one axis at a time by its
// action's channels: they wrote Babylon's own (YXZ) Euler, so the object turned elsewhere and its rotation, written
// back to Main, moved what hangs on it (Bike Ride's rider's arm, through the empties her lattice follows).
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';

const scene = new Scene(new NullEngine());
const empty = Object.assign(new TransformNode('Bone', scene), { metadata: { wbId: 'bone' } });
const channels = new Map();
registerObjects({ register: (channel) => channels.set(channel.path, channel) }, [empty]);
// Main sets its order after the channels exist, as a file's sync does.
const ob = createRNA({ world: { scene, objects: [empty] } }).pointer('Object', empty);
ob.rotation_mode = 'XYZ';

// Blender's rotation at Bike Ride's frame 119 through the channels: each Babylon axis takes the negated Blender axis.
const blender = [0.0548, 0.7347, 0.0638];
channels.get('rotation.x').set(-blender[0]);
channels.get('rotation.z').set(-blender[1]);
channels.get('rotation.y').set(-blender[2]);
[...ob.rotation_euler].forEach((value, i) => assert.ok(Math.abs(value - blender[i]) < 1e-6, `rotation_euler[${i}] ${value}`));
// Its orientation is XYZ's (X first, then Y, then Z), as Blender's matrix_world composes it.
const [x, y, z] = blender, [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
const xAxis = [cy * cz, cy * sz, -sy];
const matrix = empty.computeWorldMatrix(true).m, babylonX = [matrix[0], matrix[2], matrix[1]];
babylonX.forEach((value, i) => assert.ok(Math.abs(value - xAxis[i]) < 1e-6, `its X axis ${babylonX} is XYZ's ${xAxis}`));
assert.ok(Math.abs(channels.get('rotation.z').get() + blender[1]) < 1e-6, 'the channel reads back what it set');
console.log('Object rotation order: an XYZ object animates by its keys in XYZ');
