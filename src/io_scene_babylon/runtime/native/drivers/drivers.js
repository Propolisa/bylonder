// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Drivers of a rig description compiled against a RigProgram (prior/drivers-spec/drivers.md): each driver becomes an
// op that reads its variables, combines them by type, maps the value through its F-Curve and writes the property.
//
// Supported reads: SINGLE_PROP of custom properties and transform channels of objects and pose bones, constraint
// settings; TRANSFORMS, LOC_DIFF and ROTATION_DIFF of objects and bones. Supported writes: constraint influence, mute
// and Armature target weights, pose bone and object location, rotation and scale, Armature bone B-Bone values.
// Anything else is listed in program.unsupported and leaves the property as stored.
import { compileExpression, driverResult, FLT_MAX } from './expression.js';
import { evaluateFCurve, curveMapsDriver } from './fcurve.js';
import { readTransformChannel, locationIn, rotationDiff } from './channels.js';

// 'pose.bones["a"].constraints["b"].influence' -> [{name:'pose'}, {name:'bones'}, {key:'a'}, ...]
export function parsePath(path) {
  const out = [];
  const re = /\.?([A-Za-z_][A-Za-z0-9_]*)|\["((?:[^"\\]|\\.)*)"\]|\[(-?\d+)\]/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < path.length && (m = re.exec(path))) {
    if (m[1] !== undefined) out.push({ name: m[1] });
    else if (m[2] !== undefined) out.push({ key: m[2].replace(/\\(.)/g, '$1') });
    else out.push({ index: Number(m[3]) });
  }
  return re.lastIndex === path.length || out.length ? out : null;
}

const AXIS_INDEX = { x: 0, y: 1, z: 2, w: 3 };
const TRANSFORM_PROPS = new Set(['location', 'rotation_euler', 'rotation_quaternion', 'rotation_axis_angle', 'scale']);
const SIZE = { location: 3, rotation_euler: 3, rotation_quaternion: 4, rotation_axis_angle: 4, scale: 3 };

// A property of the program by path on an ID: { kind, ... } describing where it lives, or null.
export function resolveProperty(program, idName, idType, segs, arrayIndex) {
  if (!segs) return null;
  const objectIndex = program.objectIndex.get(idName);
  let i = 0;
  const at = (k) => segs[k] ?? {};
  // Shape keys: key_blocks["K"].value or eval_time on a mesh's Key (named by the mesh object or the Key).
  if (idType === 'KEY') {
    const mesh = program.objects.findIndex((o) => o.data?.shape_keys && (o.name === idName || o.data.shape_keys.name === idName));
    if (mesh < 0) return null;
    if (at(0).name === 'key_blocks' && at(1).key != null && at(2).name === 'value') return { kind: 'shapeKey', object: mesh, name: at(1).key };
    if (at(0).name === 'eval_time') return { kind: 'shapeEvalTime', object: mesh };
    return null;
  }
  // Armature data: bones["B"].<prop>
  if (idType === 'ARMATURE') {
    const ob = program.objects.findIndex((o) => o.data?.name === idName || (o.type === 'ARMATURE' && o.name === idName));
    if (ob < 0 || at(0).name !== 'bones' || at(1).key == null) return null;
    const b = program.objects[ob].boneIndex?.get(at(1).key);
    if (b === undefined || !at(2).name) return null;
    return { kind: 'boneData', bone: b, prop: at(2).name, index: at(3).index ?? arrayIndex };
  }
  if (objectIndex === undefined) return null;
  let bone = -1;
  if (at(0).name === 'pose' && at(1).name === 'bones' && at(2).key != null) {
    bone = program.objects[objectIndex].boneIndex?.get(at(2).key) ?? null;
    if (bone == null) return null;
    i = 3;
  }
  const s = segs.slice(i);
  if (s.length === 1 && s[0].key != null) return { kind: 'property', object: objectIndex, bone, name: s[0].key, index: arrayIndex };
  if (s.length === 2 && s[0].key != null && s[1].index != null) return { kind: 'property', object: objectIndex, bone, name: s[0].key, index: s[1].index };
  if (s[0]?.name && TRANSFORM_PROPS.has(s[0].name)) {
    const index = s.length === 1 ? arrayIndex : s[1].index ?? AXIS_INDEX[s[1].name];
    if (s.length > 2 || index == null || index < 0 || index >= SIZE[s[0].name]) return null;
    return { kind: 'transform', object: objectIndex, bone, prop: s[0].name, index };
  }
  if (bone >= 0 && s[0]?.name === 'head' && (s[1]?.index ?? arrayIndex) != null) return { kind: 'poseHead', object: objectIndex, bone, index: s[1]?.index ?? arrayIndex };
  if (bone >= 0 && s.length === 1 && s[0].name?.startsWith('bbone_')) return { kind: 'poseValue', bone, prop: s[0].name, index: arrayIndex };
  if (bone < 0 && s[0]?.name === 'data' && s[1]?.name === 'bones' && s[2]?.key != null && s[3]?.name) {
    const b = program.objects[objectIndex].boneIndex?.get(s[2].key);
    return b === undefined ? null : { kind: 'boneData', bone: b, prop: s[3].name, index: s[4]?.index ?? arrayIndex };
  }
  // Modifier settings (levels, show_viewport, factor ...): read when the deform stack is compiled.
  if (bone < 0 && s[0]?.name === 'modifiers' && s[1]?.key != null && s[2]?.name && s.length === 3) return { kind: 'modifier', object: objectIndex, modifier: s[1].key, prop: s[2].name };
  // Matrix properties read 0 (drivers do not read them; drivers_rig.md).
  if (['matrix', 'matrix_world', 'matrix_basis', 'matrix_local', 'matrix_channel'].includes(s[0]?.name)) return { kind: 'zero' };
  if (s[0]?.name === 'constraints' && s[1]?.key != null) {
    const c = program.constraintNamed(objectIndex, bone, s[1].key);
    if (!c) return null;
    if (s[2]?.name === 'targets' && s[3]?.index != null && s[4]?.name === 'weight') return { kind: 'armatureWeight', constraint: c, index: s[3].index };
    if (s.length === 3 && s[2].name) return { kind: 'setting', constraint: c, prop: s[2].name, index: arrayIndex };
  }
  return null;
}

