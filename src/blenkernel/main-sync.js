// Bylonder's scene and Blender's Main (docs/model.md). Main owns what Blender has a type for, its undo and its file;
// Babylon draws it (main-view.js, the view). Until Bylonder's editors write Main through its RNA, what they write on
// Babylon's objects crosses into Main here.
// - One mapping: the RNA bindings marked `sync` (makesrna/rna-bylonder.js), at the DNA field Blender's RNA names
//   (makesrna/dna-struct.js). What is not a value (names, parents, object data, materials, collections, modifiers,
//   bases) is written here under the same RNA names (an object's in RELATIONS).
// - Babylon to Main: hooks on Babylon's setters and observables mark an object changed (main-sync-hooks.js); flush()
//   writes what differs from what was last written, at the end of the task and before any of Blender's code runs.
// - Main to Babylon: after Blender's code ran (run(), view()) or an undo step loaded (undoLoad), the view writes what
//   Main holds. Writing it does not echo into Main.
// - Geometry: Main's Meshes own it. A mesh object's Mesh data goes into Main once, and again only when Bylonder's code
//   sets new Mesh data (its recipe, metadata.wbCreation); the view draws what Blender's code changed. A mesh Babylon
//   built itself (a MeshBuilder's) keeps its geometry: Main holds a stand-in, filled from it when Blender's code needs
//   it, until Blender's code changes it.
// - Undo is Blender's (undo-api.cc): undoPush pushes a step of Main, undoLoad loads one and draws it.
// - check() compares the overlap of both models; with `debug` on it runs after every flush and run.
import { createBlenderIDs } from './blender-ids.js';
import { dnaGet, dnaSet, dnaProperty, dnaIsText } from '../makesrna/dna-struct.js';
import { syncBindings } from '../makesrna/rna-bylonder.js';
import { INFO } from '../makesrna/rna.js';
import { modifierStack } from '../modifiers/stack.js';
import { moduleModifiers, asBlenderModifier } from '../modifiers/blender.js';
import { objectMesh } from '../editors/object/object-mesh.js';
import { nodeId, deleted } from '../editors/object/identity.js';
import { watchObject } from './main-sync-hooks.js';
import { CurveObject } from './curve/curve.js';
import { viewTransforms, looks } from './scene/render-babylon.js';
import { BlenderAnimation } from './animation/anim-blender.js';
import { MultiMaterial } from '@babylonjs/core';
import { mainTexture, readTexture, writeTexture } from './texture/texture.js';
import { armatureData, armatureDrawn, setArmatureData } from './armature/armature.js';
import { armature_draw } from '../draw/overlay-armature.js';
import { createMainView, ID_GR, ID_MA, ID_WO, ID_RECALC_GEOMETRY, CURVE_TYPES, PROPERTIES, plain, same } from './main-view.js';

const ID_TE = 0x4554;

const V3D_AROUND = { BOUNDING_BOX_CENTER: 0, CURSOR: 1, INDIVIDUAL_ORIGINS: 2, MEDIAN_POINT: 3, ACTIVE_ELEMENT: 4 };
const FLAGS = { hideSelect: 'hide_select', hideViewport: 'hide_viewport', hideRender: 'hide_render' };
const LAYER_FLAGS = { exclude: 'exclude', hideViewport: 'hide_viewport' };
// Whether `main` holds every value `babylon` has (nested records, Main's floats being 32-bit).
const holdsAll = (main, babylon) => (babylon && typeof babylon === 'object' && !Array.isArray(babylon)
  ? !!main && typeof main === 'object' && Object.keys(babylon).every((key) => holdsAll(main[key], babylon[key]))
  : Array.isArray(babylon) ? Array.isArray(main) && main.length === babylon.length && babylon.every((v, i) => holdsAll(main[i], v)) : same(plain(babylon), plain(main)));
// A name as Blender keeps it, unique among its IDs: "Cube" may be "Cube.001".
const sameName = (babylon, main) => main === babylon || main.replace(/\.\d{3}$/, '') === babylon.slice(0, 63);
// A value DNA can hold: an enum's identifier must be one of its items.
const holds = (field, value) => field.type !== 'ENUM' || typeof value !== 'string' || dnaIsText(field) || field.items?.some(([, id]) => id === value);
// Mesh data Bylonder's code made (a recipe of Mesh data or a Blender primitive), which Main owns once it holds it.
const meshData = (node) => !!(node.metadata?.wbCreation?.mesh || node.metadata?.wbCreation?.operator);

