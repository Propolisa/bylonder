// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// F-Curve evaluation (prior/drivers-spec/fcurves.md) on keys whose handles are already Blender's stored ones (the
// description carries handle_left and handle_right as saved), plus the Generator modifier (manual: expanded
// polynomial) and the Cycles modifier (fcurves.md section 7).

const EASE_IN_DEFAULT = new Set(['SINE', 'QUAD', 'CUBIC', 'QUART', 'QUINT', 'EXPO', 'CIRC']);
const IN = {
  SINE: (p) => 1 - Math.cos((p * Math.PI) / 2), QUAD: (p) => p * p, CUBIC: (p) => p ** 3, QUART: (p) => p ** 4,
  QUINT: (p) => p ** 5, CIRC: (p) => 1 - Math.sqrt(1 - p * p),
  EXPO: (p) => (2 ** (10 * (p - 1)) - 2 ** -10) / (1 - 2 ** -10),
  BOUNCE: (p) => 1 - bounce(1 - p),
};
function bounce(q) {
  const k = 7.5625;
  if (q < 1 / 2.75) return k * q * q;
  if (q < 2 / 2.75) return k * (q - 1.5 / 2.75) ** 2 + 0.75;
  if (q < 2.5 / 2.75) return k * (q - 2.25 / 2.75) ** 2 + 0.9375;
  return k * (q - 2.625 / 2.75) ** 2 + 0.984375;
}

function eased(I, easing, p) {
  if (easing === 'EASE_OUT') return 1 - I(1 - p);
  if (easing === 'EASE_IN_OUT') return p < 0.5 ? I(2 * p) / 2 : 1 - I(2 - 2 * p) / 2;
  return I(p);
}

function elastic(k, b, c, d, tau) {
  if (tau <= 0) return b;
  if (tau >= d) return b + c;
  const easing = k.easing === 'AUTO' || !k.easing ? 'EASE_OUT' : k.easing;
  const a = k.amplitude ?? 0.8;
  let P = k.period ?? 4.1;
  if (!P) P = (easing === 'EASE_IN_OUT' ? 0.45 : 0.3) * d;
  const w = (2 * Math.PI) / P;
  let D;
  if (a < Math.abs(c)) {
    const s = P / 4;
    D = (u) => Math.sign(c) * (u < s ? a + (Math.abs(c) - a) * (1 - u / s) : a) * 2 ** (-10 * u / d) * Math.sin(w * (u + s));
  } else {
    const s = (P / (2 * Math.PI)) * Math.asin(c / a);
    D = (u) => a * 2 ** (-10 * u / d) * Math.sin(w * (u + s));
  }
  if (easing === 'EASE_IN') return b + D(d - tau);
  if (easing === 'EASE_IN_OUT') return tau < d / 2 ? b + D(d - 2 * tau) / 2 : b + c - D(2 * tau - d) / 2;
  return b + c - D(tau);
}

function bezierSegment(k0, k1, t) {
  const [x0, y0] = k0.co, [x3, y3] = k1.co, d = x3 - x0;
  let [x1, y1] = k0.handle_right, [x2, y2] = k1.handle_left;
  const l1 = x1 - x0, l2 = x3 - x2;
  if (l1 > d) { const f = d / l1; x1 = x0 + (x1 - x0) * f; y1 = y0 + (y1 - y0) * f; }
  if (l2 > d) { const f = d / l2; x2 = x3 - (x3 - x2) * f; y2 = y3 - (y3 - y2) * f; }
  const at = (u, a, b, c, e) => { const v = 1 - u; return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * e; };
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid, x0, x1, x2, x3) < t) lo = mid; else hi = mid;
  }
  return at((lo + hi) / 2, y0, y1, y2, y3);
}

function segment(k0, k1, t) {
  const b = k0.co[1], c = k1.co[1] - b, d = k1.co[0] - k0.co[0], tau = t - k0.co[0], p = tau / d;
  const mode = k0.interpolation ?? 'BEZIER';
  if (mode === 'CONSTANT') return b;
  if (mode === 'LINEAR') return b + c * p;
  if (mode === 'BEZIER') return bezierSegment(k0, k1, t);
  if (mode === 'ELASTIC') return elastic(k0, b, c, d, tau);
  if (mode === 'BACK') {
    const easing = !k0.easing || k0.easing === 'AUTO' ? 'EASE_OUT' : k0.easing;
    const s = (k0.back ?? 1.70158) * (easing === 'EASE_IN_OUT' ? 1.525 : 1);
    return b + c * eased((q) => q * q * ((s + 1) * q - s), easing, p);
  }
  const I = IN[mode];
  if (!I) return b + c * p;
  const easing = !k0.easing || k0.easing === 'AUTO' ? (EASE_IN_DEFAULT.has(mode) ? 'EASE_IN' : 'EASE_OUT') : k0.easing;
  return b + c * eased(I, easing, p);
}

