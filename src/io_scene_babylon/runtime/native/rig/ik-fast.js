// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The IK Standard solver's iteration (src/constraints/ik.js sdls) without allocation: the same steps, weights,
// clamps and stop rule on preallocated Float64Arrays. Used for chains without IK limits (ik.js keeps the general one).
// Selectively damped least squares: Buss and Kim 2005.

import { eulerOf } from '../euler.js';

const STEP_FRACTION = 0.8, STEP_PER_JOINT = 0.4, GAMMA_MAX = Math.PI / 5, STOP_STEP = 1e-3, MIN_ITERATIONS = 12;
const MIN_STRETCH = 0.1, MIN_LENGTH = 1e-3;
const LOCK = ['lock_ik_x', 'lock_ik_y', 'lock_ik_z'], STIFF = ['ik_stiffness_x', 'ik_stiffness_y', 'ik_stiffness_z'];
const MAXC = 64; // columns: 4 per joint, 16 joints

// Scratch, grown on demand and reused across solves.
let cap = 0, local, poses, startOffsets, angleState, swing;
const colJ = new Int32Array(MAXC), colAxis = new Int32Array(MAXC), colW = new Float64Array(MAXC), colStretch = new Float64Array(MAXC);
const colV = new Float64Array(MAXC * 6), rho = new Float64Array(MAXC);
const angles = new Float64Array(MAXC), total = new Float64Array(MAXC), phi = new Float64Array(MAXC), solved = new Float64Array(MAXC);
const held = new Float64Array(MAXC), isHeld = new Uint8Array(MAXC), free = new Int32Array(MAXC);
const jjt = new Float64Array(36), evec = new Float64Array(36), evals = new Float64Array(6), e = new Float64Array(6), rest = new Float64Array(6);
const turn = new Float64Array(48), grow = new Float64Array(16), M = new Float64Array(16), R = new Float64Array(16), T = new Float64Array(16);

function ensure(n) {
  if (n <= cap) return;
  cap = n;
  local = new Float64Array(n * 16); poses = new Float64Array(n * 16); startOffsets = new Float64Array(n * 3);
  angleState = new Float64Array(n * 3);
}

function mulA(out, oo, a, ao, b, bo) {
  const a0 = a[ao], a1 = a[ao + 1], a2 = a[ao + 2], a4 = a[ao + 4], a5 = a[ao + 5], a6 = a[ao + 6], a8 = a[ao + 8], a9 = a[ao + 9], a10 = a[ao + 10];
  const a12 = a[ao + 12], a13 = a[ao + 13], a14 = a[ao + 14];
  for (let c = 0; c < 4; c++) {
    const b0 = b[bo + c * 4], b1 = b[bo + c * 4 + 1], b2 = b[bo + c * 4 + 2], b3 = b[bo + c * 4 + 3];
    T[c * 4] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
    T[c * 4 + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
    T[c * 4 + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    T[c * 4 + 3] = b3;
  }
  for (let i = 0; i < 16; i++) out[oo + i] = T[i];
}

// Rotation about a unit axis (x, y, z) by angle into R, as math.js axisAngleMatrix (through a normalized quaternion).
function axisAngle(x, y, z, angle) {
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  const h = angle / 2, s = Math.sin(h);
  quatToR(Math.cos(h), (x / l) * s, (y / l) * s, (z / l) * s);
}

function quatToR(w, x, y, z) {
  const l = Math.sqrt(w * w + x * x + y * y + z * z) || 1;
  w /= l; x /= l; y /= l; z /= l;
  R.fill(0); R[15] = 1;
  R[0] = 1 - 2 * (y * y + z * z); R[4] = 2 * (x * y - w * z); R[8] = 2 * (x * z + w * y);
  R[1] = 2 * (x * y + w * z); R[5] = 1 - 2 * (x * x + z * z); R[9] = 2 * (y * z - w * x);
  R[2] = 2 * (x * z - w * y); R[6] = 2 * (y * z + w * x); R[10] = 1 - 2 * (x * x + y * y);
}

function compose(n) {
  for (let i = 0; i < 16; i++) poses[i] = local[i];
  for (let j = 1; j < n; j++) mulA(poses, j * 16, poses, (j - 1) * 16, local, j * 16);
}

const colLen = (m, o, c) => Math.sqrt((m[o + c * 4]) ** 2 + (m[o + c * 4 + 1]) ** 2 + (m[o + c * 4 + 2]) ** 2);

// Jacobi eigen-decomposition of the symmetric rows x rows matrix jjt (as math.js symmetricEigen): evals and evec
// (column k of evec, evec[r * rows + k], is the k-th eigenvector).
function eigen(rows) {
  for (let i = 0; i < rows; i++) for (let j = 0; j < rows; j++) evec[i * rows + j] = i === j ? 1 : 0;
  const m = jjt;
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < rows; p++) for (let q = p + 1; q < rows; q++) off += Math.abs(m[p * rows + q]);
    if (off < 1e-30) break;
    for (let p = 0; p < rows; p++) {
      for (let q = p + 1; q < rows; q++) {
        const mpq = m[p * rows + q];
        if (Math.abs(mpq) < 1e-300) continue;
        const th = (m[q * rows + q] - m[p * rows + p]) / (2 * mpq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < rows; k++) { const kp = m[k * rows + p], kq = m[k * rows + q]; m[k * rows + p] = c * kp - s * kq; m[k * rows + q] = s * kp + c * kq; }
        for (let k = 0; k < rows; k++) { const pk = m[p * rows + k], qk = m[q * rows + k]; m[p * rows + k] = c * pk - s * qk; m[q * rows + k] = s * pk + c * qk; }
        for (let k = 0; k < rows; k++) { const kp = evec[k * rows + p], kq = evec[k * rows + q]; evec[k * rows + p] = c * kp - s * kq; evec[k * rows + q] = s * kp + c * kq; }
      }
    }
  }
  for (let i = 0; i < rows; i++) evals[i] = m[i * rows + i];
}

