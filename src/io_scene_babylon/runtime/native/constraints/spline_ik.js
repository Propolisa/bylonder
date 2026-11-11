// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import { mul, invert, col, translation, setTranslation, sub, add, scaleV, len, normalize, normalizedCols, diag, matrixFromQuat, quatFromTo, transformPoint, lerpV, slerp } from '../math.js';
import { bulgeLimit } from './stretch_to.js';

// SPLINE_IK (specs/spline_ik.md): the chain's joints are placed on the target curve's path and each bone is turned
// onto the chord to its next joint. Runs on a whole chain after the chain bones' other constraints (as IK).
//   chain: [{ pose, length }] root first, armature space; curve: { splines, world } of the target object; toPose maps
//   world to armature space.
export default {
  type: 'SPLINE_IK',
  targets: 'chain',
  defaults: {
    chain_count: 1, use_even_divisions: false, use_chain_offset: false, use_curve_radius: true, y_scale_mode: 'FIT_CURVE',
    xz_scale_mode: 'NONE', use_original_scale: true, bulge: 1, use_bulge_min: false, use_bulge_max: false, bulge_min: 1,
    bulge_max: 1, bulge_smooth: 0,
  },
  evaluate: () => null,
  solveCurve,
};

const RESOLUTION = 12;

export function solveCurve(chain, curveObject, toCurvePose, s) {
  const path = curvePath(curveObject.curve, toCurvePose);
  if (!path || path.length < 2) return chain.map((b) => b.pose);
  // Chord stepping uses the bone's length times its own Y scale with BONE_ORIGINAL.
  const lengths = chain.map((b) => b.length * (s.y_scale_mode === 'BONE_ORIGINAL' ? len(col(b.pose, 1)) : 1));
  const joints = s.y_scale_mode === 'FIT_CURVE' ? fitJoints(chain, path, s) : chordJoints(lengths, path);
  if (s.use_chain_offset) {
    const shift = sub(translation(chain[0].pose), joints[0].p);
    joints.forEach((j) => { j.p = add(j.p, shift); });
  }
  // Influence f turns each bone by f of its swing onto the chord (from its parent's result) and blends its scale; a
  // child's head follows its parent's result.
  const f = s.influence ?? 1;
  const out = [];
  chain.forEach((b, i) => {
    const startLocal = i ? mul(invert(chain[i - 1].pose), b.pose) : null;
    const start = normalizedCols(b.pose);
    const base = i ? mul(normalizedCols(out[i - 1]), mul(invert(normalizedCols(chain[i - 1].pose)), start)) : start;
    const next = joints[i + 1], w = next ? f * next.weight : 0;
    const chord = next ? sub(next.p, joints[i].p) : col(base, 1);
    const swing = slerp([1, 0, 0, 0], quatFromTo(col(base, 1), chord), w);
    const rot = mul(matrixFromQuat(swing), base);
    const original = [len(col(b.pose, 0)), len(col(b.pose, 1)), len(col(b.pose, 2))];
    const sy = s.y_scale_mode === 'FIT_CURVE' ? len(chord) / b.length : s.y_scale_mode === 'BONE_ORIGINAL' ? original[1] : 1;
    // With use_original_scale the volume modes act on the stretch over the bone's own Y scale and keep its X and Z.
    const own = s.use_original_scale ? original : [1, 1, 1];
    const sxz = xzScale(sy / own[1], s);
    const r = s.use_curve_radius && next ? (joints[i].radius + next.radius) / 2 : 1;
    const scale = s.xz_scale_mode === 'BONE_ORIGINAL' ? [original[0] * r, sy, original[2] * r] : [own[0] * sxz * r, sy, own[2] * sxz * r];
    const head = i && (w < 1 || !joints[i]) ? translation(mul(out[i - 1], startLocal)) : lerpV(translation(b.pose), joints[i].p, f);
    out.push(setTranslation(mul(rot, diag(scale.map((x, k) => lerp(original[k], x, w)))), head));
  });
  return out;
}

