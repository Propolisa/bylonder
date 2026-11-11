// SPDX-License-Identifier: MIT OR Apache-2.0
// @ts-check
// F-Curves: handle recalculation and evaluation (interpolation, easing, extrapolation, Cycles modifier).

/**
 * @typedef {[number, number]} Point
 * @typedef {'FREE' | 'ALIGNED' | 'VECTOR' | 'AUTO' | 'AUTO_CLAMPED'} HandleType
 * @typedef {{
 *   co: Point, handle_left?: Point, handle_right?: Point, interpolation?: string, easing?: string,
 *   handle_left_type?: HandleType, handle_right_type?: HandleType, back?: number, amplitude?: number,
 *   period?: number, select?: boolean[]
 * }} KeyframeInput
 * @typedef {{
 *   co: Point, left: Point, right: Point, leftType: HandleType, rightType: HandleType, interpolation: string,
 *   easing: string, back: number, amplitude: number, period: number, leftSelected: boolean
 * }} Key
 * @typedef {{ mode_before?: string, mode_after?: string, cycles_before?: number, cycles_after?: number }} CyclesInput
 * @typedef {{ mode_before: string, mode_after: string, cycles_before: number, cycles_after: number }} Cycles
 * @typedef {{
 *   keyframes: KeyframeInput[], extrapolation?: string, cycles?: boolean | CyclesInput, auto_smoothing?: string
 * }} FCurveInput
 * @typedef {{ keys: Key[], extrapolation: string, cycles: Cycles | null }} FCurve
 */

const f32 = Math.fround;
const AUTO_HANDLE_FACTOR = 2.5614;
const MIN_HANDLE_OFFSET = 0.001;
const AUTOMATIC = new Set(['AUTO', 'AUTO_CLAMPED']);
const LAID_ON_LIMIT = new Set(['FREE', 'ALIGNED']);

// Building the curve

/** @param {FCurveInput} input @returns {FCurve} sorted keys with recalculated handles */
export function prepareFCurve(input) {
  const keys = input.keyframes.map(toKey).sort((a, b) => a.co[0] - b.co[0]);
  const curve = { keys, extrapolation: input.extrapolation ?? 'CONSTANT', cycles: toCycles(input.cycles) };
  recalculateHandles(curve, input.auto_smoothing ?? 'NONE');
  return curve;
}

/** @param {Point} p @returns {Point} */
const point = (p) => [f32(p[0]), f32(p[1])];

/** @param {KeyframeInput} k @returns {Key} */
function toKey(k) {
  const co = point(k.co);
  return {
    co,
    left: k.handle_left ? point(k.handle_left) : [co[0], co[1]],
    right: k.handle_right ? point(k.handle_right) : [co[0], co[1]],
    leftType: k.handle_left_type ?? 'AUTO_CLAMPED',
    rightType: k.handle_right_type ?? 'AUTO_CLAMPED',
    interpolation: k.interpolation ?? 'BEZIER',
    easing: k.easing ?? 'AUTO',
    back: f32(k.back ?? 1.70158),
    amplitude: f32(k.amplitude ?? 0.8),
    period: f32(k.period ?? 4.1),
    leftSelected: Boolean(k.select?.[0]),
  };
}

/** @param {boolean | CyclesInput | undefined} cycles @returns {Cycles | null} */
function toCycles(cycles) {
  if (!cycles) return null;
  const settings = cycles === true ? {} : cycles;
  return {
    mode_before: settings.mode_before ?? 'REPEAT',
    mode_after: settings.mode_after ?? 'REPEAT',
    cycles_before: settings.cycles_before ?? 0,
    cycles_after: settings.cycles_after ?? 0,
  };
}

// Handle recalculation