function extrapolate(keys, t, extrapolation) {
  const first = keys[0], last = keys[keys.length - 1], before = t < first.co[0];
  const k = before ? first : last;
  if (extrapolation !== 'LINEAR' || keys.length < 1) return k.co[1];
  if ((k.interpolation ?? 'BEZIER') === 'CONSTANT') return k.co[1];
  let slope;
  if ((k.interpolation ?? 'BEZIER') === 'BEZIER') {
    const h = before ? k.handle_left : k.handle_right;
    const dx = before ? k.co[0] - h[0] : h[0] - k.co[0];
    slope = dx ? (before ? k.co[1] - h[1] : h[1] - k.co[1]) / dx : 0;
  } else if (keys.length > 1) {
    const a = before ? keys[0] : keys[keys.length - 2], b = before ? keys[1] : keys[keys.length - 1];
    const dx = b.co[0] - a.co[0];
    slope = dx ? (b.co[1] - a.co[1]) / dx : 0;
  } else slope = 0;
  return k.co[1] + slope * (t - k.co[0]);
}

export function evaluateKeys(keys, t, extrapolation = 'CONSTANT') {
  if (!keys.length) return 0;
  if (keys.length === 1) return keys[0].co[1];
  if (t < keys[0].co[0] || t > keys[keys.length - 1].co[0]) return extrapolate(keys, t, extrapolation);
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].co[0] <= t) i++;
  // At a key's frame: that key's value (the first of two keys on one frame).
  for (let j = 0; j < keys.length; j++) if (keys[j].co[0] === t) return keys[j].co[1];
  return segment(keys[i], keys[i + 1], t);
}

function cycleTime(keys, m, t) {
  const x0 = keys[0].co[0], xn = keys[keys.length - 1].co[0], L = xn - x0, V = keys[keys.length - 1].co[1] - keys[0].co[1];
  if (!L) return { t, offset: 0 };
  const after = t > xn;
  if (!after && t >= x0) return { t, offset: 0 };
  const mode = after ? m.mode_after ?? 'REPEAT' : m.mode_before ?? 'REPEAT';
  const count = after ? m.cycles_after ?? 0 : m.cycles_before ?? 0;
  const i = Math.ceil(after ? (t - xn) / L : (x0 - t) / L);
  if (mode === 'NONE' || (count > 0 && i > count)) return { t, offset: 0 };
  let tt = after ? t - i * L : t + i * L;
  if (mode === 'MIRROR' && i % 2) tt = after ? xn - (t - xn - (i - 1) * L) : x0 + (x0 - t - (i - 1) * L);
  return { t: tt, offset: mode === 'REPEAT_OFFSET' ? (after ? i : -i) * V : 0 };
}

// Handles of keys given without them, by the curve's auto_smoothing (fcurves.md 5.2 and 5.3, fcurves_addendum.md):
// NONE gives handle x lengths gap / 2.5614 and the mean secant slope; CONT_ACCEL (the default of new curves) gives
// gap / 3 and slopes with continuous acceleration. Keys with stored handles keep them; a file's handles are read as
// stored, never recalculated.
export function withHandles(keys, extrapolation = 'CONSTANT', smoothing = 'CONT_ACCEL') {
  if (keys.every((k) => k.handle_left && k.handle_right)) return keys;
  const sorted = keys.map((k) => ({ ...k })).sort((a, b) => a.co[0] - b.co[0]);
  if (smoothing === 'CONT_ACCEL' && sorted.length > 1) return contAccel(sorted, extrapolation);
  const n = sorted.length;
  sorted.forEach((k, i) => {
    if (k.handle_left && k.handle_right) return;
    const [x, y] = k.co;
    const prev = i > 0 ? sorted[i - 1].co : n > 1 ? [2 * x - sorted[i + 1].co[0], 2 * y - sorted[i + 1].co[1]] : [x - 1, y];
    const next = i < n - 1 ? sorted[i + 1].co : n > 1 ? [2 * x - sorted[i - 1].co[0], 2 * y - sorted[i - 1].co[1]] : [x + 1, y];
    const type = k.handle_left_type ?? 'AUTO_CLAMPED';
    if (type === 'VECTOR') {
      k.handle_left = [x + (prev[0] - x) / 3, y + (prev[1] - y) / 3];
      k.handle_right = [x + (next[0] - x) / 3, y + (next[1] - y) / 3];
      return;
    }
    const da = x - prev[0] || 1, db = next[0] - x || 1;
    let m = ((y - prev[1]) / da + (next[1] - y) / db) / 2;
    const ha = Math.min(da, 5 * db) / 2.5614, hb = Math.min(db, 5 * da) / 2.5614;
    const end = i === 0 || i === n - 1;
    if (end && extrapolation !== 'LINEAR') m = 0;
    else if (type === 'AUTO_CLAMPED' && !end) m = clampSlope(m, y, prev[1], next[1], ha, hb);
    k.handle_left = [x - ha, y - ha * m];
    k.handle_right = [x + hb, y + hb * m];
  });
  return sorted;
}