function blockSum(v, vo, rows) {
  let s = 0;
  for (let b = 0; b < rows; b += 3) s += Math.sqrt((v[vo + b]) ** 2 + (v[vo + b + 1]) ** 2 + (v[vo + b + 2]) ** 2);
  return s;
}

// clampStep of ik.js on x[list[0..count)] with the columns' weights.
function clampStep(x, list, count, limit) {
  let m = 0;
  for (let i = 0; i < count; i++) m = Math.max(m, Math.abs(x[i]) * colW[list[i]]);
  if (m <= limit) return;
  const c = limit / m;
  for (let i = 0; i < count; i++) { const w = colW[list[i]]; x[i] *= Math.min(1, c / (w * w)); }
}

// One SDLS step over columns list[0..count) toward err (rows values); result in out[0..count).
function sdlsStep(list, count, err, rows, out) {
  for (let i = 0; i < rows * rows; i++) jjt[i] = 0;
  for (let k = 0; k < count; k++) {
    const vo = list[k] * 6;
    for (let r = 0; r < rows; r++) for (let q = 0; q < rows; q++) jjt[r * rows + q] += colV[vo + r] * colV[vo + q];
  }
  eigen(rows);
  for (let k = 0; k < count; k++) { total[k] = 0; rho[k] = blockSum(colV, list[k] * 6, rows); }
  for (let i = 0; i < rows; i++) {
    const s2 = evals[i];
    if (s2 <= 1e-12) continue;
    const sigma = Math.sqrt(s2);
    let ue = 0, ublocks = 0;
    for (let r = 0; r < rows; r++) ue += evec[r * rows + i] * err[r];
    for (let b = 0; b < rows; b += 3) ublocks += Math.sqrt((evec[b * rows + i]) ** 2 + (evec[(b + 1) * rows + i]) ** 2 + (evec[(b + 2) * rows + i]) ** 2);
    let m = 0;
    for (let k = 0; k < count; k++) {
      const vo = list[k] * 6;
      let d = 0;
      for (let r = 0; r < rows; r++) d += colV[vo + r] * evec[r * rows + i];
      phi[k] = d / sigma;
      m += Math.abs(phi[k]) * rho[k];
    }
    m /= sigma;
    for (let k = 0; k < count; k++) phi[k] *= ue / sigma;
    clampStep(phi, list, count, Math.min(1, ublocks / m) * GAMMA_MAX);
    for (let k = 0; k < count; k++) total[k] += phi[k];
  }
  clampStep(total, list, count, GAMMA_MAX);
  for (let k = 0; k < count; k++) out[k] = total[k];
}

