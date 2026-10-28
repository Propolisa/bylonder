// The collections slice (collections.js) in the module's Blender world (main-api.cc): a Collection in Main for each of
// the slice's, with its name, Disable Selection, in Viewports and in Renders, and its children and objects in order;
// in the view layer, each one's LayerCollection with Exclude and Hide in Viewport, and the active collection. read()
// gives the slice's state back from Main after Blender's code changed it (the Outliner's operators).
//   blender: the BlenderMain; collections: the slice; objectOf(id) and idOf(ob): an object's address by its node id,
//   and back.
import { dnaGet, dnaSet } from '../../makesrna/dna-struct.js';

// ID_GR (MAKE_ID2('G', 'R')).
const ID_GR = 0x5247;
const FLAGS = [['hideSelect', 'hide_select'], ['hideViewport', 'hide_viewport'], ['hideRender', 'hide_render']];
const LAYER_FLAGS = [['exclude', 'exclude'], ['hideViewport', 'hide_viewport']];

export function createBlenderCollections({ blender, collections, objectOf, idOf }) {
  // The slice's id -> its Collection's address.
  const mirrored = new Map();
  let synced = '';
  const pointerOf = (id) => (id === collections.MASTER ? blender.masterCollection : mirrored.get(id));
  const ids = () => [collections.MASTER, ...collections.state.collections.map((c) => c.id)];

  function sync() {
    const { state } = collections;
    const objects = ids().map((id) => collections.objects(id).map(objectOf));
    const signature = JSON.stringify([state, objects]);
    if (signature === synced) return;
    synced = signature;
    const live = new Set(state.collections.map((c) => c.id)), alive = new Set(blender.ids(ID_GR));
    for (const [id, pointer] of mirrored) {
      if (live.has(id) && alive.has(pointer)) continue;
      if (alive.has(pointer)) blender.removeCollection(pointer);
      mirrored.delete(id);
    }
    for (const c of state.collections) {
      if (!mirrored.has(c.id)) mirrored.set(c.id, blender.addCollection(null, c.name));
      const pointer = mirrored.get(c.id);
      if (blender.name(pointer) !== c.name) blender.rename(pointer, c.name);
      for (const [key, prop] of FLAGS) dnaSet('Collection', pointer, prop, !!c[key]);
    }
    ids().forEach((id, i) => {
      blender.setCollectionChildren(pointerOf(id), collections.byId(id).children.map(pointerOf).filter(Boolean));
      blender.setCollectionObjects(pointerOf(id), objects[i].filter(Boolean));
    });
    for (const c of state.collections) {
      const lc = blender.layerCollection(pointerOf(c.id)), flags = collections.layerFlags(c.id);
      if (lc) for (const [key, prop] of LAYER_FLAGS) dnaSet('LayerCollection', lc, prop, !!flags[key]);
    }
    blender.syncCollections();
    blender.activeCollection = pointerOf(collections.active);
  }

  // The slice's state as Main holds it: collections Blender's code made get new ids, removed ones go.
  function read() {
    const pointers = blender.ids(ID_GR), byPointer = new Map([...mirrored].map(([id, pointer]) => [pointer, id]));
    for (const pointer of pointers) if (!byPointer.has(pointer)) byPointer.set(pointer, crypto.randomUUID());
    mirrored.clear();
    for (const pointer of pointers) mirrored.set(byPointer.get(pointer), pointer);
    const idOfCollection = (pointer) => (pointer === blender.masterCollection ? collections.MASTER : byPointer.get(pointer));
    const contents = (pointer) => ({
      objects: blender.collectionObjects(pointer).map(idOf).filter(Boolean),
      children: blender.collectionChildren(pointer).map(idOfCollection).filter(Boolean),
    });
    const { state } = collections, layer = collections.layer();
    const layers = Object.fromEntries(pointers.map((pointer) => {
      const lc = blender.layerCollection(pointer);
      return [byPointer.get(pointer), Object.fromEntries(LAYER_FLAGS.map(([key, prop]) => [key, lc ? dnaGet('LayerCollection', lc, prop) : false]))];
    }));
    return {
      ...state,
      collections: pointers.map((pointer) => ({
        id: byPointer.get(pointer), name: blender.name(pointer), ...contents(pointer),
        ...Object.fromEntries(FLAGS.map(([key, prop]) => [key, dnaGet('Collection', pointer, prop)])),
      })),
      scene: contents(blender.masterCollection),
      viewLayers: state.viewLayers.map((l) => (l === layer ? { ...l, layers, active: idOfCollection(blender.activeCollection) ?? collections.MASTER } : l)),
    };
  }

  return { sync, read, pointerOf, resync: () => { synced = ''; } };
}
