import { nodeId, deleted } from '../../editors/object/identity.js';
import { createCollectionVisibility } from './collections-babylon.js';

// Collections and view layers, shaped like Blender:
//   collections:  bpy.data.collections; each has objects, children and the global flags
//                 hideSelect (Disable Selection), hideViewport (Disable in Viewports) and hideRender (Disable in Renders)
//   scene:        scene.collection, the master Scene Collection (objects, children)
//   viewLayers:   scene.view_layers; per collection a LayerCollection with exclude and hideViewport,
//                 plus the active collection that new objects go into
// Objects are referenced by id. As in Blender's startup file, the Scene Collection holds one "Collection", and an
// object linked nowhere (built by code) counts as its member, or the Scene Collection's once it is deleted.
// Parenting is separate from collections, as in Blender.
// Document slice "collections". The Babylon side is collections-babylon.js.
const clone = value => JSON.parse(JSON.stringify(value));
export const MASTER = 'scene';
const DEFAULT = 'collection';

export function createCollections(world, { commit = () => {} } = {}) {
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const visibility = createCollectionVisibility(world);
  const ids = () => world.objects.filter(n => !deleted(n)).map(nodeId);
  const baseline = { collections: [{ id: DEFAULT, name: 'Collection', objects: [], children: [], hideSelect: false, hideViewport: false, hideRender: false }], scene: { objects: [], children: [DEFAULT] }, viewLayers: [{ id: 'ViewLayer', name: 'ViewLayer', layers: {}, active: MASTER }], activeViewLayer: 'ViewLayer' };
  let state = clone(baseline);
  const known = new Set(ids());
  let render = false;

  const byId = id => (id === MASTER ? state.scene : state.collections.find(c => c.id === id) || null);
  const layer = () => state.viewLayers.find(l => l.id === state.activeViewLayer) || state.viewLayers[0];
  const layerFlags = id => ({ exclude: false, hideViewport: false, ...layer().layers[id] });
  const parents = id => [state.scene, ...state.collections].filter(c => c.children.includes(id));
  const parentIds = id => [...(state.scene.children.includes(id) ? [MASTER] : []), ...state.collections.filter(c => c.children.includes(id)).map(c => c.id)];
  const home = () => (byId(DEFAULT) ? DEFAULT : MASTER);
  const linked = objectId => [...(state.scene.objects.includes(objectId) ? [MASTER] : []), ...state.collections.filter(c => c.objects.includes(objectId)).map(c => c.id)];
  const memberships = objectId => { const list = linked(objectId); return list.length ? list : [home()]; };
  const members = id => [...byId(id).objects, ...(id === home() ? ids().filter(o => !linked(o).length) : [])];
  const descendants = (id, found = new Set()) => { for (const child of byId(id)?.children || []) if (!found.has(child)) { found.add(child); descendants(child, found); } return found; };
  const unique = name => {
    const taken = new Set(state.collections.map(c => c.name));
    if (!taken.has(name)) return name;
    const stem = name.replace(/\.\d{3}$/, '');
    for (let i = 1; ; i++) { const next = stem + '.' + String(i).padStart(3, '0'); if (!taken.has(next)) return next; }
  };

  // Resolves each object's state in the active view layer, walking collection paths from the Scene Collection.
  // Renders show what is not disabled in renders instead of what the viewports show.
  const evaluate = () => {
    const result = new Map(), flags = layer().layers;
    const visit = (collectionId, visible, selectable, seen) => {
      for (const id of members(collectionId)) {
        const prev = result.get(id) || { visible: false, selectable: false, inLayer: false };
        result.set(id, { inLayer: true, visible: prev.visible || visible, selectable: prev.selectable || (visible && selectable) });
      }
      for (const childId of byId(collectionId).children) {
        const child = byId(childId), f = flags[childId] || {};
        if (!child || f.exclude || seen.has(childId)) continue;
        const shown = render ? !child.hideRender : !f.hideViewport && !child.hideViewport;
        visit(childId, visible && shown, selectable && !child.hideSelect, new Set([...seen, childId]));
      }
    };
    visit(MASTER, true, true, new Set());
    // Linked only inside excluded collections: not in this view layer.
    for (const id of ids()) if (!result.has(id)) result.set(id, { inLayer: false, visible: false, selectable: false });
    return result;
  };
  let resolved = evaluate();
  const sync = () => { resolved = evaluate(); visibility.apply(resolved, render); emit(); };
  const changed = () => { sync(); commit(); };
  const linkObjects = (objectIds, id) => { const c = byId(id); for (const o of objectIds) if (!c.objects.includes(o)) c.objects.push(o); };
  const unlinkObjects = (objectIds, id) => { const c = byId(id); c.objects = c.objects.filter(o => !objectIds.includes(o)); };

  const api = {
    MASTER,
    get state() { return state; },
    all: () => state.collections,
    byId, parentIds, memberships, layer, layerFlags,
    viewLayers: () => state.viewLayers,
    get active() { return byId(layer().active) ? layer().active : MASTER; },
    status: node => resolved.get(nodeId(node)) || { visible: true, selectable: true, inLayer: true },
    get home() { return home(); },
    // Members of a collection, including the objects linked nowhere for their home collection.
    objects: id => (byId(id) ? members(id) : []),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    selectable: node => api.status(node).selectable,
    setActive(id) { layer().active = byId(id) ? id : MASTER; emit(); },
    create({ parent = api.active, name = 'Collection', objects = [], move = false } = {}) {
      const collection = { id: crypto.randomUUID(), name: unique(name), objects: [], children: [], hideSelect: false, hideViewport: false, hideRender: false };
      state.collections.push(collection);
      byId(parent).children.push(collection.id);
      if (move) for (const c of [state.scene, ...state.collections]) c.objects = c.objects.filter(o => !objects.includes(o));
      collection.objects.push(...objects);
      changed();
      return collection;
    },
    // Blender's Delete keeps contents: objects and child collections move to the parent collections.
    remove(id) {
      const collection = byId(id); if (!collection || id === MASTER) return;
      const targets = parents(id);
      for (const parent of targets) {
        parent.children = parent.children.filter(c => c !== id);
        for (const child of collection.children) if (!parent.children.includes(child)) parent.children.push(child);
        for (const o of collection.objects) if (!parent.objects.includes(o)) parent.objects.push(o);
      }
      state.collections = state.collections.filter(c => c !== collection);
      for (const l of state.viewLayers) { delete l.layers[id]; if (l.active === id) l.active = MASTER; }
      changed();
    },
    rename(id, name) { const c = byId(id); if (c && id !== MASTER && name?.trim()) { c.name = name.trim() === c.name ? c.name : unique(name.trim()); changed(); } },
    set(id, patch) { Object.assign(byId(id), patch); changed(); },
    setLayer(id, patch) { const l = layer(); l.layers[id] = { ...layerFlags(id), ...patch }; changed(); },
    link(objectIds, id) { linkObjects(objectIds, id); changed(); },
    unlink(objectIds, id) { unlinkObjects(objectIds, id); changed(); },
    move(objectIds, id) { for (const c of [state.scene, ...state.collections]) unlinkObjects(objectIds, c === state.scene ? MASTER : c.id); linkObjects(objectIds, id); changed(); },
    moveCollection(id, parent) {
      if (id === MASTER || id === parent || descendants(id).has(parent)) return;
      for (const p of parents(id)) p.children = p.children.filter(c => c !== id);
      byId(parent).children.push(id); changed();
    },
    createViewLayer() {
      const names = new Set(state.viewLayers.map(l => l.name));
      let name = 'ViewLayer', i = 1; while (names.has(name)) name = 'ViewLayer.' + String(i++).padStart(3, '0');
      const next = { id: crypto.randomUUID(), name, layers: {}, active: MASTER };
      state.viewLayers.push(next); state.activeViewLayer = next.id; changed();
      return next;
    },
    removeViewLayer(id) { if (state.viewLayers.length < 2) return; state.viewLayers = state.viewLayers.filter(l => l.id !== id); if (state.activeViewLayer === id) state.activeViewLayer = state.viewLayers[0].id; changed(); },
    renameViewLayer(id, name) { const l = state.viewLayers.find(v => v.id === id); if (l && name?.trim()) { l.name = name.trim(); changed(); } },
    setViewLayer(id) { if (state.viewLayers.some(l => l.id === id)) { state.activeViewLayer = id; changed(); } },
    // Objects created since load go to the active collection (Blender adds new objects there). Runs before each undo step.
    adopt() {
      const fresh = ids().filter(id => !known.has(id));
      if (!fresh.length) return;
      fresh.forEach(id => known.add(id));
      linkObjects(fresh, api.active);
      sync();
    },
    refresh: sync,
    // A render's world shows what renders show.
    useRenderVisibility() { render = true; sync(); },
    capture() { return JSON.stringify(state) === JSON.stringify(baseline) ? undefined : clone(state); },
    apply(saved) {
      const next = clone(saved || baseline);
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next; ids().forEach(id => known.add(id)); sync();
    },
    dispose() { visibility.dispose(); listeners.clear(); },
  };
  visibility.apply(resolved, render);
  return api;
}
