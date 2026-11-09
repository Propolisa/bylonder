// F-Curves of an object's transform that a package's page runs on the clean-room F-Curve unit (runtime/fcurve-evaluator.js)
// where Babylon cannot play them exactly: an Euler rotation, an easing, another extrapolation, a Cycles modifier it
// cannot repeat. One is kept only when the page's result, the curves through scene.bin's floats composed as blend-scene.js
// places the node, is what Main evaluated at every frame of the range; anything else that moves the transform (NLA,
// drivers, constraints, F-modifiers but Cycles, delta transforms) leaves it sampled.
import { Quaternion } from '@babylonjs/core';
import { idStruct } from '../python/bpy_rna.js';
import { placement } from './runtime/blend-scene.js';
import { evaluateFCurve, prepareFCurve } from './runtime/drivers/fcurve.js';
import { packKeys, unpackKeys } from './runtime/fcurve-evaluator.js';
import { curveInput } from './driver-export.js';
import { transformBinding } from './controls-export.js';
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