/** @param {FCurve} curve @param {string} smoothing */
function recalculateHandles(curve, smoothing) {
  const { keys } = curve;
  if (keys.length === 0) return;
  if (keys.length === 1) return keepHandlesOutward(keys[0], 0);
  const neighbors = neighborFinder(curve);
  const smooth = smoothing === 'CONT_ACCEL';
  const last = keys.length - 1;
  const cyclic = isCyclic(curve);
  keys.forEach((key, i) => {
    keepHandlesOutward(key);
    const [prev, next] = neighbors(i);
    if (key.leftType === 'VECTOR') key.left = towards(key.co, prev ?? mirror(key.co, next));
    if (key.rightType === 'VECTOR') key.right = towards(key.co, next ?? mirror(key.co, prev));
  });
  keys.forEach((key, i) => {
    const [prev, next] = neighbors(i);
    if (AUTOMATIC.has(key.leftType) || AUTOMATIC.has(key.rightType)) {
      const clampedSide = (/** @type {'leftType' | 'rightType'} */ side) =>
        key[side] === 'AUTO_CLAMPED' || (cyclic && (i === 0 || i === last) && [keys[0], keys[last]].some(hasClampedSide));
      placeAutoHandles(curve, key, prev, next, { left: clampedSide('leftType'), right: clampedSide('rightType') }, smooth);
    }
    alignHandles(key);
  });
  if (!smooth) return;
  smoothHandles(curve);
  keys.forEach(alignHandles);
}

/**
 * A handle may not point back past its key. Measured: a handle that is too close lands one float32 step beyond
 * the nearest float32 to key + 0.001.
 * @param {Key} key
 */
function keepHandlesOutward(key, offset = MIN_HANDLE_OFFSET) {
  // Handles that are both on the wrong side trade places first.
  if (key.left[0] > key.co[0] && key.right[0] < key.co[0]) [key.left, key.right] = [key.right, key.left];
  const rightLimit = offset ? nextFloat32(f32(key.co[0] + offset), 1) : key.co[0];
  const leftLimit = offset ? nextFloat32(f32(key.co[0] - offset), -1) : key.co[0];
  if (key.right[0] < rightLimit) key.right = [rightLimit, key.right[1]];
  if (key.left[0] > leftLimit) key.left = [leftLimit, key.left[1]];
}

const bits = new Float32Array(1);
const bitsInt = new Int32Array(bits.buffer);

/** The next float32 after x in the given direction. @param {number} x @param {1 | -1} direction */
function nextFloat32(x, direction) {
  if (x === 0) return direction * 1.401298464324817e-45;
  bits[0] = x;
  bitsInt[0] += (x > 0) === (direction > 0) ? 1 : -1;
  return bits[0];
}

/** @param {Point} co @param {Point | undefined} other @returns {Point | undefined} */
const mirror = (co, other) => (other ? [2 * co[0] - other[0], 2 * co[1] - other[1]] : undefined);

/** One third of the way from `co` to `target`. @param {Point} co @param {Point | undefined} target @returns {Point} */
const towards = (co, target) => (target ? point([co[0] + (target[0] - co[0]) / 3, co[1] + (target[1] - co[1]) / 3]) : [co[0], co[1]]);

/** @param {Key} key */
const isAutomatic = (key) => AUTOMATIC.has(key.leftType) && AUTOMATIC.has(key.rightType);

/** Whether automatic handles see across the cycle (repeating without limit, automatic ends). @param {FCurve} curve */
function isCyclic({ keys, cycles }) {
  if (!cycles || keys.length < 2 || keys[keys.length - 1].co[0] === keys[0].co[0]) return false;
  const repeats = (/** @type {string} */ mode) => mode === 'REPEAT' || mode === 'REPEAT_OFFSET';
  return repeats(cycles.mode_before) && repeats(cycles.mode_after) && cycles.cycles_before === 0 && cycles.cycles_after === 0 &&
    isAutomatic(keys[0]) && isAutomatic(keys[keys.length - 1]);
}

/** @param {FCurve} curve @returns {(i: number) => [Point | undefined, Point | undefined]} neighbors of key i */
function neighborFinder(curve) {
  const { keys } = curve;
  const last = keys.length - 1;
  const cyclic = isCyclic(curve);
  const period = keys[last].co[0] - keys[0].co[0];
  const offset = keys[last].co[1] - keys[0].co[1];
  return (i) => {
    let prev = i > 0 ? keys[i - 1].co : undefined;
    let next = i < last ? keys[i + 1].co : undefined;
    if (cyclic && i === 0) prev = [keys[last - 1].co[0] - period, keys[last - 1].co[1] - offset];
    if (cyclic && i === last) next = [keys[1].co[0] + period, keys[1].co[1] + offset];
    return [prev, next];
  };
}

