// The clean-room oracle (tools/cleanroom/oracle.js) answers with Blender's results: values worked out by hand for
// simple expressions, driver variables and types, and F-Curve interpolation, easing, extrapolation and cycles.
import assert from 'node:assert/strict';
import { answer } from '../tools/cleanroom/oracle.js';

const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-5, `${label}: ${a} != ${b}`);
const value = (request) => {
  const result = answer(request);
  assert.equal(result.error, undefined, `${JSON.stringify(request)}: ${result.error}`);
  return result.value;
};

const expression = (text, variables = {}, frame = 1) => value({ kind: 'expression', expression: text, variables, frame });
close(expression('a * 2 + frame', { a: 1.5 }, 12), 15, 'arithmetic and frame');
close(expression('sin(pi / 2) + clamp(a, 0, 1) + min(1, 2, -3)', { a: 3 }), -1, 'functions');
close(expression('a if a > 1 else 0', { a: 3 }), 3, 'conditional');
close(expression('round(2.5)'), 3, 'round half away from zero, unlike Python');
close(expression(''), 0, 'empty expression');
assert.deepEqual(answer({ kind: 'expression', expression: '2 ** 3' }), { error: 'python-only' });
assert.deepEqual(answer({ kind: 'expression', expression: 'b', variables: { a: 1 } }), { error: 'python-only' });

const transform = (type, transform_type, object, transform_space = 'WORLD_SPACE', rotation_mode = 'AUTO') =>
  value({ kind: 'driver', type, variables: [{ name: 'v', type: 'TRANSFORMS', targets: [{ transform_type, transform_space, rotation_mode, object }] }] });
close(transform('AVERAGE', 'LOC_X', { location: [1, 0, 0], parent: { location: [2, 0, 0], scale: [2, 2, 2] } }), 4, 'world location under a scaled parent');
close(transform('AVERAGE', 'LOC_X', { location: [1, 0, 0], parent: { location: [2, 0, 0], scale: [2, 2, 2] } }, 'TRANSFORM_SPACE'), 1, 'transform space');
close(transform('MAX', 'ROT_W', { rotation_euler: [0, 0, 1.2] }, 'WORLD_SPACE', 'QUATERNION'), Math.cos(0.6), 'quaternion W');
close(value({ kind: 'driver', type: 'SUM', variables: [
  { name: 'd', type: 'LOC_DIFF', targets: [{ object: { location: [3, 4, 0] } }, { object: {} }] },
  { name: 'r', type: 'ROTATION_DIFF', targets: [{ object: { rotation_euler: [0, 0, 1] } }, { object: {} }] }] }), 6, 'distance and rotation difference');
close(value({ kind: 'driver', type: 'SCRIPTED', expression: 'p * 2', objects: { a: { location: [0, 0, 5] } },
  variables: [{ name: 'p', type: 'SINGLE_PROP', targets: [{ object: 'a', data_path: 'location[2]' }] }] }), 10, 'single property');

const fcurve = (keyframes, times, settings = {}) => answer({ kind: 'fcurve', keyframes, times, ...settings });
const line = [{ co: [1, 0], interpolation: 'LINEAR' }, { co: [11, 10], interpolation: 'LINEAR' }];
assert.deepEqual(fcurve(line, [6, 20], { extrapolation: 'LINEAR' }).values, [5, 19], 'linear interpolation and extrapolation');
assert.deepEqual(fcurve(line, [-5, 20]).values, [0, 10], 'constant extrapolation');
assert.deepEqual(fcurve([{ co: [1, 0], interpolation: 'CONSTANT' }, { co: [11, 10] }], [10.9]).values, [0], 'constant interpolation');
close(fcurve([{ co: [0, 0], interpolation: 'QUAD', easing: 'EASE_IN' }, { co: [10, 10] }], [5]).values[0], 2.5, 'quadratic ease in');
close(fcurve([{ co: [0, 0] }, { co: [10, 10] }], [5]).values[0], 5, 'symmetric Bezier');
assert.deepEqual(fcurve([{ co: [0, 0], interpolation: 'LINEAR' }, { co: [10, 10] }], [15, -5], { cycles: true }).values, [5, 5], 'cycles');
const { handles } = fcurve([{ co: [5, 3] }, { co: [1, 0] }, { co: [11, 0] }], []);
assert.deepEqual(handles.map((h) => h.co), [[1, 0], [5, 3], [11, 0]], 'keys sorted');
assert.ok(handles.every((h) => h.handle_left[1] === h.co[1] && h.handle_right[1] === h.co[1]), 'auto clamped handles flat at extremes');

console.log('Clean-room oracle: expressions, driver variables and F-Curves answer with Blender\'s results');
