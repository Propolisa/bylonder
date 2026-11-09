// F-Curves of an object's transform that a package's page runs on the clean-room F-Curve unit (runtime/fcurve-evaluator.js)
// where Babylon cannot play them exactly: an Euler rotation, an easing, another extrapolation, a Cycles modifier it
// cannot repeat. One is kept only when the page's result, the curves through scene.bin's floats composed as blend-scene.js
// places the node, is what Main evaluated at every frame of the range; anything else that moves the transform (NLA,
// drivers, constraints, F-modifiers but Cycles, delta transforms) leaves it sampled.
import { Matrix, Quaternion } from '@babylonjs/core';
import { idStruct } from '../python/bpy_rna.js';
import { placement, posedBone } from './runtime/blend-scene.js';
import { evaluateFCurve, prepareFCurve } from './runtime/drivers/fcurve.js';
import { packKeys, unpackKeys } from './runtime/fcurve-evaluator.js';
import { constrained, swapped } from './runtime/constraints-evaluator.js';
import { curveInput } from './driver-export.js';
import { key, transformBinding } from './controls-export.js';
import { actionFCurves } from './ir-export.js';

// The clean room's acceptance tolerance, relative to values above 1.
const TOLERANCE = 2e-5;
const PARTS = { position: 'location', scaling: 'scale' };
const FIELDS = { position: 'position', scaling: 'scaling', rotationQuaternion: 'rotation', direction: 'direction' };

const close = (a, b) => (a instanceof Quaternion ? [b, b.scale(-1)].some((q) => close(a.asArray(), q.asArray())) : a.asArray?.() ? close(a.asArray(), b.asArray())
  : a.every((v, i) => Math.abs(v - b[i]) <= TOLERANCE * Math.max(1, Math.abs(b[i]))));

// An F-Curve as the page runs it: its settings, its keys as scene.bin holds them, and the unit's curve from those.
function pageCurve(fc) {
  const { keyframes, ...settings } = curveInput(fc), keys = packKeys(keyframes);
  return { settings, keys, curve: prepareFCurve({ ...settings, keyframes: unpackKeys(keys) }) };
}

// For an object's node, what gives the F-Curves the page runs for one of its sampled transform keys (`position`,
// `rotationQuaternion`, `scaling`, `direction`) from Main's samples of it (`frames`, one per frame from `frameStart`):
// each `{ id, fc, settings, keys, node }`, or null when they do not reproduce the samples.
export function liveTransform(sync, node) {
  const pointer = sync.objectOf(node), ob = idStruct(pointer);
  const rotation = ob.rotation_mode === 'QUATERNION' ? 'rotation_quaternion' : 'rotation_euler';
  const bind = transformBinding(node, ob, [...ob[rotation]], sync.blender.transform(pointer).matrix_parent_inverse);
  if (bind?.node !== node.id) return () => null;
  const defaults = { location: [...ob.location], [rotation]: [...ob[rotation]], scale: [...ob.scale] }, fcurves = actionFCurves(ob.animation_data);
  return (key, frames, frameStart) => {
    const part = PARTS[key] ?? rotation, own = fcurves.filter((fc) => fc.data_path === part && !fc.mute);
    if (!own.length || own.some((fc) => [...fc.modifiers].some((m) => m.type !== 'CYCLES'))) return null;
    const curves = own.map((fc) => ({ fc, ...pageCurve(fc) }));
    const placed = (frame) => {
      const values = { ...defaults, [part]: [...defaults[part]] };
      for (const { fc, curve } of curves) values[part][fc.array_index] = evaluateFCurve(curve, frame);
      return placement(bind.transform, (name) => values[name])[FIELDS[key]];
    };
    if (!frames.every((sample, i) => { const value = placed(frameStart + i); return value && close(value, sample[key]); })) return null;
    return curves.map(({ fc, settings, keys }) => ({ id: ob, fc, settings, keys, node: node.id }));
  };
}

