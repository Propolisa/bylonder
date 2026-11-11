// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, normalizedCols, transformPoint, diag } from '../math.js';
import { bezierPoints } from './spline_ik.js';

// FOLLOW_PATH and CLAMP_TO (specs/follow_path.md). The path is the curve's first spline as a polyline in the curve
// object's space (poly points, or a Bezier sampled resolution_u times per segment), measured by arc length; outside
// 0..1 its first and last segments extend in a straight line. Follow Curve turns the owner by the path's frame G:
// minimum-twist frames at the path points (from the curve's local +Z), tilted, slerped by length.

function polyline(curve) {
  const sp = curve?.splines?.[0];
  if (!sp) return null;
  const pts = sp.type === 'BEZIER' ? bezierPoints(sp, sp.resolution_u ?? curve.resolution_u ?? 12)
    : sp.points.map((q) => ({ p: q.co.slice(0, 3), radius: q.radius ?? 1, tilt: q.tilt ?? 0 }));
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(...pts[i].p.map((v, k) => v - pts[i - 1].p[k])));
  return { pts, d, total: d[d.length - 1] };
}

// Point and radius at fraction f of the arc length, with the segment and fraction (for frames).
function at(path, f) {
  const { pts, d, total } = path, s = f * total;
  let i = 1;
  if (s > 0) while (i < pts.length - 1 && d[i] < s) i++;
  const a = pts[i - 1], b = pts[i], span = d[i] - d[i - 1], t = span ? (s - d[i - 1]) / span : 0;
  return { p: a.p.map((v, k) => v + t * (b.p[k] - v)), radius: a.radius + t * (b.radius - a.radius), k: i - 1, u: t };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Rotate v about unit axis by angle (Rodrigues).
function rotate(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), k = dot(axis, v) * (1 - c), x = crs(axis, v);
  return v.map((vi, i) => vi * c + x[i] * s + axis[i] * k);
}

// Shortest-arc rotation taking unit a to unit b, applied to v.
function arcApply(a, b, v) {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d > 1 - 1e-12) return v;
  const axis = nrm(crs(a, b));
  if (!Math.hypot(...crs(a, b))) return v;
  return rotate(v, axis, Math.acos(d));
}

// Quaternion (w, x, y, z) of a rotation given by its columns.
function quatOfCols([X, Y, Z]) {
  const m00 = X[0], m11 = Y[1], m22 = Z[2], tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); q = [0.25 * s, (Y[2] - Z[1]) / s, (Z[0] - X[2]) / s, (X[1] - Y[0]) / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [(Y[2] - Z[1]) / s, 0.25 * s, (Y[0] + X[1]) / s, (Z[0] + X[2]) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(Z[0] - X[2]) / s, (Y[0] + X[1]) / s, 0.25 * s, (Z[1] + Y[2]) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(X[1] - Y[0]) / s, (Z[0] + X[2]) / s, (Z[1] + Y[2]) / s, 0.25 * s]; }
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}

function colsOfQuat([w, x, y, z]) {
  return [[1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]];
}

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 1 - 1e-12) { const q = a.map((v, i) => v + t * (b[i] - v)); const l = Math.hypot(...q); return q.map((v) => v / l); }
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, i) => (Math.sin((1 - t) * th) * v + Math.sin(t * th) * b[i]) / s);
}

// Point frames of the path (follow_path.md, Follow Curve 1 to 3), as quaternions.
function pathFrames(path, spline) {
  const P = path.pts.map((q) => q.p), n = P.length;
  const T = P.map((p, i) => {
    if (i === 0) return spline.type === 'BEZIER' ? nrm(sub(spline.points[0].right, spline.points[0].co)) : nrm(sub(P[1], P[0]));
    if (i === n - 1) { const l = spline.points[spline.points.length - 1]; return spline.type === 'BEZIER' ? nrm(sub(l.co, l.left)) : nrm(sub(P[n - 1], P[n - 2])); }
    const a = nrm(sub(P[i + 1], P[i])), b = nrm(sub(P[i], P[i - 1]));
    return nrm(a.map((v, k) => v + b[k]));
  });
  let N = [0, 0, 1];
  if (Math.abs(dot(N, T[0])) > 1 - 1e-9) N = [0, 1, 0];
  N = nrm(sub(N, T[0].map((v) => v * dot(N, T[0]))));
  return T.map((t, i) => {
    if (i) N = nrm(arcApply(T[i - 1], t, N));
    const X = crs(t, N), tilt = path.pts[i].tilt ?? 0;
    const cols = [X, t, N].map((c) => (tilt ? rotate(c, t, tilt) : c));
    return quatOfCols(cols);
  });
}