// The output each shader node RNA's node trees link from (rna-bylonder.js nodeTree), with its socket.
const SHADER_OUTPUTS = { ShaderNodeBsdfPrincipled: 'BSDF', ShaderNodeBackground: 'Background', ShaderNodeVolumeScatter: 'Volume', ShaderNodeEmission: 'Emission' };
const WIDTHS = { ShaderNodeBsdfPrincipled: 240 };

// A shader node tree as Blender builds it (BlenderMain.setNodeTree), from the RNA of one (its output node and the nodes
// linked into it), laid out right to left.
export function shaderTree(tree) {
  const nodes = [], links = [], byName = new Map();
  // A node once, however many links leave it; the outputs it links from (a closure's, or the link's socket).
  const add = (node, depth) => {
    if (byName.has(node.name)) return byName.get(node.name);
    const idname = node[INFO].struct, output = SHADER_OUTPUTS[idname];
    const entry = { idname, name: node.name, location: [-300 * depth, 0], width: WIDTHS[idname] ?? 140, inputs: [],
      outputs: output ? [{ identifier: output, socket: 'NodeSocketShader' }] : [] };
    nodes.push(entry);
    byName.set(node.name, entry);
    for (const input of node.inputs) {
      const link = input.is_linked ? input.links[0] : null;
      // An input Bylonder does not bind has no value: Blender's default is the node type's.
      const bound = !link && input[INFO].bound.has('default_value');
      entry.inputs.push({ identifier: input.identifier, name: input.name, socket: input[INFO].struct, value: bound ? plain(input.default_value) ?? null : null });
      if (!link) continue;
      const from = add(link.from_node, depth + 1), socket = link.from_socket?.identifier ?? SHADER_OUTPUTS[from.idname];
      if (!from.outputs.some((o) => o.identifier === socket)) from.outputs.push({ identifier: socket, socket: link.from_socket[INFO].struct });
      links.push([from.name, socket, node.name, input.identifier]);
    }
    return entry;
  };
  add(tree.get_output_node(), 0);
  return { nodes, links };
}