/**
 * Automatic handles: along the mean direction to the neighbors, at a length set by the gaps to them.
 * @param {FCurve} curve @param {Key} key @param {Point | undefined} prev @param {Point | undefined} next
 * @param {{ left: boolean, right: boolean }} clamped which sides keep within their neighbors' values
 * @param {boolean} smooth handle lengths for continuous-acceleration smoothing
 */
function placeAutoHandles(curve, key, prev, next, clamped, smooth = false) {
  const [x, y] = key.co;
  if (!prev && !next) return setAutoHandles(key, 0, 0, 0, 0, !smooth);
  const before = prev ?? /** @type {Point} */ (mirror(key.co, next));
  const after = next ?? /** @type {Point} */ (mirror(key.co, prev));
  const dxBefore = x - before[0], dxAfter = after[0] - x;
  const gapBefore = dxBefore || 1, gapAfter = dxAfter || 1;
  // Each neighbor contributes its direction scaled by 1 / gap, so a zero gap leaves only its rise.
  const tangentX = dxBefore / gapBefore + dxAfter / gapAfter;
  // Neighbors straight above or below give no direction: handles stay, except that a flat end goes flat.
  if (tangentX === 0) {
    const flatEnd = (!prev || !next) && flatEnds(curve) && isAutomatic(key);
    const flatten = (/** @type {HandleType} */ type) => flatEnd && AUTOMATIC.has(type);
    if (flatten(key.leftType)) key.left = [key.left[0], y];
    if (flatten(key.rightType)) key.right = [key.right[0], y];
    return;
  }
  let slope = ((y - before[1]) / gapBefore + (after[1] - y) / gapAfter) / tangentX;
  // Continuous-acceleration smoothing places automatic handles a third of the way to the neighbors.
  const lengthBefore = smooth ? gapBefore / 3 : Math.min(gapBefore, 5 * gapAfter) / AUTO_HANDLE_FACTOR;
  const lengthAfter = smooth ? gapAfter / 3 : Math.min(gapAfter, 5 * gapBefore) / AUTO_HANDLE_FACTOR;
  const isEnd = !prev || !next;
  if (isEnd && flatEnds(curve) && isAutomatic(key)) slope = 0;
  if (isEnd || (!clamped.left && !clamped.right)) return setAutoHandles(key, lengthBefore, slope, lengthAfter, slope, !smooth);
  const riseBefore = y - before[1], riseAfter = after[1] - y;
  // At a local extreme only the clamped sides go flat; otherwise both sides share one slope that keeps each
  // automatic handle within its neighbor's value.
  if (riseBefore * riseAfter <= 0) return setAutoHandles(key, lengthBefore, clamped.left ? 0 : slope, lengthAfter, clamped.right ? 0 : slope, !smooth);
  let limited = slope;
  if (LIMIT_SIDE(key.leftType)) limited = clampBetweenZeroAnd(limited, riseBefore / lengthBefore);
  if (LIMIT_SIDE(key.rightType)) limited = clampBetweenZeroAnd(limited, riseAfter / lengthAfter);
  setAutoHandles(key, lengthBefore, limited, lengthAfter, limited, !smooth);
  // A limit that bites also lays the key's FREE or ALIGNED handle on the limited tangent, keeping its time offset.
  if (limited === slope) return;
  if (LAID_ON_LIMIT.has(key.leftType)) key.left = point([key.left[0], y + (key.left[0] - x) * limited]);
  if (LAID_ON_LIMIT.has(key.rightType)) key.right = point([key.right[0], y + (key.right[0] - x) * limited]);
}

/** Sets the automatic sides of a key (pushed outward except under smoothing). @param {Key} key @param {number} lengthBefore @param {number} slopeBefore @param {number} lengthAfter @param {number} slopeAfter */
function setAutoHandles(key, lengthBefore, slopeBefore, lengthAfter, slopeAfter, push = true) {
  const [x, y] = key.co;
  if (AUTOMATIC.has(key.leftType)) key.left = point([x - lengthBefore, y - lengthBefore * slopeBefore]);
  if (AUTOMATIC.has(key.rightType)) key.right = point([x + lengthAfter, y + lengthAfter * slopeAfter]);
  if (push) keepAutomaticHandlesOutward(key);
}

