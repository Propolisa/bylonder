import { BLENDER } from '../light/light-home.js';
import { createWorldRenderer, readAuthoredWorld } from './world-babylon.js';

// World datablocks (Blender's bpy.data.worlds plus scene.world). Shaped like Blender's World:
//   home:       BLENDER (its color lights the scene) or BABYLON (a code scene's clear color: background only)
//   background: the Background shader node (Color input as linear RGB or Environment Texture, Strength)
//   volume:     the Volume output (None, Volume Scatter, or a Babylon fog mode)
//   visibility: Ray Visibility (camera: environment visible as the background)
// The Babylon side lives in world-babylon.js. Document slice "worlds".
export const STUDIO = 'https://assets.babylonjs.com/environments/environmentSpecular.env';
export const environmentFile = /\.(env|hdr|dds)$/i;
const clone = value => JSON.parse(JSON.stringify(value));
// Blender's default world: Background node with 0.05 grey, strength 1.
export const worldDefaults = {
  home: BLENDER,
  background: { input: 'COLOR', color: [0.05, 0.05, 0.05], image: STUDIO, rotation: 0, strength: 1 },
  volume: { type: 'NONE', color: [0.8, 0.8, 0.8], density: 0.05, start: 10, end: 100 },
  visibility: { camera: true },
};
// Animatable World properties, as channel paths relative to the world (like Blender F-Curve data paths).
export const worldChannels = [
  ['background.color.0', 'Color R'], ['background.color.1', 'Color G'], ['background.color.2', 'Color B'], ['background.strength', 'Strength'], ['background.rotation', 'Rotation'],
  ['volume.color.0', 'Volume Color R'], ['volume.color.1', 'Volume Color G'], ['volume.color.2', 'Volume Color B'], ['volume.density', 'Density'], ['volume.start', 'Start'], ['volume.end', 'End'],
];
const resolve = (entry, path) => { const keys = path.split('.'), key = keys.pop(); return { owner: keys.reduce((o, k) => o?.[k], entry), key }; };
export const getPath = (entry, path) => { const { owner, key } = resolve(entry, path); return owner?.[key]; };

// A scene's world as Blender's (bpy.data.worlds.new as scene.world): its color, linear, lights the scene.
export function createWorld(scene, { color = worldDefaults.background.color } = {}) {
  scene.metadata = { ...scene.metadata, wbWorld: { color } };
}

export function createWorlds(world, { commit = () => {}, asset } = {}) {
  const { scene, animation } = world;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const renderer = createWorldRenderer(scene, { asset, studio: STUDIO });
  const authored = { id: 'world', name: 'World', ...readAuthoredWorld(scene, worldDefaults) };
  const baseline = { worlds: [authored], active: 'world' };
  let state = clone(baseline);

  const byId = id => state.worlds.find(w => w.id === id) || null;
  const active = () => byId(state.active);
  const users = entry => (entry.id === state.active ? 1 : 0) + (entry.fakeUser ? 1 : 0);
  const unique = (name, except) => {
    const taken = new Set(state.worlds.filter(w => w !== except).map(w => w.name));
    if (!taken.has(name)) return name;
    const stem = name.replace(/\.\d{3}$/, '');
    for (let i = 1; ; i++) { const next = stem + '.' + String(i).padStart(3, '0'); if (!taken.has(next)) return next; }
  };
  const render = () => renderer.render(active());
  const registered = new Set();
  const sync = () => {
    for (const id of registered) if (!byId(id)) { animation.removeTarget('world:' + id); registered.delete(id); }
    for (const entry of state.worlds) {
      registered.add(entry.id);
      for (const [path, label] of worldChannels) animation.register({
        id: 'world:' + entry.id, path, label, group: entry.name,
        available: () => !!byId(entry.id),
        get: () => getPath(byId(entry.id), path),
        set: v => { const { owner, key } = resolve(byId(entry.id), path); if (owner) { owner[key] = v; if (state.active === entry.id) render(); } },
      });
    }
    render();
    emit();
  };
  const changed = () => { sync(); commit(); };
  const api = {
    all: () => state.worlds, active, byId, users,
    images: files => [...(renderer.hasAuthoredTexture ? [['scene', 'Scene (code)']] : []), [STUDIO, 'Studio'], ...files.filter(f => environmentFile.test(f)).map(f => [f, f])],
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Per view: rendered shading or camera view shows the world background and volume. Cheap.
    setViewportActive(value) { renderer.setRendered(value); },
    // Material Preview's studio lighting while a view shows it, and its background per view.
    setPreview(value) { renderer.setPreview(value); },
    showPreview(value) { renderer.showPreview(value); },
    link(entry) { state.active = entry?.id ?? null; changed(); },
    unlink() { state.active = null; changed(); },
    // Blender's world.new copies the current world when there is one, as Blender's.
    create(from = active()) {
      const entry = { ...clone(from || { ...worldDefaults, name: 'World' }), home: BLENDER, id: crypto.randomUUID(), created: true, fakeUser: false };
      entry.name = unique(entry.name);
      state.worlds.push(entry); state.active = entry.id; changed();
      return entry;
    },
    rename(entry, name) { if (name?.trim()) { entry.name = unique(name.trim(), entry); changed(); } },
    toggleFakeUser(entry) { entry.fakeUser = !entry.fakeUser; changed(); },
    set(entry, path, value, finish = true) {
      const { owner, key } = resolve(entry, path);
      owner[key] = Array.isArray(value) ? [...value] : value;
      if (entry.id === state.active) render();
      if (finish) { emit(); commit(); }
    },
    // The code-built world is saved as a diff so later code edits to untouched fields still apply.
    capture({ save = false } = {}) {
      if (JSON.stringify(state) === JSON.stringify(baseline)) return undefined;
      const diff = entry => entry.id !== 'world' ? entry : Object.fromEntries(Object.entries(entry).filter(([k, v]) => k === 'id' || JSON.stringify(v) !== JSON.stringify(authored[k])));
      return clone({ active: state.active, worlds: state.worlds.filter(w => !save || !w.created || users(w)).map(diff) });
    },
    apply(saved) {
      const next = clone(saved || baseline);
      next.worlds = next.worlds.map(w => (w.id === 'world' ? { ...clone(authored), ...w } : w));
      if (!next.worlds.some(w => w.id === 'world')) next.worlds.unshift(clone(authored));
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next; sync();
    },
    dispose() { renderer.dispose(); listeners.clear(); },
  };
  sync();
  return api;
}
