// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
import {
  mul, invert, clone, col, translation, setTranslation, translationMatrix, sub, add, scaleV, dot, cross,
  len, normalize, lerpV, matrixFromQuat, quatFromTo, axisAngleMatrix, normalizedCols, diag, symmetricEigen, get, mat, transformDir,
} from '../math.js';
import { blendMatrices } from '../blend.js';
import { sdlsFast } from '../rig/ik-fast.js';
import { eulerOf } from '../euler.js';

// IK, Standard solver (specs/ik.md). Runs on a whole chain after the chain bones' other constraints, so the solver
// calls `solveChain` instead of `evaluate`. Poses are armature space.
//   chain: [{ pose, length, ik }] root first; ik holds the pose bone's lock_ik_*, ik_stiffness_*, ik_stretch.
//   target, pole: points in armature space (pole may be null).
export default {
  type: 'IK',
  targets: 'chain',
  defaults: {
    pole_angle: 0, iterations: 500, chain_count: 0, use_tail: true, use_stretch: true,
    use_location: true, weight: 1, use_rotation: false, orient_weight: 1,
  },
  evaluate: () => null,
  solveChain,
};

const aboutPoint = (rot, p) => mul(mul(translationMatrix(p), rot), translationMatrix(scaleV(p, -1)));
const yAxis = (m) => col(m, 1);
const tailOf = (m, length) => add(translation(m), scaleV(yAxis(m), length));
const project = (v, n) => sub(v, scaleV(n, dot(v, n)));

export function solveChain(chain, target, pole, s, targetMatrix) {
  const start = chain.map((b) => b.pose);
  const joints = s.use_tail ? chain : chain.slice(0, -1);
  if (!joints.length) return start;
  const influence = s.influence ?? 1;
  // Beyond the spec: without a pole, influence moves the target from the start effector toward the real one and the
  // solver runs at full strength (fuzz: exact; a blend of the solved chain is not). With a pole the chain is first
  // turned as in the spec's steps 2-4, then solved the same way (the spec's two-bone bend is what the solver reaches;
  // three-bone chains match too), and influence blends the chain (spec).
  const goal = { position: target, orientation: s.use_rotation && targetMatrix && s.use_tail ? normalizedCols(targetMatrix) : null };
  const solve = chain.some(hasLimits) || globalThis.__ikGeneral ? sdls : sdlsFast;
  const poses = pole
    ? solve(poleAligned(chain, target, pole, s), goal, s)
    : solve(chain, { ...goal, position: influence < 1 ? lerpV(effectorOf(chain, s), target, influence) : target }, s);
  return pole && influence < 1 ? blendChain(start, poses, influence) : poses;
}

const effectorOf = (chain, s) => {
  const last = chain[chain.length - 1];
  return s.use_tail ? tailOf(last.pose, last.length) : translation(last.pose);
};

// Spec steps 2-4: the chain turned about its root head so the effector points at the target and the root's X axis
// (turned by -pole_angle about its Y) points at the pole.
function poleAligned(chain, t, p, s) {
  const poses = chain.map((b) => b.pose);
  const H = translation(poses[0]);
  const u = normalize(sub(t, H));
  let A = matrixFromQuat(quatFromTo(sub(effectorOf(chain, s), H), u));
  const root = mul(A, poses[0]);
  const x = normalize(project(transformDirRot(axisAngleMatrix(normalize(col(root, 1)), -s.pole_angle), col(root, 0)), u));
  const q = normalize(project(sub(p, H), u));
  if (len(x) && len(q)) A = mul(axisAngleMatrix(u, signedAngle(x, q, u)), A);
  const M = aboutPoint(A, H);
  return chain.map((b, i) => ({ ...b, pose: mul(M, poses[i]) }));
}

function signedAngle(a, b, axis) {
  return Math.atan2(dot(cross(a, b), axis), dot(a, b));
}

function transformDirRot(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}

// Beyond the spec (fitted on oracle runs with iterations 1..N, exact per step): Blender's Standard solver is selectively
// damped least squares (Buss and Kim 2005) from the start pose. Each joint turns in its own frame (a rotation
// right-multiplied onto its matrix relative to its parent); the effector error is scaled to
// min(0.8 |e|, 0.4 * chain length / segments) (segments: joints plus stretchy bones), the chain length counting the gaps
// between a bone's tail and its child's head; gamma_max is pi/5. It runs at least 12 steps (fewer if `iterations` says
// so), then stops after a step whose every rotation is below 1e-3 and every stretch below 1e-5 (stepSize).
const STEP_FRACTION = 0.8, STEP_PER_JOINT = 0.4, GAMMA_MAX = Math.PI / 5, STOP_STEP = 1e-3, MIN_ITERATIONS = 12;
// A step's size in units of STOP_STEP: a rotation's angle, a stretch's w^2 a times 100.
const stepSize = (column, a) => Math.abs(a) * column.w ** 2 * (column.stretch ? 100 : 1);
// Stretch (fitted per step): weight k = max(ik_stretch, 0.1); a bone's length never drops below 0.001 * chain length.
const MIN_STRETCH = 0.1, MIN_LENGTH = 1e-3;