/** keepHandlesOutward for the automatic sides only (a VECTOR handle may sit on its key). @param {Key} key */
function keepAutomaticHandlesOutward(key) {
  const { left, right } = key;
  keepHandlesOutward(key);
  if (!AUTOMATIC.has(key.leftType)) key.left = left;
  if (!AUTOMATIC.has(key.rightType)) key.right = right;
}

/** @param {number} value @param {number} bound */
const clampBetweenZeroAnd = (value, bound) => Math.min(Math.max(0, bound), Math.max(Math.min(0, bound), value));
const LIMIT_SIDE = (/** @type {HandleType} */ type) => type === 'AUTO_CLAMPED';

/** @param {number} riseBefore @param {number} riseAfter @param {number} lengthBefore @param {number} lengthAfter */
function slopeRange(riseBefore, riseAfter, lengthBefore, lengthAfter) {
  const a = riseBefore / lengthBefore, b = riseAfter / lengthAfter;
  return [Math.max(Math.min(0, a), Math.min(0, b)), Math.min(Math.max(0, a), Math.max(0, b))];
}

/**
 * An ALIGNED handle turns to point away from the other handle. Next to an automatic handle it keeps its length in
 * time; otherwise its length. When both are ALIGNED the second turn reuses the lengths measured before the first.
 * @param {Key} key
 */
function alignHandles(key) {
  const { leftType, rightType, co } = key;
  if (leftType !== 'ALIGNED' && rightType !== 'ALIGNED') return;
  if (leftType === 'FREE' || rightType === 'FREE') return;
  if (leftType !== 'ALIGNED' || rightType !== 'ALIGNED') {
    if (leftType === 'ALIGNED') key.left = opposite(co, key.right, distance(co, key.left) / distance(co, key.right));
    else key.right = opposite(co, key.left, distance(co, key.right) / distance(co, key.left));
    return;
  }
  const leftLength = distance(co, key.left), rightLength = distance(co, key.right);
  if (key.leftSelected) {
    key.right = opposite(co, key.left, rightLength / leftLength);
    key.left = opposite(co, key.right, leftLength / rightLength);
  } else {
    key.left = opposite(co, key.right, leftLength / rightLength);
    key.right = opposite(co, key.left, rightLength / leftLength);
  }
}

/** @param {Point} co @param {Point} p */
const distance = (co, p) => Math.hypot(p[0] - co[0], p[1] - co[1]);

/** The point opposite `other` through `co`, at `scale` times its distance. @param {Point} co @param {Point} other @param {number} scale @returns {Point} */
function opposite(co, other, scale) {
  if (!Number.isFinite(scale)) return [co[0], co[1]];
  return point([co[0] - (other[0] - co[0]) * scale, co[1] - (other[1] - co[1]) * scale]);
}

// Continuous-acceleration smoothing
//
// Keys automatic on both sides, and VECTOR sides, get slopes (handles a third of the way to the neighbor) that make
// d2y/dx2 of the actual Bezier segments continuous across each solved key. Other handles stay as computed and enter
// the equations by their positions. A solved key at an open end has zero curvature there (a VECTOR side always,
// an automatic key unless CONSTANT extrapolation pins its slope to 0). AUTO_CLAMPED keys outside their range are
// pinned one at a time, worst first, and the system is solved again.

/** @typedef {{ constant: number, terms: Map<number, number> }} Linear constant + sum of coefficient * unknown */

