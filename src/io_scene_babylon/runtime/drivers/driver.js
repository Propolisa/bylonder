// SPDX-License-Identifier: MIT OR Apache-2.0
// @ts-check
// Drivers: variable types (single property, transform channel, distance, rotational difference) and driver types.
import { compile, PYTHON_ONLY, FLT_MAX } from './expression.js';
import { f, dot, mul3, apply3, column, length, det3 } from './float32.js';
import { AXIS, readRotation, rotationDifference } from './rotation-reading.js';

export { normalizeColumns, worldMatrix, spaceMatrix };

/**
 * @typedef {number[][]} Mat3 rows of a 3x3 matrix acting on column vectors
 * @typedef {{ linear: Mat3, translation: number[] }} Affine
 * @typedef {{
 *   location?: number[], rotation_mode?: string, rotation_euler?: number[], rotation_quaternion?: number[],
 *   rotation_axis_angle?: number[], scale?: number[], delta_location?: number[], delta_rotation_euler?: number[],
 *   delta_rotation_quaternion?: number[], delta_scale?: number[], parent?: ObjectRef,
 *   matrix_parent_inverse?: number[][], properties?: Record<string, number | number[]>
 * }} ObjectData an Empty, as plain data; every field optional
 * @typedef {ObjectData | string} ObjectRef an object, or the name of one in the driver's `objects`
 * @typedef {{
 *   object?: ObjectRef, value?: number, data_path?: string, transform_type?: string,
 *   transform_space?: string, rotation_mode?: string
 * }} Target `value` stands in for a SINGLE_PROP read when the caller resolves the property itself
 * @typedef {{ name?: string, type?: string, targets?: Target[] }} Variable
 * @typedef {{ type?: string, expression?: string, variables?: Variable[] }} Driver
 * @typedef {{ frame?: number, objects?: Record<string, ObjectData>, previousValue?: number }} Context
 * @typedef {{ value: number, valid: boolean, pythonOnly?: boolean }} DriverResult
 */

const SINGULAR_NUDGE = 1e-8;

// Matrix helpers, in float32 (see float32.js).

/** A singular matrix is nudged along its diagonal first, as Blender's safe inverse does. @param {Mat3} matrix @returns {Mat3} */
function inverse3(matrix) {
  const a = det3(matrix) === 0 ? matrix.map((row, r) => row.map((v, c) => (r === c ? v + SINGULAR_NUDGE : v))) : matrix;
  const d = det3(a);
  const m = (/** @type {number} */ r0, /** @type {number} */ c0, /** @type {number} */ r1, /** @type {number} */ c1) => f(f(a[r0][c0] * a[r1][c1]) - f(a[r0][c1] * a[r1][c0]));
  const g = (/** @type {number} */ v) => f(v / d);
  return [
    [g(m(1, 1, 2, 2)), g(-m(0, 1, 2, 2)), g(m(0, 1, 1, 2))],
    [g(-m(1, 0, 2, 2)), g(m(0, 0, 2, 2)), g(-m(0, 0, 1, 2))],
    [g(m(1, 0, 2, 1)), g(-m(0, 0, 2, 1)), g(m(0, 0, 1, 1))],
  ];
}

/** As a 4x4 product, so the zero terms of the bottom row take part (they turn -0 into +0). @param {Affine} a @param {Affine} b @returns {Affine} */
const compose = (a, b) => ({
  linear: a.linear.map((row, r) => [0, 1, 2].map((c) => f(dot(row, column(b.linear, c)) + f(a.translation[r] * 0)))),
  translation: apply3(a.linear, b.translation).map((v, i) => f(v + a.translation[i])),
});

/** @param {Mat3} a @returns {Mat3} each column divided by its length */
const normalizeColumns = (a) => {
  const lengths = [0, 1, 2].map((c) => f(Math.sqrt(dot(column(a, c), column(a, c)))));
  return a.map((row) => row.map((v, c) => (lengths[c] === 0 ? 0 : f(v * f(1 / lengths[c])))));
};

/** Order "ABC" rotates about A first: R_C R_B R_A, written out per element. @param {number[]} angles @param {string} order */
function eulerToMatrix(angles, order) {
  const [i, j, k] = [...order].map((axis) => AXIS[axis]);
  const sign = ['XYZ', 'YZX', 'ZXY'].includes(order) ? 1 : -1;
  const [ti, tj, th] = [angles[i], angles[j], angles[k]].map((a) => f(sign * a));
  const ci = f(Math.cos(ti)), cj = f(Math.cos(tj)), ch = f(Math.cos(th));
  const si = f(Math.sin(ti)), sj = f(Math.sin(tj)), sh = f(Math.sin(th));
  const cc = f(ci * ch), cs = f(ci * sh), sc = f(si * ch), ss = f(si * sh);
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  m[i][i] = f(cj * ch); m[i][j] = f(f(sj * sc) - cs); m[i][k] = f(f(sj * cc) + ss);
  m[j][i] = f(cj * sh); m[j][j] = f(f(sj * ss) + cc); m[j][k] = f(f(sj * cs) - sc);
  m[k][i] = -sj; m[k][j] = f(cj * si); m[k][k] = f(cj * ci);
  return m;
}