// AUTO_CLAMPED: the slope range that keeps both handles between the neighbours' values (fcurves.md 5.2 step 6); NaN
// when the key is an extreme (slope 0).
function slopeRange(y, py, ny, ha, hb) {
  const A = (y - py) / ha, B = (ny - y) / hb;
  const lo = Math.max(Math.min(0, A), Math.min(0, B)), hi = Math.min(Math.max(0, A), Math.max(0, B));
  return lo > hi ? [0, 0] : [lo, hi];
}
const clampSlope = (m, y, py, ny, ha, hb) => { const [lo, hi] = slopeRange(y, py, ny, ha, hb); return Math.min(hi, Math.max(lo, m)); };

// CONT_ACCEL: slopes solved so the second derivative is continuous at automatic keys (fcurves.md 5.3); AUTO_CLAMPED
// fixes the worst violator at its bound and solves again.
function contAccel(k, extrapolation) {
  const n = k.length, x = k.map((q) => q.co[0]), y = k.map((q) => q.co[1]);
  const h = x.slice(1).map((v, i) => v - x[i] || 1);
  const fixed = new Map();
  if (extrapolation !== 'LINEAR') { fixed.set(0, 0); fixed.set(n - 1, 0); }
  const clamped = (i) => (k[i].handle_left_type ?? 'AUTO_CLAMPED') === 'AUTO_CLAMPED' && i > 0 && i < n - 1;
  for (let pass = 0; pass <= n; pass++) {
    const m = solveSlopes(n, h, y, fixed);
    let worst = -1, worstBy = 0, worstTo = 0;
    for (let i = 1; i < n - 1; i++) {
      if (!clamped(i) || fixed.has(i)) continue;
      const [lo, hi] = slopeRange(y[i], y[i - 1], y[i + 1], h[i - 1] / 3, h[i] / 3);
      const by = m[i] < lo ? lo - m[i] : m[i] > hi ? m[i] - hi : 0;
      if (by > worstBy) { worstBy = by; worst = i; worstTo = m[i] < lo ? lo : hi; }
    }
    if (worst < 0) {
      k.forEach((q, i) => {
        if (q.handle_left && q.handle_right) return;
        const ha = i ? h[i - 1] / 3 : h[0] / 3, hb = i < n - 1 ? h[i] / 3 : h[n - 2] / 3;
        q.handle_left = [x[i] - ha, y[i] - ha * m[i]];
        q.handle_right = [x[i] + hb, y[i] + hb * m[i]];
      });
      return k;
    }
    fixed.set(worst, worstTo);
  }
  return k;
}

