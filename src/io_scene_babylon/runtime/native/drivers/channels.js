// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Transform channel variables (prior/drivers-spec/drivers.md section 3, TRANSFORMS, LOC_DIFF, ROTATION_DIFF).
// Objects follow the spec. Bones (bone_target) are not covered by the spec; they use the same decomposition on the
// bone's matrix in each space: WORLD_SPACE the armature world times the pose, TRANSFORM_SPACE the basis, LOCAL_SPACE
// the bone LOCAL space of the constraint foundations (an assumption, unverified).
import { mul, invert, normalizedCols, det3, scaleOf, quatFromMatrix } from '../math.js';
import { eulerOf } from '../euler.js';
import { toSpace } from '../spaces.js';
import { ROT_NAMES } from '../rig/m4.js';

const EULER = new Set(['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']);
const F32_PI = Math.fround(Math.PI), F32_TAU = Math.fround(2 * Math.PI);

// Cached per evaluation pass: a pass runs each op once, so a source read by several drivers is final and the same.
function spaceMatrix(inst, r, space = 'WORLD_SPACE') {
  const key = `${r.object}/${r.bone}/${space}`, cache = inst.channelCache ??= new Map(), hit = cache.get(key);
  if (hit && hit.pass === inst.pass) return hit.m;
  const m = Float64Array.from(spaceMatrixOf(inst, r, space));
  cache.set(key, { pass: inst.pass, m });
  return m;
}

function spaceMatrixOf(inst, r, space) {
  if (r.bone >= 0) {
    const pose = inst.poseView[r.bone];
    if (space === 'TRANSFORM_SPACE') return inst.boneBasis(r.bone);
    const world = mul(inst.worldView[r.object], pose);
    return space === 'LOCAL_SPACE' ? toSpace('LOCAL', world, inst.targetEnt[r.bone]) : world;
  }
  const basis = inst.objectBasisView(r.object);
  if (space === 'TRANSFORM_SPACE') return basis;
  if (space === 'LOCAL_SPACE') return inst.objectEnt[r.object].parentMatrix ? Float64Array.from(basis) : mul(invert(normalizedCols(basis)), basis);
  return inst.worldView[r.object];
}

// Rotation mode and Euler reference of the target (AUTO uses the owner's Euler order and angles).
function ownRotation(inst, r) {
  const mode = ROT_NAMES[r.bone >= 0 ? inst.rotationMode[r.bone] : inst.objectRotationMode(r.object)];
  const rot = r.bone >= 0 ? inst.rotation.subarray(r.bone * 4, r.bone * 4 + 3) : inst.objectRotation(r.object);
  return { mode, euler: EULER.has(mode) ? [rot[0], rot[1], rot[2]] : null };
}

// Per axis: e moved by whole turns toward the reference, with the spec's float32 rule.
function compatible(e, ref) {
  return e.map((v, i) => {
    const d = ref[i] - v;
    if (Math.abs(d) <= F32_PI) return v;
    const q = Math.fround(d / F32_TAU);
    const k = q < 0 ? -Math.round(-q) : Math.round(q);
    return v + 2 * Math.PI * k;
  });
}

function quatOf(n) {
  let m = n;
  if (det3(m) < 0) m = m.map((x, i) => (i % 4 < 3 && i < 12 ? -x : x));
  const q = quatFromMatrix(m);
  return q[0] < 0 ? q.map((x) => -x) : q;
}

export function readTransformChannel(inst, r, t) {
  // One read per (source, space, channel, mode) per pass: many drivers read the same control.
  const key = `${r.object}/${r.bone}/${t.transform_space}/${t.transform_type}/${t.rotation_mode}`;
  const cache = inst.channelValues ??= new Map(), hit = cache.get(key);
  if (hit && hit.pass === inst.pass) return hit.v;
  const v = readTransformChannelUncached(inst, r, t);
  if (hit) { hit.pass = inst.pass; hit.v = v; } else cache.set(key, { pass: inst.pass, v });
  return v;
}

function readTransformChannelUncached(inst, r, t) {
  const m = spaceMatrix(inst, r, t.transform_space);
  const type = t.transform_type ?? 'LOC_X';
  const axis = { X: 0, Y: 1, Z: 2, W: 3 }[type[type.length - 1]];
  if (type.startsWith('LOC_')) return m[12 + axis];
  if (type === 'SCALE_AVG') return Math.cbrt(det3(m));
  if (type.startsWith('SCALE_')) return scaleOf(m)[axis];
  let mode = t.rotation_mode ?? 'AUTO', ref = null;
  if (mode === 'AUTO') {
    const own = ownRotation(inst, r);
    mode = own.euler ? own.mode : 'XYZ';
    ref = own.euler;
  }
  return readTransformChannelOf(normalizedCols(m), type, mode, ref);
}

// A rotation channel (ROT_X ... ROT_W) of a column-normalized matrix in a rotation mode (drivers.md section 3).
export function readTransformChannelOf(n, type, mode, ref = null) {
  const axis = { X: 0, Y: 1, Z: 2, W: 3 }[type[type.length - 1]];
  if (EULER.has(mode)) {
    if (axis === 3) return 0;
    const e = eulerOf(n, mode);
    return (ref ? compatible(e, ref) : e)[axis];
  }
  const q = quatOf(n);
  if (mode === 'QUATERNION') return axis === 3 ? q[0] : q[axis + 1];
  if (mode.startsWith('SWING_TWIST_')) {
    const a = { X: 1, Y: 2, Z: 3 }[mode[mode.length - 1]];
    const tw = 2 * Math.atan2(q[a], q[0]);
    const l = Math.hypot(q[0], q[a]);
    const tq = [q[0] / l, 0, 0, 0];
    tq[a] = q[a] / l;
    // swing = q * conj(twist)
    const c = [tq[0], -tq[1], -tq[2], -tq[3]];
    const s = [
      q[0] * c[0] - q[1] * c[1] - q[2] * c[2] - q[3] * c[3],
      q[0] * c[1] + q[1] * c[0] + q[2] * c[3] - q[3] * c[2],
      q[0] * c[2] - q[1] * c[3] + q[2] * c[0] + q[3] * c[1],
      q[0] * c[3] + q[1] * c[2] - q[2] * c[1] + q[3] * c[0],
    ];
    if (axis === 3) return 2 * Math.acos(Math.min(1, Math.fround(s[0])));
    if (axis + 1 === a) return tw;
    return 2 * Math.asin(s[axis + 1]);
  }
  return 0;
}

export function locationIn(inst, r, space = 'WORLD_SPACE') {
  if (space === 'TRANSFORM_SPACE') {
    if (r.bone >= 0) return Array.from(inst.location.subarray(r.bone * 3, r.bone * 3 + 3));
    return inst.objectLocation(r.object);
  }
  const m = spaceMatrix(inst, r, space);
  return [m[12], m[13], m[14]];
}

export function rotationDiff(inst, a, b) {
  const qa = quatOf(normalizedCols(spaceMatrix(inst, a))), qb = quatOf(normalizedCols(spaceMatrix(inst, b)));
  const w = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  return 2 * Math.acos(Math.min(1, Math.fround(Math.abs(w))));
}