/** @param {number[]} q w, x, y, z @returns {Mat3} */
function quaternionToMatrix(q) {
  const size = f(Math.sqrt(dot(q, q)));
  if (size === 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  // Normalized in float32, then expanded in double and rounded once per element.
  const [w, x, y, z] = q.map((v) => f(v * f(1 / size)) * Math.SQRT2);
  return [
    [1 - y * y - z * z, x * y - w * z, x * z + w * y],
    [x * y + w * z, 1 - x * x - z * z, y * z - w * x],
    [x * z - w * y, y * z + w * x, 1 - x * x - y * y],
  ].map((row) => row.map(f));
}

/** @param {number[]} axisAngle angle, x, y, z */
function axisAngleToMatrix([angle, ...axis]) {
  const n = length(axis);
  if (n === 0) return quaternionToMatrix([1, 0, 0, 0]);
  const half = angle / 2, s = Math.sin(half) / n;
  return quaternionToMatrix([Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s]);
}

// Object matrices

const ZERO = [0, 0, 0];
const ONE = [1, 1, 1];
const IDENTITY_QUATERNION = [1, 0, 0, 0];

/** @param {ObjectData} o */
const rotationModeOf = (o) => o.rotation_mode ?? 'XYZ';

/** @param {ObjectData} o @returns {Mat3} rotation with its delta (none for axis angle) applied on the parent side */
function rotationMatrix(o) {
  const mode = rotationModeOf(o);
  if (mode === 'QUATERNION')
    return mul3(quaternionToMatrix(o.delta_rotation_quaternion ?? IDENTITY_QUATERNION), quaternionToMatrix(o.rotation_quaternion ?? IDENTITY_QUATERNION));
  if (mode === 'AXIS_ANGLE') return axisAngleToMatrix(o.rotation_axis_angle ?? [0, 0, 1, 0]);
  return mul3(eulerToMatrix(o.delta_rotation_euler ?? ZERO, mode), eulerToMatrix(o.rotation_euler ?? ZERO, mode));
}

/** @param {ObjectData} o @returns {Affine} the object's own transform, deltas included */
function basisMatrix(o) {
  const scale = (o.scale ?? ONE).map((s, i) => f(s * (o.delta_scale ?? ONE)[i]));
  const rotation = rotationMatrix(o);
  return {
    linear: rotation.map((row) => row.map((v, c) => f(v * scale[c]))),
    translation: (o.location ?? ZERO).map((v, i) => f(v + (o.delta_location ?? ZERO)[i])),
  };
}

/** @param {number[][]} rows 4 rows of 4 @returns {Affine} */
const affineFromRows = (rows) => ({ linear: rows.slice(0, 3).map((row) => row.slice(0, 3)), translation: rows.slice(0, 3).map((row) => row[3]) });

/** @param {ObjectData} o @param {(ref: ObjectRef) => ObjectData} resolve @returns {Affine} parent world times parent inverse */
function parentMatrix(o, resolve) {
  const parent = resolve(/** @type {ObjectRef} */ (o.parent));
  const inverse = o.matrix_parent_inverse ? affineFromRows(o.matrix_parent_inverse) : { linear: quaternionToMatrix(IDENTITY_QUATERNION), translation: ZERO };
  return compose(worldMatrix(parent, resolve), inverse);
}

/** @param {ObjectData} o @param {(ref: ObjectRef) => ObjectData} resolve @returns {Affine} */
function worldMatrix(o, resolve) {
  const basis = basisMatrix(o);
  return o.parent === undefined ? basis : compose(parentMatrix(o, resolve), basis);
}

/** @param {ObjectData} o @param {(ref: ObjectRef) => ObjectData} resolve @param {string} space @returns {Affine} */
function spaceMatrix(o, resolve, space) {
  if (space === 'WORLD_SPACE') return worldMatrix(o, resolve);
  const basis = basisMatrix(o);
  if (space === 'TRANSFORM_SPACE' || o.parent !== undefined) return basis;
  // Local space without a parent: the own matrix taken relative to its own rotation.
  const unrotate = inverse3(normalizeColumns(basis.linear));
  return { linear: mul3(unrotate, basis.linear), translation: apply3(unrotate, basis.translation) };
}

// Rotation readings

/** @param {Affine} m @param {ObjectData} o @param {string} type @param {string} rotationMode */
function readChannel(m, o, type, rotationMode) {
  const axis = AXIS[type.slice(-1)];
  if (type.startsWith('LOC_')) return m.translation[axis];
  if (type === 'SCALE_AVG') return Math.cbrt(det3(m.linear));
  if (type.startsWith('SCALE_')) return length(column(m.linear, axis));
  return readRotation(normalizeColumns(m.linear), rotationMode, type, rotationModeOf(o), o.rotation_euler ?? ZERO);
}

// Variables

/** Thrown for anything that makes a variable invalid (its value is then 0). */
class Invalid extends Error {}

/** @param {ObjectData} o @param {string} path @param {(ref: ObjectRef) => ObjectData} resolve */
export function readProperty(o, path, resolve) {
  const custom = /^\["((?:[^"\\]|\\.)*)"\](?:\[(\d+)\])?$/.exec(path);
  if (custom) return pickIndex(o.properties?.[custom[1]], custom[2]);
  const builtin = /^([a-z_]+)(?:\[(\d+)\])?(?:\[(\d+)\])?$/.exec(path);
  if (!builtin) throw new Invalid(path);
  const [, name, index, inner] = builtin;
  if (Object.hasOwn(MATRIX_PROPERTIES, name)) {
    // RNA matrices index column first: matrix_world[3][0] is the x translation.
    if (index === undefined || inner === undefined) throw new Invalid(path);
    return pickIndex(MATRIX_PROPERTIES[name](o, resolve)[Number(index)], inner);
  }
  if (inner !== undefined) throw new Invalid(path);
  if (Object.hasOwn(SCALAR_PROPERTIES, name)) {
    if (index !== undefined) throw new Invalid(path);
    return SCALAR_PROPERTIES[name];
  }
  if (!Object.hasOwn(VECTOR_DEFAULTS, name)) throw new Invalid(path);
  const field = /** @type {keyof typeof VECTOR_DEFAULTS} */ (name);
  return pickIndex(o[field] ?? VECTOR_DEFAULTS[field], index);
}

