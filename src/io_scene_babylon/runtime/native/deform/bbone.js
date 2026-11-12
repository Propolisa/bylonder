// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// B-Bone segment joints (specs/bbone.md): the bone's curve from its handles and B-Bone values, and the n + 1 joint
// matrices in bone space for the pose shape or the rest shape.
//
// bboneJoints(bone, ctx, rest) -> Float64Array((n + 1) * 16), joint j at j * 16, column-major.
//   bone: the program's bone record (edit values and handle settings by RNA name, pose values on bone.pose).
//   ctx: { matrix(b, rest) -> 4x4 pose or rest matrix of bone index b (armature space), poseValue(b, name),
//          scale(b) -> the handle bone's scale in its LOCAL space, bones, connectedChild(b), parent(b) }.
import { invert, mul, normalize, cross, dot, len, sub, scaleV, add } from '../math.js';
import { toSpace } from '../spaces.js';

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
// For a sheared handle frame (non-orthogonal columns) the mean of the angles read from its X and Z columns (bbone.md
// Open: the spec's best approximation, exact wherever the frame is orthogonal).
function rollOf(F) {
  const T = compose3(transpose(arc([0, 1, 0], normalize(F[1]))), F);
  return 0.5 * (Math.atan2(-T[0][2], T[0][0]) + Math.atan2(T[2][0], T[2][2]));
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
  if (debug) Object.assign(debug, { h1, h2, roll1, roll2, S, d1, d2 });
  // The curve P0 = 0, P1 = h1, P2 = P3 + h2, P3 = (0, Lp, 0), as scalars; arc length table over SAMPLES steps.
  const p1x = h1[0], p1y = h1[1], p1z = h1[2], p2x = h2[0], p2y = Lp + h2[1], p2z = h2[2];
  const dist = DIST;
  dist[0] = 0;
  let qx = 0, qy = 0, qz = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES, u = 1 - t, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    const x = b1 * p1x + b2 * p2x, y = b1 * p1y + b2 * p2y + b3 * Lp, z = b1 * p1z + b2 * p2z;
    dist[i] = dist[i - 1] + Math.sqrt((x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2);
    qx = x; qy = y; qz = z;
  }
  // Segment lengths scale from Scale In Y to Scale Out Y.
  let totalSeg = 0;
  for (let k = 0; k < n; k++) totalSeg += segLength(scaleIn[1], scaleOut[1], k, n);
  const out = new Float64Array((n + 1) * 16);
  let acc = 0;
  for (let j = 0; j <= n; j++) {
    if (j) acc += segLength(scaleIn[1], scaleOut[1], j - 1, n);
    const c = dist[SAMPLES] * acc / totalSeg;
    let i = 1;
    while (i < SAMPLES && dist[i] < c) i++;
    const span = dist[i] - dist[i - 1];
    // Clamped: rounding past t = 1 would reverse a zero-length end handle's tangent.
    const t = Math.min(1, (i - 1 + (span > 0 ? (c - dist[i - 1]) / span : 0)) / SAMPLES), u = 1 - t;
    const b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    const px = b1 * p1x + b2 * p2x, py = b1 * p1y + b2 * p2y + b3 * Lp, pz = b1 * p1z + b2 * p2z;
    const c0 = 3 * u * u, c1 = 6 * u * t, c2 = 3 * t * t;
    let tx = c0 * p1x + c1 * (p2x - p1x) - c2 * p2x, ty = c0 * p1y + c1 * (p2y - p1y) + c2 * (Lp - p2y), tz = c0 * p1z + c1 * (p2z - p1z) - c2 * p2z;
    // End joints (bbone.md step 4): a short end handle is lengthened by the second derivative,
    // T = B' + lam B'' at t = 0 and B' - lam B'' at t = 1, lam = max(0, 0.05 - |B'| / |B''|).
    if (j === 0 || j === n) {
      const end = j === n;
      // B'(0) = 3 P1, B''(0) = 6 (P2 - 2 P1); B'(1) = 3 (P3 - P2), B''(1) = 6 (P3 - 2 P2 + P1).
      tx = end ? -3 * p2x : 3 * p1x; ty = end ? 3 * (Lp - p2y) : 3 * p1y; tz = end ? -3 * p2z : 3 * p1z;
      const ax = end ? 6 * (-2 * p2x + p1x) : 6 * (p2x - 2 * p1x);
      const ay = end ? 6 * (Lp - 2 * p2y + p1y) : 6 * (p2y - 2 * p1y);
      const az = end ? 6 * (-2 * p2z + p1z) : 6 * (p2z - 2 * p1z);
      const la = Math.sqrt(ax * ax + ay * ay + az * az);
      if (la) {
        const lam = Math.max(0, 0.05 - Math.sqrt(tx * tx + ty * ty + tz * tz) / la), s = end ? -lam : lam;
        tx += s * ax; ty += s * ay; tz += s * az;
      }
    }
    if (!(tx || ty || tz)) ty = 1;
    const roll = roll1 + (roll2 - roll1) * j / n;
    const sx = scaleIn[0] + (scaleOut[0] - scaleIn[0]) * j / n, sz = scaleIn[2] + (scaleOut[2] - scaleIn[2]) * j / n;
    jointInto(out, j * 16, tx, ty, tz, roll, sx, sz, S, px, py, pz);
  }
  return out;
}

