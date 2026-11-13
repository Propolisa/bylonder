// The scene's drivers as IR entities (docs/ir.md): each driver of an exported ID whose inputs are properties becomes a
// `driver:<type>` entity: its expression, variables and F-Curve as Blender's RNA holds them, the properties it reads and
// the one it writes, run in the page by the clean-room driver units (runtime/drivers/). Its baked samples play until a
// property it reads is set. A driver the page cannot run (Python, an F-Curve modifier, an input that is no property)
// stays baked.
import { compile, PYTHON_ONLY } from './runtime/drivers/expression.js';
import { prepareFCurve } from './runtime/drivers/fcurve.js';
import { curveValue } from './runtime/fcurve-evaluator.js';
import { blendData } from '../python/bpy_rna.js';
import { idKey } from './ir-export.js';

const key = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
// The bpy.data collection of each ID type a driver target names.
const COLLECTIONS = { OBJECT: 'objects', MATERIAL: 'materials', SCENE: 'scenes', KEY: 'shape_keys', WORLD: 'worlds', MESH: 'meshes',
  LIGHT: 'lights', CAMERA: 'cameras', NODETREE: 'node_groups' };
// A vector's component by letter (`pose.bones["Hand"].scale.y`), as its controls index it (`scale[1]`).
const AXES = { rotation_quaternion: 'wxyz', rotation_axis_angle: 'wxyz' };
const indexed = (dataPath) => dataPath.replace(/(\w+)\.([wxyz])$/, (whole, vector, axis) => `${vector}[${(AXES[vector] ?? 'xyzw').indexOf(axis)}]`);
const pathOf = (collection, name, dataPath) => `${collection}${key(name)}${dataPath.startsWith('[') ? '' : '.'}${indexed(dataPath)}`;
// An object's transform controls: its location, scale and the rotation of its mode (controls-export.js).
const ROTATIONS = { QUATERNION: 'rotation_quaternion', AXIS_ANGLE: 'rotation_axis_angle' };
const transformsOf = (ob) => ['location', ROTATIONS[ob.rotation_mode] ?? 'rotation_euler', 'scale'];
const STATIC = ['delta_location', 'delta_rotation_euler', 'delta_rotation_quaternion', 'delta_scale'];
const rows = (matrix) => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => matrix[c][r]));

// An object as the driver units read it (driver.js ObjectData): its transform as properties, its static parts as
// values, and its parent's, recursively.
function objectData(ob, objects, reads) {
  if (objects[ob.name]) return;
  const base = `objects${key(ob.name)}`, transforms = {};
  for (const name of transformsOf(ob)) transforms[name] = [...ob[name]].map((_, i) => `${base}.${name}[${i}]`);
  reads.push(...Object.values(transforms).flat());
  objects[ob.name] = {
    ...Object.fromEntries(Object.entries(transforms).map(([name, paths]) => [name, paths.map((property) => ({ property }))])), rotation_mode: ob.rotation_mode,
    ...Object.fromEntries(STATIC.map((name) => [name, [...ob[name]]])),
    ...(ob.parent && { parent: ob.parent.name, matrix_parent_inverse: rows(ob.matrix_parent_inverse) }),
  };
  if (ob.parent) objectData(ob.parent, objects, reads);
}

// The F-Curve that maps a driver's value (driver.js FCurveInput), or null without keys; undefined when it has
// modifiers the units do not evaluate, or when the units' curve misses Blender's anywhere it is sampled (some
// Continuous Acceleration curves do, docs/clean-room/impl/RESULTS.md).
export function driverCurve(fc, whole = false) {
  if ([...fc.modifiers].some((m) => m.type !== 'CYCLES')) return undefined;
  if (!fc.keyframe_points.length) return null;
  const curve = { ...curveInput(fc), ...(whole && { whole }) };
  return matchesBlender(fc, curve) ? curve : undefined;
}

// The units' curve against Blender's (FCurve.evaluate) at its keys, between them and well beyond its ends, within the
// clean room's acceptance tolerance (2e-5 relative to the largest key value, at least 1).
function matchesBlender(fc, input) {
  const curve = prepareFCurve(input), frames = input.keyframes.map((k) => k.co[0]), values = input.keyframes.map((k) => Math.abs(k.co[1]));
  const first = Math.min(...frames), last = Math.max(...frames), span = Math.max(last - first, 1), scale = Math.max(1, ...values);
  const samples = [...frames, ...Array.from({ length: 97 }, (_, i) => first - 2 * span + (i * 5 * span) / 96)];
  return samples.every((x) => Math.abs(curveValue(input, curve, x) - fc.evaluate(x)) <= 2e-5 * Math.max(scale, Math.abs(fc.evaluate(x))));
}

// A driver's F-Curve as the units take it (fcurve.js FCurveInput).
export function curveInput(fc) {
  const pair = (p) => [p[0], p[1]];
  return {
    keyframes: [...fc.keyframe_points].map((k) => ({ co: pair(k.co), handle_left: pair(k.handle_left), handle_right: pair(k.handle_right), interpolation: k.interpolation,
      easing: k.easing, handle_left_type: k.handle_left_type, handle_right_type: k.handle_right_type, back: k.back, amplitude: k.amplitude, period: k.period })),
    extrapolation: fc.extrapolation, auto_smoothing: fc.auto_smoothing,
    cycles: [...fc.modifiers].map((m) => ({ mode_before: m.mode_before, mode_after: m.mode_after, cycles_before: m.cycles_before, cycles_after: m.cycles_after }))[0] ?? false,
  };
}