/** @param {FCurve} curve */
function smoothHandles(curve) {
  const { keys } = curve;
  const n = keys.length - 1;
  const cyclic = isCyclic(curve);
  /** @type {{ key: number, side: 'left' | 'right' | 'both' }[]} */
  const unknowns = [];
  /** @type {Map<string, number>} side ("3:left") to unknown index */
  const unknownOf = new Map();
  const add = (/** @type {number} */ key, /** @type {'left' | 'right' | 'both'} */ side, /** @type {string[]} */ ids) => {
    for (const id of ids) unknownOf.set(id, unknowns.length);
    unknowns.push({ key, side });
  };
  keys.forEach((key, i) => {
    if (cyclic && i === n) return;
    if (isAutomatic(key) && key.leftType === key.rightType) add(i, 'both', [`${i}:left`, `${i}:right`, ...(cyclic && i === 0 ? [`${n}:left`, `${n}:right`] : [])]);
    else {
      if (key.leftType === 'VECTOR' && i > 0) add(i, 'left', [`${i}:left`]);
      if (key.rightType === 'VECTOR' && i < n) add(i, 'right', [`${i}:right`]);
    }
  });
  if (unknowns.length === 0) return;

  /** @param {number} v @returns {Linear} */
  const constant = (v) => ({ constant: v, terms: new Map() });
  /** Control points of segment j (key j to key j + 1), y as linear forms. @param {number} j */
  const segment = (j) => {
    const a = keys[j], b = keys[j + 1];
    const gap = b.co[0] - a.co[0];
    const handle = (/** @type {number} */ i, /** @type {'left' | 'right'} */ side, /** @type {number} */ direction) => {
      const index = unknownOf.get(`${i}:${side}`);
      const key = keys[i];
      if (index === undefined) return { x: key[side][0], y: constant(key[side][1]) };
      return { x: key.co[0] + (direction * gap) / 3, y: { constant: key.co[1], terms: new Map([[index, (direction * gap) / 3]]) } };
    };
    const p1 = handle(j, 'right', 1), p2 = handle(j + 1, 'left', -1);
    return { xs: [a.co[0], p1.x, p2.x, b.co[0]], ys: [constant(a.co[1]), p1.y, p2.y, constant(b.co[1])] };
  };
  /** d2y/dx2 of segment j at its start or end, as a linear form. @param {number} j @param {boolean} end */
  const curvature = (j, end) => {
    const { xs, ys } = segment(j);
    // Read backwards from the end: d2y/dx2 is unchanged when the parameter runs the other way.
    const [x0, x1, x2] = end ? [xs[3], xs[2], xs[1]] : xs;
    const [y0, y1, y2] = end ? [ys[3], ys[2], ys[1]] : ys;
    const dx = 3 * (x1 - x0), ddx = 6 * (x0 - 2 * x1 + x2), cube = dx ** 3;
    // (y'' x' - y' x'') / x'^3 with y' = 3 (y1 - y0), y'' = 6 (y0 - 2 y1 + y2)
    return combine([[y0, (6 * dx + 3 * ddx) / cube], [y1, (-12 * dx - 3 * ddx) / cube], [y2, (6 * dx) / cube]]);
  };
  /** @param {{ key: number, side: string }} u @returns {Linear | null} null when the slope is pinned to 0 */
  const equationFor = (u) => {
    const i = u.key;
    if (u.side === 'left') return curvature(i - 1, true);
    if (u.side === 'right') return curvature(i, false);
    if (cyclic && i === 0) return subtract(curvature(n - 1, true), curvature(0, false));
    if (i === 0) return flatEnds(curve) ? null : curvature(0, false);
    if (i === n) return flatEnds(curve) ? null : curvature(n - 1, true);
    return subtract(curvature(i - 1, true), curvature(i, false));
  };
  const equations = unknowns.map(equationFor);
  /** @type {(number | null)[]} */
  const pinned = equations.map((e) => (e === null ? 0 : null));
  const ranges = unknowns.map((u) => clampRange(curve, u.key, u.side));
  let slopes = solveLinear(equations, pinned);
  for (let round = 0; round < unknowns.length; round++) {
    let worst = -1, amount = 0, value = 0;
    slopes.forEach((m, k) => {
      const range = ranges[k];
      if (pinned[k] !== null || !range) return;
      const limited = range[0] > range[1] ? 0 : Math.min(range[1], Math.max(range[0], m));
      if (Math.abs(limited - m) > amount) [worst, amount, value] = [k, Math.abs(limited - m), limited];
    });
    if (worst < 0) break;
    pinned[worst] = value;
    slopes = solveLinear(equations, pinned);
  }
  unknowns.forEach((u, k) => placeSolvedHandles(curve, u.key, u.side, slopes[k], cyclic));
}

/** @param {[Linear, number][]} parts @returns {Linear} */
function combine(parts) {
  const result = { constant: 0, terms: new Map() };
  for (const [form, scale] of parts) {
    result.constant += form.constant * scale;
    for (const [index, coefficient] of form.terms) result.terms.set(index, (result.terms.get(index) ?? 0) + coefficient * scale);
  }
  return result;
}

/** @param {Linear} a @param {Linear} b */
const subtract = (a, b) => combine([[a, 1], [b, -1]]);

