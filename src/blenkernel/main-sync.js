// Bylonder's scene and Blender's Main, kept equal both ways (docs/blender-boundary.md, "Who owns what"). The Babylon
// scene is the truth and renders; Main is a second model of the same scene, so Blender's code (operators, editors,
// the .blend writer) works on real data whenever it runs.
// - One mapping: the RNA bindings marked `sync` (makesrna/rna-bylonder.js), read and written in Main at the DNA field
//   Blender's RNA names (makesrna/dna-struct.js). What is not a value (names, parents, object data, materials,
//   collections, modifiers, bases) is written here, under the same RNA names (RELATIONS).
// - Babylon to Main: hooks on Babylon's setters and observables mark an object changed (hooks.js); flush() writes
//   what differs from what was last synced, at the end of the task and before any of Blender's code runs.
// - Main to Babylon: after Blender's code ran (run()), what it changed is written back through the same mapping:
//   geometry by its recalc tag (ID_RECALC_GEOMETRY), values that differ from what was last synced (which also catches
//   the writes Blender's buttons make without tagging). Writing back does not echo into Main.
// - Geometry has one owner, the Babylon scene: Main's Meshes hold none at rest. Code that needs it gets it filled for
//   its run (`meshes`), and only what the code changed comes back. In Edit Mode the module's edit mesh owns it.
// - check() compares the overlap of both models; with `debug` on it runs after every flush and run.
import { createBlenderIDs } from './blender-ids.js';
import { dnaGet, dnaSet, dnaProperty } from '../makesrna/dna-struct.js';
import { syncBindings } from '../makesrna/rna-bylonder.js';
import { modifierStack } from '../modifiers/stack.js';
import { moduleModifiers, blenderModifierDefinitions } from '../modifiers/blender.js';
import { mesh_serialize } from './mesh/mesh.js';
import { objectMesh } from '../editors/object/object-mesh.js';
import { rebuildMesh } from '../editors/object/mesh-catalog.js';
import { nodeId, deleted } from '../editors/object/identity.js';
import { watchObject } from './main-sync-hooks.js';

// ID codes (MAKE_ID2) and recalc tags (DNA_ID.h).
const ID_OB = 0x424f, ID_GR = 0x5247;
const ID_RECALC_GEOMETRY = 1 << 1;
const OWN_DATA = ['MESH', 'EMPTY', 'LIGHT', 'CAMERA'];
const V3D_AROUND = { BOUNDING_BOX_CENTER: 0, CURSOR: 1, INDIVIDUAL_ORIGINS: 2, MEDIAN_POINT: 3, ACTIVE_ELEMENT: 4 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (matrix) => matrix.every((v, i) => v === IDENTITY[i]);
const FLAGS = { hideSelect: 'hide_select', hideViewport: 'hide_viewport', hideRender: 'hide_render' };
const LAYER_FLAGS = { exclude: 'exclude', hideViewport: 'hide_viewport' };

// A value as both models compare it: arrays plain, Main's floats being 32-bit.
const plain = (value) => (value && typeof value === 'object' ? Array.from(value) : value);
const close = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
export const same = (a, b) => (Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]))
  : typeof a === 'number' && typeof b === 'number' ? close(a, b) : a === b);
// A name as Blender keeps it, unique among its IDs: "Cube" may be "Cube.001".
const sameName = (babylon, main) => main === babylon || main.replace(/\.\d{3}$/, '') === babylon.slice(0, 63);
// A value DNA can hold: an enum's identifier must be one of its items.
const holds = (field, value) => field.type !== 'ENUM' || typeof value !== 'string' || field.items?.some(([, id]) => id === value);

