// Bylonder's animation: Blender's F-Curves in the module's Blender world are the data (anim-blender.js), on the IDs
// that stand for what they animate (blender-ids.js): an object's channels are its Object's RNA paths in Blender's axes
// and units, every other channel a custom property (an ID property, `["name"]`) of the ID that stands for its owner
// (`owner()`, the Scene when it has none), in a group named after it. A channel (registered here with get and set,
// `animatable(owner, path, { get, set })`) takes the value Blender's animation gives its property once Main is
// evaluated for a frame (`evaluateMain`, the scene sync's), else the value its F-Curve evaluates to.
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { createSceneTime, frameRate } from '../scene/time.js';
import { createBlenderIDs } from '../blender-ids.js';
import { BlenderAnimation, FCURVE, animatedProperty, customProperty, customPropertyName, customPropertyPath, setCustomProperty } from './anim-blender.js';
import { address, INTERPOLATIONS, KEY_FIELDS, LIMIT, parseAnimation, validateAction } from './saved.js';

export { address, normalizeAnimation, parseAnimation, validateAction } from './saved.js';

const scalar = value => ['number','boolean','string'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const clone = value => structuredClone(value);

// Babylon's object transforms as Blender's Object RNA: Babylon's (x, y, z) is Blender's (x, z, y), and a rotation about
// Babylon's axes is one about Blender's negated (docs/blender-boundary.md).
const AXES = { x: 0, y: 2, z: 1 };
const OBJECT_PATHS = { position: ['location', 1], rotation: ['rotation_euler', -1], scaling: ['scale', 1] };
const objectPath = (id, path) => {
  const [property, axis] = path.split('.');
  if (!id.startsWith('object:') || !OBJECT_PATHS[property] || !(axis in AXES)) return null;
  const [rna_path, factor] = OBJECT_PATHS[property];
  return { rna_path, index: AXES[axis], factor };
};
const transformChannel = (rna_path, index) => {
  const property = Object.keys(OBJECT_PATHS).find((p) => OBJECT_PATHS[p][0] === rna_path), axis = Object.keys(AXES).find((a) => AXES[a] === index);
  return property && axis && { path: `${property}.${axis}`, factor: OBJECT_PATHS[property][1] };
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

  // The channels with F-Curves or that may get them: registered, keyed or loaded.
  const known = new Set();
  // Where a channel's F-Curve is: an object's transform on its Object in Blender's axes, any other channel a custom
  // property on its owner's ID named by its path, or on the Scene named by its owner and path.
  const placeOf = (ref, create = false) => {
    const [id, path] = JSON.parse(ref), transform = objectPath(id, path);
    if (transform) return { owner: create ? ids.object(id) : ids.find(id), ...transform };
    // Without its owner in Main (a player without the scene sync), on the Scene.
    const own = channels.get(ref)?.owner?.(), property = customPropertyName(own ? path : `${id} ${path}`);
    return { owner: own || ids.scene, property, rna_path: customPropertyPath(property), index: 0, factor: 1 };
  };
  // Every F-Curve with the Bylonder channel it animates.
  const tracks = () => curves ??= (() => {
    const byOwner = new Map(), fcurvesOf = (owner) => byOwner.get(owner) ?? byOwner.set(owner, anim.fcurves(owner)).get(owner);
    return [...known].flatMap((ref) => {
      const place = placeOf(ref), [id, path] = JSON.parse(ref);
      const fcurve = place.owner && fcurvesOf(place.owner).find((f) => f.rna_path === place.rna_path && f.array_index === place.index);
      return fcurve ? [{ id, path, ref, ...place, fcurve }] : [];
    });
  })();
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
    known.add(ref);
    const found = trackFor(ref);
    if (found) return found;
    const channel = channels.get(ref), [id, path] = JSON.parse(ref), place = placeOf(ref, true);
    if (!place.owner) return null;
    const rna = place.property ? { type: discreteKind(ref, sample), subtype: 'NONE' } : animatedProperty('Object', place.rna_path);
    if (place.property) setCustomProperty(place.owner, place.property, toCurve(ref, sample ?? 0, 1), { description: channel?.label ?? path });
    anim.fcurve(place.owner, place.rna_path, place.index, { group: place.property ? channel?.group ?? id : 'Object Transforms', type: rna.type, subtype: rna.subtype });
    curves = null;
    return trackFor(ref);
  };
  const keysOf = (track) => {
    const sample = channels.get(track.ref)?.get();
    return track.fcurve.keys.map((k) => ({ frame: k.co[0], value: fromCurve(track.ref, k.co[1], track.factor, sample ?? 0), ...Object.fromEntries(KEY_FIELDS.map((f) => [f, k[f]])),
      handle_left: [k.handle_left[0], k.handle_left[1] / track.factor], handle_right: [k.handle_right[0], k.handle_right[1] / track.factor] }));
  };
  const valueAt = (track, frame) => fromCurve(track.ref, track.fcurve.evaluate(frame), track.factor, channels.get(track.ref)?.get());
  // A custom property's value as Blender's animation evaluated it in Main.
  const evaluatedValue = (track) => fromCurve(track.ref, customProperty(track.owner, track.property), 1, channels.get(track.ref)?.get());

  const liveTracks = () => tracks().map((track) => ({ track, channel: channels.get(track.ref) }))
    .filter(({ track, channel }) => channel?.available() && track.fcurve.length && !(track.fcurve.flag & FCURVE.MUTED));
  const changed = () => { curves = null; onChange(api.serialize()); notify(); };
  const evaluate = () => {
    evaluating = true;
    try {
      api.evaluateMain?.(time.frame);
      for (const { track, channel } of liveTracks()) {
        // Main evaluated: an object's transform is the view's, a custom property holds its channel's value.
        if (api.evaluateMain && !track.property) continue;
        const value = api.evaluateMain ? evaluatedValue(track) : valueAt(track, time.frame);
        if (typeof value === typeof channel.get()) channel.set(value);
        pose.set(track.ref, channel.get());
      }
    } finally { evaluating = false; }
    notify();
  };
  // The scene's time is in Main through the scene sync's mapping (Scene.frame_current and the rest, main-sync.js).
  time.subscribe(kind => {
    if (quiet) return;
    if (kind === 'frame') evaluate();
    else if (kind === 'settings') { changed(); commit(); }
    else notify();
  });

  // Keys from a saved track: v3's with Blender's settings, v2's inserted as Blender's keying inserts them.
  function loadTrack(track) {
    const ref = address(track.id, track.path);
    if (track.values) strings.set(ref, [...track.values]);
    const sample = track.keys[0]?.value;
    const found = fcurveFor(ref, sample);
    if (!found) return;
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
    // target and property: the Babylon object and property path the channel animates, when it has one (exports).
    // owner: the Main ID that stands for the channel's owner (its custom property holds the channel), else the Scene.
    register({ id, path, label = path, group = id, get, set, available = () => true, transform = false, options, target, property, owner }) {
      const ref = address(id, path);
      if (channels.has(ref)) { Object.assign(channels.get(ref), { label, group, get, set, available, transform, options, target, property, owner }); curves = null; return ref; }
      if (!scalar(get())) throw Error('Animation channels must be scalar: ' + ref);
      channels.set(ref, { id, path, label, group, get, set, available, transform, options, target, property, owner }); known.add(ref); curves = null; pose.set(ref, clone(get())); notify(); return ref;
    },
    // A Babylon-native value made animatable: its owner (a Bylonder id, 'store:lighting'), its path under it, and
    // { get, set, label, group, owner: () => the Main ID standing for the owner, options, available }.
    animatable(id, path, options) { return api.register({ id, path, ...options }); },
    // Evaluates Main's animation for a frame (the scene sync's), after which custom properties hold channels' values.
    evaluateMain: null,
    removeTarget(id) { for (const [ref, ch] of channels) if (ch.id === id) { channels.delete(ref); pose.delete(ref); } notify(); },
    track(ref) { const t = trackFor(ref); return t && { id: t.id, path: t.path, keys: keysOf(t) }; },
    // A channel's RNA path from its owner's ID (`["name"]` for a custom property), as Copy Data Path gives it.
    dataPath: (ref) => placeOf(ref).rna_path,
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
        if (!track) continue;
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
    mute(ref) { const t = trackFor(ref); if (t) { t.fcurve.flag ^= FCURVE.MUTED; changed(); evaluate(); commit(); } },
    // Each animated channel's values, as the channel takes them, at every frame of the scene range from `start`.
    sample() {
      const [start, end] = [time.state.frameStart, time.state.frameEnd];
      return liveTracks().map(({ track, channel }) => ({ channel, start, values: Array.from(track.fcurve.sample(start, 1, end - start + 1), (v) => fromCurve(track.ref, v, track.factor, channel.get())) }));
    },
    // A Babylon AnimationGroup sampling each F-Curve at every frame of the scene range.
    toAnimationGroup(scene, groupName = name) {
      const fps = frameRate(time.state), [start, end] = [time.state.frameStart, time.state.frameEnd];
      const group = new AnimationGroup(groupName, scene);
      for (const { track, channel } of liveTracks()) {
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
  return api;
}