/** Solves form_k = 0 for the free unknowns, pinned ones fixed. @param {(Linear | null)[]} equations @param {(number | null)[]} pinned */
function solveLinear(equations, pinned) {
  const count = pinned.length;
  const matrix = [], rhs = [];
  for (let k = 0; k < count; k++) {
    const row = new Array(count).fill(0);
    const form = equations[k];
    if (pinned[k] !== null || !form) {
      row[k] = 1;
      matrix.push(row);
      rhs.push(pinned[k] ?? 0);
      continue;
    }
    let constantPart = form.constant;
    for (const [index, coefficient] of form.terms) {
      if (pinned[index] !== null) constantPart += coefficient * /** @type {number} */ (pinned[index]);
      else row[index] += coefficient;
    }
    matrix.push(row);
    rhs.push(-constantPart);
  }
  return gaussSolve(matrix, rhs);
}

/** AUTO_CLAMPED range of a solved interior key (handles at thirds), or null. @param {FCurve} curve @param {number} i @param {string} side */
function clampRange(curve, i, side) {
  const key = curve.keys[i];
  if (side !== 'both' || !hasClampedSide(key)) return null;
  const [prev, next] = neighborFinder(curve)(i);
  if (!prev || !next) return null;
  return slopeRange(key.co[1] - prev[1], next[1] - key.co[1], (key.co[0] - prev[0]) / 3, (next[0] - key.co[0]) / 3);
}

/** @param {FCurve} curve @param {number} i @param {string} side @param {number} slope @param {boolean} cyclic */
function placeSolvedHandles(curve, i, side, slope, cyclic) {
  const { keys } = curve;
  const n = keys.length - 1;
  const place = (/** @type {number} */ k) => {
    const key = keys[k];
    const [x, y] = key.co;
    // Lengths come from the key's own segments; an open end mirrors its other side.
    const before = k > 0 ? x - keys[k - 1].co[0] : keys[k + 1].co[0] - x;
    const after = k < n ? keys[k + 1].co[0] - x : x - keys[k - 1].co[0];
    if (side !== 'right') key.left = point([x - before / 3, y - (before / 3) * slope]);
    if (side !== 'left') key.right = point([x + after / 3, y + (after / 3) * slope]);
  };
  place(i);
  if (cyclic && i === 0 && side === 'both') place(n);
}

/** @param {Key} key */
const hasClampedSide = (key) => key.leftType === 'AUTO_CLAMPED' || key.rightType === 'AUTO_CLAMPED';

/** @param {number[][]} matrix @param {number[]} rhs */
function gaussSolve(matrix, rhs) {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (m[col][col] === 0) continue;
    for (let r = 0; r < n; r++) {
      if (r === col || m[r][col] === 0) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row, i) => (row[i] === 0 ? 0 : row[n] / row[i]));
}

// Evaluation

/** @param {FCurve} curve @param {number} time */
export function evaluateFCurve(curve, time) {
  const { keys } = curve;
  if (keys.length === 0) return 0;
  const t = f32(time);
  const mapped = curve.cycles ? applyCycles(curve, t) : { time: t, offset: 0 };
  return f32(evaluateCurve(curve, mapped.time) + mapped.offset);
}

/** @param {FCurve} curve @param {number} t @returns {{ time: number, offset: number }} */
function applyCycles(curve, t) {
  const { keys } = curve;
  const cycles = /** @type {Cycles} */ (curve.cycles);
  const first = keys[0].co, last = keys[keys.length - 1].co;
  const period = last[0] - first[0], change = last[1] - first[1];
  const after = t > last[0];
  if ((!after && t >= first[0]) || period === 0) return { time: t, offset: 0 };
  const mode = after ? cycles.mode_after : cycles.mode_before;
  const limit = after ? cycles.cycles_after : cycles.cycles_before;
  const cycle = Math.ceil(after ? (t - last[0]) / period : (first[0] - t) / period);
  if (mode === 'NONE' || (limit > 0 && cycle > limit)) return { time: t, offset: 0 };
  let mapped = after ? t - cycle * period : t + cycle * period;
  if (mode === 'MIRROR' && cycle % 2 === 1)
    mapped = after ? last[0] - (t - last[0] - (cycle - 1) * period) : first[0] + (first[0] - t - (cycle - 1) * period);
  const offset = mode === 'REPEAT_OFFSET' ? (after ? cycle : -cycle) * change : 0;
  return { time: mapped, offset };
}

