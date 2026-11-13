// Roles by convention (runtime/character/roles.js): an older CloudRig without result bones (the Bar Scene's Snow)
// resolves its spine, head and limbs to its FK controls; the hips are the lowest bone both legs hang from.
import assert from 'node:assert/strict';
import { findRoles } from '../src/io_scene_babylon/runtime/character/roles.js';

const names = ['root', 'TORSO', 'FK-Spine', 'FK-RibCage', 'FK-Chest', 'FK-Neck', 'FK-Head',
  ...['L', 'R'].flatMap((s) => [`FK-Thigh.${s}`, `FK-Knee.${s}`, `FK-Foot.${s}`, `FK-UpperArm.${s}`, `FK-Forearm.${s}`, `FK-Wrist.${s}`])];
const parent = { TORSO: 'root', 'FK-Spine': 'TORSO', 'FK-RibCage': 'FK-Spine', 'FK-Chest': 'FK-RibCage', 'FK-Neck': 'FK-Chest', 'FK-Head': 'FK-Neck',
  'FK-Thigh.L': 'TORSO', 'FK-Knee.L': 'FK-Thigh.L', 'FK-Foot.L': 'FK-Knee.L', 'FK-Thigh.R': 'TORSO', 'FK-Knee.R': 'FK-Thigh.R', 'FK-Foot.R': 'FK-Knee.R',
  'FK-UpperArm.L': 'FK-Chest', 'FK-Forearm.L': 'FK-UpperArm.L', 'FK-Wrist.L': 'FK-Forearm.L', 'FK-UpperArm.R': 'FK-Chest', 'FK-Forearm.R': 'FK-UpperArm.R', 'FK-Wrist.R': 'FK-Forearm.R' };
const roles = findRoles(names, {}, names.map((n) => names.indexOf(parent[n] ?? '')));
assert.equal(roles.neck, 'FK-Neck');
assert.equal(roles.head, 'FK-Head');
assert.equal(roles.spine, 'FK-Spine');
assert.deepEqual(roles['leg.L'], ['FK-Thigh.L', 'FK-Knee.L', 'FK-Foot.L']);
assert.deepEqual(roles['arm.R'], ['FK-UpperArm.R', 'FK-Forearm.R', 'FK-Wrist.R']);
assert.equal(roles.hips, 'TORSO', 'the hips: the bone both legs hang from');
assert.equal(findRoles(names, { hips: 'root' }, null).hips, 'root', 'given roles win');
console.log('character roles: ok');