//   rna: createRNA(host), whose host has the world and selection; ids: the world's IDs in the module (blender-ids.js),
//   shared with its animation.
export function createMainSync({ rna, ids = createBlenderIDs() }) {
  const { world, selection } = rna.host;
  const blender = ids.blender;
  const key = (node) => 'object:' + nodeId(node);
  // Each synced owner's record: its RNA struct, its Main address and what was last synced, by RNA name.
  const objects = new Map(), materials = new Map(), worlds = new Map(), collections = new Map();
  const scene = { struct: 'Scene', ptr: blender.scene, shadow: new Map() };
  const sceneStruct = (name) => ({ struct: name, ptr: blender.scene + dnaProperty('Scene', { RenderSettings: 'render', UnitSettings: 'unit_settings' }[name]).offset, shadow: new Map() });
  const render = sceneStruct('RenderSettings'), units = sceneStruct('UnitSettings');
  let applying = false, scheduled = false;
  const filled = new Set();

  const objectType = (node) => rna.pointer('Object', node).type;
  const dataStruct = (node) => rna.pointer('Object', node).data?.bl_rna?.identifier ?? null;
  const live = () => rna.objects();
  const entryOf = (node) => objects.get(node);
  const nodeOf = (ob) => [...objects.values()].find((entry) => entry.ob === ob)?.node ?? null;

  // A record's values from Babylon into Main, where they differ from what was last synced; what Main holds is kept.
  function push(record, owner) {
    for (const [name, binding] of syncBindings(rna, record.struct, owner)) {
      const field = dnaProperty(record.struct, name);
      if (!field || field.kind === 'pointer' || field.kind === 'struct') continue;
      const value = plain(binding.get());
      if (record.shadow.has(name) && same(record.shadow.get(name), value)) continue;
      if (!holds(field, value)) continue;
      dnaSet(record.struct, record.ptr, name, value);
      record.shadow.set(name, dnaGet(record.struct, record.ptr, name));
    }
  }
  // A record's values that Blender's code changed in Main, written to Babylon.
  function pull(record, owner) {
    let changed = false;
    for (const [name, binding] of syncBindings(rna, record.struct, owner)) {
      const field = dnaProperty(record.struct, name);
      if (!field || field.kind === 'pointer' || field.kind === 'struct') continue;
      const value = dnaGet(record.struct, record.ptr, name);
      if (same(record.shadow.get(name), value)) continue;
      record.shadow.set(name, value);
      if (binding.set) { binding.set(value); changed = true; }
    }
    return changed;
  }

  // Objects: one per Bylonder object, with data of its type; one made again when its type changed.
  function syncObjects() {
    const nodes = live(), alive = new Set(nodes);
    for (const [node, entry] of objects) {
      if (alive.has(node) && objectType(node) === entry.type) continue;
      objects.delete(node);
      entry.unwatch();
      if (!alive.has(node)) ids.remove(entry.key);
    }
    for (const node of nodes) {
      if (objects.has(node)) continue;
      const type = objectType(node), ob = ids.object(key(node), type, node.name);
      const entry = { struct: 'Object', ptr: ob, node, key: key(node), type, ob, shadow: new Map() };
      entry.data = { struct: dataStruct(node), ptr: blender.data(entry.ob), shadow: new Map() };
      entry.name = blender.name(entry.ob);
      entry.unwatch = watchObject(node, () => changed(entry));
      entry.dirty = true;
      objects.set(node, entry);
    }
  }
  // A hook saw an object change (or, without one, something no hook sees): it goes to Main at the end of the task.
  function changed(entry) {
    if (applying) return;
    if (entry) entry.dirty = true;
    else for (const e of objects.values()) e.dirty = true;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; flush(false); });
    }
  }

  // Relations, by RNA name: what both models hold that is not a DNA value.
  function pushObject(entry) {
    const { node, ob } = entry, data = rna.pointer('Object', node);
    if (node.name !== entry.babylonName) {
      blender.rename(ob, node.name);
      [entry.babylonName, entry.name] = [node.name, blender.name(ob)];
    }
    blender.setParent(ob, objects.get(node.parent)?.ob);
    blender.setMode(ob, data.mode);
    push(entry, node);
    if (entry.data.ptr && entry.data.struct) push(entry.data, node);
    const slots = world.materials?.slots(node);
    if (slots && entry.type === 'MESH') {
      const wanted = slots.map((material) => (material ? materials.get(material)?.ma ?? 0 : 0));
      if (!same(wanted, blender.materials(ob))) blender.setMaterials(ob, wanted);
    }
    pushModifiers(entry);
  }
  // A mesh object's modifier stack as Blender holds it: the stack's Blender modifiers with their settings.
  function pushModifiers(entry) {
    if (entry.type !== 'MESH') return;
    const stack = modifierStack(entry.node).filter((m) => blenderModifierDefinitions.some((d) => d.id === m.type));
    const signature = JSON.stringify(stack.map(({ type, values, showViewport, showRender }) => [type, values, showViewport, showRender]));
    if (signature === entry.modifiers) return;
    entry.modifiers = signature;
    blender.setModifiers(entry.ob, moduleModifiers(stack));
  }
  function pushBases() {
    const active = selection.nodes.at(-1);
    for (const [node, { ob }] of objects) {
      const data = rna.pointer('Object', node), status = world.collections?.status(node) ?? { visible: true, selectable: true };
      blender.setBase(ob, { visible: status.visible, hidden: data.hide_get(), hide_select: data.hide_select || !status.selectable,
        select: data.select_get(), active: node === active });
    }
  }

  // The scene: its values, its camera and world, and what operators read of its tool settings.
  function pushScene() {
    push(scene, world);
    if (world.renderSettings) push(render, world);
    if (world.sceneSettings) push(units, world);
    const settings = rna.pointer('Scene', world);
    blender.cursor = Array.from(settings.cursor.location);
    blender.pivotPoint = V3D_AROUND[settings.tool_settings.transform_pivot_point];
    blender.camera = objects.get(world.sceneSettings?.camera())?.ob;
    blender.world = worlds.get(world.worlds?.active()?.id)?.wo;
  }

  // Materials and worlds: an ID for each of Bylonder's, its values through the mapping.
  function pushMaterials() {
    const all = new Set(world.materials?.all() ?? []);
    for (const [material, record] of materials) if (!all.has(material)) { blender.removeID(record.ma); materials.delete(material); }
    for (const material of all) {
      if (!materials.has(material)) materials.set(material, { struct: 'Material', ma: blender.addMaterial(material.name), shadow: new Map() });
      const record = materials.get(material);
      record.ptr = record.ma;
      if (blender.name(record.ma) !== material.name && record.babylonName !== material.name) { blender.rename(record.ma, material.name); record.babylonName = material.name; }
      blender.setFakeUser(record.ma, !!material.metadata?.wbFakeUser);
      push(record, material);
    }
  }
  function pushWorlds() {
    const all = world.worlds?.all() ?? [], ids = new Set(all.map((entry) => entry.id));
    for (const [id, record] of worlds) if (!ids.has(id)) { blender.removeID(record.wo); worlds.delete(id); }
    for (const entry of all) {
      if (!worlds.has(entry.id)) worlds.set(entry.id, { struct: 'World', wo: blender.addWorld(entry.name), shadow: new Map() });
      const record = worlds.get(entry.id);
      record.ptr = record.wo;
      if (record.babylonName !== entry.name) { blender.rename(record.wo, entry.name); record.babylonName = entry.name; }
      blender.setFakeUser(record.wo, !!entry.fakeUser);
      push(record, entry);
    }
  }

  // Collections: a Collection for each of the slice's, its children and objects in order, and in the view layer each
  // one's LayerCollection and the active collection.
  let collectionsSynced = '';
  const slice = () => world.collections;
  const collectionPointer = (id) => (id === slice().MASTER ? blender.masterCollection : collections.get(id)?.ptr);
  function pushCollections() {
    const cols = slice();
    if (!cols) return;
    const ids = [cols.MASTER, ...cols.state.collections.map((c) => c.id)];
    const members = ids.map((id) => cols.objects(id).map((objectId) => [...objects.values()].find((e) => nodeId(e.node) === objectId)?.ob).filter(Boolean));
    const signature = JSON.stringify([cols.state, members]);
    if (signature === collectionsSynced) return;
    collectionsSynced = signature;
    const kept = new Set(cols.state.collections.map((c) => c.id)), alive = new Set(blender.ids(ID_GR));
    for (const [id, record] of collections) {
      if (kept.has(id) && alive.has(record.ptr)) continue;
      if (alive.has(record.ptr)) blender.removeCollection(record.ptr);
      collections.delete(id);
    }
    for (const c of cols.state.collections) {
      if (!collections.has(c.id)) collections.set(c.id, { struct: 'Collection', ptr: blender.addCollection(null, c.name), shadow: new Map(), layer: { struct: 'LayerCollection', shadow: new Map() } });
      const record = collections.get(c.id);
      if (blender.name(record.ptr) !== c.name) blender.rename(record.ptr, c.name);
      push(record, c);
    }
    ids.forEach((id, i) => {
      blender.setCollectionChildren(collectionPointer(id), cols.byId(id).children.map(collectionPointer).filter(Boolean));
      blender.setCollectionObjects(collectionPointer(id), members[i]);
    });
    for (const c of cols.state.collections) {
      const record = collections.get(c.id);
      record.layer.ptr = blender.layerCollection(record.ptr);
      if (record.layer.ptr) push(record.layer, c);
    }
    blender.syncCollections();
    blender.activeCollection = collectionPointer(cols.active);
  }
  // The slice's state as Main holds it: collections Blender's code made get new ids, removed ones go.
  function readCollections() {
    const cols = slice(), pointers = blender.ids(ID_GR);
    const byPointer = new Map([...collections].map(([id, record]) => [record.ptr, id]));
    for (const pointer of pointers) if (!byPointer.has(pointer)) {
      const id = crypto.randomUUID();
      byPointer.set(pointer, id);
      collections.set(id, { struct: 'Collection', ptr: pointer, shadow: new Map(), layer: { struct: 'LayerCollection', shadow: new Map() } });
    }
    for (const [id, record] of collections) if (!pointers.includes(record.ptr)) collections.delete(id);
    const idOf = (pointer) => (pointer === blender.masterCollection ? cols.MASTER : byPointer.get(pointer));
    const contents = (pointer) => ({
      objects: blender.collectionObjects(pointer).map(nodeOf).filter(Boolean).map(nodeId),
      children: blender.collectionChildren(pointer).map(idOf).filter(Boolean),
    });
    const flags = (struct, pointer, names) => Object.fromEntries(Object.entries(names).map(([key, name]) => [key, pointer ? dnaGet(struct, pointer, name) : false]));
    const { state } = cols, layer = cols.layer();
    const layers = Object.fromEntries(pointers.map((pointer) => [byPointer.get(pointer), flags('LayerCollection', blender.layerCollection(pointer), LAYER_FLAGS)]));
    const next = {
      ...state,
      collections: pointers.map((pointer) => ({ id: byPointer.get(pointer), name: blender.name(pointer), ...contents(pointer), ...flags('Collection', pointer, FLAGS) })),
      scene: contents(blender.masterCollection),
      viewLayers: state.viewLayers.map((l) => (l === layer ? { ...l, layers, active: idOf(blender.activeCollection) ?? cols.MASTER } : l)),
    };
    cols.assign(next);
    for (const c of next.collections) {
      const record = collections.get(c.id);
      for (const [key, name] of Object.entries(FLAGS)) record.shadow.set(name, c[key]);
      record.layer.ptr = blender.layerCollection(record.ptr);
      for (const [key, name] of Object.entries(LAYER_FLAGS)) record.layer.shadow.set(name, layers[c.id][key]);
    }
    collectionsSynced = '';
  }

  // Babylon into Main: the objects hooks marked changed, or `all` of them (before Blender's code runs, so what no hook
  // saw is in Main too), and the rest of the scene, which is compared with what was last synced.
  function flush(all = true) {
    if (applying) return;
    syncObjects();
    pushMaterials();
    pushWorlds();
    for (const entry of objects.values()) if (entry.dirty || all) { pushObject(entry); entry.dirty = false; }
    pushCollections();
    pushBases();
    pushScene();
    blender.evaluate();
    if (api.debug && all) assertEqual('flush');
  }

  // Fills mesh objects' Meshes from Babylon for code that needs their geometry.
  function fill(nodes) {
    for (const node of nodes) {
      const entry = objects.get(node);
      if (entry?.type !== 'MESH' || filled.has(entry)) continue;
      blender.setMesh(entry.ob, objectMesh(node));
      filled.add(entry);
    }
  }
  function release() {
    for (const entry of filled) blender.clearMesh(entry.ob);
    filled.clear();
  }

  // Main into Babylon, after Blender's code: what it changed, with geometry it changed of the meshes it was given.
  function writeBack() {
    applying = true;
    try {
      const alive = new Set(blender.ids(ID_OB)), chosen = [], active = [];
      for (const [node, entry] of [...objects]) {
        if (!alive.has(entry.ob)) {
          node.metadata = { ...node.metadata, wbDeleted: true };
          node.setEnabled(false);
          objects.delete(node);
          entry.unwatch();
          ids.forget(entry.key);
          continue;
        }
        const { ob } = entry, tags = blender.tags(ob);
        if (!isIdentity(blender.transform(ob).matrix_parent_inverse)) blender.foldParentInverse(ob);
        pull(entry, node);
        if (entry.data.ptr && entry.data.struct) pull(entry.data, node);
        const name = blender.name(ob);
        if (name !== entry.name) [node.name, entry.name, entry.babylonName] = [name, name, name];
        const parent = nodeOf(blender.parent(ob));
        if (parent !== (objects.has(node.parent) ? node.parent : null)) node.setParent(parent);
        const base = blender.base(ob), data = rna.pointer('Object', node);
        if (base?.selected) (base.active ? active : chosen).push(node);
        if (base && data.hide_get() !== base.hidden) node.setEnabled(!base.hidden);
        if ((tags.object | tags.data) & ID_RECALC_GEOMETRY && filled.has(entry)) {
          rebuildMesh(node, { mesh: mesh_serialize(blender.mesh(ob)) });
        }
      }
      selection.replace([...chosen, ...active]);
      for (const [material, record] of materials) pull(record, material);
      for (const [id, record] of worlds) { const entry = world.worlds.byId(id); if (entry) pull(record, entry); }
      pull(scene, world);
      if (world.renderSettings) pull(render, world);
      if (world.sceneSettings) pull(units, world);
      if (slice()) readCollections();
      blender.evaluate();
    } finally {
      applying = false;
    }
    world.modifiers?.refresh();
  }

  // Runs Blender's code on Main made current, with the geometry of `meshes` filled for it, and writes back what it
  // changed; returns what fn returns. Run inside the undo step the change makes.
  function run(fn, { meshes = [] } = {}) {
    flush();
    fill(meshes);
    try {
      const result = fn();
      writeBack();
      flush();
      if (api.debug) assertEqual('run');
      return result;
    } finally {
      release();
    }
  }

  // The differences between both models where they overlap, as messages; none when they are equal. Geometry is
  // compared only where Main holds it (filled).
  function check() {
    const diffs = [];
    const compare = (label, record, owner) => {
      for (const [name, binding] of syncBindings(rna, record.struct, owner)) {
        const field = dnaProperty(record.struct, name);
        if (!field || field.kind === 'pointer' || field.kind === 'struct') continue;
        const babylon = plain(binding.get()), main = dnaGet(record.struct, record.ptr, name);
        if (holds(field, babylon) && !same(babylon, main)) diffs.push(`${label}.${name}: Babylon ${JSON.stringify(babylon)}, Main ${JSON.stringify(main)}`);
      }
    };
    const nodes = live();
    if (nodes.length !== objects.size || nodes.some((node) => !objects.has(node))) diffs.push('objects: Babylon and Main hold different objects');
    const active = selection.nodes.at(-1);
    for (const [node, entry] of objects) {
      const label = `Object "${node.name}"`;
      if (!sameName(node.name, blender.name(entry.ob))) diffs.push(`${label}.name: Main "${blender.name(entry.ob)}"`);
      compare(label, entry, node);
      if (entry.data.ptr && entry.data.struct) compare(`${label}.data`, entry.data, node);
      if (blender.parent(entry.ob) !== (objects.get(node.parent)?.ob ?? 0)) diffs.push(`${label}.parent differs`);
      const base = blender.base(entry.ob);
      if (base && base.selected !== selection.has(node)) diffs.push(`${label}: selected ${selection.has(node)}, Main ${base.selected}`);
      if (base && base.active !== (node === active) && base.selected) diffs.push(`${label}: active differs`);
      if (entry.type === 'MESH' && world.materials) {
        const wanted = world.materials.slots(node).map((m) => (m ? materials.get(m)?.ma ?? 0 : 0));
        if (!same(wanted, blender.materials(entry.ob))) diffs.push(`${label}.material_slots differ`);
      }
      if (filled.has(entry)) {
        const mesh = blender.mesh(entry.ob), own = objectMesh(node);
        if (!same(Array.from(mesh.vert_positions), Array.from(own.vert_positions)) || !same(Array.from(mesh.corner_verts), Array.from(own.corner_verts)))
          diffs.push(`${label}: geometry differs`);
      }
    }
    for (const [material, record] of materials) {
      if (!sameName(material.name, blender.name(record.ma))) diffs.push(`Material "${material.name}".name: Main "${blender.name(record.ma)}"`);
      compare(`Material "${material.name}"`, record, material);
    }
    for (const [id, record] of worlds) { const entry = world.worlds.byId(id); if (entry) compare(`World "${entry.name}"`, record, entry); }
    compare('Scene', scene, world);
    if (world.renderSettings) compare('Scene.render', render, world);
    if (world.sceneSettings) compare('Scene.unit_settings', units, world);
    if (blender.world !== (worlds.get(world.worlds?.active()?.id)?.wo ?? 0)) diffs.push('Scene.world differs');
    const cols = slice();
    for (const c of cols?.state.collections ?? []) {
      const record = collections.get(c.id);
      if (!record) { diffs.push(`Collection "${c.name}" is not in Main`); continue; }
      if (blender.name(record.ptr) !== c.name) diffs.push(`Collection "${c.name}".name: Main "${blender.name(record.ptr)}"`);
      compare(`Collection "${c.name}"`, record, c);
      const objectsOf = blender.collectionObjects(record.ptr).map(nodeOf).filter(Boolean).map(nodeId);
      if (!same(objectsOf, cols.objects(c.id))) diffs.push(`Collection "${c.name}".objects differ`);
    }
    return diffs;
  }
  function assertEqual(when) {
    const diffs = check();
    if (diffs.length) throw new Error(`Babylon and Main differ after ${when}:\n  ${diffs.join('\n  ')}`);
  }

  // A mesh object's Mesh with its modifiers applied, as Blender evaluates it (for export): filled, evaluated, released.
  function evaluatedMesh(node) {
    flush();
    fill([node]);
    try {
      return blender.evaluatedMesh(objects.get(node).ob);
    } finally {
      release();
    }
  }

  // What Blender's code tagged so far: the objects whose geometry it changed, with their types.
  const geometryTagged = () => [...objects.values()].filter(({ ob }) => { const tags = blender.tags(ob); return (tags.object | tags.data) & ID_RECALC_GEOMETRY; })
    .map(({ node, type }) => ({ node, type }));
  // Main made Babylon's again, undoing what Blender's code changed that Bylonder does not take.
  function revert() {
    const records = [scene, render, units, ...objects.values(), ...[...objects.values()].map((e) => e.data), ...materials.values(), ...worlds.values(),
      ...[...collections.values()].flatMap((c) => [c, c.layer])];
    records.forEach((record) => record.shadow.clear());
    for (const entry of objects.values()) [entry.babylonName, entry.modifiers] = [undefined, undefined];
    collectionsSynced = '';
    flush();
  }

  const api = {
    blender,
    ids,
    flush,
    run,
    // For editors that run Blender's code over several events (the Outliner's modal operators and drags): what it
    // changed, written back.
    writeBack: () => { writeBack(); flush(); if (api.debug) assertEqual('writeBack'); },
    geometryTagged,
    revert,
    check,
    evaluatedMesh,
    // For code that reads Main's geometry (the .blend writer): fn runs with every mesh object's Mesh filled.
    withMeshes(fn, nodes = [...objects.keys()]) {
      flush();
      fill(nodes);
      try { return fn(); } finally { release(); }
    },
    // Whether the module holds an object's data (Bylonder's text and curves are its own until the curves land in Main).
    holdsData: (node) => OWN_DATA.includes(objects.get(node)?.type),
    // The selected objects, whose geometry operators on the selection are given.
    selected: () => selection.nodes.filter((node) => objects.has(node)),
    objectOf: (node) => objects.get(node)?.ob ?? null,
    nodeOf,
    materialOf: (material) => materials.get(material)?.ma ?? null,
    entryOf,
    // A change Babylon makes that no hook sees (a slice's state): the next flush writes everything.
    changed: () => changed(null),
    debug: false,
  };
  return api;
}