/** @param {FCurve} curve @param {number} t */
function evaluateCurve(curve, t) {
  const { keys } = curve;
  const first = keys[0], last = keys[keys.length - 1];
  if (t < first.co[0]) return extrapolate(curve, t, true);
  if (t > last.co[0]) return extrapolate(curve, t, false);
  if (t === first.co[0]) return first.co[1];
  if (t === last.co[0]) return last.co[1];
  const exact = findKeyAt(keys, t);
  if (exact >= 0) return keys[exact].co[1];
  let k = 0;
  while (keys[k + 1].co[0] <= t) k++;
  return evaluateSegment(keys[k], keys[k + 1], t);
}

/** Binary search for a key on frame t; which of several keys on one frame it finds matters. @param {Key[]} keys @param {number} t */
function findKeyAt(keys, t) {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].co[0] === t) return mid;
    if (t > keys[mid].co[0]) lo = mid + 1;
    else hi = mid;
  }
  return -1;
}

/** @param {FCurve} curve @param {number} t @param {boolean} before before the first key, else after the last */
function extrapolate(curve, t, before) {
  const { keys } = curve;
  const end = before ? 0 : keys.length - 1;
  const key = keys[end];
  if (curve.extrapolation !== 'LINEAR' || key.interpolation === 'CONSTANT') return key.co[1];
  if (keys.length === 1 && key.interpolation === 'LINEAR') return key.co[1];
  let slope;
  // Only LINEAR end keys extend their secant; every other mode, easings included, follows the outer handle.
  if (key.interpolation !== 'LINEAR') {
    const handle = before ? key.left : key.right;
    const dx = handle[0] - key.co[0];
    slope = dx === 0 ? 0 : (handle[1] - key.co[1]) / dx;
  } else {
    const other = keys[before ? 1 : end - 1];
    const dx = key.co[0] - other.co[0];
    slope = dx === 0 ? 0 : (key.co[1] - other.co[1]) / dx;
  }
  return key.co[1] + slope * (t - key.co[0]);
}

/** @param {Key} a @param {Key} b @param {number} t */
function evaluateSegment(a, b, t) {
  const duration = b.co[0] - a.co[0];
  const elapsed = t - a.co[0];
  const start = a.co[1], change = b.co[1] - a.co[1];
  switch (a.interpolation) {
    case 'CONSTANT': return start;
    case 'LINEAR': return start + (change * elapsed) / duration;
    case 'BEZIER': return evaluateBezier(a, b, t);
    case 'ELASTIC': return elastic(a, elapsed, start, change, duration);
    default: return start + change * ease(a, elapsed / duration);
  }
}

// Easing

/** @type {Record<string, (p: number, key: Key) => number>} the "ease in" form of each mode */
const EASE_IN = {
  SINE: (p) => 1 - Math.cos((p * Math.PI) / 2),
  QUAD: (p) => p * p,
  CUBIC: (p) => p ** 3,
  QUART: (p) => p ** 4,
  QUINT: (p) => p ** 5,
  CIRC: (p) => 1 - Math.sqrt(1 - p * p),
  EXPO: (p) => (2 ** (10 * (p - 1)) - 2 ** -10) / (1 - 2 ** -10),
  BACK: (p, key) => p * p * ((key.back + 1) * p - key.back),
  BOUNCE: (p) => 1 - bounceOut(1 - p),
};

const DEFAULT_EASE_OUT = new Set(['BACK', 'BOUNCE', 'ELASTIC']);

/** @param {Key} key */
const easingOf = (key) => (key.easing !== 'AUTO' ? key.easing : DEFAULT_EASE_OUT.has(key.interpolation) ? 'EASE_OUT' : 'EASE_IN');

/** @param {Key} key @param {number} p */
function ease(key, p) {
  const easing = easingOf(key);
  // Back's in-out form overshoots by the scaled amount on both halves.
  const inner = easing === 'EASE_IN_OUT' && key.interpolation === 'BACK' ? { ...key, back: key.back * 1.525 } : key;
  const fn = (/** @type {number} */ q) => EASE_IN[key.interpolation](q, inner);
  if (easing === 'EASE_IN') return fn(p);
  if (easing === 'EASE_OUT') return 1 - fn(1 - p);
  return p < 0.5 ? fn(2 * p) / 2 : 1 - fn(2 - 2 * p) / 2;
}

