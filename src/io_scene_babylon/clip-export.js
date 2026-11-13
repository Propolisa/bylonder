// File > Export's Animations as Clips (export-options.js ANIMATIONS): an animation group per Blender action, named by it,
// as Blender's glTF exporter exports actions and Babylon's glTF loader names its groups. Each action is evaluated alone
// by Blender on the IDs that use it, over its frame range; the first NLA strip playing it gives the group's playback:
// its blending (Add, and Combine approximated as Add, additive), influence (weight), scale (speed) and repeat.
import { Animation, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { pointerOf, setCustomProperty } from '../python/bpy_rna.js';
import { actionFCurves } from './ir-export.js';

import { isClip } from './runtime/clips.js';

export { isClip };

const address = (id) => pointerOf(id)?.[2];
// A test of whether an ID is one of `ids`.
export const ownedBy = (ids) => {
  const addresses = new Set(ids.map(address));
  return (id) => !!id && addresses.has(address(id));
};

// How a clip plays as the first strip using its action plays it, or as the action plays assigned.
function playback(action, strip) {
  const [start, end] = strip ? [strip.action_frame_start, strip.action_frame_end] : action.frame_range;
  return { frame_start: Math.floor(start), frame_end: Math.ceil(end), blend: strip?.blend_type ?? 'REPLACE',
    influence: strip?.use_animated_influence ? strip.influence : 1, speed: strip ? 1 / (Math.abs(strip.scale) || 1) : 1, repeat: strip?.repeat ?? 1 };
}

/**
 * The clips of the actions `ids` use, assigned or in their NLA strips: { name, action, ids, frame_start, frame_end,
 * blend, influence, speed, repeat }, ids being those that use it.
 */
export function actionClips(ids) {
  const clips = new Map();
  const use = (action, id, strip) => {
    if (!action) return;
    if (!clips.has(action.name)) clips.set(action.name, { action, ids: [], strip: null });
    const clip = clips.get(action.name);
    if (!ownedBy(clip.ids)(id)) clip.ids.push(id);
    clip.strip ??= strip;
  };
  for (const id of ids) {
    const adt = id.animation_data;
    if (!adt) continue;
    for (const track of adt.nla_tracks) for (const strip of track.strips) use(strip.action, id, strip);
    use(adt.action, id, null);
  }
  return [...clips.values()].map(({ action, ids: users, strip }) => ({ name: action.name, action, ids: users, ...playback(action, strip) }));
}

// An object's location and Euler rotation components its action does not set, set to 0 for an additive clip's samples
// to hold nothing but the action's; gives what puts them back.
function zeroUnset(id) {
  if (!id.location) return () => {};
  const curves = actionFCurves(id.animation_data), saved = [];
  for (const path of ['location', 'rotation_euler']) for (let i = 0; i < 3; i++) {
    if (curves.some((fc) => fc.data_path === path && fc.array_index === i)) continue;
    saved.push([path, i, id[path][i]]);
    id[path][i] = 0;
  }
  return () => saved.forEach(([path, i, value]) => { id[path][i] = value; });
}

// An armature's own pose (each bone's location, rotation and scale) and the custom properties of it and its bones (a
// rig's settings), put back by the function it gives: an action sampled before another leaves what it keys where it put
// it, which the next would sample, and the export write, as the file's.
const POSE = ['location', 'rotation_quaternion', 'rotation_euler', 'rotation_axis_angle', 'scale'];
const numbers = (struct) => [...(struct?.keys?.() ?? [])].filter((name) => typeof struct.get(name) === 'number').map((name) => [name, struct.get(name)]);
function keepPose(id) {
  const bones = [...(id.pose?.bones ?? [])], saved = bones.map((bone) => POSE.map((path) => [...bone[path]]));
  const properties = [id, ...bones].map((struct) => [struct, numbers(struct)]);
  return () => {
    bones.forEach((bone, i) => POSE.forEach((path, k) => { bone[path] = saved[i][k]; }));
    for (const [struct, values] of properties) for (const [name, value] of values) if (struct.get(name) !== value) setCustomProperty(struct, name, value);
  };
}

/**
 * Runs `sample` with `action` alone animating `ids`: assigned to each, its NLA off; then gives each its animation data
 * and an armature its own pose back. With `additive`, an object's transform the action leaves alone is zero meanwhile.
 */
export function withAction(ids, action, sample, { additive = false } = {}) {
  const saved = ids.map((id) => { const adt = id.animation_data; return { id, adt, action: adt.action, slot: adt.action_slot, use_nla: adt.use_nla }; });
  const restores = ids.map(keepPose);
  try {
    for (const { id, adt } of saved) {
      adt.action = action;
      // An action whose one slot is not named for this ID (a pose library's "Legacy Slot") animates it all the same.
      const slots = [...(action.slots ?? [])];
      if (!adt.action_slot && slots.length === 1) adt.action_slot = slots[0];
      adt.use_nla = false;
      if (additive) restores.push(zeroUnset(id));
    }
    return sample();
  } finally {
    restores.forEach((restore) => restore());
    for (const { adt, action: own, slot, use_nla } of saved) {
      adt.action = own;
      if (own && slot && adt.action_slot?.handle !== slot.handle) adt.action_slot = slot;
      adt.use_nla = use_nla;
    }
  }
}

// What an additive clip's keys are deltas from where they are not already: a bone's rest pose, an unscaled scale.
function reference(animation, target) {
  if (animation.dataType === Animation.ANIMATIONTYPE_MATRIX) return target.getRestMatrix().clone();
  if (!animation.targetProperty.startsWith('scaling')) return null;
  return animation.dataType === Animation.ANIMATIONTYPE_VECTOR3 ? Vector3.One() : 1;
}
/** An animation of an additive clip as deltas, as Babylon's MakeAnimationAdditive makes them, from its reference frame. */
export function additive(animation, target) {
  const value = reference(animation, target);
  if (value === null) return animation;
  // Babylon's reference is the first key at frame 0: the reference value is put there, the keys after it, then taken out.
  const keys = animation.getKeys(), shift = 1 - keys[0].frame;
  animation.setKeys([{ frame: 0, value }, ...keys.map((key) => ({ ...key, frame: key.frame + shift }))]);
  Animation.MakeAnimationAdditive(animation);
  animation.setKeys(animation.getKeys().slice(1).map((key) => ({ ...key, frame: key.frame - shift })));
  return animation;
}

/**
 * A clip's animation group as Babylon's glTF loader makes one: normalized to start at 0, looping, not started, with
 * the strip's playback. `targetedAnimations`: serialized, at the action's frames.
 */
export function clipGroup(clip, targetedAnimations) {
  const { name, frame_start, frame_end, blend, influence, speed } = clip;
  for (const { animation } of targetedAnimations) for (const key of animation.keys) key.frame -= frame_start;
  const isAdditive = blend !== 'REPLACE', properties = clipProperties(clip);
  return { name, from: 0, to: frame_end - frame_start, speedRatio: speed, loopAnimation: true, isAdditive, weight: isAdditive || influence < 1 ? influence : -1,
    playOrder: 0, targetedAnimations, metadata: { bylonder: { clip: true, action: name, frame_start, ...(properties && { properties }) } } };
}

// The custom properties a clip's action keys on an object or its pose bones (a rig's settings: IK or FK, what follows
// what), by their path as the page's controls name them: a value per frame from the clip's start, or one where it holds
// still. The page sets them as the clip plays, as Blender's animation does.
function clipProperties({ action, ids = [], frame_start, frame_end }) {
  const objects = ids.filter((id) => id.pose !== undefined || id.location !== undefined);
  if (!action || !objects.length) return null;
  const owner = `objects[${JSON.stringify(objects[0].name)}]`, out = {};
  for (const fc of [...action.layers].flatMap((l) => [...l.strips]).flatMap((s) => [...s.channelbags]).flatMap((bag) => [...bag.fcurves])) {
    if (!/\]\["|^\["/.test(fc.data_path)) continue;
    const [, bone, name] = /^(?:pose\.bones\["((?:[^"\\]|\\.)*)"\])?\["((?:[^"\\]|\\.)*)"\]$/.exec(fc.data_path) ?? [];
    const struct = bone ? objects[0].pose?.bones?.get?.(JSON.parse(`"${bone}"`)) : objects[0], current = struct?.get?.(name && JSON.parse(`"${name}"`));
    // A curve whose property is missing (a rig's leftover gizmo keys) sets nothing, as in Blender.
    if (typeof current !== 'number' && typeof current !== 'boolean') continue;
    const flag = typeof current === 'boolean';
    const values = Array.from({ length: frame_end - frame_start + 1 }, (_, f) => (flag ? fc.evaluate(frame_start + f) >= 0.5 : Math.fround(fc.evaluate(frame_start + f))));
    out[`${owner}${fc.data_path.startsWith('[') ? '' : '.'}${fc.data_path}`] = values.every((v) => v === values[0]) ? values[0] : values;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The clips as the IR's scene time records them (runtime/ir.js ClipSchema), by name, with their actions' pose markers
 * and the foot contacts found from Blender's evaluation (contacts-export.js).
 */
export const irClips = (clips) => Object.fromEntries(clips.map(({ name, action, frame_start, frame_end, blend, influence, speed, repeat, contacts }) => [name, {
  action: action.name, frame_start, frame_end, blend, influence, speed, repeat,
  markers: [...(action.pose_markers ?? [])].map((m) => ({ name: m.name, frame: m.frame })), ...(contacts && { contacts }) }]));

// Clip compression, after ACL (Nicholas Frechette's Animation Compression Library): each bone track's keys reduced to
// those its neighbours' interpolation cannot stand in for within an error bound, then quantized: rotation as the
// smallest three components of its unit quaternion (16 bits each, and the index of the largest), location and scale on
// 16 bits over the track's own range, scale left out where it stays 1. The page decodes them once, at load
// (CLIP_KEYS_SOURCE), into the keys Babylon plays.
// The bounds for an error of `mm` at the end of a half-meter bone (export-options.js CLIP_COMPRESSION; 1 mm is ACL's
// default precision): location in the rig's units, rotation in radians, scale.
const bounds = (mm) => ({ location: mm * 1e-4, rotation: mm / 500, scale: mm * 1e-3 });

/** A key's location, rotation (x, y, z, w) and scale from its Babylon matrix's values. */
function decompose(values) {
  const m = Matrix.FromArray(values), scale = new Vector3(), turn = new Quaternion(), at = new Vector3();
  m.decompose(scale, turn, at);
  return { t: at.asArray(), q: turn.normalize().asArray(), s: scale.asArray() };
}
const lerp = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
function slerp(a, b, f) {
  const q = Quaternion.Slerp(Quaternion.FromArray(a), Quaternion.FromArray(b), f);
  return q.asArray();
}
/** Whether key `i` is within the bounds of its interpolation between keys `a` and `b`. */
function fits(keys, frames, a, b, i, bound) {
  const f = (frames[i] - frames[a]) / (frames[b] - frames[a] || 1);
  const t = lerp(keys[a].t, keys[b].t, f), s = lerp(keys[a].s, keys[b].s, f);
  return Math.hypot(...t.map((v, k) => v - keys[i].t[k])) <= bound.location && angle(slerp(keys[a].q, keys[b].q, f), keys[i].q) <= bound.rotation
    && Math.max(...s.map((v, k) => Math.abs(v - keys[i].s[k]))) <= bound.scale;
}
/** The keys kept: the ends, then (Douglas-Peucker) the worst key of each span that its ends do not stand in for. */
function reduce(keys, frames, bound) {
  const kept = new Set([0, keys.length - 1]), spans = [[0, keys.length - 1]];
  while (spans.length) {
    const [a, b] = spans.pop();
    let worst = -1;
    for (let i = a + 1; i < b && worst < 0; i++) if (!fits(keys, frames, a, b, i, bound)) worst = i;
    if (worst < 0) continue;
    // Split where interpolation is furthest off: the key at the largest rotation or location error.
    let far = worst, error = -1;
    for (let i = a + 1; i < b; i++) {
      const f = (frames[i] - frames[a]) / (frames[b] - frames[a]);
      const e = angle(slerp(keys[a].q, keys[b].q, f), keys[i].q) / bound.rotation + Math.hypot(...lerp(keys[a].t, keys[b].t, f).map((v, k) => v - keys[i].t[k])) / bound.location;
      if (e > error) { error = e; far = i; }
    }
    kept.add(far);
    spans.push([a, far], [far, b]);
  }
  return [...kept].sort((x, y) => x - y);
}
/** Values on 16 bits over their own range per component: the quantized values, and each component's minimum and extent. */
function quantize(rows, size) {
  const min = Array.from({ length: size }, (_, k) => Math.min(...rows.map((r) => r[k])));
  const extent = Array.from({ length: size }, (_, k) => Math.max(...rows.map((r) => r[k])) - min[k]);
  const out = new Uint16Array(rows.length * size);
  rows.forEach((r, i) => r.forEach((v, k) => { out[i * size + k] = extent[k] > 0 ? Math.round(((v - min[k]) / extent[k]) * 65535) : 0; }));
  const short = (values) => values.map((v) => Number(v.toPrecision(7)));
  return { out, min: short(min), extent: short(extent) };
}
/** Unit quaternions as their smallest three components (on 16 bits over [-1/sqrt2, 1/sqrt2]) and the largest's index. */
function smallestThree(quaternions) {
  const out = new Uint16Array(quaternions.length * 4), range = Math.SQRT1_2;
  quaternions.forEach((q, i) => {
    let largest = 0;
    for (let k = 1; k < 4; k++) if (Math.abs(q[k]) > Math.abs(q[largest])) largest = k;
    const sign = q[largest] < 0 ? -1 : 1;
    let j = 0;
    for (let k = 0; k < 4; k++) if (k !== largest) out[i * 4 + j++] = Math.round(((q[k] * sign + range) / (2 * range)) * 65535);
    out[i * 4 + 3] = largest;
  });
  return out;
}

/** A track's keys exact: its frames, and each matrix's 12 affine entries (the last column is 0, 0, 0, 1). */
function exactKeys(animation, bin) {
  const values = new Float32Array(animation.keys.length * 12);
  animation.keys.forEach((key, i) => { for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) values[i * 12 + r * 3 + c] = key.values[r * 4 + c]; });
  return { frames: bin.add(Float32Array.from(animation.keys, (key) => key.frame)), values: bin.add(values) };
}

/**
 * Bone matrices in scene.bin instead of JSON, in one track table per group: a clip's compressed within `mm` (above), or
 * exact with `mm` 0; the timeline's exact, as it plays the scene. Gives the groups to write; each such animation has no
 * keys, and `bylonderKeys` (indices of `bin`): { frames, values } exact, or { frames, rotation, location, scale } with the
 * location's and scale's ranges.
 */
export function binaryClipKeys(groups, bin, mm = 1) {
  const bound = bounds(mm);
  return groups.map((group) => trackTable({ ...group, targetedAnimations: group.targetedAnimations.map((t) => {
    const { animation } = t;
    // A timeline's track of one key (a bone held still) stays as it is: the table holds what moves.
    if (animation.dataType !== Animation.ANIMATIONTYPE_MATRIX || !animation.keys.length || (!isClip(group) && animation.keys.length < 2)) return t;
    // What Babylon's Animation.Parse needs, the rest left to its defaults: a clip has thousands of tracks.
    const { property, dataType, framePerSecond, loopBehavior } = animation, slim = { name: '', property, dataType, framePerSecond, loopBehavior, keys: [] };
    if (!mm || !isClip(group) || animation.keys.length < 2) return { ...t, animation: { ...slim, bylonderKeys: exactKeys(animation, bin) } };
    const all = animation.keys.map((key) => decompose(key.values)), allFrames = animation.keys.map((key) => key.frame);
    const kept = reduce(all, allFrames, bound), keys = kept.map((i) => all[i]);
    const location = quantize(keys.map((k) => k.t), 3), scaled = keys.some((k) => k.s.some((v) => Math.abs(v - 1) > bound.scale));
    const scale = scaled ? quantize(keys.map((k) => k.s), 3) : null;
    return { ...t, animation: { ...slim, bylonderKeys: {
      frames: bin.add(Float32Array.from(kept, (i) => allFrames[i])), rotation: bin.add(smallestThree(keys.map((k) => k.q))),
      location: bin.add(location.out), locationRange: [location.min, location.extent],
      ...(scale && { scale: bin.add(scale.out), scaleRange: [scale.min, scale.extent] }) } } };
  }) }, bin));
}

// A group's bone tracks as one table of scene.bin, a row each, in place of thousands of JSON objects: what they share
// (property, type, rate, loop) once, and per row the track's target (its index in `targets`, kept as JSON once per
// group), its arrays (each an index in `buffers`, their keys, -1 where it has none), whether it scales, and its
// location's and scale's ranges.
const COLUMNS = ['frames', 'values', 'rotation', 'location', 'scale'], ROW = COLUMNS.length + 1 + 12;
function trackTable(group, bin) {
  const tracks = group.targetedAnimations.filter((t) => t.animation.bylonderKeys), rest = group.targetedAnimations.filter((t) => !t.animation.bylonderKeys);
  if (tracks.length < 2) return group;
  const { property, dataType, framePerSecond, loopBehavior } = tracks[0].animation, rows = new Float32Array(tracks.length * ROW), buffers = [];
  const column = (key) => (key === undefined ? -1 : buffers.push(key) - 1);
  tracks.forEach(({ animation: { bylonderKeys: keys } }, i) => {
    const ranges = [...(keys.locationRange ?? [[0, 0, 0], [0, 0, 0]]).flat(), ...(keys.scaleRange ?? [[0, 0, 0], [0, 0, 0]]).flat()];
    rows.set([...COLUMNS.map((c) => column(keys[c])), keys.scaleRange ? 1 : 0, ...ranges], i * ROW);
  });
  return { ...group, targetedAnimations: rest,
    bylonderTracks: { targets: tracks.map((t) => t.targetId), property, dataType, framePerSecond, loopBehavior, rows: bin.add(rows), buffers } };
}

/** The page's code that decodes a clip's compressed bone keys from scene.bin (`buffers`) into Babylon's matrix keys. */
export const CLIP_KEYS_SOURCE = `// A clip's bone keys from scene.bin: smallest-three rotations, location and scale on 16 bits over their ranges
// (io_scene_babylon/clip-export.js binaryClipKeys), composed into matrices as Babylon's Matrix.Compose does.
function clipKeys(entry, buffers) {
  const R = Math.SQRT1_2;
  for (const table of [].concat(entry.bylonderTracks ?? [])) {
    const rows = buffers[table.rows], size = rows.length / table.targets.length, column = (row, i) => (rows[row * size + i] < 0 ? undefined : table.buffers[rows[row * size + i]]);
    entry.targetedAnimations = [...entry.targetedAnimations, ...table.targets.map((targetId, row) => {
      const at = row * size, ranges = Array.from(rows.subarray(at + 6, at + 18)), scaled = rows[at + 5] === 1;
      const keys = { frames: column(row, 0), values: column(row, 1), rotation: column(row, 2), location: column(row, 3), scale: scaled ? column(row, 4) : undefined,
        locationRange: [ranges.slice(0, 3), ranges.slice(3, 6)], scaleRange: scaled ? [ranges.slice(6, 9), ranges.slice(9, 12)] : undefined };
      return { targetId, animation: { name: '', property: table.property, dataType: table.dataType, framePerSecond: table.framePerSecond, loopBehavior: table.loopBehavior, keys: [], bylonderKeys: keys } };
    })];
    delete entry.bylonderTracks;
  }
  for (const { animation } of entry.targetedAnimations) {
    const packed = animation.bylonderKeys;
    if (!packed) continue;
    const frames = buffers[packed.frames];
    if (packed.values !== undefined) {
      const values = buffers[packed.values];
      animation.keys = Array.from(frames, (frame, i) => {
        const m = values.subarray(i * 12, i * 12 + 12);
        return { frame, values: [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, m[9], m[10], m[11], 1] };
      });
      continue;
    }
    const turns = buffers[packed.rotation], at = buffers[packed.location], sizes = packed.scale === undefined ? null : buffers[packed.scale];
    const unpack = (data, [min, extent], i, k) => min[k] + (data[i * 3 + k] / 65535) * extent[k];
    animation.keys = Array.from(frames, (frame, i) => {
      const q = [0, 0, 0, 0], largest = turns[i * 4 + 3];
      let sum = 0;
      for (let k = 0, j = 0; k < 4; k++) if (k !== largest) { q[k] = (turns[i * 4 + j++] / 65535) * 2 * R - R; sum += q[k] * q[k]; }
      q[largest] = Math.sqrt(Math.max(0, 1 - sum));
      const [x, y, z, w] = q, [sx, sy, sz] = sizes ? [0, 1, 2].map((k) => unpack(sizes, packed.scaleRange, i, k)) : [1, 1, 1];
      const t = [0, 1, 2].map((k) => unpack(at, packed.locationRange, i, k));
      return { frame, values: [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1] };
    });
  }
  return entry;
}
`;
