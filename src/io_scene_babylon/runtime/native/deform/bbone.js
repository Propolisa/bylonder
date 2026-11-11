// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// B-Bone segment joints (specs/bbone.md): the bone's curve from its handles and B-Bone values, and the n + 1 joint
// matrices in bone space for the pose shape or the rest shape.
//
// bboneJoints(bone, ctx, rest) -> Float64Array((n + 1) * 16), joint j at j * 16, column-major.
//   bone: the program's bone record (edit values and handle settings by RNA name, pose values on bone.pose).
//   ctx: { matrix(b, rest) -> 4x4 pose or rest matrix of bone index b (armature space), poseValue(b, name),
//          scale(b) -> the pose bone's own scale channels, bones, connectedChild(b), parent(b) }.
import { invert, normalize, cross, dot, len, sub, scaleV, add } from '../math.js';

const DEFAULTS = {
  bbone_curveinx: 0, bbone_curveinz: 0, bbone_curveoutx: 0, bbone_curveoutz: 0, bbone_rollin: 0, bbone_rollout: 0,
  bbone_easein: 1, bbone_easeout: 1, bbone_scalein: [1, 1, 1], bbone_scaleout: [1, 1, 1],
};
const POSE_DEFAULTS = { ...DEFAULTS, bbone_easein: 0, bbone_easeout: 0 };
const ADDED = ['bbone_curveinx', 'bbone_curveinz', 'bbone_curveoutx', 'bbone_curveoutz', 'bbone_rollin', 'bbone_rollout', 'bbone_easein', 'bbone_easeout'];
const SAMPLES = 32;

// Edit values, or edit combined with pose values (sum; scales multiply per axis).
export function bboneValues(bone, pose, rest) {
  const v = {};
  for (const k of ADDED) v[k] = (bone[k] ?? DEFAULTS[k]) + (rest ? 0 : pose?.[k] ?? POSE_DEFAULTS[k]);
  for (const k of ['bbone_scalein', 'bbone_scaleout']) {
    const e = bone[k] ?? DEFAULTS[k], p = rest ? [1, 1, 1] : pose?.[k] ?? [1, 1, 1];
    v[k] = [e[0] * p[0], e[1] * p[1], e[2] * p[2]];
  }
  return v;
}

const col3 = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];

// The frame of this bone's scaled space: point(x) and axes(H3) as bbone.md "Scaled bone space".
function scaledSpace(M) {
  const S = [len(col3(M, 0)), len(col3(M, 1)), len(col3(M, 2))];
  const Mi = invert(M);
  const point = (x) => {
    const p = [Mi[0] * x[0] + Mi[4] * x[1] + Mi[8] * x[2] + Mi[12], Mi[1] * x[0] + Mi[5] * x[1] + Mi[9] * x[2] + Mi[13], Mi[2] * x[0] + Mi[6] * x[1] + Mi[10] * x[2] + Mi[14]];
    return [p[0] * S[0], p[1] * S[1], p[2] * S[2]];
  };
  const dir = (v) => {
    const p = [Mi[0] * v[0] + Mi[4] * v[1] + Mi[8] * v[2], Mi[1] * v[0] + Mi[5] * v[1] + Mi[9] * v[2], Mi[2] * v[0] + Mi[6] * v[1] + Mi[10] * v[2]];
    return [p[0] * S[0], p[1] * S[1], p[2] * S[2]];
  };
  const axes = (H) => [0, 1, 2].map((c) => normalize(dir(col3(H, c))));
  return { S, point, dir, axes };
}