const VECTOR_DEFAULTS = {
  location: ZERO, scale: ONE, rotation_euler: ZERO, rotation_quaternion: IDENTITY_QUATERNION,
  rotation_axis_angle: [0, 0, 1, 0], delta_location: ZERO, delta_scale: ONE, delta_rotation_euler: ZERO,
  delta_rotation_quaternion: IDENTITY_QUATERNION,
};

/** Properties of an Empty that are not part of the object description, at their defaults. */
/** @type {Record<string, number>} */
const SCALAR_PROPERTIES = { name: 0, empty_display_size: 1, hide_viewport: 0, hide_render: 0, hide_select: 0 };

/** @param {Affine} m @returns {number[][]} columns of the 4x4 matrix */
const columns4 = (m) => [0, 1, 2].map((c) => [...column(m.linear, c), 0]).concat([[...m.translation, 1]]);

/** @type {Record<string, (o: ObjectData, resolve: (ref: ObjectRef) => ObjectData) => number[][]>} */
const MATRIX_PROPERTIES = {
  matrix_world: (o, resolve) => columns4(worldMatrix(o, resolve)),
  matrix_basis: (o) => columns4(basisMatrix(o)),
  matrix_parent_inverse: (o) => [0, 1, 2, 3].map((c) => [0, 1, 2, 3].map((r) => (o.matrix_parent_inverse ?? IDENTITY4)[r][c])),
};

const IDENTITY4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

/** @param {number | number[] | undefined} value @param {string | undefined} index */
function pickIndex(value, index) {
  if (value === undefined) throw new Invalid('missing');
  if (Array.isArray(value) !== (index !== undefined)) throw new Invalid('index');
  if (!Array.isArray(value)) return value;
  const i = Number(index);
  if (i >= value.length) throw new Invalid('index');
  return value[i];
}

/** @param {Target} target @param {(ref: ObjectRef) => ObjectData} resolve @returns {ObjectData} */
function targetObject(target, resolve) {
  if (target?.object === undefined || target.object === null) throw new Invalid('no object');
  return resolve(target.object);
}

/** @param {Target} target @param {(ref: ObjectRef) => ObjectData} resolve */
function locationOf(target, resolve) {
  const o = targetObject(target, resolve);
  const space = target.transform_space ?? 'WORLD_SPACE';
  if (space === 'TRANSFORM_SPACE') return o.location ?? ZERO;
  return spaceMatrix(o, resolve, space).translation;
}