// The tridiagonal system of fcurves.md 5.3 with natural ends, solved densely (curves are short).
function solveSlopes(n, h, y, fixed) {
  const A = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let i = 0; i < n; i++) {
    const row = A[i];
    if (fixed.has(i)) { row[i] = 1; row[n] = fixed.get(i); continue; }
    if (i === 0) { row[0] = 2; row[1] = 1; row[n] = (3 * (y[1] - y[0])) / h[0]; continue; }
    if (i === n - 1) { row[i - 1] = 1; row[i] = 2; row[n] = (3 * (y[i] - y[i - 1])) / h[i - 1]; continue; }
    row[i - 1] = 1 / h[i - 1]; row[i] = 2 * (1 / h[i - 1] + 1 / h[i]); row[i + 1] = 1 / h[i];
    row[n] = 3 * ((y[i] - y[i - 1]) / h[i - 1] ** 2 + (y[i + 1] - y[i]) / h[i] ** 2);
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !A[r][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

// F-Curve modifiers (drivers_rig.md): time modifiers (Stepped, Limits on X) change the input in reverse stack order,
// then value modifiers apply in stack order; each blends by its influence and restricted range.
const FN = {
  SIN: Math.sin, COS: Math.cos, TAN: Math.tan, SQRT: (u) => (u < 0 ? null : Math.sqrt(u)), LN: (u) => (u <= 1 ? null : Math.log(u)),
  SINC: (u) => (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)),
};

function strength(m, x) {
  let f = m.use_influence ? m.influence ?? 1 : 1;
  if (m.use_restricted_range) {
    const a = m.frame_start ?? 0, b = m.frame_end ?? 0;
    if (x < a || x > b) return 0;
    if (m.blend_in && x < a + m.blend_in) f *= (x - a) / m.blend_in;
    if (m.blend_out && x > b - m.blend_out) f *= (b - x) / m.blend_out;
  }
  return f;
}

function timeModifier(m, x) {
  if (m.type === 'STEPPED') {
    if ((m.use_frame_start && x < m.frame_start) || (m.use_frame_end && x > m.frame_end)) return x;
    const step = m.frame_step ?? 2, off = m.frame_offset ?? 0;
    return Math.trunc((x - off) / step) * step + off;
  }
  if (m.type === 'LIMITS') {
    if (m.use_min_x && x < m.min_x) x = m.min_x;
    if (m.use_max_x && x > m.max_x) x = m.max_x;
  }
  return x;
}

function valueModifier(m, x, y) {
  switch (m.type) {
    case 'GENERATOR': {
      const c = m.coefficients ?? [0, 1], order = m.poly_order ?? 1;
      let g;
      if (m.mode === 'POLYNOMIAL_FACTORISED') { g = 1; for (let i = 0; i < order; i++) g *= (c[2 * i] ?? 0) * x + (c[2 * i + 1] ?? 0); }
      else { g = 0; let xp = 1; for (let i = 0; i <= order && i < c.length; i++) { g += c[i] * xp; xp *= x; } }
      return m.use_additive ? y + g : g;
    }
    case 'FNGENERATOR': {
      // SQRT of a negative and LN up to 1 give 0 for the whole modifier (observed).
      const f = (FN[m.function_type ?? 'SIN'] ?? FN.SIN)((m.phase_multiplier ?? 1) * x + (m.phase_offset ?? 0));
      if (f === null) return m.use_additive ? y : 0;
      const g = (m.amplitude ?? 1) * f + (m.value_offset ?? 0);
      return m.use_additive ? y + g : g;
    }
    case 'ENVELOPE': {
      const pts = m.control_points ?? [];
      if (!pts.length) return y;
      const point = (p) => (Array.isArray(p) ? p : [p.frame, p.min, p.max]);
      const list = pts.map(point).sort((a, b) => a[0] - b[0]);
      let lo, hi;
      if (x <= list[0][0]) [, lo, hi] = list[0];
      else if (x >= list[list.length - 1][0]) [, lo, hi] = list[list.length - 1];
      else {
        let k = 0;
        while (list[k + 1][0] < x) k++;
        const t = (x - list[k][0]) / (list[k + 1][0] - list[k][0]);
        lo = list[k][1] + t * (list[k + 1][1] - list[k][1]); hi = list[k][2] + t * (list[k + 1][2] - list[k][2]);
      }
      const dmin = m.default_min ?? -1, dmax = m.default_max ?? 1;
      return lo + ((y - dmin) / (dmax - dmin)) * (hi - lo);
    }
    case 'LIMITS': {
      if (m.use_min_y && y < m.min_y) y = m.min_y;
      if (m.use_max_y && y > m.max_y) y = m.max_y;
      return y;
    }
    default: return y;
  }
}

// The value of an F-Curve { keyframe_points, extrapolation, modifiers } at t.
export function evaluateFCurve(fc, t) {
  const keys = fc.prepared ??= withHandles(fc.keyframe_points ?? [], fc.extrapolation, fc.auto_smoothing);
  const mods = (fc.modifiers ?? []).filter((m) => !m.mute);
  let time = t;
  for (let i = mods.length - 1; i >= 0; i--) {
    const m = mods[i];
    if (m.type === 'STEPPED' || m.type === 'LIMITS') { const f = strength(m, time); time += f * (timeModifier(m, time) - time); }
  }
  let offset = 0, ct = time;
  for (const m of mods) if (m.type === 'CYCLES' && keys.length) ({ t: ct, offset } = cycleTime(keys, m, ct));
  let value = keys.length ? evaluateKeys(keys, ct, fc.extrapolation) + offset : 0;
  for (const m of mods) {
    if (m.type === 'CYCLES' || m.type === 'STEPPED') continue;
    const f = strength(m, time);
    if (f) value += f * (valueModifier(m, time, value) - value);
  }
  return value;
}

export const curveMapsDriver = (fc) => (fc.keyframe_points?.length ?? 0) > 0 || (fc.modifiers ?? []).some((m) => !m.mute);
