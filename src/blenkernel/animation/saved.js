// A saved animation payload with Blender's keyframe settings by name, checked without Blender's module: the project
// window reads shared projects with it.
import { validateTime } from '../scene/time.js';

export const address = (id, path) => JSON.stringify([id, path]);
export const LIMIT = 1e6;
const scalar = value => ['number','boolean','string'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
export const INTERPOLATIONS = ['CONSTANT', 'LINEAR', 'BEZIER', 'BACK', 'BOUNCE', 'CIRC', 'CUBIC', 'ELASTIC', 'EXPO', 'QUAD', 'QUART', 'QUINT', 'SINE'];
export const HANDLE_TYPES = ['FREE', 'AUTO', 'VECTOR', 'ALIGNED', 'AUTO_CLAMPED'];
export const EASINGS = ['AUTO', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'];
export const KEYFRAME_TYPES = ['KEYFRAME', 'EXTREME', 'BREAKDOWN', 'JITTER', 'MOVING_HOLD', 'GENERATED'];
export const EXTRAPOLATIONS = ['CONSTANT', 'LINEAR'];

// A key as Blender's Keyframe in Bylonder's terms: frame, value and Blender's keyframe settings.
export const KEY_FIELDS = ['interpolation', 'handle_left_type', 'handle_right_type', 'easing', 'type', 'back', 'amplitude', 'period', 'select'];
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
  const result = { name: input.name ?? 'Action', tracks: structuredClone(input.tracks) };
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