// ik.js limitStretch: a stretch that would shorten a bone below the floor is held there and the rest re-solved.
function limitStretch(nc, err, rows, chainLen, lengths) {
  isHeld.fill(0, 0, nc);
  for (let pass = 0; pass < nc; pass++) {
    let changed = false;
    for (let k = 0; k < nc; k++) {
      if (!colStretch[k] || isHeld[k]) continue;
      const j = colJ[k], s0 = colLen(poses, j * 16, 1), floor = MIN_LENGTH * chainLen / lengths[j];
      if (s0 + colStretch[k] * angles[k] < floor) { isHeld[k] = 1; held[k] = (floor - s0) / colStretch[k]; changed = true; }
    }
    if (!changed) return;
    for (let r = 0; r < rows; r++) rest[r] = err[r];
    let nf = 0;
    for (let k = 0; k < nc; k++) {
      if (isHeld[k]) for (let r = 0; r < rows; r++) rest[r] -= colV[k * 6 + r] * held[k];
      else free[nf++] = k;
    }
    sdlsStep(free, nf, rest, rows, solved);
    for (let k = 0, f = 0; k < nc; k++) angles[k] = isHeld[k] ? held[k] : solved[f++];
  }
}

const allColumns = Int32Array.from({ length: MAXC }, (_, i) => i);

