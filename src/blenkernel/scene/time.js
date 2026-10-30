// Scene time, shaped like Blender's Scene: frame_current, frame_start, frame_end, frame_step, render.fps and fps_base,
// use_preview_range, frame_preview_start/end, sync_mode and tool_settings.use_keyframe_insert_auto. `loop` is ours
// (Blender playback always loops). Also owns the playback clock. Saved with the action in the animation payload.
export const timeDefaults = { frameCurrent: 1, frameStart: 1, frameEnd: 250, frameStep: 1, fps: 60, fpsBase: 1, usePreviewRange: false, framePreviewStart: 1, framePreviewEnd: 250, autoKey: false, loop: true, syncMode: 'FRAME_DROP' };
// Frames per second, as Blender's FPS: render.fps / render.fps_base (29.97 is 30 / 1.001).
export const frameRate = (t) => t.fps / t.fpsBase;
export const syncModes = { FRAME_DROP: 'Frame Dropping', NONE: 'Play Every Frame' };
const limit = 1e6;
export function validateTime(input = {}) {
  const t = { ...timeDefaults, ...input };
  for (const key of ['frameCurrent', 'frameStart', 'frameEnd', 'frameStep', 'fps', 'fpsBase', 'framePreviewStart', 'framePreviewEnd']) if (!Number.isFinite(t[key]) || Math.abs(t[key]) > limit) throw Error('Invalid scene time: ' + key);
  for (const key of ['usePreviewRange', 'autoKey', 'loop']) if (typeof t[key] !== 'boolean') throw Error('Invalid scene time: ' + key);
  if (!syncModes[t.syncMode]) throw Error('Invalid scene time: syncMode');
  if (t.frameStart >= t.frameEnd || t.framePreviewStart >= t.framePreviewEnd) throw Error('Invalid frame range');
  if (t.fps < 1 || t.fps > 240 || !(t.fpsBase >= 1e-5 && t.fpsBase <= 1e6) || t.frameStep < 1 || !Number.isInteger(t.frameStep)) throw Error('Invalid frame rate or step');
  return Object.fromEntries(Object.keys(timeDefaults).map(key => [key, t[key]]));
}

// Listeners receive 'frame' (current frame moved), 'settings' (finished user edit, recorded for undo),
// 'change' (in-progress edit such as a drag), 'load' or 'playback'.
export function createSceneTime(initial) {
  let state = validateTime(initial), playing = false, previous = null, clock = state.frameCurrent;
  const listeners = new Set();
  const emit = kind => listeners.forEach(fn => fn(kind));
  const range = () => (state.usePreviewRange ? [state.framePreviewStart, state.framePreviewEnd] : [state.frameStart, state.frameEnd]);
  const api = {
    get state() { return state; },
    get frame() { return state.frameCurrent; },
    get playing() { return playing; },
    range,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    configure(patch, { record = true } = {}) {
      const next = validateTime({ ...state, ...patch });
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      const moved = next.frameCurrent !== state.frameCurrent;
      state = next; clock = state.frameCurrent;
      emit(record ? 'settings' : 'change'); if (moved) emit('frame');
    },
    seek(frame) {
      if (!Number.isFinite(frame)) return;
      api.pause();
      state = { ...state, frameCurrent: Math.round(Math.max(-limit, Math.min(limit, frame))) }; clock = state.frameCurrent;
      emit('frame');
    },
    play() { playing = !playing; previous = null; emit('playback'); },
    pause() { if (playing) { playing = false; previous = null; emit('playback'); } },
    // Frame Dropping advances in real time at fps; Play Every Frame advances one frame step per tick.
    // frame_step makes playback skip frames like Blender's.
    tick(now) {
      if (!playing) return;
      if (previous === null) { previous = now; return; }
      const [start, end] = range();
      clock += state.syncMode === 'NONE' ? state.frameStep : (now - previous) / 1000 * frameRate(state); previous = now;
      if (clock > end) { if (state.loop) clock = start + (clock - start) % (end - start); else { clock = end; api.pause(); } }
      if (clock < start) clock = start;
      const frame = state.frameStep > 1 ? start + Math.floor((clock - start) / state.frameStep) * state.frameStep : clock;
      state = { ...state, frameCurrent: frame };
      emit('frame');
    },
    serialize() { return { ...state, frameCurrent: Math.round(state.frameCurrent) }; },
    load(data) { api.pause(); state = validateTime(data); clock = state.frameCurrent; emit('load'); emit('frame'); },
  };
  return api;
}