function sdls(chain, goal, s) {
  const useLocation = s.use_location !== false || !goal.orientation;
  const n = chain.length, joints = s.use_tail ? n : n - 1;
  const local = chain.map((b, i) => (i ? mul(invert(chain[i - 1].pose), b.pose) : clone(b.pose)));
  const offsets = local.map(translation);
  const startLocal = local.map(clone);
  const compose = () => {
    const out = [];
    local.forEach((l, i) => out.push(i ? mul(out[i - 1], l) : l));
    return out;
  };
  const effector = (p) => (s.use_tail ? tailOf(p[n - 1], chain[n - 1].length) : translation(p[n - 1]));
  let poses = compose();
  const segments = joints + chain.slice(0, joints).filter((b) => stretchOf(b, s)).length;
  const chainLen = chainLength(chain, poses, joints);
  const maxStep = STEP_PER_JOINT * chainLen / segments;
  const turnWeight = useLocation ? chainLen * Math.sqrt(s.orient_weight ?? 1) : 1;
  const euler = chain.map((b) => (onlyTwistLocked(b) ? { swing: mat() } : AXES.some((a) => b.ik?.[`lock_ik_${a}`]) ? [0, 0, 0] : null));
  // Locks act on the whole rotation relative to the joint's rest frame (as src/rig/ik-fast.js lockStart).
  chain.forEach((b, j) => {
    if (!euler[j] || !b.frame) return;
    const Rf = normalizedCols(b.frame), s3 = [0, 1, 2].map((c) => len(col(local[j], c)));
    const T = mul(invert(Rf), normalizedCols(local[j]));
    let E;
    if (Array.isArray(euler[j])) {
      const ang = eulerOf(T, 'ZYX').map((v, a) => (b.ik?.[`lock_ik_${AXES[a]}`] ? 0 : v));
      euler[j] = ang;
      E = eulerTurn(ang);
    } else {
      E = swingOf(T);
      euler[j].swing = E;
    }
    local[j] = setTranslation(mul(mul(Rf, E), diag(s3)), translation(local[j]));
  });
  startLocal.forEach((_, j) => { startLocal[j] = clone(local[j]); });
  poses = compose();
  for (let it = 0; it < (s.iterations ?? 500); it++) {
    const eff = effector(poses);
    const err = sub(goal.position, eff);
    const dist = len(err);
    const turnErr = goal.orientation && orientationError(goal.orientation, poses[n - 1]);
    if (!dist && !(turnErr && len(turnErr))) break;
    const rows = (position, orientation) => [...(useLocation ? position : []), ...(goal.orientation ? orientation : [])];
    const columns = [];
    for (let j = 0; j < joints; j++) {
      const lever = sub(eff, translation(poses[j]));
      jointAxes(chain[j], poses[j], euler[j]).forEach((unit, axis) => {
        const w = Math.sqrt(1 - (chain[j].ik?.[`ik_stiffness_${AXES[axis]}`] ?? 0));
        if (unit && w > 0) columns.push({ j, axis, w, v: rows(scaleV(cross(unit, lever), w), scaleV(unit, turnWeight * w)) });
      });
      const k = stretchOf(chain[j], s);
      if (k && useLocation) columns.push({ j, w: k, stretch: chainLen * k * k / chain[j].length, v: rows(scaleV(normalize(col(poses[j], 1)), chainLen * k), [0, 0, 0]) });
    }
    const e = rows(dist ? scaleV(err, Math.min(STEP_FRACTION, maxStep / dist)) : err, turnErr ? scaleV(turnErr, turnWeight) : []);
    let angles = limitStretch(columns, e, sdlsStep(columns, e), poses, chainLen, chain);
    angles = holdLimits(columns, e, angles, chain, startLocal, local);
    const turn = Array.from({ length: joints }, () => [0, 0, 0]);
    const grow = Array.from({ length: joints }, () => 0);
    columns.forEach((c, k) => {
      if (c.stretch) grow[c.j] += c.stretch * angles[k];
      else turn[c.j][c.axis] += c.w * c.w * angles[k];
    });
    turn.forEach((w, j) => {
      const angle = len(w);
      if (euler[j]?.swing) {
        const before = euler[j].swing;
        euler[j].swing = swingOf(angle > 0 ? mul(before, axisAngleMatrix(scaleV(w, 1 / angle), angle)) : before);
        local[j] = mul(local[j], mul(invert(before), euler[j].swing));
      } else if (euler[j]) {
        const before = eulerTurn(euler[j]);
        euler[j] = add(euler[j], w);
        local[j] = mul(local[j], mul(invert(before), eulerTurn(euler[j])));
      } else if (angle > 0) local[j] = mul(local[j], axisAngleMatrix(scaleV(w, 1 / angle), angle));
      if (grow[j]) stretchLocal(local, j, len(col(poses[j], 1)), grow[j], chain[j].length);
      if (hasLimits(chain[j])) local[j] = limitJoint(chain[j].ik, startLocal[j], local[j]);
    });
    poses = compose();
    if (it + 1 >= MIN_ITERATIONS && Math.max(...angles.map((a, k) => stepSize(columns[k], a))) < STOP_STEP) break;
  }
  // The solver moves a child by its parent's change of length only; the pose places it from the parent's scaled matrix.
  for (let i = 1; i < n; i++) local[i] = setTranslation(local[i], offsets[i]);
  return compose();
}

