// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The animation stage (specs/evaluation.md): an object's active Action (its slot's F-Curves) over its NLA tracks,
// blended per channel, written into the properties before drivers run.
//
// Object `animation_data`: { action, action_slot, action_blend_type, action_influence, nla_tracks: [{ mute, strips:
// [{ action, action_slot, frame_start, frame_end, action_frame_start, action_frame_end, scale, repeat, blend_type,
// extrapolation, influence, use_animated_influence, blend_in, blend_out, mute }] }] }.
import { evaluateFCurve } from '../drivers/fcurve.js';
import { parsePath, resolveProperty } from '../drivers/drivers.js';

const DEFAULT = { scale: 1, rotation_quaternion: [1, 0, 0, 0], rotation_axis_angle: [0, 0, 1, 0] };
const defaultOf = (prop, i) => (Array.isArray(DEFAULT[prop]) ? DEFAULT[prop][i] : DEFAULT[prop] ?? 0);

// The F-Curves an object reads from an action: its slot's (or every curve when the action has no slots named).
function slotCurves(action, slot) {
  const name = slot ?? action?.slots?.[0]?.name;
  return (action?.fcurves ?? []).filter((fc) => !fc.slot || !name || fc.slot === name);
}

export function actionRange(action) {
  let lo = Infinity, hi = -Infinity;
  for (const fc of action?.fcurves ?? []) for (const k of fc.keyframe_points ?? []) { lo = Math.min(lo, k.co[0]); hi = Math.max(hi, k.co[0]); }
  return lo <= hi ? [lo, hi] : [0, 0];
}

export function compileAnimations(program) {
  const out = [];
  program.objects.forEach((ob, oi) => {
    const ad = ob.animation_data;
    if (!ad || (!ad.action && !ad.nla_tracks?.length)) return;
    const layers = [];
    for (const track of ad.nla_tracks ?? []) {
      if (track.mute) continue;
      const strips = (track.strips ?? []).filter((s) => !s.mute).map((s, k) => {
        const action = program.actions.get(s.action), [a0, a1] = [s.action_frame_start, s.action_frame_end].every((v) => v != null) ? [s.action_frame_start, s.action_frame_end] : actionRange(action);
        const scale = s.scale ?? 1, repeat = s.repeat ?? 1, start = s.frame_start ?? a0;
        return {
          curves: slotCurves(action, s.action_slot), a0, a1, start, end: s.frame_end ?? start + (a1 - a0) * scale * repeat, length: (a1 - a0) * scale,
          blend: s.blend_type ?? 'REPLACE', extrapolation: s.extrapolation ?? (k === 0 ? 'HOLD' : 'HOLD_FORWARD'),
          influence: s.use_animated_influence ? s.influence ?? 1 : 1, blendIn: s.blend_in ?? 0, blendOut: s.blend_out ?? 0,
        };
      });
      if (strips.length) layers.push({ strips });
    }
    const active = ad.action ? { curves: slotCurves(program.actions.get(ad.action), ad.action_slot), blend: ad.action_blend_type ?? 'REPLACE', influence: ad.action_influence ?? 1 } : null;
    // Channels by property path: the write target and which indices are animated.
    const channels = new Map();
    const curvesOf = [...layers.flatMap((l) => l.strips.map((s) => s.curves)), ...(active ? [active.curves] : [])];
    for (const curves of curvesOf) for (const fc of curves) {
      const key = fc.data_path;
      if (!channels.has(key)) channels.set(key, { path: key, indices: new Set(), writes: [] });
      channels.get(key).indices.add(fc.array_index ?? 0);
    }
    for (const ch of channels.values()) {
      const segs = parsePath(ch.path), prop = segs?.[segs.length - 1]?.name;
      ch.prop = prop;
      // A strip animating any quaternion component brings all four.
      const indices = prop === 'rotation_quaternion' ? [0, 1, 2, 3] : [...ch.indices];
      ch.writes = indices.map((i) => ({ index: i, w: resolveProperty(program, ob.name, 'OBJECT', segs, i) })).filter((x) => x.w);
    }
    // A channel whose every curve holds one value (all keys equal, no modifiers) is the same at every frame: it is
    // evaluated once.
    const flat = (fc) => !(fc.modifiers ?? []).some((m) => !m.mute) && (fc.keyframe_points ?? []).every((k, _, a) => k.co[1] === a[0].co[1]);
    for (const ch of channels.values()) ch.constant = curvesOf.every((curves) => curves.filter((fc) => fc.data_path === ch.path).every(flat));
    out.push({ object: oi, layers, active, channels: [...channels.values()].filter((c) => c.writes.length) });
  });
  return out;
}