function compileVariable(program, v) {
  const targets = v.targets ?? [];
  const ref = (t) => {
    const object = program.objectIndex.get(t.id);
    if (object === undefined) return null;
    if (!t.bone_target) return { object, bone: -1 };
    const bone = program.objects[object].boneIndex?.get(t.bone_target);
    return bone === undefined ? null : { object, bone };
  };
  switch (v.type) {
    case 'SINGLE_PROP': {
      const t = targets[0] ?? {};
      const r = resolveProperty(program, t.id, t.id_type ?? 'OBJECT', parsePath(t.data_path ?? ''), undefined);
      return r ? { kind: 'read', r } : { invalid: true };
    }
    case 'TRANSFORMS': {
      const r = targets[0] && ref(targets[0]);
      return r ? { kind: 'channel', r, t: targets[0] } : { invalid: true };
    }
    case 'LOC_DIFF': case 'ROTATION_DIFF': {
      const a = targets[0] && ref(targets[0]), b = targets[1] && ref(targets[1]);
      return a && b ? { kind: v.type === 'LOC_DIFF' ? 'distance' : 'angle', a, b, ta: targets[0], tb: targets[1] } : { invalid: true };
    }
    case 'CONTEXT_PROP': {
      const t = targets[0] ?? {};
      const read = contextReader(program, t.context_property ?? 'ACTIVE_SCENE', t.data_path ?? '');
      return read ? { kind: 'context', read } : { invalid: true };
    }
    default:
      return { invalid: true };
  }
}

// Context Property (drivers_rig.md): the scene's frame and fps, the view layer's use flag, custom properties.
function contextReader(program, which, path) {
  const holder = which === 'ACTIVE_VIEW_LAYER' ? program.viewLayer ?? {} : program.scene ?? {};
  const custom = /^\["(.+)"\]$/.exec(path);
  if (custom) return custom[1] in (holder.properties ?? {}) ? () => holder.properties[custom[1]] : null;
  if (which === 'ACTIVE_SCENE' && (path === 'frame_current' || path === 'frame_current_final')) {
    return path === 'frame_current' ? (inst) => Math.floor(inst.frame) : (inst) => inst.frame;
  }
  if (which === 'ACTIVE_SCENE' && path === 'render.fps') return () => program.scene.render?.fps ?? 24;
  if (which === 'ACTIVE_VIEW_LAYER' && path === 'use') return () => 1;
  return null;
}