/** @param {number} q */
function bounceOut(q) {
  if (q < 1 / 2.75) return 7.5625 * q * q;
  if (q < 2 / 2.75) return 7.5625 * (q - 1.5 / 2.75) ** 2 + 0.75;
  if (q < 2.5 / 2.75) return 7.5625 * (q - 2.25 / 2.75) ** 2 + 0.9375;
  return 7.5625 * (q - 2.625 / 2.75) ** 2 + 0.984375;
}

/** @param {Key} key @param {number} elapsed @param {number} start @param {number} change @param {number} duration */
function elastic(key, elapsed, start, change, duration) {
  if (elapsed <= 0) return start;
  if (elapsed >= duration) return start + change;
  const easing = easingOf(key);
  const period = key.period === 0 ? (easing === 'EASE_IN_OUT' ? 0.45 : 0.3) * duration : key.period;
  const deviation = elasticDeviation(key.amplitude, period, change, duration);
  if (easing === 'EASE_OUT') return start + change - deviation(elapsed);
  if (easing === 'EASE_IN') return start + deviation(duration - elapsed);
  return elapsed < duration / 2 ? start + deviation(duration - 2 * elapsed) / 2 : start + change - deviation(2 * elapsed - duration) / 2;
}

/** @param {number} amplitude @param {number} period @param {number} change @param {number} duration */
function elasticDeviation(amplitude, period, change, duration) {
  const omega = (2 * Math.PI) / period;
  const decay = (/** @type {number} */ u) => 2 ** ((-10 * u) / duration);
  if (amplitude < Math.abs(change)) {
    // Below the change, the amplitude fades in from the change over the first quarter period.
    const shift = period / 4;
    const sign = Math.sign(change);
    return (/** @type {number} */ u) => {
      const fade = Math.abs(shift);
      const a = u < fade ? amplitude + (Math.abs(change) - amplitude) * (1 - u / fade) : amplitude;
      return sign * a * decay(u) * Math.sin(omega * (u + shift));
    };
  }
  if (amplitude === 0) return () => 0;
  const shift = (period / (2 * Math.PI)) * Math.asin(change / amplitude);
  return (/** @type {number} */ u) => amplitude * decay(u) * Math.sin(omega * (u + shift));
}

// Bezier segments

/** @param {Key} a @param {Key} b @param {number} t */
function evaluateBezier(a, b, t) {
  const p0 = a.co, p3 = b.co;
  const duration = p3[0] - p0[0];
  const p1 = limitHandle(p0, a.right, duration);
  const p2 = limitHandle(p3, b.left, duration);
  const u = solveBezierTime(p0[0], p1[0], p2[0], p3[0], t);
  return bezier(p0[1], p1[1], p2[1], p3[1], u);
}

/** A handle longer (in time) than the segment is pulled in toward its key. @param {Point} key @param {Point} handle @param {number} duration @returns {Point} */
function limitHandle(key, handle, duration) {
  const reach = Math.abs(handle[0] - key[0]);
  if (reach <= duration) return handle;
  const scale = duration / reach;
  return [key[0] + (handle[0] - key[0]) * scale, key[1] + (handle[1] - key[1]) * scale];
}

/** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} u */
function bezier(a, b, c, d, u) {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
}

/** Finds u in [0, 1] with x(u) = t; x is monotone once handles are limited. */
function solveBezierTime(/** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ x2, /** @type {number} */ x3, /** @type {number} */ t) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(x0, x1, x2, x3, mid) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Public entry

/**
 * Evaluates an F-Curve description at the given times.
 * @param {FCurveInput & { times?: number[] }} input
 */
export function evaluateFCurveRequest(input) {
  const curve = prepareFCurve(input);
  return {
    values: (input.times ?? []).map((t) => evaluateFCurve(curve, t)),
    handles: curve.keys.map((k) => ({
      co: k.co, handle_left: k.left, handle_right: k.right, handle_left_type: k.leftType, handle_right_type: k.rightType,
    })),
  };
}


/** Automatic end keys go flat under CONSTANT extrapolation. @param {FCurve} curve */
const flatEnds = (curve) => curve.extrapolation === 'CONSTANT';