// Shortest-arc rotation (3x3 as three columns) taking unit a to unit b.
function arc(a, b) {
  const d = dot(a, b);
  let axis, angle;
  if (d > 1 - 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (d < -1 + 1e-12) {
    axis = normalize(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    angle = Math.PI;
  } else {
    axis = normalize(cross(a, b));
    angle = Math.acos(d);
  }
  return axisAngleCols(axis, angle);
}

function axisAngleCols([x, y, z], angle) {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    [t * x * x + c, t * x * y + s * z, t * x * z - s * y],
    [t * x * y - s * z, t * y * y + c, t * y * z + s * x],
    [t * x * z + s * y, t * y * z - s * x, t * z * z + c],
  ];
}

const apply = (R, v) => [0, 1, 2].map((r) => R[0][r] * v[0] + R[1][r] * v[1] + R[2][r] * v[2]);
const compose3 = (A, B) => B.map((c) => apply(A, c)); // A @ B, columns

// Angle about Y of y_to(F.y)^T @ F (F as columns).
function rollOf(F) {
  const T = compose3(transpose(arc([0, 1, 0], normalize(F[1]))), F);
  return Math.atan2(T[2][0], T[0][0]);
}
const transpose = (R) => [0, 1, 2].map((c) => [R[0][c], R[1][c], R[2][c]]);

// One end's handle: direction (unit, scaled space) and roll.
function handleEnd(end, bone, ctx, rest, space, Lp) {
  const type = bone[`bbone_handle_type_${end}`] ?? 'AUTO';
  let hb = -1;
  if (type === 'AUTO') hb = end === 'start' ? (bone.use_connect ? ctx.parent(bone.index) : -1) : ctx.connectedChild(bone.index);
  else {
    const name = bone[`bbone_custom_handle_${end}`];
    hb = name ? ctx.indexOf(bone.arm, name) : -1;
  }
  if (hb == null || hb < 0) return null;
  const H = ctx.matrix(hb, rest), hBone = ctx.bones[hb], hSegs = (hBone.bbone_segments ?? 1) > 1;
  const head = space.point(col3(H, 3));
  const tail = space.point(add(col3(H, 3), scaleV(col3(H, 1), hBone.length)));
  let d;
  if (type === 'TANGENT') d = space.dir(col3(H, 1));
  else if (type === 'RELATIVE') d = rest ? [0, 0, 0] : space.dir(sub(col3(H, 3), col3(ctx.matrix(hb, true), 3)));
  else if (end === 'start') d = hSegs ? sub([0, Lp, 0], head) : scaleV(head, -1);
  else d = hSegs ? tail : sub(tail, [0, Lp, 0]);
  d = len(d) ? normalize(d) : [0, 1, 0];
  const absolute = type === 'AUTO' || type === 'ABSOLUTE';
  const F = space.axes(H);
  const roll = end === 'start' && absolute && hSegs ? 0 : rollOf(compose3(arc(normalize(F[1]), d), F));
  return { d, roll, hb };
}

const bezier = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [0, 1, 2].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
};
const bezierTangent = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [0, 1, 2].map((i) => 3 * u * u * (p1[i] - p0[i]) + 6 * u * t * (p2[i] - p1[i]) + 3 * t * t * (p3[i] - p2[i]));
};

