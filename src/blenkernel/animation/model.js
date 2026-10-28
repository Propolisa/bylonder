// Bylonder's animation: Blender's F-Curves in the module's Blender world are the data (anim-blender.js), on the IDs
// that stand for what they animate (blender-ids.js): an object's channels are its Object's RNA paths in Blender's axes
// and units, every other channel a custom property of the Scene in a group named after its owner. Bylonder's
// channels (registered here with get and set) take the values Blender's evaluate_fcurve gives.
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { createSceneTime, validateTime } from '../scene/time.js';
import { createBlenderIDs } from '../blender-ids.js';
import { BlenderAnimation, FCURVE, INTERPOLATIONS, HANDLE_TYPES, EASINGS, KEYFRAME_TYPES, EXTRAPOLATIONS, PROPERTY_TYPES, animatedProperty, defineCustomProperty } from './anim-blender.js';

export const address = (id, path) => JSON.stringify([id, path]);
const scalar = value => ['number','boolean','string'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const clone = value => structuredClone(value);
const LIMIT = 1e6;

// Babylon's object transforms as Blender's Object RNA: Babylon's (x, y, z) is Blender's (x, z, y), and a rotation about
// Babylon's axes is one about Blender's negated (docs/blender-boundary.md).
const AXES = { x: 0, y: 2, z: 1 };
const OBJECT_PATHS = { position: ['location', 1], rotation: ['rotation_euler', -1], scaling: ['scale', 1] };
export function blenderPath(id, path) {
  const [property, axis] = path.split('.');
  if (id.startsWith('object:') && OBJECT_PATHS[property] && axis in AXES) {
    const [rna_path, factor] = OBJECT_PATHS[property];
    return { object: true, rna_path, index: AXES[axis], factor };
  }
  return { object: false, rna_path: `["${JSON.stringify([id, path]).replace(/["\\]/g, (c) => '\\' + c)}"]`, index: 0, factor: 1 };
}
function bylonderPath(rna_path, index, ownerId) {
  for (const [property, [path, factor]] of Object.entries(OBJECT_PATHS)) {
    if (rna_path === path) {
      const axis = Object.keys(AXES).find((a) => AXES[a] === index);
      return axis && { id: ownerId, path: `${property}.${axis}`, factor };
    }
  }
  const custom = /^\["(.*)"\]$/.exec(rna_path);
  if (!custom) return null;
  const [id, path] = JSON.parse(custom[1].replace(/\\(["\\])/g, '$1'));
  return { id, path, factor: 1 };
}

// A key as Blender's Keyframe in Bylonder's terms: frame, value and Blender's keyframe settings.
const KEY_FIELDS = ['interpolation', 'handle_left_type', 'handle_right_type', 'easing', 'type', 'back', 'amplitude', 'period', 'select'];
const ENUMS = { interpolation: INTERPOLATIONS, handle_left_type: HANDLE_TYPES, handle_right_type: HANDLE_TYPES, easing: EASINGS, type: KEYFRAME_TYPES };
function validateKey(key) {
  if (!Number.isFinite(key.frame) || Math.abs(key.frame) > LIMIT || !scalar(key.value)) throw Error('Invalid keyframe');
  for (const [field, items] of Object.entries(ENUMS)) if (key[field] !== undefined && !items.includes(key[field])) throw Error('Invalid keyframe');
  for (const field of ['handle_left', 'handle_right']) if (key[field] !== undefined && !(Array.isArray(key[field]) && key[field].length === 2 && key[field].every(Number.isFinite))) throw Error('Invalid keyframe');
}

// Action: the tracks of a saved payload, each Bylonder channel's keys.
export function validateAction(input) {
  if (!input) return { name: 'Action', tracks: [] };
  if (!Array.isArray(input.tracks) || input.tracks.length > 10000) throw Error('Invalid animation action');
  const result = { name: input.name ?? 'Action', tracks: clone(input.tracks) };
  if (typeof result.name !== 'string' || result.name.length > 200) throw Error('Invalid action settings');
  const ids = new Set(); let count = 0;
  for (const track of result.tracks) {
    if (typeof track.id !== 'string' || typeof track.path !== 'string' || !Array.isArray(track.keys)) throw Error('Invalid animation channel');
    const id = address(track.id, track.path);
    if (ids.has(id)) throw Error('Duplicate animation channel'); ids.add(id);
    if (track.extrapolation !== undefined && !EXTRAPOLATIONS.includes(track.extrapolation)) throw Error('Invalid animation channel');
    const frames = new Set();
    for (const key of track.keys) {
      validateKey(key);
      if (frames.has(key.frame)) throw Error('Invalid keyframe');
      frames.add(key.frame); if (++count > 100000) throw Error('Too many keyframes');
    }
    track.keys.sort((a, b) => a.frame - b.frame);
  }
  return result;
}
// Saved animation payload. v3: {version:3, action:{name, tracks}, time}, keys with Blender's settings and handles. v2
// had frame, value and interpolation only; v1 kept range and fps on the action.
export function parseAnimation(input) {
  if (!input) return { action: validateAction(), time: validateTime() };
  if (input.version === 1) {
    const { start, end, fps, frame, loop, autoKey } = input;
    return { action: validateAction(input), time: validateTime({ frameStart: start, frameEnd: end, fps, frameCurrent: frame, loop, autoKey, framePreviewStart: start, framePreviewEnd: end }) };
  }
  if (input.version !== 2 && input.version !== 3) throw Error('Invalid animation action');
  return { action: validateAction(input.action), time: validateTime(input.time), markers: validateMarkers(input.markers) };
}
// The scene's markers (Scene.timeline_markers): a name of up to 63 characters, an integer frame, a selection.
function validateMarkers(input = []) {
  if (!Array.isArray(input) || input.length > 10000) throw Error('Invalid markers');
  return input.map(({ name, frame, select }) => {
    if (typeof name !== 'string' || name.length > 63 || !Number.isInteger(frame) || Math.abs(frame) > LIMIT) throw Error('Invalid marker');
    return { name, frame, select: !!select };
  });
}
// Validates any saved payload version and returns it as v3.
export const normalizeAnimation = input => {
  const { action, time, markers = [] } = parseAnimation(input);
  return { version: 3, action, time, ...(markers.length ? { markers } : {}) };
};

// Legacy aliases on the action (start, end, fps, frame, loop, autoKey) read scene time; kept for user code.
const legacy = { start: 'frameStart', end: 'frameEnd', fps: 'fps', loop: 'loop', autoKey: 'autoKey' };
const withAliases = (action, time) => Object.defineProperties(action, { ...Object.fromEntries(Object.entries(legacy).map(([k, v]) => [k, { get: () => time.state[v], enumerable: false, configurable: true }])), frame: { get: () => time.frame, enumerable: false, configurable: true } });

export function createAnimationModel(onChange = () => {}, { time = createSceneTime(), ids = createBlenderIDs() } = {}) {
  const channels = new Map(), listeners = new Set(), pose = new Map();
  const anim = new BlenderAnimation(ids.blender);
  // Strings a channel without options takes, by ref: an F-Curve holds their index, as an enum's.
  const strings = new Map();
  let name = 'Action', evaluating = false, quiet = false, commit = () => {}, revision = 0, curves = null;
  const notify = () => { revision++; listeners.forEach(fn => fn()); };

  const ownerID = (id, create) => (id.startsWith('object:') ? (create ? ids.object(id) : ids.find(id)) : ids.scene);
  // Every F-Curve with the Bylonder channel it animates.
  const tracks = () => curves ??= [...new Set([ids.scene, ...ids.entries().map((e) => e.ob)])].flatMap((owner) => {
    const key = ids.entries().find((e) => e.ob === owner)?.key;
    return anim.fcurves(owner).map((fcurve) => {
      const channel = bylonderPath(fcurve.rna_path, fcurve.array_index, key);
      return channel && { ...channel, ref: address(channel.id, channel.path), owner, fcurve };
    }).filter(Boolean);
  });
  const trackFor = (ref) => tracks().find((t) => t.ref === ref);
  const optionsOf = (ref) => channels.get(ref)?.options;
  const discreteKind = (ref, value) => (typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'ENUM' : 'FLOAT');
  // A channel's value as the F-Curve holds it, and back.
  const toCurve = (ref, value, factor) => {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
      const options = optionsOf(ref) ? Object.keys(optionsOf(ref)) : (strings.get(ref) ?? strings.set(ref, []).get(ref));
      if (!options.includes(value)) options.push(value);
      return options.indexOf(value);
    }
    return value * factor;
  };
  const fromCurve = (ref, value, factor, sample) => {
    if (typeof sample === 'boolean') return value >= 0.5;
    if (typeof sample === 'string') {
      const options = optionsOf(ref) ? Object.keys(optionsOf(ref)) : strings.get(ref) ?? [];
      return options[Math.max(0, Math.min(options.length - 1, Math.round(value)))] ?? sample;
    }
    return value / factor;
  };
  const fcurveFor = (ref, sample) => {
    const found = trackFor(ref);
    if (found) return found;
    const [id, path] = JSON.parse(ref), { object, rna_path, index } = blenderPath(id, path), channel = channels.get(ref);
    const rna = object ? animatedProperty('Object', rna_path) : { type: discreteKind(ref, sample), subtype: 'NONE' };
    if (!object) defineCustomProperty(rna_path, rna.type, channel?.label ?? path);
    anim.fcurve(ownerID(id, true), rna_path, index, { group: object ? 'Object Transforms' : channel?.group ?? id, type: rna.type, subtype: rna.subtype });
    curves = null;
    return trackFor(ref);
  };
  const keysOf = (track) => {
    const sample = channels.get(track.ref)?.get();
    return track.fcurve.keys.map((k) => ({ frame: k.co[0], value: fromCurve(track.ref, k.co[1], track.factor, sample ?? 0), ...Object.fromEntries(KEY_FIELDS.map((f) => [f, k[f]])),
      handle_left: [k.handle_left[0], k.handle_left[1] / track.factor], handle_right: [k.handle_right[0], k.handle_right[1] / track.factor] }));
  };
  const valueAt = (track, frame) => fromCurve(track.ref, track.fcurve.evaluate(frame), track.factor, channels.get(track.ref)?.get());

  const changed = () => { curves = null; onChange(api.serialize()); notify(); };
  const evaluate = () => {
    evaluating = true;
    try {
      for (const track of tracks()) {
        const channel = channels.get(track.ref);
        if (!channel?.available() || !track.fcurve.length || track.fcurve.flag & FCURVE.MUTED) continue;
        const value = valueAt(track, time.frame);
        if (typeof value === typeof channel.get()) channel.set(value);
        pose.set(track.ref, channel.get());
      }
    } finally { evaluating = false; }
    notify();
  };
  const syncTime = () => {
    const t = time.state;
    anim.setTime({ frame: time.frame, start: t.frameStart, end: t.frameEnd, previewStart: t.framePreviewStart, previewEnd: t.framePreviewEnd, preview: t.usePreviewRange, fps: t.fps, autoKey: t.autoKey });
  };
  time.subscribe(kind => {
    if (quiet) return;
    syncTime();
    if (kind === 'frame') evaluate();
    else if (kind === 'settings') { changed(); commit(); }
    else notify();
  });
  syncTime();

  // Keys from a saved track: v3's with Blender's settings, v2's inserted as Blender's keying inserts them.
  function loadTrack(track) {
    const ref = address(track.id, track.path);
    if (track.values) strings.set(ref, [...track.values]);
    const sample = track.keys[0]?.value;
    const found = fcurveFor(ref, sample);
    if (track.keys.some((k) => k.handle_left)) {
      found.fcurve.keys = track.keys.map((k) => ({ ...k, co: [k.frame, toCurve(ref, k.value, found.factor)],
        handle_left: [k.handle_left[0], k.handle_left[1] * found.factor], handle_right: [k.handle_right[0], k.handle_right[1] * found.factor] }));
    } else {
      for (const k of track.keys) anim.insert(found.fcurve, k.frame, toCurve(ref, k.value, found.factor));
      const keys = found.fcurve.keys;
      found.fcurve.keys = keys.map((k, i) => ({ ...k, interpolation: track.keys[i].interpolation ?? k.interpolation, select: [false, false, false] }));
    }
    if (track.extrapolation) found.fcurve.extrapolation = track.extrapolation;
    if (track.muted) found.fcurve.flag |= FCURVE.MUTED;
  }
  const removeAll = () => { for (const track of tracks()) anim.remove(track.owner, track.fcurve); curves = null; };

  const api = {
    channels,
    ref: address,
    time, ids, anim,
    get action() { return withAliases({ name, tracks: tracks().map((t) => ({ id: t.id, path: t.path, ...(t.fcurve.flag & FCURVE.MUTED ? { muted: true } : {}), keys: keysOf(t) })) }, time); },
    get playing() { return time.playing; }, get evaluating() { return evaluating; }, get revision() { return revision; },
    setCommit(fn) { commit = fn; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    register({ id, path, label = path, group = id, get, set, available = () => true, transform = false, options }) {
      const ref = address(id, path);
      if (channels.has(ref)) { Object.assign(channels.get(ref), { label, group, get, set, available, transform, options }); return ref; }
      if (!scalar(get())) throw Error('Animation channels must be scalar: ' + ref);
      channels.set(ref, { id, path, label, group, get, set, available, transform, options }); pose.set(ref, clone(get())); notify(); return ref;
    },
    removeTarget(id) { for (const [ref, ch] of channels) if (ch.id === id) { channels.delete(ref); pose.delete(ref); } notify(); },
    track(ref) { const t = trackFor(ref); return t && { id: t.id, path: t.path, keys: keysOf(t) }; },
    state(ref) {
      const channel = channels.get(ref), track = trackFor(ref);
      if (!channel?.available()) return 'unavailable';
      if (!track?.fcurve.length) return 'none';
      if (JSON.stringify(channel.get()) !== JSON.stringify(valueAt(track, time.frame))) return 'changed';
      return track.fcurve.keys.some((k) => k.co[0] === time.frame) ? 'keyed' : 'animated';
    },
    // Inserts keys as Blender's keying does, at a frame (the current one by default).
    insert(refs, frame = time.frame, value) {
      if (!Number.isFinite(frame) || Math.abs(frame) > LIMIT) throw Error('Invalid keyframe frame');
      api.pause();
      for (const ref of Array.isArray(refs) ? refs : [refs]) {
        const channel = channels.get(ref); if (!channel?.available()) continue;
        const next = value === undefined ? clone(channel.get()) : value;
        if (!scalar(next) || typeof next !== typeof channel.get()) throw Error('Invalid animation value');
        const track = fcurveFor(ref, next);
        anim.insert(track.fcurve, frame, toCurve(ref, next, track.factor));
      }
      changed(); commit();
    },
    deleteKeys(selected) {
      api.pause();
      for (const { ref, frame } of selected) {
        const track = trackFor(ref); if (!track) continue;
        const keys = track.fcurve.keys.filter((k) => k.co[0] !== frame);
        if (keys.length) track.fcurve.keys = keys; else { anim.remove(track.owner, track.fcurve); curves = null; }
      }
      changed(); commit();
    },
    clear(refs) { for (const ref of Array.isArray(refs) ? refs : [refs]) { const t = trackFor(ref); if (t) { anim.remove(t.owner, t.fcurve); curves = null; } } changed(); commit(); },
    // Moves (or duplicates) keys by whole frames, or sets their interpolation.
    editKeys(selected, { offset = 0, duplicate = false, interpolation } = {}) {
      if (!Number.isFinite(offset) || (interpolation && !INTERPOLATIONS.includes(interpolation))) throw Error('Invalid keyframe edit');
      if (selected.some((s) => Math.abs(s.frame + Math.round(offset)) > LIMIT)) throw Error('Keyframe out of range');
      api.pause();
      const shift = Math.round(offset), move = ([x, y]) => [x + shift, y];
      for (const track of tracks()) {
        const frames = selected.filter((s) => s.ref === track.ref).map((s) => s.frame);
        if (!frames.length) continue;
        const keys = track.fcurve.keys, moving = keys.filter((k) => frames.includes(k.co[0]))
          .map((k) => ({ ...k, co: move(k.co), handle_left: move(k.handle_left), handle_right: move(k.handle_right), ...(interpolation ? { interpolation } : {}) }));
        track.fcurve.keys = [...keys.filter((k) => (duplicate || !frames.includes(k.co[0])) && !moving.some((m) => m.co[0] === k.co[0])), ...moving];
      }
      changed(); evaluate(); commit();
    },
    // Legacy: routes start/end/fps/frame/loop/autoKey to scene time, name to the action.
    configure(patch) {
      const { name: next, frame, ...rest } = patch, mapped = Object.fromEntries(Object.entries(rest).map(([k, v]) => [legacy[k] || k, v]));
      if (next !== undefined) { name = validateAction({ name: next, tracks: [] }).name; changed(); commit(); }
      if (Object.keys(mapped).length) time.configure(mapped);
      if (frame !== undefined) time.seek(frame);
    },
    seek(frame) { time.seek(frame); },
    play() { time.play(); },
    pause() { time.pause(); },
    tick(now) { time.tick(now); },
    captureEdits() {
      if (evaluating || time.playing) return;
      const refs = [];
      for (const [ref, ch] of channels) if (ch.available()) { const value = clone(ch.get()); if (time.state.autoKey && ch.transform && JSON.stringify(pose.get(ref)) !== JSON.stringify(value)) refs.push(ref); pose.set(ref, value); }
      if (refs.length) { const fn = commit; commit = () => {}; api.insert(refs); commit = fn; }
      notify();
    },
    serialize() {
      const out = tracks().map((t) => ({ id: t.id, path: t.path, extrapolation: t.fcurve.extrapolation, ...(t.fcurve.flag & FCURVE.MUTED ? { muted: true } : {}),
        ...(strings.has(t.ref) ? { values: [...strings.get(t.ref)] } : {}), keys: keysOf(t) }));
      const markers = anim.markers;
      return { version: 3, action: clone({ name, tracks: out }), time: time.serialize(), ...(markers.length ? { markers } : {}) };
    },
    load(data, { apply = true } = {}) {
      const parsed = parseAnimation(data);
      removeAll();
      name = parsed.action.name;
      parsed.action.tracks.forEach(loadTrack);
      anim.markers = parsed.markers ?? [];
      curves = null;
      quiet = true; try { time.load(parsed.time); } finally { quiet = false; }
      syncTime();
      if (apply) evaluate(); else { for (const [ref, ch] of channels) if (ch.available()) pose.set(ref, clone(ch.get())); notify(); }
    },
    // Runs an operator of another editor that may insert keys (auto keying): the animation takes those it inserted.
    keying(run) {
      const keys = () => JSON.stringify(tracks().map((t) => [t.ref, t.fcurve.keys.map((k) => k.co)]));
      curves = null;
      const before = keys();
      run();
      curves = null;
      if (keys() !== before) { onChange(api.serialize()); notify(); }
    },
    // After Blender's operators changed the F-Curves (an animation editor): channels take the new values.
    changed() { changed(); },
    edited() { curves = null; evaluate(); onChange(api.serialize()); },
    syncTime,
    mute(ref) { const t = trackFor(ref); if (t) { t.fcurve.flag ^= FCURVE.MUTED; changed(); evaluate(); commit(); } },
    // A Babylon AnimationGroup sampling each F-Curve at every frame of the scene range.
    toAnimationGroup(scene, groupName = name) {
      const fps = time.state.fps, [start, end] = [time.state.frameStart, time.state.frameEnd];
      const group = new AnimationGroup(groupName, scene);
      for (const track of tracks()) {
        const channel = channels.get(track.ref);
        if (!channel?.available() || !track.fcurve.length || track.fcurve.flag & FCURVE.MUTED) continue;
        const numeric = typeof channel.get() === 'number';
        const animation = new Animation(track.ref, 'value', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        const samples = track.fcurve.sample(start, 1, end - start + 1);
        animation.setKeys(Array.from(samples, (v, i) => ({ frame: start + i, value: v, ...(numeric ? {} : { interpolation: 1 }) })));
        const target = {};
        Object.defineProperty(target, 'value', { get: () => channel.get(), set: (v) => channel.set(fromCurve(track.ref, v, track.factor, channel.get())) });
        group.addTargetedAnimation(animation, target);
      }
      return group;
    },
    evaluate,
    dispose() { listeners.clear(); channels.clear(); },
  };
  void PROPERTY_TYPES;
  return api;
}