const AXES = { FORWARD_X: [0, 1], FORWARD_Y: [1, 1], FORWARD_Z: [2, 1], TRACK_NEGATIVE_X: [0, -1], TRACK_NEGATIVE_Y: [1, -1], TRACK_NEGATIVE_Z: [2, -1] };
const UP = { UP_X: 0, UP_Y: 1, UP_Z: 2 };

// G as a column-major 4x4 (no translation): the owner's forward axis on the path's tangent, its up axis on the normal.
function curveFrame(path, spline, q, s) {
  path.frames ??= pathFrames(path, spline);
  const k = Math.min(Math.max(q.k, 0), path.frames.length - 2), u = Math.min(1, Math.max(0, q.u));
  const [Fx, Fy, Fz] = colsOfQuat(slerp(path.frames[k], path.frames[k + 1], u));
  const [fwd, sign] = AXES[s.forward_axis] ?? AXES.FORWARD_Y, up = UP[s.up_axis] ?? 2;
  const cols = [];
  cols[fwd] = Fy.map((v) => v * sign);
  cols[up] = Fz;
  const third = 3 - fwd - up;
  if (fwd === up) return null;
  cols[third] = crs(cols[(third + 1) % 3], cols[(third + 2) % 3]);
  return Float64Array.from([...cols[0], 0, ...cols[1], 0, ...cols[2], 0, 0, 0, 0, 1]);
}

const curveOf = (s, program) => { const t = program.objectIndex.get(s.target); return t === undefined ? null : program.objects[t].data; };

export const followPath = {
  type: 'FOLLOW_PATH',
  targets: 'one',
  defaults: { use_fixed_location: false, offset_factor: 0, offset: 0, use_curve_radius: false, use_curve_follow: false, forward_axis: 'FORWARD_Y', up_axis: 'UP_Z' },
  compile(s, { program }) { const c = curveOf(s, program); s._curve = c; s._path = c && polyline(c); },
  evaluate(owner, T, s) {
    if (!s._path || !s._path.total) return null;
    const c = s._curve;
    const f = s.use_fixed_location ? s.offset_factor : ((c.eval_time ?? 0) - s.offset) / (c.path_duration ?? 100);
    const q = at(s._path, f);
    let o = [owner[12], owner[13], owner[14]], R = owner;
    if (s.use_curve_follow) {
      const G = curveFrame(s._path, s._curve.splines[0], q, s);
      if (G) { R = mul(G, owner); o = transformPoint(G, o); }
    }
    R = mul(normalizedCols(T), R);
    if (s.use_curve_radius) R = mul(R, diag([q.radius, q.radius, q.radius]));
    const out = Float64Array.from(R);
    const w = transformPoint(T, q.p.map((v, i) => v + o[i]));
    out[12] = w[0]; out[13] = w[1]; out[14] = w[2];
    return out;
  },
};

const AXIS = { CLAMPTO_X: 0, CLAMPTO_Y: 1, CLAMPTO_Z: 2 };

export const clampTo = {
  type: 'CLAMP_TO',
  targets: 'one',
  defaults: { main_axis: 'CLAMPTO_AUTO', use_cyclic: false },
  compile(s, { program }) {
    const c = curveOf(s, program), sp = c?.splines?.[0];
    s._path = c && polyline(c);
    if (!sp) return;
    // Bounding box of the control points, each grown by its radius.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const q of sp.points) for (let k = 0; k < 3; k++) { const r = q.radius ?? 1; lo[k] = Math.min(lo[k], q.co[k] - r); hi[k] = Math.max(hi[k], q.co[k] + r); }
    s._box = { lo, hi };
  },
  evaluate(owner, T, s) {
    if (!s._path || !s._box) return null;
    const { lo, hi } = s._box;
    const a = AXIS[s.main_axis] ?? [0, 1, 2].reduce((m, k) => (hi[k] - lo[k] > hi[m] - lo[m] ? k : m), 0);
    let f = (owner[12 + a] - lo[a]) / (hi[a] - lo[a]);
    if (s.use_cyclic) { if (f !== 1) f -= Math.floor(f); } else f = Math.min(1, Math.max(0, f));
    const w = transformPoint(T, at(s._path, f).p), out = Float64Array.from(owner);
    out[12] = w[0]; out[13] = w[1]; out[14] = w[2];
    return out;
  },
};