export function bboneJoints(bone, ctx, rest, debug = null) {
  const n = bone.bbone_segments ?? 1;
  const M = ctx.matrix(bone.index, rest);
  const space = scaledSpace(M);
  const { S } = space;
  const Lp = bone.length * S[1];
  const v = bboneValues(ctx.edit(bone), rest ? null : ctx.posed(bone), rest);
  const start = handleEnd('start', bone, ctx, rest, space, Lp), end = handleEnd('end', bone, ctx, rest, space, Lp);
  let easeIn = v.bbone_easein, easeOut = v.bbone_easeout;
  const scaleIn = v.bbone_scalein.slice(), scaleOut = v.bbone_scaleout.slice();
  if (!rest) {
    const flags = (e) => bone[`bbone_handle_use_scale_${e}`] ?? [false, false, false];
    if (start) {
      const sc = ctx.scale(start.hb);
      flags('start').forEach((f, i) => { if (f) scaleIn[i] *= sc[i]; });
      if (bone.bbone_handle_use_ease_start) easeIn *= sc[1];
    }
    if (end) {
      const sc = ctx.scale(end.hb);
      flags('end').forEach((f, i) => { if (f) scaleOut[i] *= sc[i]; });
      if (bone.bbone_handle_use_ease_end) easeOut *= sc[1];
    }
  }
  if (bone.use_scale_easing) { easeIn *= scaleIn[1]; easeOut *= scaleOut[1]; }
  const d1 = start?.d ?? [0, 1, 0], d2 = end?.d ?? [0, 1, 0];
  let roll1 = (start?.roll ?? 0) + v.bbone_rollin, roll2 = (end?.roll ?? 0) + v.bbone_rollout;
  if (bone.use_endroll_as_inroll && start) {
    const hb = ctx.bones[start.hb], hv = bboneValues(ctx.edit(hb), rest ? null : ctx.posed(hb), rest);
    roll1 += hv.bbone_rollout;
  }
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
  const hlen = Lp / (3 * Math.cos(phi / 4) ** 2);
  const h1 = add(scaleV(d1, hlen * easeIn), [v.bbone_curveinx * S[0], 0, v.bbone_curveinz * S[2]]);
  const h2 = add(scaleV(d2, -hlen * easeOut), [v.bbone_curveoutx * S[0], 0, v.bbone_curveoutz * S[2]]);
  const P0 = [0, 0, 0], P1 = h1, P3 = [0, Lp, 0], P2 = add(P3, h2);
  if (debug) Object.assign(debug, { h1, h2, roll1, roll2, S, d1, d2 });
  // Arc length table over 32 steps.
  const dist = [0];
  let prev = P0;
  for (let i = 1; i <= SAMPLES; i++) {
    const p = bezier(P0, P1, P2, P3, i / SAMPLES);
    dist.push(dist[i - 1] + len(sub(p, prev)));
    prev = p;
  }
  const segLen = Array.from({ length: n }, (_, k) => (n > 1 ? scaleIn[1] ** (1 - k / (n - 1)) * scaleOut[1] ** (k / (n - 1)) : 1));
  const totalSeg = segLen.reduce((a, b) => a + b, 0);
  const out = new Float64Array((n + 1) * 16);
  let acc = 0;
  for (let j = 0; j <= n; j++) {
    if (j) acc += segLen[j - 1];
    const c = dist[SAMPLES] * acc / totalSeg;
    let i = 1;
    while (i < SAMPLES && dist[i] < c) i++;
    const span = dist[i] - dist[i - 1];
    const t = (i - 1 + (span > 0 ? (c - dist[i - 1]) / span : 0)) / SAMPLES;
    const pos = bezier(P0, P1, P2, P3, t);
    let tan = bezierTangent(P0, P1, P2, P3, t);
    if (!len(tan)) tan = sub(P2, P0);
    if (!len(tan)) tan = [0, 1, 0];
    const roll = roll1 + (roll2 - roll1) * j / n;
    const R = compose3(arc([0, 1, 0], normalize(tan)), rotY(roll));
    const sx = scaleIn[0] + (scaleOut[0] - scaleIn[0]) * j / n, sz = scaleIn[2] + (scaleOut[2] - scaleIn[2]) * j / n;
    const cols = [scaleV(R[0], sx), R[1], scaleV(R[2], sz)];
    // To bone space: diag(S)^-1 @ J @ diag(S).
    const o = j * 16;
    for (let cc = 0; cc < 3; cc++) for (let r = 0; r < 3; r++) out[o + cc * 4 + r] = cols[cc][r] * S[cc] / S[r];
    for (let r = 0; r < 3; r++) out[o + 12 + r] = pos[r] / S[r];
    out[o + 15] = 1;
  }
  return out;
}

// The context bboneJoints reads, over a RigInstance (pose: final pose matrices; rest: rest matrices).
export function bboneContext(inst) {
  const P = inst.program;
  if (!P.connectedChild) {
    P.connectedChild = new Int32Array(P.bones.length).fill(-1);
    for (const b of P.bones) {
      const p = P.parent[b.index];
      if (p >= 0 && b.use_connect && P.connectedChild[p] < 0) P.connectedChild[p] = b.index;
    }
  }
  return {
    bones: P.bones,
    matrix: (b, rest) => (rest ? inst.restView[b] : inst.poseView[b]),
    parent: (b) => P.parent[b],
    connectedChild: (b) => P.connectedChild[b],
    indexOf: (arm, name) => P.objects[arm].boneIndex.get(name) ?? -1,
    scale: (b) => Array.from(inst.scale.subarray(b * 3, b * 3 + 3)),
    // Pose and edit B-Bone values with this instance's driven ones over the description's.
    posed: (bone) => overlay(bone.pose, inst.poseValues, bone.index),
    edit: (bone) => overlay(bone, inst.boneData, bone.index),
  };
}

function overlay(base, values, b) {
  if (!values?.size) return base;
  let out = null;
  for (const [key, v] of values) {
    const [i, prop] = key.split('/');
    if (+i !== b) continue;
    (out ??= { ...base })[prop] = v;
  }
  return out ?? base;
}

function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}