// chain: [{ pose, length, ik }], goal: { position, orientation (normalized 4x4 or null) }, s: IK settings.
// Returns the poses (fresh Float64Arrays) as ik.js sdls does.
export function sdlsFast(chain, goal, s) {
  const n = chain.length, useTail = s.use_tail !== false, joints = useTail ? n : n - 1;
  const useLocation = s.use_location !== false || !goal.orientation;
  const orient = goal.orientation;
  const rows = (useLocation ? 3 : 0) + (orient ? 3 : 0), po = useLocation ? 3 : 0;
  ensure(n);
  const lengths = chain.map((b) => b.length);
  // Per joint: 0 free, 1 Euler locks (angles from start), 2 only Y locked (swing kept in M per joint).
  const mode = new Uint8Array(n), stretchK = new Float64Array(n), weight = new Float64Array(n * 3);
  swing = new Float64Array(n * 16);
  let stretchy = 0;
  for (let j = 0; j < n; j++) {
    const ik = chain[j].ik ?? {};
    const lk = LOCK.map((k) => !!ik[k]);
    mode[j] = lk[1] && !lk[0] && !lk[2] ? 2 : lk.some(Boolean) ? 1 : 0;
    for (let a = 0; a < 3; a++) weight[j * 3 + a] = lk[a] ? 0 : Math.sqrt(1 - (ik[STIFF[a]] ?? 0));
    const k = s.use_stretch ? ik.ik_stretch ?? 0 : 0;
    stretchK[j] = k > 0 ? Math.max(k, MIN_STRETCH) : 0;
    if (j < joints && stretchK[j]) stretchy++;
    for (let i = 0; i < 16; i++) swing[j * 16 + i] = i % 5 === 0 ? 1 : 0;
  }
  angleState.fill(0, 0, n * 3);
  for (let i = 0; i < 16; i++) local[i] = chain[0].pose[i];
  for (let j = 1; j < n; j++) {
    invertInto(M, chain[j - 1].pose);
    mulA(local, j * 16, M, 0, chain[j].pose, 0);
  }
  // Locks act on the joint's whole rotation relative to its rest frame: the locked components of the start rotation
  // (its ZYX Euler angles) are removed and the free angles start from the posed ones (fitted, fuzz/ikls1: 48/48).
  for (let j = 0; j < n; j++) if (mode[j] && chain[j].frame) lockStart(j, chain[j], mode[j]);
  for (let j = 0; j < n; j++) { startOffsets[j * 3] = local[j * 16 + 12]; startOffsets[j * 3 + 1] = local[j * 16 + 13]; startOffsets[j * 3 + 2] = local[j * 16 + 14]; }
  compose(n);
  const last = (n - 1) * 16, lastLen = lengths[n - 1];
  let chainLen = 0;
  for (let j = 0; j < joints; j++) {
    chainLen += lengths[j];
    if (j + 1 < n) {
      const o = j * 16, tx = poses[o + 12] + poses[o + 4] * lengths[j], ty = poses[o + 13] + poses[o + 5] * lengths[j], tz = poses[o + 14] + poses[o + 6] * lengths[j];
      chainLen += Math.sqrt((poses[o + 28] - tx) ** 2 + (poses[o + 29] - ty) ** 2 + (poses[o + 30] - tz) ** 2);
    }
  }
  const segments = joints + stretchy;
  const maxStep = STEP_PER_JOINT * chainLen / segments;
  const turnWeight = useLocation ? chainLen * Math.sqrt(s.orient_weight ?? 1) : 1;
  const [gx, gy, gz] = goal.position;
  const iterations = s.iterations ?? 500;
  for (let it = 0; it < iterations; it++) {
    let ex = poses[last + 12], ey = poses[last + 13], ez = poses[last + 14];
    if (useTail) { ex += poses[last + 4] * lastLen; ey += poses[last + 5] * lastLen; ez += poses[last + 6] * lastLen; }
    const dx = gx - ex, dy = gy - ey, dz = gz - ez, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let ox = 0, oy = 0, oz = 0;
    if (orient) {
      orientationErrorInto(orient, last);
      ox = R[0]; oy = R[1]; oz = R[2];
    }
    if (!dist && !(orient && Math.sqrt(ox * ox + oy * oy + oz * oz))) break;
    // Columns of the Jacobian.
    let nc = 0;
    for (let j = 0; j < joints; j++) {
      const o = j * 16, lx = ex - poses[o + 12], ly = ey - poses[o + 13], lz = ez - poses[o + 14];
      for (let a = 0; a < 3; a++) {
        const w = weight[j * 3 + a];
        if (!(w > 0)) continue;
        let ux, uy, uz;
        if (mode[j] === 1) {
          // Axis k of the Euler turn R = Rx Rz Ry: pose3 * later^T e_k, later the factors after k.
          laterAxis(a, angleState, j * 3);
          ux = poses[o] * R[0] + poses[o + 4] * R[1] + poses[o + 8] * R[2];
          uy = poses[o + 1] * R[0] + poses[o + 5] * R[1] + poses[o + 9] * R[2];
          uz = poses[o + 2] * R[0] + poses[o + 6] * R[1] + poses[o + 10] * R[2];
        } else { ux = poses[o + a * 4]; uy = poses[o + a * 4 + 1]; uz = poses[o + a * 4 + 2]; }
        const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (!ul) continue;
        ux /= ul; uy /= ul; uz /= ul;
        const v = nc * 6;
        if (useLocation) { colV[v] = (uy * lz - uz * ly) * w; colV[v + 1] = (uz * lx - ux * lz) * w; colV[v + 2] = (ux * ly - uy * lx) * w; }
        if (orient) { colV[v + po] = ux * turnWeight * w; colV[v + po + 1] = uy * turnWeight * w; colV[v + po + 2] = uz * turnWeight * w; }
        colJ[nc] = j; colAxis[nc] = a; colW[nc] = w; colStretch[nc] = 0; nc++;
      }
      const k = stretchK[j];
      if (k && useLocation) {
        const yl = colLen(poses, o, 1), v = nc * 6, f = chainLen * k / yl;
        colV[v] = poses[o + 4] * f; colV[v + 1] = poses[o + 5] * f; colV[v + 2] = poses[o + 6] * f;
        if (orient) colV[v + 3] = colV[v + 4] = colV[v + 5] = 0;
        colJ[nc] = j; colAxis[nc] = -1; colW[nc] = k; colStretch[nc] = chainLen * k * k / lengths[j]; nc++;
      }
    }
    const scale = dist ? Math.min(STEP_FRACTION, maxStep / dist) : 1;
    if (useLocation) { e[0] = dx * scale; e[1] = dy * scale; e[2] = dz * scale; }
    if (orient) { e[po] = ox * turnWeight; e[po + 1] = oy * turnWeight; e[po + 2] = oz * turnWeight; }
    sdlsStep(allColumns, nc, e, rows, angles);
    if (stretchy) limitStretch(nc, e, rows, chainLen, lengths);
    turn.fill(0, 0, joints * 3); grow.fill(0, 0, joints);
    let biggest = 0;
    for (let k = 0; k < nc; k++) {
      const w = colW[k];
      if (colStretch[k]) { grow[colJ[k]] += colStretch[k] * angles[k]; biggest = Math.max(biggest, Math.abs(angles[k]) * w * w * 100); }
      else { turn[colJ[k] * 3 + colAxis[k]] += w * w * angles[k]; biggest = Math.max(biggest, Math.abs(angles[k]) * w * w); }
    }
    for (let j = 0; j < joints; j++) {
      const wx = turn[j * 3], wy = turn[j * 3 + 1], wz = turn[j * 3 + 2], angle = Math.sqrt(wx * wx + wy * wy + wz * wz), o = j * 16;
      if (mode[j] === 2) {
        // Keep the swing part of the turned swing: before^-1 * swing' applied to the local matrix.
        for (let i = 0; i < 16; i++) M[i] = swing[o + i];
        if (angle > 0) { axisAngle(wx / angle, wy / angle, wz / angle, angle); mulA(M, 0, M, 0, R, 0); }
        swingOfInto(M); // R = swing of M
        transposeRot(M, swing, o); // M = before^-1 (rotation)
        mulA(M, 0, M, 0, R, 0);
        for (let i = 0; i < 16; i++) swing[o + i] = R[i];
        mulA(local, o, local, o, M, 0);
      } else if (mode[j] === 1) {
        eulerTurnInto(angleState, j * 3); // R = before
        transposeRot(M, R, 0);
        angleState[j * 3] += wx; angleState[j * 3 + 1] += wy; angleState[j * 3 + 2] += wz;
        eulerTurnInto(angleState, j * 3);
        mulA(M, 0, M, 0, R, 0);
        mulA(local, o, local, o, M, 0);
      } else if (angle > 0) {
        axisAngle(wx / angle, wy / angle, wz / angle, angle);
        mulA(local, o, local, o, R, 0);
      }
      if (grow[j]) stretchLocal(j, n, colLen(poses, o, 1), grow[j], lengths[j]);
    }
    compose(n);
    if (it + 1 >= MIN_ITERATIONS && biggest < STOP_STEP) break;
  }
  for (let j = 1; j < n; j++) { local[j * 16 + 12] = startOffsets[j * 3]; local[j * 16 + 13] = startOffsets[j * 3 + 1]; local[j * 16 + 14] = startOffsets[j * 3 + 2]; }
  compose(n);
  return chain.map((_, j) => poses.slice(j * 16, j * 16 + 16));
}