/** @param {Target} target @param {(ref: ObjectRef) => ObjectData} resolve */
const worldRotation = (target, resolve) => normalizeColumns(worldMatrix(targetObject(target, resolve), resolve).linear);

/** @type {Record<string, (targets: Target[], resolve: (ref: ObjectRef) => ObjectData) => number>} */
const VARIABLE_TYPES = {
  SINGLE_PROP([target], resolve) {
    if (target?.value !== undefined) return target.value;
    return readProperty(targetObject(target, resolve), target.data_path ?? '', resolve);
  },
  TRANSFORMS([target], resolve) {
    const o = targetObject(target, resolve);
    const m = spaceMatrix(o, resolve, target.transform_space ?? 'WORLD_SPACE');
    return readChannel(m, o, target.transform_type ?? 'LOC_X', target.rotation_mode ?? 'AUTO');
  },
  LOC_DIFF([a, b], resolve) {
    const pa = locationOf(a, resolve), pb = locationOf(b, resolve);
    return length(pa.map((v, i) => v - pb[i]));
  },
  ROTATION_DIFF([a, b], resolve) {
    return rotationDifference(worldRotation(a, resolve), worldRotation(b, resolve));
  },
};

/** @param {Variable} variable @param {(ref: ObjectRef) => ObjectData} resolve @returns {{ value: number, valid: boolean }} */
export function evaluateVariable(variable, resolve) {
  const read = VARIABLE_TYPES[variable.type ?? 'SINGLE_PROP'];
  try {
    return { value: Math.fround(read(variable.targets ?? [], resolve)), valid: true };
  } catch (error) {
    if (error instanceof Invalid) return { value: 0, valid: false };
    throw error;
  }
}

// Drivers

const saturate = (/** @type {number} */ v) => (Number.isFinite(v) ? v : Math.sign(v) * FLT_MAX);

/** @type {Record<string, (values: number[]) => number>} */
const DRIVER_TYPES = {
  SUM: (values) => values.reduce((sum, v) => Math.fround(sum + v), 0),
  AVERAGE: (values) => (values.length ? Math.fround(DRIVER_TYPES.SUM(values) / values.length) : 0),
  MIN: (values) => (values.length ? Math.min(...values) : 0),
  MAX: (values) => (values.length ? Math.max(...values) : 0),
};

/** @param {Driver} driver @param {Context} context @returns {DriverResult} */
export function evaluateDriver(driver, context = {}) {
  const { frame = 1, objects = {}, previousValue = 0 } = context;
  /** @type {Map<ObjectData, ObjectData>} */
  const cache = new Map();
  /** @param {ObjectRef} ref @returns {ObjectData} */
  const resolve = (ref) => {
    const o = typeof ref === 'string' ? (objects[ref] ?? invalidObject(ref)) : ref;
    if (!cache.has(o)) cache.set(o, storedObject(o));
    return /** @type {ObjectData} */ (cache.get(o));
  };
  const variables = driver.variables ?? [];
  const results = variables.map((variable) => evaluateVariable(variable, resolve));
  const valid = results.every((r) => r.valid);
  const values = results.map((r) => r.value);
  const type = driver.type ?? 'SCRIPTED';
  if (type !== 'SCRIPTED') return { value: saturate(DRIVER_TYPES[type](values)), valid };
  const names = variables.map((v) => v.name ?? '');
  const evaluator = compile(driver.expression ?? '', names);
  if (evaluator === PYTHON_ONLY || typeof evaluator !== 'function') return { value: previousValue, valid, pythonOnly: true };
  const scope = Object.fromEntries(names.map((name, i) => [name, values[i]]).reverse());
  const value = evaluator(scope, frame);
  return { value: value ?? previousValue, valid };
}

const STORED_FIELDS = /** @type {const} */ (['location', 'rotation_euler', 'rotation_quaternion', 'rotation_axis_angle', 'scale', 'delta_location',
  'delta_rotation_euler', 'delta_rotation_quaternion', 'delta_scale']);

/** Blender stores transforms as float32. @param {ObjectData} o @returns {ObjectData} */
function storedObject(o) {
  /** @type {Record<string, any>} */
  const stored = { ...o };
  for (const field of STORED_FIELDS) if (o[field]) stored[field] = o[field].map(Math.fround);
  if (o.matrix_parent_inverse) stored.matrix_parent_inverse = o.matrix_parent_inverse.map((row) => row.map(Math.fround));
  if (o.parent && typeof o.parent === 'object') stored.parent = storedObject(o.parent);
  return stored;
}

/** @param {string} name @returns {never} */
function invalidObject(name) {
  throw new Invalid(`no object ${name}`);
}
