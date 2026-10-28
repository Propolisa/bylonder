import { renderSceneSettings } from './scene-babylon.js';
import { unitSettings, unitDefaults, baseLengthUnit } from '../unit.js';

// Scene datablock settings (Properties > Scene), shaped like Blender's Scene: name, camera, unit_settings,
// use_gravity, gravity and the 3D cursor (View3DCursor, Blender's axes). Document slice "scene"; saved as a diff from
// the code-built scene.
// cameras: { list() -> cameras, get() -> scene camera, set(camera) } supplied by the host, which owns camera view.
// The name belongs to the project's scene record (src/workspace/scenes.js): it comes in as `name` and edits go
// out through rename(name); the slice does not save it.
export function createSceneSettings(world, { commit = () => {}, cameras, name = 'Scene', rename = () => {} } = {}) {
  const { scene, animation } = world;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const cameraId = camera => camera ? camera.metadata?.wbId || camera.name : null;
  let state = { name, camera: cameraId(cameras?.get()), unitSettings: { ...unitDefaults }, useGravity: true, gravity: scene.gravity.asArray().map(v => +v.toFixed(6)),
    cursor: { location: [0, 0, 0], rotation_mode: 'XYZ', rotation_euler: [0, 0, 0], rotation_quaternion: [1, 0, 0, 0] } };
  const baseline = JSON.parse(JSON.stringify(state));
  const push = () => {
    Object.assign(unitSettings, state.unitSettings);
    renderSceneSettings(scene, state);
    const camera = cameras?.list().find(c => cameraId(c) === state.camera);
    if (camera && camera !== cameras.get()) cameras.set(camera);
  };
  ['x', 'y', 'z'].forEach((axis, i) => animation.register({
    id: 'scene', path: 'gravity.' + axis, label: 'Gravity ' + axis.toUpperCase(), group: 'Scene',
    get: () => state.gravity[i], set: v => { state.gravity[i] = v; push(); },
  }));
  push();
  const api = {
    get state() { return state; },
    cameras: () => cameras?.list() || [],
    camera: () => cameras?.get() || null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(path, value, finish = true) {
      if (path === 'camera') { state.camera = cameraId(value); if (value) cameras?.set(value); }
      else if (path.startsWith('unitSettings.')) {
        const key = path.slice(13);
        state.unitSettings = { ...state.unitSettings, [key]: value };
        if (key === 'system') state.unitSettings.length = baseLengthUnit(value);
      }
      else if (path.startsWith('cursor.')) state.cursor = { ...state.cursor, [path.slice(7)]: value };
      else if (path === 'name') { state.name = value; rename(value); }
      else state[path] = value;
      push();
      if (finish) { emit(); commit(); }
    },
    // Moves the 3D cursor, as view3d.cursor3d does: no undo step of its own.
    setCursor(values) { state.cursor = { ...state.cursor, ...values }; emit(); },
    // The scene was renamed elsewhere (scene selector).
    renamed(next) { if (next !== state.name) { state.name = next; emit(); } },
    capture() {
      const out = {};
      for (const key of Object.keys(baseline)) if (key !== 'name' && JSON.stringify(state[key]) !== JSON.stringify(baseline[key])) out[key] = state[key];
      return Object.keys(out).length ? JSON.parse(JSON.stringify(out)) : undefined;
    },
    apply(saved = {}) {
      const next = JSON.parse(JSON.stringify({ ...baseline, ...saved, name: state.name, unitSettings: { ...baseline.unitSettings, ...saved.unitSettings },
        cursor: { ...baseline.cursor, ...saved.cursor } }));
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next; push(); emit();
    },
    dispose() { listeners.clear(); },
  };
  return api;
}