const DIST = new Float64Array(SAMPLES + 1);
const segLength = (yin, yout, k, n) => (n > 1 ? yin ** (1 - k / (n - 1)) * yout ** (k / (n - 1)) : 1);

// Joint matrix in bone space: R = arc(Y, tangent) @ rotY(roll), X and Z columns scaled by sx, sz, at (px, py, pz) in
// the scaled bone space; written as diag(S)^-1 @ J @ diag(S).
function jointInto(out, o, tx, ty, tz, roll, sx, sz, S, px, py, pz) {
  const l = Math.sqrt(tx * tx + ty * ty + tz * tz);
  tx /= l; ty /= l; tz /= l;
  // arc(Y, t) as axis-angle (arc above): axis normalize(Y x t) = (tz, 0, -tx), angle acos(ty).
  let ax = 0, ay = 0, az = 1, angle = 0;
  if (ty < -1 + 1e-12) { ax = 0; ay = 0; az = -1; angle = Math.PI; }
  else if (ty <= 1 - 1e-12) { const k = Math.sqrt(tz * tz + tx * tx) || 1; ax = tz / k; az = -tx / k; angle = Math.acos(ty); }
  const c = Math.cos(angle), s = Math.sin(angle), v = 1 - c;
  // A (columns), as axisAngleCols.
  const a00 = v * ax * ax + c, a01 = v * ax * ay + s * az, a02 = v * ax * az - s * ay;
  const a10 = v * ax * ay - s * az, a11 = v * ay * ay + c, a12 = v * ay * az + s * ax;
  const a20 = v * ax * az + s * ay, a21 = v * ay * az - s * ax, a22 = v * az * az + c;
  // R = A @ rotY(roll): rotY columns (cr, 0, -sr), (0, 1, 0), (sr, 0, cr).
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const R = JOINT;
  R[0] = (a00 * cr - a20 * sr) * sx; R[1] = (a01 * cr - a21 * sr) * sx; R[2] = (a02 * cr - a22 * sr) * sx;
  R[3] = a10; R[4] = a11; R[5] = a12;
  R[6] = (a00 * sr + a20 * cr) * sz; R[7] = (a01 * sr + a21 * cr) * sz; R[8] = (a02 * sr + a22 * cr) * sz;
  for (let cc = 0; cc < 3; cc++) for (let r = 0; r < 3; r++) out[o + cc * 4 + r] = R[cc * 3 + r] * S[cc] / S[r];
  out[o + 3] = out[o + 7] = out[o + 11] = 0;
  out[o + 12] = px / S[0]; out[o + 13] = py / S[1]; out[o + 14] = pz / S[2]; out[o + 15] = 1;
}
const JOINT = new Float64Array(9);

// The context bboneJoints reads, over a RigInstance (pose: final pose matrices; rest: rest matrices). It reads the
// instance live; only its grouping of driven B-Bone values is kept, until a driver writes one again.
export function bboneContext(inst) {
  const version = inst.bboneValuesVersion ?? 0;
  if (inst.bboneCtx?.version === version) return inst.bboneCtx.ctx;
  const ctx = makeContext(inst);
  inst.bboneCtx = { version, ctx };
  return ctx;
}

function makeContext(inst) {
  const P = inst.program;
  if (!P.connectedChild) {
    P.connectedChild = new Int32Array(P.bones.length).fill(-1);
    for (const b of P.bones) {
      const p = P.parent[b.index];
      if (p >= 0 && b.use_connect && P.connectedChild[p] < 0) P.connectedChild[p] = b.index;
    }
  }
  const posed = byBone(inst.poseValues), edit = byBone(inst.boneData);
  return {
    bones: P.bones,
    matrix: (b, rest) => (rest ? inst.restView[b] : inst.poseView[b]),
    parent: (b) => P.parent[b],
    connectedChild: (b) => P.connectedChild[b],
    indexOf: (arm, name) => P.objects[arm].boneIndex.get(name) ?? -1,
    // A handle bone's scale for the handle scale flags: the axis lengths of its final pose in its LOCAL space (its
    // channels when no constraint scales it; fitted on two Snow rigs: a handle given its scale by Copy Scale under an
    // Inherit Scale None parent, and a handle that only inherits scale; bbone.md says channels).
    scale: (b) => {
      const P = inst.program, L = toSpace('LOCAL', mul(inst.worldView[P.bones[b].arm], inst.poseView[b]), inst.targetEnt[b]);
      return [0, 1, 2].map((c) => Math.hypot(L[c * 4], L[c * 4 + 1], L[c * 4 + 2]));
    },
    // Pose and edit B-Bone values with this instance's driven ones over the description's.
    posed: (bone) => overlay(bone.pose, posed, bone.index),
    edit: (bone) => overlay(bone, edit, bone.index),
  };
}

// Driven values ("bone/prop" keys) grouped by bone index.
function byBone(values) {
  const out = new Map();
  for (const [key, v] of values ?? []) {
    const i = key.indexOf('/'), b = +key.slice(0, i);
    if (!out.has(b)) out.set(b, []);
    out.get(b).push(key.slice(i + 1), v);
  }
  return out;
}

function overlay(base, grouped, b) {
  const list = grouped.get(b);
  if (!list) return base;
  const out = { ...base };
  for (let i = 0; i < list.length; i += 2) out[list[i]] = list[i + 1];
  return out;
}