// Compiles program.description drivers; returns { drivers, unsupported }.
export function compileDrivers(program, list) {
  const drivers = [], unsupported = [];
  for (const d of list) {
    // UI-only properties: no effect on evaluation.
    if (/\.(hide|hide_select|select)$/.test(d.data_path)) continue;
    const write = resolveProperty(program, d.id, d.id_type ?? 'OBJECT', parsePath(d.data_path), d.array_index ?? 0);
    const label = `${d.id}: ${d.data_path}[${d.array_index ?? 0}]`;
    if (!write) { unsupported.push(`${label}: target property not supported`); continue; }
    if (write.kind === 'boneData' && !['bbone_easein', 'bbone_easeout', 'bbone_rollin', 'bbone_rollout', 'bbone_curveinx', 'bbone_curveinz', 'bbone_curveoutx', 'bbone_curveoutz'].includes(write.prop)) {
      unsupported.push(`${label}: armature property not supported`);
      continue;
    }
    if (write.kind === 'setting' && typeof write.constraint.s[write.prop] === 'object' && write.constraint.s[write.prop] !== null && !Array.isArray(write.constraint.s[write.prop])) {
      unsupported.push(`${label}: constraint setting not supported`);
      continue;
    }
    const variables = (d.variables ?? []).map((v) => compileVariable(program, v));
    let expression = null;
    if (d.type === 'SCRIPTED') {
      expression = compileExpression(d.expression ?? '', (d.variables ?? []).map((v) => v.name));
      // Python-only: the reference binary does not run it; the driver reads 0 (drivers_rig.md). Listed for baking.
      if (!expression.ok) {
        unsupported.push(`${label}: needs Python, reads 0 (${expression.reason}): ${d.expression}`);
        expression = { ok: true, fn: () => 0, pythonOnly: true };
      }
    }
    drivers.push({ label, type: d.type, variables, expression, write, fcurve: curveMapsDriver(d) ? d : null, last: 0 });
  }
  return { drivers, unsupported };
}

// The double value of one variable, before float32 rounding.
function variableValue(inst, v) {
  if (v.invalid) return 0;
  switch (v.kind) {
    case 'read': return readProperty(inst, v.r);
    case 'channel': return readTransformChannel(inst, v.r, v.t);
    case 'distance': {
      const a = locationIn(inst, v.a, v.ta.transform_space), b = locationIn(inst, v.b, v.tb.transform_space);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    case 'angle': return rotationDiff(inst, v.a, v.b);
    case 'context': return v.read(inst);
    default: return 0;
  }
}

export function readProperty(inst, r) {
  switch (r.kind) {
    case 'property': {
      const v = inst.property(r.object, r.bone, r.name);
      if (Array.isArray(v)) return r.index == null ? 0 : +(v[r.index] ?? 0);
      return typeof v === 'number' || typeof v === 'boolean' ? +v : 0;
    }
    case 'transform': return inst.transformValue(r.object, r.bone, r.prop, r.index);
    case 'setting': return +(r.constraint.s[r.prop] ?? 0);
    case 'armatureWeight': return r.constraint.targetList?.[r.index]?.weight ?? 0;
    case 'boneData': { const v = inst.program.bones[r.bone][r.prop] ?? 0; return Array.isArray(v) ? v[r.index ?? 0] ?? 0 : +v; }
    case 'poseValue': {
      const o = inst.poseValues?.get(`${r.bone}/${r.prop}`);
      const v = o ?? inst.program.bones[r.bone].pose[r.prop] ?? (r.prop.startsWith('bbone_scale') ? [1, 1, 1] : 0);
      return Array.isArray(v) ? v[r.index ?? 0] ?? 0 : +v;
    }
    case 'shapeKey': return inst.shapeKeyValue(r.object, r.name) ?? inst.program.objects[r.object].data.shape_keys.key_blocks.find((k) => k.name === r.name)?.value ?? 0;
    case 'poseHead': return inst.pose[r.bone * 16 + 12 + r.index];
    case 'zero': return 0;
    default: return 0;
  }
}

const f32Sat = (x) => { const f = Math.fround(x); return Number.isFinite(f) ? f : Math.sign(x) * FLT_MAX; };

// Evaluates one driver: the float32 value, or null when a scripted expression errs (previous value kept).
export function evaluateDriver(inst, d, frame = 0) {
  const vals = d.variables.map((v) => Math.fround(variableValue(inst, v)));
  let value;
  switch (d.type) {
    case 'SCRIPTED': value = driverResult(d.expression.fn(vals, Math.fround(frame))); break;
    case 'AVERAGE': case 'SUM': {
      let s = 0;
      for (const x of vals) s = Math.fround(s + x);
      value = d.type === 'SUM' ? s : vals.length ? Math.fround(s / vals.length) : 0;
      value = Number.isFinite(value) ? value : Math.sign(value) * FLT_MAX;
      break;
    }
    case 'MIN': value = vals.length ? Math.min(...vals) : 0; break;
    case 'MAX': value = vals.length ? Math.max(...vals) : 0; break;
    default: value = 0;
  }
  if (value === null) return null;
  return d.fcurve ? f32Sat(evaluateFCurve(d.fcurve, value)) : value;
}
