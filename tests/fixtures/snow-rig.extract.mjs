// Writes snow-rig.json, the Snow test rig (Snow by Blender Studio, CC BY 4.0), from an exported Character Controller package's IR (scene.ir.json): each
// test bone's name, parent and rest (head in its parent's space, orientation relative to its parent, Blender's axes), and
// the parts limb, gaze and eyes effects read (IK, copy and track constraints, IK locks and limits, location limits).
// usage: node tests/fixtures/snow-rig.extract.mjs <scene.ir.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { poseBones } from '../../src/io_scene_babylon/runtime/character/effects/limbs.js';

const ir = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bones = [...poseBones({ blend: { ir }, armature: 'RIG-Snow' }).values()];
const parentOf = (b) => b.parent?.struct?.match(/^pose\.bones\["(.*)"\]$/)?.[1] ?? null;
const KEEP = new Set(['IK', 'COPY_TRANSFORMS', 'COPY_ROTATION', 'DAMPED_TRACK', 'TRACK_TO', 'LIMIT_LOCATION']);
const IK = ['lock_ik_x', 'lock_ik_y', 'lock_ik_z', 'use_ik_limit_x', 'use_ik_limit_y', 'use_ik_limit_z', 'ik_min_x', 'ik_max_x', 'ik_min_y', 'ik_max_y', 'ik_min_z', 'ik_max_z'];
const round = (v) => Math.round(v * 1e6) / 1e6;
// Rest in armature space: the head and the bone's 3x3 orientation, composed down from the root.
const byName = new Map(bones.map((b) => [b.name, b])), armature = new Map();
const armatureOf = (b) => {
  if (armature.has(b.name)) return armature.get(b.name);
  // bone.matrix is written column by column, as Babylon's row-vector matrices read it. A
  // bone the IR lost (its Bone data null) is taken unrolled along its pose head and tail, as Blender's roll 0 places it.
  let value;
  if (b.bone) {
    const m3 = b.bone.matrix ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], own = Matrix.FromValues(m3[0], m3[1], m3[2], 0, m3[3], m3[4], m3[5], 0, m3[6], m3[7], m3[8], 0, 0, 0, 0, 1);
    const parent = parentOf(b), rotation = parent ? own.multiply(armatureOf(byName.get(parent)).rotation) : own;
    value = { rotation, head: Vector3.FromArray(b.bone.head_local ?? [0, 0, 0]), tail: Vector3.FromArray(b.bone.tail_local) };
  } else {
    const head = Vector3.FromArray(b.head), tail = Vector3.FromArray(b.tail), rotation = new Matrix();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), tail.subtract(head).normalize(), new Quaternion()).toRotationMatrix(rotation);
    value = { rotation, head, tail };
  }
  armature.set(b.name, value);
  return value;
};
// The bones the tests use, with every bone they hang from or their constraints read.
const SEEDS = ['TORSO-Spine', 'FK-Spine', 'FK-RibCage', 'FK-Chest', 'FK-Neck', 'FK-Head', 'DEF-Ponytail1', 'DEF-Ponytail2',
  ...['L', 'R'].flatMap((s) => ['Thigh', 'Knee', 'Foot', 'UpperArm', 'Forearm', 'Wrist', 'Eye', 'AIM-Eye', 'MSTR-Eyelid_Upper', 'MSTR-Eyelid_Lower', 'IK-Foot', 'IK-Wrist', 'POLE-Thigh', 'POLE-UpperArm'].map((n) => `${n}.${s}`))];
const used = new Set(), use = (name) => {
  const b = byName.get(name);
  if (!b || used.has(name)) return;
  used.add(name);
  use(parentOf(b));
  for (const c of b.constraints) if (KEEP.has(c.type) && c.type !== 'LIMIT_LOCATION') { use(c.subtarget); use(c.pole_subtarget); }
};
SEEDS.forEach(use);
const out = bones.filter((b) => used.has(b.name)).map((b) => {
  const parent = parentOf(b), mine = armatureOf(b), up = parent && armatureOf(byName.get(parent));
  const q = Quaternion.FromRotationMatrix(up ? mine.rotation.multiply(up.rotation.clone().transpose()) : mine.rotation);
  const head = up ? Vector3.TransformNormal(mine.head.subtract(up.head), up.rotation.clone().transpose()) : mine.head;
  const extra = Object.fromEntries(IK.filter((k) => b[k] !== undefined && b[k] !== false && !(k.startsWith('ik_m') && Math.abs(Math.abs(b[k]) - Math.PI) < 1e-4)).map((k) => [k, b[k]]));
  const constraints = (b.constraints ?? []).filter((c) => KEEP.has(c.type)).map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => ['type', 'name', 'subtarget', 'chain_count', 'influence', 'pole_subtarget'].includes(k))));
  return { name: b.name, parent, rest: [...head.asArray(), ...q.asArray()].map(round), ...extra, ...(constraints.length && { constraints }) };
});
// Each bone's Y axis runs from its head to its tail, as Blender's.
for (const name of used) {
  const { rotation, head, tail } = armatureOf(byName.get(name)), y = Vector3.TransformNormal(Vector3.Up(), rotation), along = tail.subtract(head).normalize();
  if (Vector3.Dot(y, along) < 0.999) throw new Error(`${name}: rest orientation read wrong (${y} vs ${along})`);
}
writeFileSync(new URL('./snow-rig.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} bones`);
