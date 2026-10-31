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
// Document slice "collections": Main's collections as main-sync.js reads them, which its edits change by Blender's
// functions there. The Babylon side is collections-babylon.js.
const clone = value => JSON.parse(JSON.stringify(value));
const viewLayersOf = ({ viewLayers, activeViewLayer }) => ({ viewLayers, activeViewLayer });
export const MASTER = 'scene';
const DEFAULT = 'collection';

export function createCollections(world, { commit = () => {} } = {}) {
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const visibility = createCollectionVisibility(world);
  const ids = () => world.objects.filter(n => !deleted(n)).map(nodeId);
  const baseline = { collections: [{ id: DEFAULT, name: 'Collection', objects: [], children: [], hideSelect: false, hideViewport: false, hideRender: false }], scene: { objects: [], children: [DEFAULT] }, viewLayers: [{ id: 'ViewLayer', name: 'ViewLayer', layers: {}, active: DEFAULT }], activeViewLayer: 'ViewLayer' };
  let state = clone(baseline);
  let render = false;

  const byId = id => (id === MASTER ? state.scene : state.collections.find(c => c.id === id) || null);
  const layer = () => state.viewLayers.find(l => l.id === state.activeViewLayer) || state.viewLayers[0];
  const layerFlags = id => ({ exclude: false, hideViewport: false, ...layer().layers[id] });
  const parentIds = id => [...(state.scene.children.includes(id) ? [MASTER] : []), ...state.collections.filter(c => c.children.includes(id)).map(c => c.id)];
  const home = () => (byId(DEFAULT) ? DEFAULT : MASTER);
  const linked = objectId => [...(state.scene.objects.includes(objectId) ? [MASTER] : []), ...state.collections.filter(c => c.objects.includes(objectId)).map(c => c.id)];
  const memberships = objectId => { const list = linked(objectId); return list.length ? list : [home()]; };
  const members = id => [...byId(id).objects, ...(id === home() ? ids().filter(o => !linked(o).length) : [])];
  const descendants = (id, found = new Set()) => { for (const child of byId(id)?.children || []) if (!found.has(child)) { found.add(child); descendants(child, found); } return found; };

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
  // A view layer's change, which Main takes (main-sync.js pushCollections).
  const changed = () => { sync(); world.mainSync?.sceneChanged(); commit(); };
  // An edit of Main's collections (main-sync.js collectionEdits), which the slice then holds; one undo step.
  const edit = (fn) => { const result = fn(world.mainSync.collectionEdits); commit(); return result; };

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
    setActive(id) { world.mainSync.collectionEdits.setActive(byId(id) ? id : MASTER); },
    create({ parent = api.active, name = 'Collection', objects = [], move = false } = {}) {
      return byId(edit((main) => main.create({ parent, name, objects, move })));
    },
    // Blender's Delete keeps contents: objects and child collections move to the parent collections.
    remove(id) { if (byId(id) && id !== MASTER) edit((main) => main.remove(id)); },
    rename(id, name) { if (byId(id) && id !== MASTER && name?.trim()) edit((main) => main.rename(id, name.trim())); },
    set(id, patch) { edit((main) => main.set(id, patch)); },
    setLayer(id, patch) { edit((main) => main.setLayer(id, patch)); },
    link(objectIds, id) { edit((main) => main.link(objectIds, id)); },
    unlink(objectIds, id) { edit((main) => main.unlink(objectIds, id)); },
    move(objectIds, id) { edit((main) => main.move(objectIds, id)); },
    moveCollection(id, parent) {
      if (id !== MASTER && id !== parent && !descendants(id).has(parent)) edit((main) => main.moveCollection(id, parent));
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
    refresh: sync,
    // A whole state from Main after Blender's code ran (main-view.js), whose undo step is that code's.
    assign(next) {
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = clone(next); sync();
    },
    // A render's world shows what renders show.
    useRenderVisibility() { render = true; sync(); },
    get rendering() { return render; },
    // What Main does not hold: the view layers (Main's view layer has the active one's flags).
    capture() { return JSON.stringify(viewLayersOf(state)) === JSON.stringify(viewLayersOf(baseline)) ? undefined : clone(viewLayersOf(state)); },
    // A project's view layers; one saved before Main held the collections brings them too, which Main then takes.
    apply(saved) {
      const next = { ...state, ...clone(viewLayersOf(baseline)), ...clone(saved ?? {}) };
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next; sync();
      world.mainSync?.sceneChanged();
    },
    dispose() { visibility.dispose(); listeners.clear(); },
  };
  visibility.apply(resolved, render);
  return api;
}
