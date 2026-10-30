// The view (docs/model.md): Babylon's scene drawn from Blender's state in Main, one way. After Blender's code ran or
// an undo step loaded, every object's values come from Main through the RNA mapping (rna-bylonder.js `sync`
// bindings at their DNA fields), its relations and base, the geometry Blender tagged, a curve's Curve data and an
// armature's bones; Main's objects without a Babylon object get one, linked by id (`bylonder_id`), and objects Main
// no longer holds are deleted. Materials, worlds, scene settings and collections are read the same way.
import { dnaGet, dnaProperty } from '../makesrna/dna-struct.js';
import { syncBindings, LIGHT_STRUCTS } from '../makesrna/rna-bylonder.js';
import { INFO } from '../makesrna/rna.js';
import { createLight } from './light/light-home.js';
import { createWorld } from './scene/world.js';
import { mesh_serialize } from './mesh/mesh.js';
import { nodeId, deleted } from '../editors/object/identity.js';
import { CurveObject } from './curve/curve.js';
import { mesh_batch_cache_apply } from '../draw/mesh-batch-cache.js';
import { asObject, setEvaluatedMatrix } from '../runtime/object-transform.js';
import { ID_RECALC_GEOMETRY, ID_RECALC_SYNC_TO_EVAL, ID_RECALC_ALL } from '../bmesh/bmesh-wasm.js';
import { Color3, FreeCamera, Material, Matrix, Mesh, PBRMaterial, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { armatureData, armatureDrawn } from './armature/armature.js';
import { armature_draw } from '../draw/overlay-armature.js';
import { principledPBR, applyPBR } from './material/principled-gltf.js';
import { createEditMeshOverlay } from '../draw/overlay-edit-mesh.js';

export const ID_OB = 0x424f, ID_GR = 0x5247, ID_MA = 0x414d, ID_WO = 0x4f57;
export const CURVE_TYPES = ['CURVE', 'FONT'];
// Types of Blender's the view draws only as the depsgraph evaluates them: as their evaluated mesh, or placed where they
// are (what they do, a lattice's deform or a speaker's sound, is Blender's).
const EVALUATED = ['SURFACE', 'META'], PLACED = ['LATTICE', 'SPEAKER', 'LIGHT_PROBE'];
// The objects drawn from what the depsgraph evaluated.
const DRAWN = ['MESH', 'EMPTY', 'LIGHT', 'CAMERA', ...CURVE_TYPES, ...EVALUATED, ...PLACED];
// Custom properties in Main for what only Babylon has: an object's identity in Bylonder, a material's kind and graph.
// `bylonder_standin`: a Mesh that stands in for geometry Babylon built (a MeshBuilder's), which Babylon draws itself.
export const PROPERTIES = { id: 'bylonder_id', material: 'bylonder_material', graph: 'bylonder_node_material', standin: 'bylonder_standin' };
// eRotationModes.
export const ROTATION_MODES = { QUATERNION: 0, XYZ: 1, XZY: 2, YXZ: 3, YZX: 4, ZXY: 5, ZYX: 6, AXIS_ANGLE: -1 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const isIdentity = (matrix) => matrix.every((v, i) => v === IDENTITY[i]);
// A value as both models compare it: arrays plain, Main's floats being 32-bit.
export const plain = (value) => (value && typeof value === 'object' ? Array.from(value) : value);
const close = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
export const same = (a, b) => (Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]))
  : typeof a === 'number' && typeof b === 'number' ? close(a, b) : a === b);
// The Babylon objects an Object of Main's becomes, by its type.
const MAKERS = {
  EMPTY: (scene, name) => new TransformNode(name, scene),
  CAMERA: (scene, name) => asObject(new FreeCamera(name, Vector3.Zero(), scene)),
  // A light Blender's code made is Blender's (docs/blender-boundary.md point 4a); the view fills its settings from Main.
  LIGHT: (scene, name, ob, blender) => createLight(name, dnaGet('Light', blender.data(ob), 'type'), {}, scene),
  MESH: (scene, name) => new Mesh(name, scene),
  ARMATURE: (scene, name) => new Mesh(name, scene),
  CURVE: (scene, name) => new Mesh(name, scene),
  FONT: (scene, name) => new Mesh(name, scene),
  ...Object.fromEntries(EVALUATED.map((type) => [type, (scene, name) => Object.assign(new Mesh(name, scene), { metadata: { wbType: type } })])),
  ...Object.fromEntries(PLACED.map((type) => [type, (scene, name) => Object.assign(new TransformNode(name, scene), { metadata: { wbType: type } })])),
};

