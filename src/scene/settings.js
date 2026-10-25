import { renderSceneSettings } from './scene-babylon.js';
import { unitSettings, unitDefaults, baseLengthUnit } from '../properties/units.js';

// Scene datablock settings (Properties > Scene), shaped like Blender's Scene: name, camera, unit_settings,
// use_gravity, gravity. Document slice "scene"; saved as a diff from the code-built scene.
// cameras: { list() -> cameras, get() -> scene camera, set(camera) } supplied by the host, which owns camera view.
export function createSceneSettings(world, { commit = () => {}, cameras } = {}) {
  const { scene, animation } = world;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const cameraId = camera => camera ? camera.metadata?.wbId || camera.name : null;
  let state = { name: 'Scene', camera: cameraId(cameras?.get()), unitSettings: { ...unitDefaults }, useGravity: true, gravity: scene.gravity.asArray().map(v => +v.toFixed(6)) };
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
      else state[path] = value;
      push();
      if (finish) { emit(); commit(); }
    },
    capture() {
      const out = {};
      for (const key of Object.keys(baseline)) if (JSON.stringify(state[key]) !== JSON.stringify(baseline[key])) out[key] = state[key];
      return Object.keys(out).length ? JSON.parse(JSON.stringify(out)) : undefined;
    },
    apply(saved = {}) {
      const next = JSON.parse(JSON.stringify({ ...baseline, ...saved, unitSettings: { ...baseline.unitSettings, ...saved.unitSettings } }));
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next; push(); emit();
    },
    dispose() { listeners.clear(); },
  };
  return api;
}