// Beyond the spec (fitted per step, fuzz/lock1, all exact): a joint turns about its own current axes. A joint with a
// locked axis turns from its start by angles R = Rx Rz Ry (swing, then twist about Y; locked angles stay 0), its free
// axes being those of the partial products; with only Y locked it turns about its current X and Z and keeps the swing
// part of the result (the turn taking Y to its image), dropping the twist.
const AXES = ['x', 'y', 'z'];

const onlyTwistLocked = (b) => b.ik?.lock_ik_y && !b.ik?.lock_ik_x && !b.ik?.lock_ik_z;

// Swing part of a rotation (the turn taking Y to its image, no twist about Y).
function swingOf(r) {
  return matrixFromQuat(quatFromTo([0, 1, 0], col(r, 1)));
}

function jointAxes(bone, pose, angles) {
  return AXES.map((a, k) => {
    if (bone.ik?.[`lock_ik_${a}`]) return null;
    if (!Array.isArray(angles)) return normalize(col(pose, k));
    const later = ORDER.slice(ORDER.indexOf(k) + 1).reduce((m, i) => mul(m, axisRotation(i, angles[i])), mat());
    return normalize(transformDir(pose, transformDir(invert(later), unitAxis(k))));
  });
}

// Beyond the spec (fitted, fuzz/lock1 limz): a joint's limits act on its turn from the start, split into a swing (the
// shortest turn taking Y to its image) and a twist about Y. The swing quaternion's X and Z components are clamped to
// sin(limit / 2), the twist angle to its limits.
const hasLimits = (b) => AXES.some((a) => b.ik?.[`use_ik_limit_${a}`]);

function swingTwist(start, current) {
  const turn = mul(invert(linearOf(start)), linearOf(current));
  const R = normalizedCols(turn);
  const q = quatFromTo([0, 1, 0], col(R, 1));
  const twistM = mul(invert(matrixFromQuat(q)), R);
  return { f: len(col(turn, 1)), x: q[1], z: q[3], y: Math.atan2(get(twistM, 0, 2), get(twistM, 0, 0)) };
}

// Each limited value (swing quaternion X and Z as sin of half the limit, twist angle) and its bounds.
function bounds(ik, a) {
  if (!ik[`use_ik_limit_${a}`]) return null;
  const lo = ik[`ik_min_${a}`] ?? 0, hi = ik[`ik_max_${a}`] ?? 0;
  return a === 'y' ? [lo, hi] : [Math.sin(lo / 2), Math.sin(hi / 2)];
}

// How far each axis' value lies outside its bounds (0 inside).
function overLimit(ik, start, current) {
  const st = swingTwist(start, current);
  const over = AXES.map((a) => { const b = bounds(ik, a); return b ? Math.max(b[0] - st[a], st[a] - b[1], 0) : 0; });
  const bx = bounds(ik, 'x'), bz = bounds(ik, 'z');
  if (bx && bz) { const r = Math.hypot(st.x / (st.x < 0 ? -bx[0] : bx[1]), st.z / (st.z < 0 ? -bz[0] : bz[1])); over[0] = over[2] = Math.max(0, r - 1); }
  return over;
}