// A mesh object's Mesh as Main holds it is its recipe (its Mesh data, for saving), Main owning it; the view draws it as
// the depsgraph evaluates it.
function keepMesh(entry, blender) {
  entry.node.metadata = { ...entry.node.metadata, wbCreation: { mesh: mesh_serialize(blender.mesh(entry.ob)) } };
  [entry.creation, entry.owned] = [entry.node.metadata.wbCreation, true];
  blender.setProperty(entry.ob, PROPERTIES.standin, '');
}

// Blender's matrix (column-major, Z up) as Babylon's (row-major, Y up): Babylon's (x, y, z) is Blender's (x, z, y).
const AXIS = [0, 2, 1, 3];
const babylonMatrix = (m) => Matrix.FromArray(Array.from({ length: 16 }, (_, i) => m[AXIS[i >> 2] * 4 + AXIS[i & 3]]));

//   state: the scene sync's records (main-sync.js): rna, world, selection, blender, ids, objects, materials, worlds,
//   sceneRecords(), readCollections(), relations(entry), nodeOf, forget(node, entry), and `applying`, which mutes its hooks.
export function createMainView(state) {
  const { rna, world, selection, blender, ids, objects, materials, worlds } = state;

  // A record's values Main holds that Babylon does not yet, written to Babylon. A new rotation mode changes which
  // rotation is synced: that one is read again.
  function pull(record, owner) {
    let changed = false;
    for (const [name, binding] of syncBindings(rna, record.struct, owner)) {
      const field = dnaProperty(record.struct, name);
      if (!field || field.kind === 'pointer' || field.kind === 'struct' || record.unheld?.has(name)) continue;
      const value = dnaGet(record.struct, record.ptr, name);
      if (same(record.shadow.get(name), value)) continue;
      record.shadow.set(name, value);
      if (!binding.set) continue;
      binding.set(value);
      changed = true;
      if (name === 'rotation_mode') {
        ['rotation_euler', 'rotation_quaternion'].forEach((rotation) => record.shadow.delete(rotation));
        return pull(record, owner);
      }
    }
    return changed;
  }
  const exact = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
  function pullRelations(entry) {
    for (const [, relation] of state.relations(entry)) {
      const value = relation.main(entry.ob);
      if (relation.apply && !exact(value, relation.babylon(entry.node))) relation.apply(entry.node, value);
    }
  }
  const curveObject = (entry) => new CurveObject(entry.type, entry.node.name, entry.ob, blender);
  // An object's data as Main holds it: a mesh's geometry, a curve's or text's Curve data, an armature's bones.
  function drawData(entry) {
    const { node, type } = entry;
    if (type === 'MESH') {
      if (blender.property(entry.ob, PROPERTIES.standin) === '1') entry.owned = false;
      else keepMesh(entry, blender);
    }
    else if (CURVE_TYPES.includes(type)) {
      // Its recipe; the depsgraph's evaluation draws it.
      node.metadata = { ...node.metadata, wbCreation: { curve: { ...curveObject(entry).data, modifiers: node.metadata?.wbCreation?.curve?.modifiers } } };
      entry.drawn = false;
    } else if (type === 'ARMATURE') pullArmature(entry, true);
  }
  // What Blender's code changed of an armature (bones, pose, its mode), after Main is evaluated.
  function pullArmature(entry, always = false) {
    const { node, ob } = entry, data = armatureData(ob), signature = JSON.stringify(data), mode = dnaGet('Object', ob, 'mode');
    if (!always && signature === entry.armature && mode === node.metadata.wbMode) return;
    entry.armature = signature;
    node.metadata = { ...node.metadata, wbCreation: { armature: data }, wbMode: mode };
    armature_draw(armatureDrawn(ob), node);
  }

  // A mesh object in Blender's Edit Mode in Main: its edit mesh drawn as the edit overlay over its evaluated mesh (which
  // the depsgraph evaluates from the edit mesh, its modifiers shown in Edit Mode included), its mode Main's; leaving it,
  // the Mesh Blender wrote is kept. Returns whether it is in Edit Mode.
  function drawEditMode(entry) {
    const edit = blender.editMesh(entry.ob), { node } = entry;
    if (!edit && !entry.overlay) return false;
    node.metadata = { ...node.metadata, wbMode: edit ? 'EDIT' : 'OBJECT' };
    if (!edit) {
      entry.overlay.dispose();
      entry.overlay = null;
      keepMesh(entry, blender);
      entry.drawn = false;
      return false;
    }
    (entry.overlay ??= createEditMeshOverlay(node)).update(edit.mesh, { selectmode: edit.selectmode });
    return true;
  }

  // An object's entry, as the sync makes one, for an Object Main holds.
  function link(node, ob, type) {
    node.name = blender.name(ob);
    const entry = { struct: 'Object', ptr: ob, node, key: 'object:' + nodeId(node), type, ob, shadow: new Map(), babylonName: node.name, name: node.name };
    entry.data = { struct: rna.pointer('Object', node).data?.[INFO].struct ?? null, ptr: blender.data(ob), shadow: new Map() };
    // The data's type is the Babylon object's own (a light's class).
    if (entry.data.struct === 'Light') entry.data.shadow.set('type', dnaGet('Light', entry.data.ptr, 'type'));
    ids.adopt(entry.key, ob, type);
    // Without hooks: a full flush writes what Babylon changed of it before Blender's code runs or an undo step is pushed.
    entry.unwatch = () => {};
    objects.set(node, entry);
    return entry;
  }

  // Main's objects that have no Babylon object: the one their id names (the project's code built it, or Bylonder deleted
  // it and an undo brought it back), else a new one of their type. Returns the new objects, the revived ones and what Bylonder cannot show.
  function adopt(scene = world.scene) {
    const warnings = [], made = [], revived = [], was = state.applying;
    state.applying = true;
    try {
      for (const ma of blender.ids(ID_MA)) if (!materialFor(ma)) adoptMaterial(ma, scene, warnings);
      for (const ob of blender.ids(ID_OB)) {
        if (state.nodeOf(ob)) continue;
        const type = dnaGet('Object', ob, 'type'), name = blender.name(ob), id = blender.property(ob, PROPERTIES.id) ?? name;
        if (!MAKERS[type]) { warnings.push(`"${name}": ${type.toLowerCase()} objects are not opened`); continue; }
        const kept = world.objects.find((node) => !objects.has(node) && nodeId(node) === id);
        if (kept) {
          kept.metadata = { ...kept.metadata, wbDeleted: false };
          kept.setEnabled(!blender.base(ob)?.hidden);
          revived.push(link(kept, ob, type));
          continue;
        }
        const node = MAKERS[type](scene, name, ob, blender);
        // A copy Blender's code made (object.duplicate) carries its original's id: it gets one of its own.
        const taken = world.objects.some((other) => !deleted(other) && nodeId(other) === id) || [...objects.keys()].some((other) => nodeId(other) === id);
        node.metadata = { ...node.metadata, editable: true, wbId: taken ? crypto.randomUUID() : id };
        made.push(link(node, ob, type));
      }
      for (const entry of [...made, ...revived]) {
        pullRelations(entry);
        if (entry.type === 'MESH' || CURVE_TYPES.includes(entry.type) || entry.type === 'ARMATURE') drawData(entry);
      }
      for (const entry of made) {
        const { node, ob } = entry, wanted = rna.pointer('Object', node).rotation_mode;
        if (!isIdentity(blender.transform(ob).matrix_parent_inverse)) blender.foldParentInverse(ob);
        if (dnaGet('Object', ob, 'rotation_mode') !== wanted) {
          if (fcurvePaths(ob).includes('rotation_euler')) warnings.push(`"${node.name}": its rotation keys are in another rotation order than Bylonder's`);
          blender.setRotationMode(ob, ROTATION_MODES[wanted]);
        }
        if (blender.camera === ob) scene.activeCamera = node;
      }
      for (const entry of [...made, ...revived]) {
        pull(entry, entry.node);
        if (entry.data.ptr && entry.data.struct) pull(entry.data, entry.node);
      }
      const wo = blender.world;
      if (wo && !world.worlds && !ids.adopted.has('world')) adoptWorld(wo, scene, warnings);
      return { nodes: made.map(({ node }) => node), revived: revived.map(({ node }) => node), warnings };
    } finally {
      state.applying = was;
    }
  }
  const fcurvePaths = (id) => state.animationData.fcurves(id).map((fcurve) => fcurve.rna_path);
  const materialFor = (ma) => [...materials].find(([, record]) => record.ma === ma)?.[0] ?? null;
  // A read Material: Bylonder's kind of it (its custom properties tell a Standard or Node material, which a file
  // Bylonder wrote keeps), its values and its Principled BSDF inputs.
  function adoptMaterial(ma, scene, warnings) {
    const name = blender.name(ma), kind = blender.property(ma, PROPERTIES.material), graph = blender.property(ma, PROPERTIES.graph);
    // Bylonder's material of that name (the project's code built it) is the one a project's .blend saved.
    const own = world.materials?.all().find((material) => material.name === name && !materials.has(material));
    if (own) {
      const record = { struct: 'Material', ma, ptr: ma, shadow: new Map() };
      materials.set(own, record);
      drawShading(record, own, 'Material');
      return;
    }
    const material = graph ? Material.Parse(JSON.parse(graph), scene, '') : kind === 'standard' ? new StandardMaterial(name, scene)
      : Object.assign(new PBRMaterial(name, scene), { metallic: 0, roughness: 0.5, albedoColor: new Color3(0.8, 0.8, 0.8) });
    material.name = name;
    material.metadata = { ...material.metadata, wbId: name };
    const record = { struct: 'Material', ma, ptr: ma, shadow: new Map() };
    materials.set(material, record);
    ids.adopted.set(material, ma);
    drawShading(record, material, 'Material', warnings);
  }
  // A read World: the scene's world as Blender's, which Bylonder's authored world reads.
  function adoptWorld(wo, scene, warnings) {
    const background = blender.nodeTree(wo).nodes.find((node) => node.idname === 'ShaderNodeBackground');
    const color = background?.inputs.Color ?? dnaGet('World', wo, 'color');
    createWorld(scene, color && { color: [...color].slice(0, 3) });
    if (background && background.inputs.Strength !== 1) warnings.push(`World "${blender.name(wo)}": its strength opens as 1`);
    ids.adopted.set('world', wo);
  }
  // A material's or world's values and node tree from Main. A PBR material is its Principled BSDF as Blender's glTF
  // exporter and Babylon's loader convert it (principled-gltf.js); a node material's graph is Babylon's (Main holds a
  // stand-in of it).
  function drawShading(record, owner, struct, warnings = []) {
    pull(record, owner);
    const type = struct === 'Material' ? world.materials?.type(owner) : null;
    if (type === 'node') return;
    const pbr = type === 'pbr' && mainPBR(blender, record.ptr);
    if (pbr) applyPBR(owner, pbr);
    pullTree(record.ptr, rna.pointer(struct, owner), owner.name, warnings, !pbr);
  }
  // An ID's node tree inputs that Bylonder's RNA of it binds, from Main's nodes of the same types, where they differ
  // (when `values`); a warning names the node types it has no binding for.
  function pullTree(id, data, label, warnings = [], values = true) {
    const held = blender.nodeTree(id).nodes, mapped = new Set(['ShaderNodeOutputMaterial', 'ShaderNodeOutputWorld']);
    const visit = (node) => {
      mapped.add(node[INFO].struct);
      const from = held.find((h) => h.idname === node[INFO].struct);
      for (const input of node.inputs) {
        if (input.is_linked) { visit(input.links[0].from_node); continue; }
        if (!values) continue;
        const value = from?.inputs[input.identifier];
        if (value !== undefined && input[INFO].bound.has('default_value') && !same(plain(input.default_value), plain(value))) input.default_value = value;
      }
    };
    visit(data.node_tree.get_output_node());
    const unmapped = [...new Set(held.map((h) => h.idname).filter((idname) => !mapped.has(idname)))];
    if (unmapped.length) warnings.push(`Material "${label}": its ${unmapped.join(', ')} nodes are not opened`);
  }
  // A read file's scene, once the slices it sets exist: its settings, world and collections.
  function adoptScene() {
    state.applying = true;
    try {
      // Twice: a value the slice refuses before another is set (a frame range's start after its old end) is set after.
      for (const record of [...state.sceneRecords(), ...state.sceneRecords()]) {
        record.shadow.clear();
        try { pull(record, world); } catch { /* set on the second pass */ }
      }
      state.readCollections((pointer) => 'collection:' + blender.name(pointer));
    } finally {
      state.applying = false;
    }
  }

  // Babylon drawn from Main, after Blender's code ran: what it deleted is deleted, every object's values, relations,
  // base and tagged geometry, objects it added made, then materials, worlds and the scene.
  function view() {
    state.applying = true;
    try {
      const alive = new Set(blender.ids(ID_OB)), chosen = [], active = [];
      blender.cleanMasterCollection();
      const kept = [...objects].filter(([node, entry]) => alive.has(entry.ob) || state.forget(node, entry));
      for (const [node, entry] of kept) {
        const { ob } = entry, tags = blender.tags(ob);
        entry.data.ptr = blender.data(ob);
        if (!isIdentity(blender.transform(ob).matrix_parent_inverse)) blender.foldParentInverse(ob);
        pull(entry, node);
        if (entry.data.ptr && entry.data.struct) pull(entry.data, node);
        const name = blender.name(ob);
        if (name !== entry.name) [node.name, entry.name, entry.babylonName] = [name, name, name];
        const base = blender.base(ob), data = rna.pointer('Object', node);
        if (base?.selected) (base.active ? active : chosen).push(node);
        if (base && data.hide_get() !== base.hidden) node.setEnabled(!base.hidden);
        // A stand-in Blender's code changed becomes Main's; one an undo step read again stays Babylon's.
        const changed = ((tags.object | tags.data) & ID_RECALC_GEOMETRY) || (entry.owned && tags.data & ID_RECALC_SYNC_TO_EVAL);
        if (entry.type === 'MESH' && drawEditMode(entry)) continue;
        if (changed && entry.type === 'MESH') keepMesh(entry, blender);
        else if (changed && entry.type !== 'ARMATURE') drawData(entry);
      }
      const { nodes: added, revived } = adopt();
      world.objects.push(...added);
      // Once every object Main holds is drawn: a parent an undo step brought back is one.
      for (const [, entry] of kept) pullRelations(entry);
      for (const node of [...added, ...revived]) {
        const base = blender.base(objects.get(node).ob);
        if (base?.selected) (base.active ? active : chosen).push(node);
      }
      selection.replace([...chosen, ...active]);
      pullShading();
      for (const record of state.sceneRecords()) pull(record, world);
      state.evaluate();
      for (const entry of objects.values()) if (entry.type === 'ARMATURE') pullArmature(entry);
    } finally {
      state.applying = false;
    }
    // Last, as the collections' subscribers (the Outliner) draw from Main as soon as they change.
    if (world.collections) state.readCollections();
    world.modifiers?.refresh();
  }

  // What the depsgraph updated, drawn (docs/model.md): every updated object's and its data's values (a light's, a
  // camera's, an armature's pose), materials' and worlds' values and node trees, the scene's settings; an object's
  // evaluated world matrix (a light's and camera's where Babylon reads them), and the evaluated mesh of a mesh object
  // whose Mesh Main holds or of a curve or text, with its modifiers' errors (outside Edit Mode, which draws the edit
  // data). An object not drawn yet is drawn whole.
  // `scene`: whether the scene's values are drawn, by default when it was tagged (always for a new frame; not before the
  // page's are in Main).
  function drawEvaluated({ scene } = {}) {
    const updates = new Map(blender.updates().map(({ id, recalc }) => [id, recalc]));
    const was = state.applying;
    state.applying = true;
    try {
      // The updated IDs the view draws; any other is a node tree of a material or world.
      const drawn = new Set();
      for (const entry of objects.values()) {
        const object = updates.get(entry.ob), data = entry.data.ptr ? updates.get(entry.data.ptr) : undefined;
        if (object !== undefined || data !== undefined) {
          drawn.add(entry.ob).add(entry.data.ptr);
          if (entry.type === 'LIGHT') retype(entry);
          pull(entry, entry.node);
          if (entry.data.ptr && entry.data.struct) pull(entry.data, entry.node);
          if (entry.type === 'ARMATURE') pullArmature(entry);
        }
        const recalc = entry.drawn ? object : ID_RECALC_ALL;
        if (!recalc || !DRAWN.includes(entry.type)) continue;
        entry.drawn = true;
        const matrix = babylonMatrix(blender.transform(entry.ob).matrix_world);
        if (entry.node.freezeWorldMatrix) entry.node.freezeWorldMatrix(matrix);
        else setEvaluatedMatrix(entry.node, matrix);
        if (recalc & ID_RECALC_GEOMETRY && drawsGeometry(entry)) drawGeometry(entry);
      }
      const shading = [...materials.values()].map((record) => record.ma).concat([...worlds.values()].map((record) => record.wo));
      const nodeTrees = [...updates.keys()].some((id) => !drawn.has(id) && id !== blender.scene && !shading.includes(id));
      for (const [material, record] of materials) if (nodeTrees || updates.has(record.ma)) drawShading(record, material, 'Material');
      for (const [id, record] of worlds) if (world.worlds.byId(id) && (nodeTrees || updates.has(record.wo))) drawShading(record, world.worlds.byId(id), 'World');
      if (scene ?? updates.has(blender.scene)) for (const record of state.sceneRecords()) pull(record, world);
      if (updates.size) drawInstances();
    } finally {
      state.applying = was;
    }
  }
  // The instances objects make (a collection instance, instancing on vertices or faces), drawn as Blender's draw engines
  // draw them: for each instancer and object it instances, the object's evaluated geometry and materials as thin
  // instances at their world matrices, on a mesh of the view's own.
  const instanced = new Map();
  function drawInstances() {
    const groups = Map.groupBy(blender.instances(), ({ instancer, ob }) => `${instancer}:${ob}`), byOb = new Map([...objects.values()].map((e) => [e.ob, e.node]));
    for (const [key, carrier] of instanced) if (!groups.has(key)) { carrier.dispose(); instanced.delete(key); }
    for (const [key, list] of groups) {
      const source = byOb.get(list[0].ob);
      if (!source?.geometry) continue;
      let carrier = instanced.get(key);
      if (!carrier) {
        carrier = new Mesh('__instances ' + key, source.getScene());
        carrier.isPickable = false;
        carrier.alwaysSelectAsActiveMesh = true;
        instanced.set(key, carrier);
      }
      source.geometry.applyToMesh(carrier);
      carrier.material = source.material;
      const buffer = new Float32Array(list.length * 16);
      list.forEach(({ matrix_world }, i) => babylonMatrix(matrix_world).copyToArray(buffer, i * 16));
      carrier.thinInstanceSetBuffer('matrix', buffer, 16, false);
    }
  }
  // A light whose type Blender changed (its Properties' Type) is drawn by a Babylon light of the new type, which takes the
  // old one's place: its name, ids, parent, children and selection.
  function retype(entry) {
    const type = dnaGet('Light', entry.data.ptr, 'type'), old = entry.node;
    if (entry.data.struct === LIGHT_STRUCTS[type]) return;
    const node = MAKERS.LIGHT(old.getScene(), old.name, entry.ob, blender);
    const { wbLight, wbHome, ...metadata } = old.metadata ?? {};
    node.metadata = { ...node.metadata, ...metadata };
    node.parent = old.parent;
    for (const child of old.getChildren(undefined, true)) child.parent = node;
    world.objects.splice(world.objects.indexOf(old), 1, node);
    objects.delete(old);
    objects.set(node, Object.assign(entry, { node, drawn: false }));
    entry.data = { struct: rna.pointer('Object', node).data?.[INFO].struct ?? null, ptr: entry.data.ptr, shadow: new Map() };
    if (selection.has(old)) selection.replace(selection.nodes.map((n) => (n === old ? node : n)));
    entry.unwatch();
    entry.unwatch = () => {};
    old.dispose();
  }
  // Main's evaluated geometry is drawn for a mesh whose Mesh it holds, a curve or text, in Edit Mode too, and the types
  // drawn only as evaluated.
  const drawsGeometry = ({ type, owned }) => (type === 'MESH' ? owned : CURVE_TYPES.includes(type) || EVALUATED.includes(type));
  function drawGeometry({ node, ob }) {
    const mesh = blender.evaluatedMesh(ob);
    if (!mesh) return;
    const errors = blender.modifiers(ob).map(({ error }) => error);
    if (world.modifiers) world.modifiers.draw(node, mesh, errors);
    else mesh_batch_cache_apply(mesh, node);
  }

  // Materials and worlds as Main holds them: their values and their node trees' inputs, Babylon's derived from them.
  function pullShading() {
    for (const [material, record] of materials) drawShading(record, material, 'Material');
    for (const [id, record] of worlds) if (world.worlds.byId(id)) drawShading(record, world.worlds.byId(id), 'World');
  }
  return {
    pull, view, adopt, adoptScene, drawData, drawShading, drawEvaluated,
    keepMesh: (entry) => { keepMesh(entry, blender); return true; },
  };
}

// A Material's Principled BSDF in Main as PBRMaterial properties, null without one.
export function mainPBR(blender, ma) {
  const principled = blender.nodeTree(ma).nodes.find((node) => node.idname === 'ShaderNodeBsdfPrincipled');
  return principled && principledPBR(principled.inputs, { use_backface_culling: dnaGet('Material', ma, 'use_backface_culling') });
}