function lockStart(j, bone, kind) {
  const o = j * 16, F = bone.frame, ik = bone.ik ?? {};
  const cols = (m, mo) => [0, 1, 2].map((c) => { const v = [m[mo + c * 4], m[mo + c * 4 + 1], m[mo + c * 4 + 2]], l = Math.hypot(...v) || 1; return { v: v.map((x) => x / l), l }; });
  const f = cols(F, 0).map((c) => c.v), lc = cols(local, o), s = lc.map((c) => c.l), L = lc.map((c) => c.v);
  // T = Rf^T Rl (column-major columns); entry (r, c) = f[r] . L[c]
  const T = (r, c) => f[r][0] * L[c][0] + f[r][1] * L[c][1] + f[r][2] * L[c][2];
  let E;
  if (kind === 1) {
    // The start angles are the ZYX Euler angles of the rotation (fitted: every other order misses by 1e-3 to 1e-2).
    const m = new Float64Array(16);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = T(r, c);
    m[15] = 1;
    const ang = eulerOf(m, 'ZYX');
    LOCK.forEach((k, a) => { if (ik[k]) ang[a] = 0; });
    angleState[j * 3] = ang[0]; angleState[j * 3 + 1] = ang[1]; angleState[j * 3 + 2] = ang[2];
    eulerTurnInto(angleState, j * 3);
    E = Float64Array.from(R);
  } else {
    // Only Y locked: the swing part (no twist about Y) of the start rotation.
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) M[c * 4 + r] = T(r, c);
    M[3] = M[7] = M[11] = M[12] = M[13] = M[14] = 0; M[15] = 1;
    swingOfInto(M);
    E = Float64Array.from(R);
  }
  // local3 = Rf E diag(s), translation kept.
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) local[o + c * 4 + r] = (f[0][r] * E[c * 4] + f[1][r] * E[c * 4 + 1] + f[2][r] * E[c * 4 + 2]) * s[c];
  if (kind === 2) for (let i = 0; i < 16; i++) swing[o + i] = E[i];
}

function stretchLocal(j, n, scale, g, length) {
  const f = (scale + g) / scale, o = j * 16;
  for (let i = 0; i < 12; i++) if (i % 4 < 3) local[o + i] *= f;
  if (j + 1 >= n) return;
  const q = o + 16;
  const tx = (local[q + 12] * scale) / (scale + g), ty = (local[q + 13] * scale + g * length) / (scale + g), tz = (local[q + 14] * scale) / (scale + g);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) local[q + c * 4 + r] /= f;
  local[q + 12] = tx; local[q + 13] = ty; local[q + 14] = tz;
}