function limitJoint(ik, start, current) {
  const st = swingTwist(start, current);
  let [x, y, z] = AXES.map((a) => { const b = bounds(ik, a); return b ? Math.min(b[1], Math.max(b[0], st[a])) : st[a]; });
  const bx = bounds(ik, 'x'), bz = bounds(ik, 'z');
  if (bx && bz) {
    const rx = st.x < 0 ? -bx[0] : bx[1], rz = st.z < 0 ? -bz[0] : bz[1];
    const r = Math.hypot(st.x / rx, st.z / rz);
    [x, z] = r > 1 ? [st.x / r, st.z / r] : [st.x, st.z];
  }
  const swing = matrixFromQuat([Math.sqrt(Math.max(0, 1 - x * x - z * z)), x, 0, z]);
  const turned = mul(mul(linearOf(start), mul(swing, axisRotation(1, y))), diag([st.f, st.f, st.f]));
  return setTranslation(turned, translation(current));
}

const linearOf = (m) => setTranslation(clone(m), [0, 0, 0]);

const unitAxis = (k) => [0, 1, 2].map((i) => +(i === k));
const axisRotation = (k, angle) => axisAngleMatrix(unitAxis(k), angle);
const ORDER = [0, 2, 1];
const eulerTurn = (angles) => ORDER.reduce((m, k) => mul(m, axisRotation(k, angles[k])), mat());

// Beyond the spec (fitted per step, use_rotation): the orientation rows of the Jacobian are the joints' unit axes and the
// orientation error is 0.8 * (sin angle) * axis of the turn from the tip to the target, read from the antisymmetric part
// of target * tip^-1. With use_location on, the orientation rows and error are weighted by chain length *
// sqrt(orient_weight).
function orientationError(want, tip) {
  const d = mul(want, invert(normalizedCols(tip)));
  return scaleV([get(d, 2, 1) - get(d, 1, 2), get(d, 0, 2) - get(d, 2, 0), get(d, 1, 0) - get(d, 0, 1)], STEP_FRACTION / 2);
}

// Beyond the spec (fitted per step): a bone with ik_stretch > 0 gets a stretch degree of freedom along its own Y axis,
// counted as one more segment in the step clamp, with weight k = max(ik_stretch, 0.1). Its column is the unit Y axis
// times chain length times k; a step a adds chain length * k^2 * a / bone length to the bone's scale (uniform; its
// children keep their pose-space scale and move by the change of length along the bone).
function stretchOf(bone, s) {
  const k = s.use_stretch ? bone.ik?.ik_stretch ?? 0 : 0;
  return k > 0 ? Math.max(k, MIN_STRETCH) : 0;
}

function stretchLocal(local, j, scale, grow, length) {
  const f = (scale + grow) / scale;
  local[j] = mul(local[j], diag([f, f, f]));
  if (j + 1 >= local.length) return;
  const t = scaleV(add(scaleV(translation(local[j + 1]), scale), [0, grow * length, 0]), 1 / (scale + grow));
  local[j + 1] = setTranslation(mul(diag([1 / f, 1 / f, 1 / f]), local[j + 1]), t);
}

// A stretch that would shorten a bone below MIN_LENGTH * chain length is held there and the step is solved again for
// the other columns with the error it leaves (fitted; exact on single bones, about 5e-2 off on some chains).
function limitStretch(columns, e, angles, poses, chainLen, chain) {
  const held = new Map();
  for (let pass = 0; pass < columns.length; pass++) {
    let changed = false;
    columns.forEach((c, k) => {
      if (!c.stretch || held.has(k)) return;
      const s0 = len(col(poses[c.j], 1)), floor = MIN_LENGTH * chainLen / chain[c.j].length;
      if (s0 + c.stretch * angles[k] < floor) { held.set(k, (floor - s0) / c.stretch); changed = true; }
    });
    if (!changed) return angles;
    let rest = e;
    held.forEach((a, k) => { rest = rest.map((x, r) => x - columns[k].v[r] * a); });
    const free = columns.map((_, k) => k).filter((k) => !held.has(k));
    const solved = sdlsStep(free.map((k) => columns[k]), rest);
    angles = columns.map((_, k) => (held.has(k) ? held.get(k) : solved[free.indexOf(k)]));
  }
  return angles;
}