function xzScale(sy, s) {
  if (s.xz_scale_mode === 'INVERSE_PRESERVE') return 1 / sy;
  if (s.xz_scale_mode === 'VOLUME_PRESERVE') return Math.sqrt(bulgeLimit(Math.pow(sy, -s.bulge), s));
  return 1;
}

// The path of the curve's first spline as a polyline in armature space: [{ p, radius, tilt, d }] with arc length d.
export function curvePath(curve, toPose) {
  const spline = curve?.splines?.[0];
  if (!spline) return null;
  const pts = spline.type === 'BEZIER' ? bezierPoints(spline, spline.resolution_u ?? curve.resolution_u ?? RESOLUTION) : spline.points.map((q) => ({ p: q.co.slice(0, 3), radius: q.radius ?? 1, tilt: q.tilt ?? 0 }));
  let d = 0;
  return pts.map((q, i) => {
    const p = transformPoint(toPose, q.p);
    if (i) d += len(sub(p, pts[i - 1].pp));
    q.pp = p;
    return { p, radius: q.radius, tilt: q.tilt, d };
  });
}

export function bezierPoints(spline, res) {
  const pts = spline.points, out = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    for (let j = 0; j < res; j++) {
      const t = j / res, u = 1 - t;
      const p = [0, 1, 2].map((c) => u * u * u * a.co[c] + 3 * u * u * t * (a.right ?? a.co)[c] + 3 * u * t * t * (b.left ?? b.co)[c] + t * t * t * b.co[c]);
      out.push({ p, radius: lerp(a.radius ?? 1, b.radius ?? 1, t), tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t) });
    }
  }
  const last = pts[pts.length - 1];
  out.push({ p: last.co.slice(0, 3), radius: last.radius ?? 1, tilt: last.tilt ?? 0 });
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

// The path point at arc length d (clamped to the ends).
export function at(path, d) {
  const total = path[path.length - 1].d;
  d = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < path.length - 1 && path[i].d < d) i++;
  const a = path[i - 1], b = path[i], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { p: lerpV(a.p, b.p, t), radius: lerp(a.radius, b.radius, t), tilt: lerp(a.tilt, b.tilt, t), d, weight: 1 };
}

// FIT_CURVE: joints at the cumulative rest-length shares of the path (equal shares with use_even_divisions).
function fitJoints(chain, path, s) {
  const total = path[path.length - 1].d, n = chain.length;
  const lengths = chain.map((b) => (s.use_even_divisions ? 1 : b.length));
  const sum = lengths.reduce((a, b) => a + b, 0);
  let acc = 0;
  const joints = [at(path, 0)];
  lengths.forEach((l) => { acc += l; joints.push(at(path, (acc / sum) * total)); });
  return joints.slice(0, n + 1);
}

// NONE and BONE_ORIGINAL: each next joint is where the path is at straight-line distance of the bone's length from the
// previous joint, searched forward along the path.
function chordJoints(lengths, path) {
  const joints = [at(path, 0)];
  let seg = 1;
  for (const length of lengths) {
    const from = joints[joints.length - 1];
    let found = null;
    for (; seg < path.length && !found; seg++) {
      const a = path[seg - 1], c = path[seg];
      if (len(sub(c.p, from.p)) < length) continue;
      // solve |a + t (c - a) - from| = length for the largest root in [0, 1]
      const dv = sub(c.p, a.p), w = sub(a.p, from.p);
      const A = dv[0] ** 2 + dv[1] ** 2 + dv[2] ** 2, B = 2 * (w[0] * dv[0] + w[1] * dv[1] + w[2] * dv[2]), C = w[0] ** 2 + w[1] ** 2 + w[2] ** 2 - length ** 2;
      const t = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
      found = at(path, a.d + t * (c.d - a.d));
      seg--;
    }
    if (!found) {
      // The curve ends within this bone: it turns toward the end by the share of its length the end is away.
      const end = at(path, path[path.length - 1].d);
      joints.push({ ...end, weight: len(sub(end.p, from.p)) / length });
      break;
    }
    joints.push(found);
  }
  return joints;
}