// Strip time, or null when the strip contributes nothing at frame f; with its influence.
function stripAt(s, f) {
  let t, k = s.influence;
  if (f < s.start) {
    if (s.extrapolation !== 'HOLD') return null;
    if (s.blendIn) return null;
    t = s.a0;
  } else if (f >= s.end) {
    if (s.extrapolation === 'NOTHING') return null;
    if (s.blendOut) return null;
    t = s.a1;
  } else {
    const u = (f - s.start) / s.length;
    t = s.a0 + (u - Math.floor(u)) * (s.a1 - s.a0);
    if (s.blendIn && f < s.start + s.blendIn) k *= (f - s.start) / s.blendIn;
    if (s.blendOut && f > s.end - s.blendOut) k *= (s.end - f) / s.blendOut;
  }
  return { t, k };
}

function curveValue(curves, path, index, t) {
  const fc = curves.find((c) => c.data_path === path && (c.array_index ?? 0) === index);
  return fc ? evaluateFCurve(fc, t) : null;
}

const slerpFromIdentity = (q, k) => {
  const n = Math.hypot(...q) || 1, [w, x, y, z] = q.map((v) => v / n), th = Math.acos(Math.min(1, Math.abs(w)));
  if (th < 1e-12) return [1, 0, 0, 0];
  const s = Math.sin(th), a = Math.sin((1 - k) * th) / s, b = Math.sin(k * th) / s * Math.sign(w || 1);
  return [a + b * w, b * x, b * y, b * z];
};
const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

// One layer onto the values below (spec blend table), for one channel's components.
function blend(type, prop, lower, upper, k) {
  if (type === 'COMBINE' && prop === 'rotation_quaternion') return qmul(lower, slerpFromIdentity(upper, k));
  return lower.map((l, i) => {
    const u = upper[i];
    if (u == null) return l;
    switch (type) {
      case 'ADD': return l + k * u;
      case 'SUBTRACT': return l - k * u;
      case 'MULTIPLY': return l + k * (l * u - l);
      case 'COMBINE': return prop === 'scale' ? l * u ** k : l + k * u;
      default: return l + k * (u - l);
    }
  });
}

// Evaluates an object's animation at frame f: [{ w, value }] writes.
export function evaluateAnimation(anim, f, firstRun = true) {
  const writes = [];
  for (const ch of anim.channels) {
    if (ch.constant && !firstRun) continue;
    let values = ch.writes.map(({ index }) => defaultOf(ch.prop, index));
    const layer = (curves, t, type, k) => {
      const upper = ch.writes.map(({ index }) => curveValue(curves, ch.path, index, t));
      if (upper.every((v) => v == null)) return;
      if (ch.prop === 'rotation_quaternion') upper.forEach((v, i) => { if (v == null) upper[i] = defaultOf(ch.prop, ch.writes[i].index); });
      values = blend(type, ch.prop, values, upper, k);
    };
    for (const { strips } of anim.layers) {
      // The strip containing f, else the held one (the first before its start, the last before f after its end).
      let s = strips.find((x) => f >= x.start && f < x.end);
      if (!s) s = f < strips[0].start ? strips[0] : [...strips].reverse().find((x) => f >= x.end);
      const at = s && stripAt(s, f);
      if (at && at.k > 0) layer(s.curves, at.t, s.blend, at.k);
    }
    if (anim.active) layer(anim.active.curves, f, anim.active.blend, anim.active.influence);
    ch.writes.forEach(({ w }, i) => writes.push({ w, value: values[i] }));
  }
  return writes;
}