//   rna: createRNA(host), whose host has the world and selection; ids: the world's IDs in the module (blender-ids.js),
//   shared with its animation.
export function createMainSync({ rna, ids = createBlenderIDs() }) {
  const { world, selection } = rna.host;
  const blender = ids.blender;
  const key = (node) => 'object:' + nodeId(node);
  // Each synced owner's record: its RNA struct, its Main address and what was last synced, by RNA name.
  const objects = new Map(), materials = new Map(), worlds = new Map(), collections = new Map(), textures = new Map();
  const scene = { struct: 'Scene', ptr: blender.scene, shadow: new Map() };
  const SCENE_STRUCTS = { RenderSettings: 'render', UnitSettings: 'unit_settings', ColorManagedViewSettings: 'view_settings', ColorManagedDisplaySettings: 'display_settings', View3DCursor: 'cursor' };
  const sceneStruct = (name) => { const { offset } = dnaProperty('Scene', SCENE_STRUCTS[name]); return { struct: name, offset, ptr: blender.scene + offset, shadow: new Map() }; };
  const render = sceneStruct('RenderSettings'), units = sceneStruct('UnitSettings'), cursor = sceneStruct('View3DCursor');
  const view = sceneStruct('ColorManagedViewSettings'), display = sceneStruct('ColorManagedDisplaySettings');
  const tools = { struct: 'ToolSettings', ptr: dnaGet('Scene', blender.scene, 'tool_settings'), shadow: new Map() };
  // The scene's records, over the world: the scene, its render, unit and tool settings and 3D cursor, those whose slices it has.
  const sceneRecords = () => [scene, ...(world.renderSettings ? [render, view] : []), ...(world.sceneSettings ? [units, cursor] : []), tools, display];
  // The scene's view transform and look as Blender names them (Bylonder's are Babylon's tone maps).
  const viewNames = () => {
    const settings = rna.pointer('Scene', world).view_settings;
    return { view_transform: viewTransforms[settings.view_transform]?.ocioView ?? 'Standard', look: looks[settings.look]?.[0] ?? 'None' };
  };
  let scheduled = false, sceneChanged = true, listed = -1;
  // The objects hooks saw change since the last flush.
  const dirty = new Set();
  const animationData = new BlenderAnimation(blender);

  const objectType = (node) => rna.pointer('Object', node).type;
  const dataStruct = (node) => rna.pointer('Object', node).data?.[INFO].struct ?? null;
  const live = () => rna.objects();
  const entryOf = (node) => objects.get(node);
  const nodeOf = (ob) => [...objects.values()].find((entry) => entry.ob === ob)?.node ?? null;

  // An object's relations: its RNA pointer and collection properties, as IDs in Main. Each is written, read back and
  // checked by the same routines (pushRelations, pullRelations, check): `babylon` is the value Main should hold,
  // `main` what it holds, `set` writes it with Blender's function for that RNA setter, `apply` (when Blender's code
  // may change it) gives Main's to Babylon. A new kind is one more entry.
  const RELATIONS = {
    parent: {
      babylon: (node) => objects.get(node.parent)?.ob ?? 0,
      main: (ob) => blender.parent(ob),
      set: (ob, parent) => blender.setParent(ob, parent),
      // Its transform stays the one relative to its parent, as Main's (its parent inverse folded in).
      apply: (node, parent) => { node.parent = nodeOf(parent); },
    },
    material_slots: {
      applies: (entry) => entry.type === 'MESH',
      babylon: (node) => slotsOf(node).map((material) => (material ? materials.get(material)?.ma ?? 0 : 0)),
      main: (ob) => blender.materials(ob),
      set: (ob, slots) => blender.setMaterials(ob, slots),
      apply: (node, slots) => setSlots(node, slots.map(materialFor)),
    },
  };
  const slotsOf = (node) => world.materials?.slots(node) ?? (node.material instanceof MultiMaterial ? node.material.subMaterials : node.material ? [node.material] : []);
  const materialFor = (ma) => [...materials].find(([, record]) => record.ma === ma)?.[0] ?? null;
  function setSlots(node, list) {
    if (world.materials) list.forEach((material, index) => world.materials.assign(node, index, material));
    else if (list.length > 1) {
      const multi = new MultiMaterial('__slots ' + nodeId(node), node.getScene());
      multi.subMaterials = list;
      node.material = multi;
    } else node.material = list[0] ?? null;
  }
  const exact = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
  const relations = (entry) => Object.entries(RELATIONS).filter(([, relation]) => relation.applies?.(entry) ?? true);
  function pushRelations(entry) {
    for (const [, relation] of relations(entry)) {
      const value = relation.babylon(entry.node);
      if (!exact(value, relation.main(entry.ob))) relation.set(entry.ob, value);
    }
  }

  // A record's values from Babylon into Main, where they differ from what was last synced; what Main holds is kept.
  function push(record, owner) {
    for (const [name, binding] of syncBindings(rna, record.struct, owner)) {
      const field = dnaProperty(record.struct, name);
      if (!field || field.kind === 'pointer' || field.kind === 'struct') continue;
      const value = plain(binding.get());
      if (record.shadow.has(name) && same(record.shadow.get(name), value)) continue;
      if (!holds(field, value)) {
        // An enum whose items Blender makes per call (a unit's): Main keeps its own.
        (record.unheld ??= new Set()).add(name);
        continue;
      }
      dnaSet(record.struct, record.ptr, name, value);
      record.shadow.set(name, dnaGet(record.struct, record.ptr, name));
      api.writes++;
    }
  }
  // Objects: one per Bylonder object, with data of its type; one made again when its type changed. A deleted one is
  // deleted in Main, which undo brings back; one that left the scene keeps its keys (blender-ids.js).
  function syncObjects() {
    const nodes = live(), alive = new Set(nodes);
    for (const [node, entry] of objects) {
      if (alive.has(node) && objectType(node) === entry.type) continue;
      objects.delete(node);
      dirty.delete(entry);
      entry.unwatch();
      if (deleted(node)) {
        blender.remove(entry.ob);
        ids.forget(entry.key);
      } else if (!alive.has(node)) ids.remove(entry.key);
    }
    for (const node of nodes) {
      if (objects.has(node)) continue;
      const type = objectType(node), ob = ids.object(key(node), type, node.name);
      const entry = { struct: 'Object', ptr: ob, node, key: key(node), type, ob, shadow: new Map() };
      entry.data = { struct: dataStruct(node), ptr: blender.data(entry.ob), shadow: new Map() };
      entry.name = blender.name(entry.ob);
      entry.unwatch = watchObject(node, () => changed(entry));
      if (type === 'MESH' && !meshData(node)) blender.setProperty(ob, PROPERTIES.standin, '1');
      dirty.add(entry);
      objects.set(node, entry);
    }
  }
  // An object Main no longer holds (Blender's code deleted it, or an undo step does not have it): deleted, its children
  // without it, as Main's are.
  function forget(node, entry) {
    node.metadata = { ...node.metadata, wbDeleted: true };
    node.setEnabled(false);
    for (const child of objects.keys()) if (child.parent === node) child.parent = null;
    objects.delete(node);
    dirty.delete(entry);
    entry.unwatch();
    ids.forget(entry.key);
  }
  // A hook saw an object change (or, without one, something no hook sees): it goes to Main at the end of the task.
  function changed(entry) {
    if (state.applying) return;
    if (entry) dirty.add(entry);
    else {
      for (const e of objects.values()) dirty.add(e);
      sceneChanged = true;
    }
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => { scheduled = false; flush(false); });
    }
  }

  // Relations, by RNA name: what both models hold that is not a DNA value.
  function pushObject(entry) {
    const { node, ob } = entry, data = rna.pointer('Object', node);
    // A name is Blender's, unique among its IDs ("Cube.001" for a second "Cube").
    if (node.name !== entry.babylonName) {
      blender.rename(ob, node.name);
      node.name = entry.babylonName = entry.name = blender.name(ob);
    }
    pushRelations(entry);
    // An armature's mode is Blender's: its Edit and Pose Modes are entered by Blender's operators in Main.
    if (entry.type !== 'ARMATURE') blender.setMode(ob, data.mode);
    if (entry.id !== nodeId(node)) blender.setProperty(ob, PROPERTIES.id, (entry.id = nodeId(node)));
    push(entry, node);
    if (entry.data.ptr && entry.data.struct) push(entry.data, node);
    pushGeometry(entry);
    pushModifiers(entry);
    pushCurve(entry);
    pushArmature(entry);
  }
  // Mesh data Bylonder's code set on a mesh object (its recipe): Main's Mesh becomes it, and owns it from then on.
  function pushGeometry(entry) {
    const creation = entry.node.metadata?.wbCreation;
    if (entry.type !== 'MESH' || creation === entry.creation || !meshData(entry.node)) return;
    blender.setMesh(entry.ob, objectMesh(entry.node));
    [entry.creation, entry.owned] = [creation, true];
    blender.setProperty(entry.ob, PROPERTIES.standin, '');
  }
  // An armature object's bones and pose (its edit bones in Edit Mode), live in Main as in Babylon, drawn as Blender
  // evaluates them.
  function pushArmature(entry) {
    const data = entry.type === 'ARMATURE' && entry.node.metadata?.wbCreation?.armature, signature = JSON.stringify(data);
    if (!data || signature === entry.armature) return;
    entry.armature = signature;
    setArmatureData(blender.bmain, entry.ob, data);
    blender.evaluate();
    armature_draw(armatureDrawn(entry.ob), entry.node);
  }
  // A curve or text object's Curve data, live in Main as in Babylon (the edit data in Edit Mode).
  function pushCurve(entry) {
    if (!CURVE_TYPES.includes(entry.type) || !world.curves) return;
    const data = world.curves.data(entry.node), signature = JSON.stringify(data);
    if (signature === entry.curve) return;
    entry.curve = signature;
    curveObject(entry).data = data;
  }
  // A mesh object's modifier stack as Blender holds it: the stack's Blender modifiers with their settings.
  function pushModifiers(entry) {
    if (entry.type !== 'MESH') return;
    const stack = modifierStack(entry.node).map(asBlenderModifier).filter(Boolean);
    // A modifier deforming by another object (an Armature's) points at its Object in Main.
    const target = ({ values }) => [...objects.values()].find(({ node }) => nodeId(node) === values.object)?.ob ?? 0;
    const signature = JSON.stringify(stack.map((m) => [m.type, m.values, m.showViewport, m.showRender, textures.get(m.values.texture)?.tex, target(m)]));
    if (signature === entry.modifiers) return;
    entry.modifiers = signature;
    // A textured modifier points at Main's Tex of its texture (blenkernel/texture/textures.js).
    blender.setModifiers(entry.ob, moduleModifiers(stack, (m) => textures.get(m.values.texture)?.tex ?? 0, target));
  }
  // An object's base in the view layer; its collections' visibility and selectability are Blender's view layer sync's.
  function pushBase({ node, ob }, active = selection.nodes.at(-1)) {
    const data = rna.pointer('Object', node), status = world.collections?.status(node) ?? { visible: true };
    blender.setBase(ob, { visible: status.visible, hidden: data.hide_get(), hide_select: data.hide_select, select: data.select_get(), active: node === active });
  }

  // The scene: its values, its camera and world, and what operators read of its tool settings.
  function pushScene() {
    for (const record of sceneRecords()) push(record, world);
    if (world.renderSettings) for (const [name, value] of Object.entries(viewNames())) dnaSet('ColorManagedViewSettings', view.ptr, name, value);
    const settings = rna.pointer('Scene', world);
    blender.pivotPoint = V3D_AROUND[settings.tool_settings.transform_pivot_point];
    blender.camera = objects.get(world.sceneSettings?.camera())?.ob;
    blender.world = worlds.get(world.worlds?.active()?.id)?.wo;
  }

  // Main's ID of a name that no record holds yet (a project's .blend, an undo step's): the one a record of that name takes.
  const unclaimed = (code, name, records, field) => blender.ids(code).find((id) => blender.name(id) === name && ![...records.values()].some((record) => record[field] === id));
  // Materials and worlds: an ID for each of Bylonder's, its values through the mapping.
  function pushMaterials() {
    const all = new Set(world.materials?.all() ?? []);
    for (const [material, record] of materials) if (!all.has(material)) { blender.removeID(record.ma); materials.delete(material); }
    for (const material of all) {
      if (!materials.has(material)) materials.set(material, { struct: 'Material', ma: ids.adopted.get(material) ?? unclaimed(ID_MA, material.name, materials, 'ma') ?? blender.addMaterial(material.name), shadow: new Map() });
      const record = materials.get(material);
      record.ptr = record.ma;
      if (blender.name(record.ma) !== material.name && record.babylonName !== material.name) { blender.rename(record.ma, material.name); record.babylonName = material.name; }
      blender.setFakeUser(record.ma, !!material.metadata?.wbFakeUser);
      if (!record.kept) keepMaterial(record, material);
      push(record, material);
      pushTree(record, record.ma, rna.pointer('Material', material));
    }
  }
  // What only Babylon has of a material, for a round trip: its kind, and a node material's graph as Babylon saves it.
  function keepMaterial(record, material) {
    const type = world.materials.type(material);
    blender.setProperty(record.ma, PROPERTIES.material, type);
    if (type === 'node') blender.setProperty(record.ma, PROPERTIES.graph, JSON.stringify(material.serialize()));
    record.kept = true;
  }
  // An ID's node tree, built again when the RNA of Bylonder's changed.
  function pushTree(record, id, data) {
    const tree = shaderTree(data.node_tree), signature = JSON.stringify(tree);
    if (signature === record.tree) return;
    blender.setNodeTree(id, tree);
    record.tree = signature;
  }
  // Textures (blenkernel/texture/textures.js): a Tex for each record, its settings written where they differ.
  function pushTextures() {
    const all = world.textures?.all() ?? [], ids = new Set(all.map((entry) => entry.id));
    for (const [id, record] of textures) if (!ids.has(id)) { blender.removeID(record.tex); textures.delete(id); }
    for (const entry of all) {
      if (!textures.has(entry.id)) textures.set(entry.id, { tex: unclaimed(ID_TE, entry.name, textures, 'tex') ?? mainTexture(blender.bmain, entry.name, entry.values), values: entry.values });
      const record = textures.get(entry.id);
      if (record.babylonName !== entry.name) { blender.rename(record.tex, entry.name); record.babylonName = entry.name; }
      blender.setFakeUser(record.tex, entry.fakeUser);
      if (record.values !== entry.values) { writeTexture(record.tex, entry.values); record.values = entry.values; }
    }
  }
  function pushWorlds() {
    const all = world.worlds?.all() ?? [], kept = new Set(all.map((entry) => entry.id));
    for (const [id, record] of worlds) if (!kept.has(id)) { blender.removeID(record.wo); worlds.delete(id); }
    for (const entry of all) {
      if (!worlds.has(entry.id)) worlds.set(entry.id, { struct: 'World', wo: ids.adopted.get(entry.id) ?? unclaimed(ID_WO, entry.name, worlds, 'wo') ?? blender.addWorld(entry.name), shadow: new Map() });
      const record = worlds.get(entry.id);
      record.ptr = record.wo;
      if (record.babylonName !== entry.name) { blender.rename(record.wo, entry.name); record.babylonName = entry.name; }
      blender.setFakeUser(record.wo, !!entry.fakeUser);
      push(record, entry);
      pushTree(record, record.wo, rna.pointer('World', entry));
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
    const ids = [cols.MASTER, ...cols.state.collections.map((c) => c.id)], byId = new Map([...objects.values()].map((e) => [nodeId(e.node), e.ob]));
    const members = ids.map((id) => cols.objects(id).map((objectId) => byId.get(objectId)).filter(Boolean));
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
  function readCollections(newId = () => crypto.randomUUID()) {
    const cols = slice(), pointers = blender.ids(ID_GR);
    const byPointer = new Map([...collections].map(([id, record]) => [record.ptr, id]));
    for (const pointer of pointers) if (!byPointer.has(pointer)) {
      const id = newId(pointer);
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

  // Babylon into Main: what hooks marked changed, or `all` of it before Blender's code runs (so what no hook sees, the
  // selection and the slices' state, is in Main too), each value compared with what was last synced; then Main
  // evaluated, as the depsgraph would.
  function flush(all = true) {
    if (state.applying) return;
    // Objects come and go by the world's list and by deleting (metadata, which hooks see).
    if (all || world.objects.length !== listed || [...dirty].some(({ node, type }) => deleted(node) || objectType(node) !== type)) {
      syncObjects();
      listed = world.objects.length;
    }
    if (all || sceneChanged) {
      pushTextures();
      pushMaterials();
      pushWorlds();
    }
    const active = selection.nodes.at(-1);
    for (const entry of all ? objects.values() : dirty) {
      pushObject(entry);
      pushBase(entry, active);
    }
    dirty.clear();
    if (all || sceneChanged) {
      pushCollections();
      pushScene();
      sceneChanged = false;
    }
    if (!all) return;
    blender.evaluate();
    if (api.debug) assertEqual('flush');
  }

  const curveObject = (entry) => new CurveObject(entry.type, entry.node.name, entry.ob, blender);
  // The stand-ins of meshes Babylon built itself, filled with their geometry as it is now, for Blender's code.
  function fill(nodes) {
    for (const node of nodes) {
      const entry = objects.get(node);
      if (entry?.type === 'MESH' && !entry.owned) blender.setMesh(entry.ob, objectMesh(node));
    }
  }

  // Runs Blender's code on Main made current, with the stand-ins of `meshes` filled for it, and draws what it changed;
  // returns what fn returns. Run inside the undo step the change makes.
  function run(fn, { meshes = [] } = {}) {
    flush();
    fill(meshes);
    const result = fn();
    api.view();
    return result;
  }

  // Blender's undo (undo-api.cc): a step of Main pushed, with what Babylon wrote flushed into it first, and one loaded,
  // whose Main the view then draws. Returns the step, or whether it loaded.
  function undoPush(name) {
    flush();
    return blender.undoPush(name);
  }
  function undoLoad(step) {
    if (!blender.undoLoad(step)) return false;
    relink();
    api.view();
    return true;
  }
  // The records of what an undo step's Main read again at another address (an ID it brought back, the scene's
  // settings), found again by name; one that is gone is made again when Babylon still has it.
  function relink() {
    scene.ptr = blender.scene;
    for (const record of [render, units, cursor, view, display]) record.ptr = blender.scene + record.offset;
    tools.ptr = dnaGet('Scene', blender.scene, 'tool_settings');
    const byName = (code) => new Map(blender.ids(code).map((id) => [blender.name(id), id]));
    const again = (records, code, field, nameOf) => {
      const held = byName(code), alive = new Set(held.values());
      for (const [owner, record] of records) {
        if (alive.has(record[field])) continue;
        const id = held.get(nameOf(owner, record));
        if (id) record[field] = record.ptr = id;
        else records.delete(owner);
      }
    };
    again(materials, ID_MA, 'ma', (material) => material.name);
    again(worlds, ID_WO, 'wo', (id) => world.worlds.byId(id)?.name);
    again(textures, ID_TE, 'tex', (id) => world.textures.byId(id)?.name);
    again(collections, ID_GR, 'ptr', (id) => world.collections.byId(id)?.name);
    collectionsSynced = '';
  }

  // The differences between both models where they overlap, as messages; none when they are equal.
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
      for (const [name, relation] of relations(entry)) if (!exact(relation.babylon(node), relation.main(entry.ob))) diffs.push(`${label}.${name} differs`);
      const base = blender.base(entry.ob);
      if (base && base.selected !== selection.has(node)) diffs.push(`${label}: selected ${selection.has(node)}, Main ${base.selected}`);
      if (base && base.active !== (node === active) && base.selected) diffs.push(`${label}: active differs`);
      if (CURVE_TYPES.includes(entry.type) && world.curves && !holdsAll(curveObject(entry).data, world.curves.data(node))) diffs.push(`${label}: curve data differs`);
      if (entry.type === 'ARMATURE' && !holdsAll(armatureData(entry.ob), node.metadata?.wbCreation?.armature)) diffs.push(`${label}: armature data differs`);
      if (entry.owned) {
        const mesh = blender.mesh(entry.ob), own = objectMesh(node);
        if (!same(Array.from(mesh.vert_positions), Array.from(own.vert_positions)) || !same(Array.from(mesh.corner_verts), Array.from(own.corner_verts)))
          diffs.push(`${label}: geometry differs`);
      }
    }
    // A node tree's input values, as Main holds them.
    const compareTree = (label, id, data) => {
      const main = blender.nodeTree(id), byName = new Map(main.nodes.map((node) => [node.name, node]));
      for (const node of shaderTree(data.node_tree).nodes) {
        const held = byName.get(node.name);
        if (!held || held.idname !== node.idname) { diffs.push(`${label}.node_tree: no ${node.idname} "${node.name}" in Main`); continue; }
        for (const { identifier, value } of node.inputs) if (value !== null && !same(value, held.inputs[identifier]))
          diffs.push(`${label}.node_tree["${node.name}"].inputs["${identifier}"]: Babylon ${JSON.stringify(value)}, Main ${JSON.stringify(held.inputs[identifier])}`);
      }
    };
    for (const [material, record] of materials) {
      const label = `Material "${material.name}"`;
      if (!sameName(material.name, blender.name(record.ma))) diffs.push(`${label}.name: Main "${blender.name(record.ma)}"`);
      compare(label, record, material);
      compareTree(label, record.ma, rna.pointer('Material', material));
    }
    for (const [id, record] of worlds) {
      const entry = world.worlds.byId(id);
      if (!entry) continue;
      compare(`World "${entry.name}"`, record, entry);
      compareTree(`World "${entry.name}"`, record.wo, rna.pointer('World', entry));
    }
    for (const [id, { tex }] of textures) {
      const entry = world.textures.byId(id), values = readTexture(tex);
      if (!entry) continue;
      if (!sameName(entry.name, blender.name(tex))) diffs.push(`Texture "${entry.name}".name: Main "${blender.name(tex)}"`);
      for (const [name, value] of Object.entries(entry.values)) if (!same(value, values[name])) diffs.push(`Texture "${entry.name}".${name}: Babylon ${JSON.stringify(value)}, Main ${JSON.stringify(values[name])}`);
    }
    for (const record of sceneRecords()) compare(record.struct, record, world);
    if (world.renderSettings) for (const [name, value] of Object.entries(viewNames())) {
      if (dnaGet('ColorManagedViewSettings', view.ptr, name) !== value) diffs.push(`Scene.view_settings.${name}: Babylon "${value}", Main "${dnaGet('ColorManagedViewSettings', view.ptr, name)}"`);
    }
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

  // A mesh object's Mesh with its modifiers applied, as Blender evaluates it (for export, and the stacks that evaluate
  // in Main).
  function evaluatedMesh(node) {
    flush();
    fill([node]);
    return blender.evaluatedMesh(objects.get(node).ob);
  }

  // What Blender's code tagged so far: the objects whose geometry it changed, with their types.
  const geometryTagged = () => [...objects.values()].filter(({ ob }) => { const tags = blender.tags(ob); return (tags.object | tags.data) & ID_RECALC_GEOMETRY; })
    .map(({ node, type }) => ({ node, type }));
  // Main made Babylon's again, undoing what Blender's code changed that Bylonder does not take.
  function revert() {
    const records = [scene, render, units, tools, view, display, ...objects.values(), ...[...objects.values()].map((e) => e.data), ...materials.values(), ...worlds.values(),
      ...[...collections.values()].flatMap((c) => [c, c.layer])];
    records.forEach((record) => record.shadow.clear());
    for (const entry of objects.values()) [entry.babylonName, entry.modifiers, entry.id] = [undefined, undefined, undefined];
    for (const record of [...materials.values(), ...worlds.values()]) record.tree = undefined;
    collectionsSynced = '';
    flush();
  }

  const api = {
    blender,
    ids,
    flush,
    run,
    // Babylon drawn from Main after Blender's code ran (main-view.js), for editors that run it over several events (the
    // Outliner's modal operators and drags).
    view: () => { mainView.view(); flush(); if (api.debug) assertEqual('view'); },
    // A run over several events (a modal operator's): Main made current with the meshes' stand-ins filled, until end
    // draws what it changed.
    begin({ meshes = [] } = {}) { flush(); fill(meshes); },
    end: () => api.view(),
    // The scene at a frame: Main evaluated for it as the depsgraph evaluates a new frame (animation and drivers, then
    // matrices), and its evaluated values drawn (main-view.js evaluated).
    frameChanged(frame) {
      flush();
      blender.frame = frame;
      blender.evaluate();
      mainView.evaluated();
    },
    // Blender's undo stack, started from Main as it is (the scene's first state), its steps pushed and loaded.
    undoInit: () => { flush(); blender.undoInit(); },
    undoPush,
    undoLoad,
    geometryTagged,
    revert,
    check,
    evaluatedMesh,
    // For code that reads Main's geometry: fn runs with the stand-ins filled.
    withMeshes(fn, nodes) {
      flush();
      fill(nodes ?? [...objects.keys()]);
      return fn();
    },
    // The scene as a .blend file (its bytes), written by Blender's writer from Main.
    writeBlend: (filepath) => api.withMeshes(() => blender.writeBlend(filepath)),
    // Main as a project saves it: meshes Babylon built keep their stand-ins as they are (the project's code builds them).
    projectBlend: () => { flush(); return blender.writeBlend('/project.blend'); },
    // A .blend's data read into Main and made Babylon's in `scene` (the view's adopt); returns the Babylon objects it
    // made and Blender's and Bylonder's warnings. Its scene settings and collections follow when the scene sync of the
    // world starts (ids.read).
    readBlend(bytes, scene = world.scene) {
      const read = blender.readBlend(bytes), { nodes, warnings } = mainView.adopt(scene);
      if (world.collections) mainView.adoptScene();
      else ids.read = true;
      return { nodes, warnings: [...read, ...warnings] };
    },
    adopt: (scene) => mainView.adopt(scene),
    // Whether Blender's code may change an object's data: its geometry is filled for it (lights and cameras are
    // Bylonder's objects of their own kind).
    holdsData: (node) => ['MESH', 'EMPTY', 'ARMATURE', ...CURVE_TYPES].includes(objects.get(node)?.type),
    // The selected objects, whose geometry operators on the selection are given.
    selected: () => selection.nodes.filter((node) => objects.has(node)),
    objectOf: (node) => objects.get(node)?.ob ?? null,
    nodeOf,
    materialOf: (material) => materials.get(material)?.ma ?? null,
    textureOf: (id) => textures.get(id)?.tex ?? null,
    entryOf,
    // A change Babylon makes that no hook sees (a slice's state): the next flush writes everything.
    changed: () => changed(null),
    debug: false,
    // Values written into Main so far, to tell that writing back does not echo.
    writes: 0,
  };
  const state = {
    rna, world, selection, blender, ids, objects, materials, worlds, textures, animationData, applying: false,
    sceneRecords, readCollections, relations, nodeOf, forget, treeSignature: (data) => JSON.stringify(shaderTree(data.node_tree)),
  };
  const mainView = createMainView(state);
  // Objects Main already holds (a project's .blend, a file the project's code opened) are the ones of their ids, with
  // Main's selection; then a read file's scene settings and collections.
  const { nodes, revived } = mainView.adopt();
  world.objects.push(...nodes);
  const selected = [...nodes, ...revived].filter((node) => blender.base(objects.get(node).ob)?.selected);
  if (selected.length) selection?.replace(selected.sort((a, b) => blender.base(objects.get(a).ob).active - blender.base(objects.get(b).ob).active));
  if (ids.read && world.collections) {
    mainView.adoptScene();
    ids.read = false;
  }
  return api;
}
