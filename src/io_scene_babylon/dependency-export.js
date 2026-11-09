// The package's dependency table (docs/controllable-exports.md): the operations that propagate a control's change, as
// plain data. Each driver of an exported ID whose inputs are controls becomes a `driver` operation: its expression,
// variables and F-Curve as Blender's RNA holds them, the controls it reads and the one it writes, run in the page by the
// clean-room driver units (runtime/drivers/). Its baked samples play until a control it reads is set. A driver the page
// cannot run (Python, an F-Curve modifier, an input that is no control) stays baked.
import { compile, PYTHON_ONLY } from './runtime/drivers/expression.js';
import { evaluateFCurve, prepareFCurve } from './runtime/drivers/fcurve.js';
import { blendData } from '../python/bpy_rna.js';

const key = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
// The bpy.data collection of each ID type a driver target names.
const COLLECTIONS = { OBJECT: 'objects', MATERIAL: 'materials', SCENE: 'scenes', KEY: 'shape_keys', WORLD: 'worlds', MESH: 'meshes',
  LIGHT: 'lights', CAMERA: 'cameras', NODETREE: 'node_groups' };
const pathOf = (collection, name, dataPath) => `${collection}${key(name)}${dataPath.startsWith('[') ? '' : '.'}${dataPath}`;
// An object's transform controls: its location, scale and the rotation of its mode (controls-export.js).
const ROTATIONS = { QUATERNION: 'rotation_quaternion', AXIS_ANGLE: 'rotation_axis_angle' };
const transformsOf = (ob) => ['location', ROTATIONS[ob.rotation_mode] ?? 'rotation_euler', 'scale'];
const STATIC = ['delta_location', 'delta_rotation_euler', 'delta_rotation_quaternion', 'delta_scale'];
const rows = (matrix) => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => matrix[c][r]));

// An object as the driver units read it (driver.js ObjectData): its transform's controls by path, its static parts as
// values, and its parent's, recursively.
function objectData(ob, objects, reads) {
  if (objects[ob.name]) return;
  const base = `objects${key(ob.name)}`, transforms = {};
  for (const name of transformsOf(ob)) transforms[name] = [...ob[name]].map((_, i) => `${base}.${name}[${i}]`);
  reads.push(...Object.values(transforms).flat());
  objects[ob.name] = {
    controls: transforms, rotation_mode: ob.rotation_mode,
    ...Object.fromEntries(STATIC.map((name) => [name, [...ob[name]]])),
    ...(ob.parent && { parent: ob.parent.name, matrix_parent_inverse: rows(ob.matrix_parent_inverse) }),
  };
  if (ob.parent) objectData(ob.parent, objects, reads);
}

// The F-Curve that maps a driver's value (driver.js FCurveInput), or null without keys; undefined when it has
// modifiers the units do not evaluate, or when the units' curve misses Blender's anywhere it is sampled (some
// Continuous Acceleration curves do, docs/clean-room/impl/RESULTS.md).
function driverCurve(fc) {
  if ([...fc.modifiers].some((m) => m.type !== 'CYCLES')) return undefined;
  if (!fc.keyframe_points.length) return null;
  const curve = curveInput(fc);
  return matchesBlender(fc, curve) ? curve : undefined;
}

// The units' curve against Blender's (FCurve.evaluate) at its keys, between them and well beyond its ends, within the
// clean room's acceptance tolerance (2e-5 relative to the largest key value, at least 1).
function matchesBlender(fc, input) {
  const curve = prepareFCurve(input), frames = input.keyframes.map((k) => k.co[0]), values = input.keyframes.map((k) => Math.abs(k.co[1]));
  const first = Math.min(...frames), last = Math.max(...frames), span = Math.max(last - first, 1), scale = Math.max(1, ...values);
  const samples = [...frames, ...Array.from({ length: 97 }, (_, i) => first - 2 * span + (i * 5 * span) / 96)];
  return samples.every((x) => Math.abs(evaluateFCurve(curve, x) - fc.evaluate(x)) <= 2e-5 * Math.max(scale, Math.abs(fc.evaluate(x))));
}