// For a bone of an armature (RNA's Object and PoseBone) and its Babylon Bone, the F-Curves the page runs for its pose
// when, posed as blend-scene.js poses a bone, they give its local matrices (`samples`, one per frame from `frameStart`):
// each `{ id, fc, settings, keys, node }`, none when nothing animates a pose that holds, or null when they do not
// reproduce the samples (constraints, IK, NLA, drivers, F-modifiers but Cycles, another inheritance).
export function livePose(arm, pose, bone, samples, frameStart) {
  const base = `pose.bones${key(pose.name)}`, mode = pose.rotation_mode, animation = arm.animation_data;
  if (mode === 'AXIS_ANGLE' || animation?.nla_tracks.length || [...(animation?.drivers ?? [])].some((d) => d.data_path.startsWith(base))) return null;
  const rotation = mode === 'QUATERNION' ? 'rotation_quaternion' : 'rotation_euler', parts = ['location', rotation, 'scale'];
  const own = actionFCurves(animation).filter((fc) => !fc.mute && parts.some((part) => fc.data_path === `${base}.${part}`));
  if (own.some((fc) => [...fc.modifiers].some((m) => m.type !== 'CYCLES'))) return null;
  const curves = own.map((fc) => ({ fc, part: fc.data_path.slice(base.length + 1), ...pageCurve(fc) }));
  const defaults = Object.fromEntries(parts.map((part) => [part, [...pose[part]]]));
  const posed = (frame) => {
    const values = Object.fromEntries(parts.map((part) => [part, [...defaults[part]]]));
    for (const { fc, part, curve } of curves) values[part][fc.array_index] = evaluateFCurve(curve, frame);
    return posedBone({ mode }, (name) => values[name], bone.getRestMatrix());
  };
  if (!samples.every((sample, i) => close(posed(frameStart + i), sample))) return null;
  return curves.map(({ fc, settings, keys }) => ({ id: arm, fc, settings, keys, node: bone.id }));
}

// Each constraint the page applies (runtime/constraints-evaluator.js), as it reads it, in world space at full influence:
// its settings, or null when the page does not apply it.
const AXES = ['x', 'y', 'z'];
const CONSTRAINTS = {
  TRACK_TO: (c) => ({ track_axis: c.track_axis, up_axis: c.up_axis, use_target_z: c.use_target_z }),
  COPY_LOCATION: (c) => ({ use: AXES.map((a) => c[`use_${a}`]), invert: AXES.map((a) => c[`invert_${a}`]), use_offset: c.use_offset }),
  COPY_ROTATION: (c) => (AXES.every((a) => c[`use_${a}`] && !c[`invert_${a}`]) && c.mix_mode === 'REPLACE' ? {} : null),
  CHILD_OF: (c) => (['location', 'rotation', 'scale'].every((k) => AXES.every((a) => c[`use_${k}_${a}`])) ? { inverse_matrix: [...c.inverse_matrix] } : null),
};

// For an object's node whose own transform nothing animates, its constraints as the page applies them: `{ own, check,
// entity }`, `own` its transform before them, `check()` comparing the page's result with Main's world matrix at the
// frame Main is on, and `entity()` the IR entity's inputs (`node`, `constraints`, by the nodes' ids then) once every check
// held, else null; null when the page cannot apply them. `nodeOf` gives the node of an object.
export function liveConstraints(sync, node, nodeOf) {
  const ob = idStruct(sync.objectOf(node)), rotation = ob.rotation_mode === 'QUATERNION' ? 'rotation_quaternion' : 'rotation_euler', animation = ob.animation_data;
  if (!ob.constraints.length || !['Mesh', 'TransformNode', 'InstancedMesh'].includes(node.getClassName())) return null;
  if (actionFCurves(animation).some((fc) => /^(location|rotation_|scale|delta_)/.test(fc.data_path)) || animation?.nla_tracks.length || animation?.drivers.length) return null;
  const bind = transformBinding(node, ob, [...ob[rotation]], sync.blender.transform(sync.objectOf(node)).matrix_parent_inverse);
  if (!bind || bind.transform.offset) return null;
  const stack = [];
  for (const c of [...ob.constraints].filter((c) => !c.mute)) {
    const settings = c.influence === 1 && c.owner_space === 'WORLD' && c.target_space === 'WORLD' && !c.subtarget && c.target && CONSTRAINTS[c.type]?.(c);
    const target = settings && nodeOf(c.target);
    if (!target) return null;
    stack.push({ type: c.type, target, settings });
  }
  const own = placement(bind.transform, (name) => [...ob[name]]), local = Matrix.Compose(own.scaling, own.rotation, own.position);
  let checked = 0, held = true;
  return {
    own,
    check() {
      const world = node.parent ? local.multiply(sync.worldMatrix(node.parent)) : local, targets = new Map(stack.map((c) => [c.target.id, c.target]));
      const result = constrained(swapped(world), stack.map(({ type, target, settings }) => ({ type, target: target.id, ...settings })), (id) => swapped(sync.worldMatrix(targets.get(id))));
      held &&= close(result.asArray(), swapped(sync.worldMatrix(node)).asArray());
      checked++;
    },
    entity: () => (checked && held ? { node: node.id, constraints: stack.map(({ type, target, settings }) => ({ type, target: target.id, ...settings })) } : null),
  };
}