// A bone a driver variable reads, as the page finds it (runtime/pose-constraints.js): its armature's skeleton and the
// mesh it skins (`skeletons`, by the armature's name), in a space; undefined where the page draws it with none.
function boneTarget(t, space, skeletons) {
  const drawn = t.id?.type === 'ARMATURE' && skeletons[t.id.name];
  return drawn && t.id.pose.bones.get(t.bone_target) ? { bone: t.bone_target, skeleton: drawn.skeleton, mesh: drawn.mesh, space } : undefined;
}

// Whether the page can run a driver that reads no bone's transform (driverEntity's `driver` implementation), as far as
// the driver alone tells: what it reads still has to be exported.
export function pageDriver(fc) {
  const { driver } = fc;
  if (driver.use_self || driverCurve(fc) === undefined) return false;
  if ([...driver.variables].some((v) => v.type !== 'SINGLE_PROP' || [...v.targets].slice(0, 1).some((t) => !t.id || t.bone_target))) return false;
  return driver.type !== 'SCRIPTED' || compile(driver.expression, [...driver.variables].map((v) => v.name)) !== PYTHON_ONLY;
}

// One driver as an IR entity reading and writing `properties`, or null when it stays baked. A driver reading a bone
// runs with the page's poses (the `pose` implementation), after them each frame.
function driverEntity(collection, id, fc, properties, time, skeletons) {
  const exact = pathOf(collection, id.name, `${fc.data_path}[${fc.array_index}]`), written = [exact, pathOf(collection, id.name, fc.data_path)].find((p) => properties[p]);
  const { driver } = fc, curve = driverCurve(fc);
  // Disable in Viewports switches what a viewport shows (a rig's proxy meshes); the page shows what Blender renders.
  if (!written || curve === undefined || driver.use_self || fc.data_path === 'hide_viewport') return null;
  const variables = [], objects = {}, reads = [];
  let bones = false;
  for (const variable of driver.variables) {
    const targets = [...variable.targets].slice(0, variable.type === 'SINGLE_PROP' || variable.type === 'TRANSFORMS' ? 1 : 2);
    const space = (t) => (variable.type === 'ROTATION_DIFF' ? 'WORLD_SPACE' : t.transform_space);
    if (targets.some((t) => !t.id || (t.bone_target && variable.type !== 'SINGLE_PROP' && !boneTarget(t, space(t), skeletons)))) return null;
    if (targets.some((t) => t.bone_target && variable.type === 'SINGLE_PROP')) return null;
    variables.push({ name: variable.name, type: variable.type, targets: targets.map((t) => {
      if (t.bone_target) {
        const name = `${t.id.name}:${t.bone_target}:${space(t)}`;
        objects[name] = boneTarget(t, space(t), skeletons);
        bones = true;
        return { object: name, transform_type: t.transform_type, transform_space: t.transform_space, rotation_mode: t.rotation_mode };
      }
      if (variable.type === 'SINGLE_PROP') {
        const path = COLLECTIONS[t.id_type] && pathOf(COLLECTIONS[t.id_type], t.id.name, t.data_path);
        reads.push(path);
        return { value: { property: path } };
      }
      objectData(t.id, objects, reads);
      return { object: t.id.name, transform_type: t.transform_type, transform_space: t.transform_space, rotation_mode: t.rotation_mode };
    }) });
  }
  if (driver.type === 'SCRIPTED' && compile(driver.expression, variables.map((v) => v.name)) === PYTHON_ONLY) return null;
  if (reads.some((path) => !properties[path])) return null;
  // The scene's time, which an expression reads as `frame`.
  // A driver reading bones runs each frame, after the poses; one whose expression reads `frame`, when it changes.
  const frame = (bones || (driver.type === 'SCRIPTED' && /frame/.test(driver.expression))) && time;
  return [`${idKey(id)}/driver/${fc.data_path}[${fc.array_index}]`, { type: `driver:${driver.type}`, id: idKey(id), implementation: bones ? 'pose' : 'driver',
    inputs: { driver: { type: driver.type, expression: driver.expression, variables }, curve, objects, ...(frame && { frame: { property: frame } }) },
    outputs: { value: { property: written } } }];
}

/** The names of an armature's bones whose transforms the drivers of every ID read (a bone target off a Single Property). */
export function bonesDriversRead(arm) {
  const data = blendData(), names = new Set();
  for (const collection of Object.values(COLLECTIONS)) for (const id of data[collection] ?? []) for (const fc of id.animation_data?.drivers ?? []) {
    for (const variable of fc.driver.variables) if (variable.type !== 'SINGLE_PROP') for (const t of variable.targets) if (t.id?.name === arm.name && t.bone_target) names.add(t.bone_target);
  }
  return names;
}

// The drivers of every ID that the page can run on `properties`, as IR entities by key; `skeletons`, the skeleton
// and skinned mesh drawing each armature, by its name, for drivers that read bones.
export function driverEntities(properties, skeletons = {}) {
  const data = blendData(), entities = {}, time = Object.keys(properties).find((path) => path.endsWith('.frame_current'));
  for (const collection of Object.values(COLLECTIONS)) for (const id of data[collection] ?? []) {
    for (const fc of id.animation_data?.drivers ?? []) {
      const entry = driverEntity(collection, id, fc, properties, time, skeletons);
      if (entry) entities[entry[0]] = entry[1];
    }
  }
  return entities;
}