// A limited joint whose step would pass a limit holds the offending axis' entry where it meets the limit and the step is
// solved again for the other columns.
function holdLimits(columns, e, angles, chain, startLocal, local) {
  const held = new Map();
  const after = (j, ang) => {
    const w = [0, 0, 0];
    columns.forEach((c, k) => { if (c.j === j && !c.stretch) w[c.axis] += c.w * c.w * ang[k]; });
    const a = len(w);
    return a > 0 ? mul(local[j], axisAngleMatrix(scaleV(w, 1 / a), a)) : local[j];
  };
  for (let pass = 0; pass < columns.length; pass++) {
    let changed = false;
    chain.forEach((b, j) => {
      if (!hasLimits(b)) return;
      const over = overLimit(b.ik, startLocal[j], after(j, angles));
      over.forEach((o, axis) => {
        const k = columns.findIndex((c) => c.j === j && c.axis === axis && !c.stretch);
        if (!o || k < 0 || held.has(k)) return;
        let lo = 0, hi = 1;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2, trial = angles.slice(); trial[k] *= mid;
          if (overLimit(b.ik, startLocal[j], after(j, trial))[axis] > 0) hi = mid; else lo = mid;
        }
        held.set(k, angles[k] * lo); changed = true;
      });
    });
    if (!changed) return angles;
    let rest = e;
    held.forEach((a, k) => { rest = rest.map((x, r) => x - columns[k].v[r] * a); });
    const free = columns.map((_, k) => k).filter((k) => !held.has(k));
    const solved = sdlsStep(free.map((k) => columns[k]), rest);
    angles = columns.map((_, k) => (held.has(k) ? held.get(k) : solved[free.indexOf(k)]));
  }
  return angles;
}

// Bone lengths of the joints plus the gaps from each tail to the next head (up to the effector).
function chainLength(chain, poses, joints) {
  let total = 0;
  for (let j = 0; j < joints; j++) {
    total += chain[j].length;
    if (j + 1 < chain.length) total += len(sub(translation(poses[j + 1]), tailOf(poses[j], chain[j].length)));
  }
  return total;
}

// One SDLS step (Buss and Kim): for each singular direction of J, the pseudo-inverse component clamped to
// gamma_max * min(1, N_i / M_i) (N_i: the norms of u_i's blocks of rows, position and orientation), then the sum
// clamped to gamma_max (clampStep).
function sdlsStep(columns, e) {
  const R = e.length, blocks = (v) => Array.from({ length: R / 3 }, (_, b) => Math.hypot(v[3 * b], v[3 * b + 1], v[3 * b + 2]));
  const jjt = Array.from({ length: R }, () => Array(R).fill(0));
  for (const { v } of columns) for (let r = 0; r < R; r++) for (let k = 0; k < R; k++) jjt[r][k] += v[r] * v[k];
  const { values, vectors } = symmetricEigen(jjt);
  const rho = columns.map((c) => sum(blocks(c.v)));
  let total = columns.map(() => 0);
  values.forEach((s2, i) => {
    if (s2 <= 1e-12) return;
    const sigma = Math.sqrt(s2), u = vectors[i];
    const v = columns.map((c) => dotN(c.v, u) / sigma);
    const m = v.reduce((acc, vl, l) => acc + Math.abs(vl) * rho[l], 0) / sigma;
    const phi = clampStep(v.map((vl) => (dotN(u, e) / sigma) * vl), Math.min(1, sum(blocks(u)) / m) * GAMMA_MAX, columns);
    total = total.map((x, l) => x + phi[l]);
  });
  return clampStep(total, GAMMA_MAX, columns);
}

const sum = (v) => v.reduce((a, b) => a + b, 0);
const dotN = (a, b) => a.reduce((acc, x, i) => acc + x * b[i], 0);

// Beyond the spec (fitted per step): every degree of freedom has a weight w (a rotation sqrt(1 - stiffness), a stretch
// k); its column is scaled by w and its step by w^2. The clamp's largest entry counts each entry times its w; an entry
// scales by min(1, c / w^2) with c = limit / largest, so a clamped stiff entry loses its w^2.
function clampStep(v, limit, columns) {
  const m = Math.max(...v.map((x, i) => Math.abs(x) * columns[i].w));
  if (m <= limit) return v;
  const c = limit / m;
  return v.map((x, i) => x * Math.min(1, c / columns[i].w ** 2));
}

// Spec Influence: each bone's transform relative to its parent blends between start and result, then recomposes.
function blendChain(start, result, f) {
  const out = [];
  for (let i = 0; i < start.length; i++) {
    const a = i ? mul(invert(start[i - 1]), start[i]) : start[i];
    const b = i ? mul(invert(result[i - 1]), result[i]) : result[i];
    const local = blendMatrices(a, b, f);
    out.push(i ? mul(out[i - 1], local) : local);
  }
  return out;
}