// A driver's F-Curve as the units take it (fcurve.js FCurveInput).
function curveInput(fc) {
  const pair = (p) => [p[0], p[1]];
  return {
    keyframes: [...fc.keyframe_points].map((k) => ({ co: pair(k.co), handle_left: pair(k.handle_left), handle_right: pair(k.handle_right), interpolation: k.interpolation,
      easing: k.easing, handle_left_type: k.handle_left_type, handle_right_type: k.handle_right_type, back: k.back, amplitude: k.amplitude, period: k.period })),
    extrapolation: fc.extrapolation, auto_smoothing: fc.auto_smoothing,
    cycles: [...fc.modifiers].map((m) => ({ mode_before: m.mode_before, mode_after: m.mode_after, cycles_before: m.cycles_before, cycles_after: m.cycles_after }))[0] ?? false,
  };
}

// One driver as an operation on the controls (`index` gives a control's position by path), or null when it stays baked.
function driverOperation(collection, id, fc, index) {
  const written = pathOf(collection, id.name, `${fc.data_path}[${fc.array_index}]`), write = index.get(written) ?? index.get(pathOf(collection, id.name, fc.data_path));
  const { driver } = fc, curve = driverCurve(fc);
  if (write === undefined || curve === undefined || driver.use_self) return null;
  const variables = [], objects = {}, reads = [];
  for (const variable of driver.variables) {
    const targets = [...variable.targets].slice(0, variable.type === 'SINGLE_PROP' || variable.type === 'TRANSFORMS' ? 1 : 2);
    if (targets.some((t) => !t.id || t.bone_target)) return null;
    variables.push({ name: variable.name, type: variable.type, targets: targets.map((t) => {
      if (variable.type === 'SINGLE_PROP') {
        const path = COLLECTIONS[t.id_type] && pathOf(COLLECTIONS[t.id_type], t.id.name, t.data_path);
        reads.push(path);
        return { control: index.get(path) };
      }
      objectData(t.id, objects, reads);
      return { object: t.id.name, transform_type: t.transform_type, transform_space: t.transform_space, rotation_mode: t.rotation_mode };
    }) });
  }
  if (driver.type === 'SCRIPTED' && compile(driver.expression, variables.map((v) => v.name)) === PYTHON_ONLY) return null;
  const indices = reads.map((path) => index.get(path));
  if (indices.some((i) => i === undefined)) return null;
  for (const o of Object.values(objects)) o.controls = Object.fromEntries(Object.entries(o.controls).map(([name, paths]) => [name, paths.map((p) => index.get(p))]));
  return { evaluator: 'driver', reads: [...new Set(indices)], writes: [write], baked: written,
    data: { driver: { type: driver.type, expression: driver.expression, variables }, curve, objects } };
}

// Operations in an order where each runs after those that write what it reads.
function topological(operations) {
  const writers = new Map(operations.flatMap((op, i) => op.writes.map((w) => [w, i]))), order = [], state = new Map();
  const visit = (i) => {
    if (state.get(i) === 'done') return;
    if (state.get(i) === 'visiting') throw Error('drivers depend on each other in a cycle');
    state.set(i, 'visiting');
    for (const r of operations[i].reads) if (writers.has(r)) visit(writers.get(r));
    state.set(i, 'done');
    order.push(i);
  };
  operations.forEach((_, i) => visit(i));
  return order;
}

// The table for `controls` (the package's CONTROLS, which the drivers' inputs are marked suggested in), or null.
export function exportDependencies(world, controls) {
  if (!world.mainSync) return null;
  const index = new Map(controls.map((c, i) => [c.path, i])), operations = [], data = blendData();
  for (const collection of Object.values(COLLECTIONS)) for (const id of data[collection] ?? []) {
    for (const fc of id.animation_data?.drivers ?? []) {
      const op = driverOperation(collection, id, fc, index);
      if (op) operations.push(op);
    }
  }
  if (!operations.length) return null;
  for (const op of operations) for (const r of op.reads) controls[r].suggested = true;
  return { version: 1, operations, order: topological(operations) };
}
