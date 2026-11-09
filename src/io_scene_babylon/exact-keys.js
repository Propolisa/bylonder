// Babylon keys that are a channel's F-curve exactly, where they can be: Babylon's Hermite keys are Blender's Bezier
// segments when the handles sit at a third and two thirds of the key spacing (as Blender's Auto and Auto Clamped
// handles do), and its Hermite or step keys are Blender's linear and constant segments. The keys are kept only when
// they reproduce what Main evaluated at every frame of the range (`samples`): anything else that moves the value
// (drivers, constraints, NLA, F-modifiers but a plain Cycles, another extrapolation) leaves the samples in place.
import { Animation, AnimationKeyInterpolation } from '@babylonjs/core';

const THIRD = 1e-4, TOLERANCE = 1e-5;

// A segment's tangents per frame at its start and end, or null when Babylon cannot draw it exactly.
function segmentTangents(a, b) {
  const dx = b.frame - a.frame, slope = (b.value - a.value) / dx;
  if (a.interpolation === 'LINEAR') return [slope, slope];
  if (a.interpolation !== 'BEZIER') return null;
  const [hx1, hy1] = a.handle_right, [hx2, hy2] = b.handle_left;
  if (Math.abs((hx1 - a.frame) / dx - 1 / 3) > THIRD || Math.abs((b.frame - hx2) / dx - 1 / 3) > THIRD) return null;
  return [3 * (hy1 - a.value) / dx, 3 * (b.value - hy2) / dx];
}

// Babylon's keys for a track's keys (model.js track(ref).keys, in the channel's values), or null.
export function curveKeys(keys) {
  if (!keys?.length) return null;
  const out = keys.map((k) => ({ frame: k.frame, value: k.value }));
  for (let i = 0; i + 1 < keys.length; i++) {
    if (keys[i].interpolation === 'CONSTANT') {
      out[i].interpolation = AnimationKeyInterpolation.STEP;
      continue;
    }
    const tangents = segmentTangents(keys[i], keys[i + 1]);
    if (!tangents) return null;
    [out[i].outTangent, out[i + 1].inTangent] = tangents;
  }
  // Babylon draws a segment with tangents only when both its ends have them.
  for (const key of out) {
    key.inTangent ??= key.outTangent ?? 0;
    key.outTangent ??= key.inTangent;
  }
  return out;
}

// The keys repeated period after period over the range (a Cycles F-modifier's repetition, which Babylon's animation
// group cannot loop per animation), or null when that is no fewer keys than a sample per frame. A cycle that ends where
// it starts shares its boundary key.
function repeated(keys, frameStart, frameEnd) {
  const first = keys[0].frame, period = keys.at(-1).frame - first;
  if (period <= 0) return null;
  const out = [];
  for (let n = Math.floor((frameStart - first) / period); first + n * period <= frameEnd; n++) {
    keys.forEach((key, i) => {
      const shifted = { ...key, frame: key.frame + n * period }, last = out.at(-1);
      if (i === 0 && last?.frame === shifted.frame && last.value === shifted.value) Object.assign(last, { outTangent: shifted.outTangent, interpolation: shifted.interpolation });
      else out.push(shifted);
    });
  }
  return out.length < frameEnd - frameStart + 1 ? out : null;
}

// A float animation of `property` from a track's keys, as they are or repeated, when it reproduces `samples` (one per
// frame from `frameStart`), else null.
export function exactAnimation(name, property, keys, samples, { frameStart, fps }) {
  const babylonKeys = curveKeys(keys);
  if (!babylonKeys) return null;
  const frameEnd = frameStart + samples.length - 1;
  for (const candidate of [babylonKeys, repeated(babylonKeys, frameStart, frameEnd)].filter(Boolean)) {
    const animation = new Animation(name, property, fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys(candidate);
    if (samples.every((value, i) => Math.abs(animation.evaluate(frameStart + i) - value) <= TOLERANCE * Math.max(1, Math.abs(value)))) return animation;
  }
  return null;
}