// R's first column = 0.4 * the antisymmetric part of want * normalize(tip)^-1 (ik.js orientationError).
function orientationErrorInto(want, last) {
  for (let c = 0; c < 3; c++) {
    const l = colLen(poses, last, c) || 1;
    for (let r = 0; r < 3; r++) M[c * 4 + r] = poses[last + c * 4 + r] / l;
  }
  M[3] = M[7] = M[11] = M[12] = M[13] = M[14] = 0; M[15] = 1;
  invertInto(M, M);
  mulA(M, 0, want, 0, M, 0);
  const g = (r, c) => M[c * 4 + r], k = STEP_FRACTION / 2;
  R[0] = (g(2, 1) - g(1, 2)) * k; R[1] = (g(0, 2) - g(2, 0)) * k; R[2] = (g(1, 0) - g(0, 1)) * k;
}

// The unit axis k of an Euler-locked joint, before the pose: later^T e_k with later the factors after k in
// R = Rx Rz Ry (Rx: later = Rz Ry; Rz: later = Ry; Ry: none). Into R[0..2].
function laterAxis(k, ang, o) {
  let x = +(k === 0), y = +(k === 1), z = +(k === 2);
  // later^T e = Ry^T Rz^T e for k = 0; Ry^T e for k = 2.
  if (k === 0) { const c = Math.cos(ang[o + 2]), s = Math.sin(ang[o + 2]); [x, y] = [c * x + s * y, -s * x + c * y]; }
  if (k === 0 || k === 2) { const c = Math.cos(ang[o + 1]), s = Math.sin(ang[o + 1]); [x, z] = [c * x - s * z, s * x + c * z]; }
  R[0] = x; R[1] = y; R[2] = z;
}

// R = Rx(a) Rz(c) Ry(b), each through axisAngle as ik.js does.
const A = new Float64Array(16);
function eulerTurnInto(ang, o) {
  axisAngle(1, 0, 0, ang[o]); A.set(R);
  axisAngle(0, 0, 1, ang[o + 2]); mulA(A, 0, A, 0, R, 0);
  axisAngle(0, 1, 0, ang[o + 1]); mulA(A, 0, A, 0, R, 0);
  R.set(A);
}

// R = the shortest turn taking Y to M's Y column (ik.js swingOf).
function swingOfInto(m) {
  const l = colLen(m, 0, 1);
  const bx = m[4] / l, by = m[5] / l, bz = m[6] / l;
  if (by < -1 + 1e-12) { quatToR(0, 0, 0, -1); return; }
  // a = (0, 1, 0): cross(a, b) = (bz, 0, -bx), w = 1 + by
  quatToR(1 + by, bz, 0, -bx);
}

function transposeRot(out, m, mo) {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) T[c * 4 + r] = m[mo + r * 4 + c];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = T[c * 4 + r];
  out[3] = out[7] = out[11] = out[12] = out[13] = out[14] = 0; out[15] = 1;
}

function invertInto(out, a) {
  const m0 = a[0], m1 = a[1], m2 = a[2], m4 = a[4], m5 = a[5], m6 = a[6], m8 = a[8], m9 = a[9], m10 = a[10], tx = a[12], ty = a[13], tz = a[14];
  const c0 = m5 * m10 - m6 * m9, c1 = m6 * m8 - m4 * m10, c2 = m4 * m9 - m5 * m8;
  const det = m0 * c0 + m1 * c1 + m2 * c2, d = det ? 1 / det : 0;
  const i0 = c0 * d, i4 = c1 * d, i8 = c2 * d;
  const i1 = (m2 * m9 - m1 * m10) * d, i5 = (m0 * m10 - m2 * m8) * d, i9 = (m1 * m8 - m0 * m9) * d;
  const i2 = (m1 * m6 - m2 * m5) * d, i6 = (m2 * m4 - m0 * m6) * d, i10 = (m0 * m5 - m1 * m4) * d;
  out[0] = i0; out[1] = i1; out[2] = i2; out[3] = 0; out[4] = i4; out[5] = i5; out[6] = i6; out[7] = 0;
  out[8] = i8; out[9] = i9; out[10] = i10; out[11] = 0;
  out[12] = -(i0 * tx + i4 * ty + i8 * tz); out[13] = -(i1 * tx + i5 * ty + i9 * tz); out[14] = -(i2 * tx + i6 * ty + i10 * tz); out[15] = 1;
}
