// Babylon keys that are a channel's F-curve exactly, where they can be: Babylon's Hermite keys are Blender's Bezier
// segments when the handles sit at a third and two thirds of the key spacing (as Blender's Auto and Auto Clamped
// handles do), and its Hermite or step keys are Blender's linear and constant segments. The keys are kept only when
// they reproduce what Main evaluated at every frame of the range (`samples`): anything else that moves the value
// (drivers, constraints, NLA, F-modifiers but a plain Cycles, another extrapolation) leaves the samples in place.
import { Animation, AnimationKeyInterpolation } from '@babylonjs/core';
import { actionFCurves } from './ir-export.js';

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

/** An F-Curve's keys as exactAnimation reads them, or null. */
export const fcurveKeys = (fc) => fc && [...fc.keyframe_points].map((k) => ({ frame: k.co[0], value: k.co[1], interpolation: k.interpolation,
  handle_left: [k.handle_left[0], k.handle_left[1]], handle_right: [k.handle_right[0], k.handle_right[1]] }));

// A channel's keys (`data_path`, `array_index`) as an ID's NLA plays them where Babylon can: one track holding it, its
// strips action clips that replace at full influence (no blend in or out, no animated influence or time, not reversed,
// a whole number of repeats), and no action on top setting it. Each strip's keys are moved to its frames, scaled and
// repeated; null otherwise. exactAnimation checks them against Main's samples.
export function stripKeys(animation, dataPath, index) {
  if (!animation?.use_nla || animation.use_tweak_mode || animation.nla_tracks.length === 0) return null;
  const sets = (owner) => actionFCurves(owner).find((fc) => fc.data_path === dataPath && fc.array_index === index && !fc.mute);
  if (animation.action && sets(animation)) return null;
  const tracks = [...animation.nla_tracks].filter((track) => !track.mute && [...track.strips].some((strip) => !strip.mute && strip.action && sets(strip)));
  if (tracks.length !== 1 || [...animation.nla_tracks].some((track) => track.is_solo)) return null;
  const keys = [];
  for (const strip of tracks[0].strips) {
    const fc = !strip.mute && sets(strip);
    if (!fc || strip.type !== 'CLIP' || strip.blend_type !== 'REPLACE' || strip.blend_in || strip.blend_out || strip.use_animated_influence || strip.use_animated_time
      || strip.use_reverse || strip.repeat !== Math.round(strip.repeat) || [...fc.modifiers].length) return null;
    const length = strip.action_frame_end - strip.action_frame_start, scale = Math.abs(strip.scale) || 1;
    const own = [...fc.keyframe_points].filter((k) => k.co[0] >= strip.action_frame_start && k.co[0] <= strip.action_frame_end);
    const at = (x, n) => strip.frame_start + (x - strip.action_frame_start + n * length) * scale;
    for (let n = 0; n < strip.repeat; n++) for (const k of own) {
      const key = { frame: at(k.co[0], n), value: k.co[1], interpolation: k.interpolation, handle_left: [at(k.handle_left[0], n), k.handle_left[1]], handle_right: [at(k.handle_right[0], n), k.handle_right[1]] };
      // A repeat that starts where the last ended shares its key.
      const last = keys.at(-1);
      if (last?.frame === key.frame) Object.assign(last, { interpolation: key.interpolation, handle_right: key.handle_right });
      else keys.push(key);
    }
  }
  return keys.length ? keys : null;
}
