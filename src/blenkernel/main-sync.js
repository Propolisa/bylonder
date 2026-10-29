// Bylonder's scene and Blender's Main, kept equal both ways (docs/blender-boundary.md, "Who owns what"). The Babylon
// scene is the truth and renders; Main is a second model of the same scene, so Blender's code (operators, editors,
// the .blend writer) works on real data whenever it runs.
// - One mapping: the RNA bindings marked `sync` (makesrna/rna-bylonder.js), read and written in Main at the DNA field
//   Blender's RNA names (makesrna/dna-struct.js). What is not a value (names, parents, object data, materials,
//   collections, modifiers, bases) is written here, under the same RNA names (an object's in RELATIONS).
// - Babylon to Main: hooks on Babylon's setters and observables mark an object changed (hooks.js); flush() writes
//   what differs from what was last synced, at the end of the task and before any of Blender's code runs.
// - Main to Babylon: after Blender's code ran (run()), what it changed is written back through the same mapping:
//   geometry by its recalc tag (ID_RECALC_GEOMETRY), values that differ from what was last synced (which also catches
//   the writes Blender's buttons make without tagging). Writing back does not echo into Main.
// - Geometry has one owner, the Babylon scene: Main's Meshes hold none at rest. Code that needs it gets it filled for
//   its run (`meshes`), and only what the code changed comes back. In Edit Mode the module's edit mesh owns it.
// - check() compares the overlap of both models; with `debug` on it runs after every flush and run.
import { createBlenderIDs } from './blender-ids.js';
import { dnaGet, dnaSet, dnaProperty, dnaIsText } from '../makesrna/dna-struct.js';
import { syncBindings } from '../makesrna/rna-bylonder.js';
import { INFO } from '../makesrna/rna.js';
import { createLight } from './light/light-home.js';
import { createWorld } from './scene/world.js';
import { modifierStack } from '../modifiers/stack.js';
import { moduleModifiers, blenderModifierDefinitions, asBlenderModifier } from '../modifiers/blender.js';
import { mesh_serialize } from './mesh/mesh.js';
import { objectMesh } from '../editors/object/object-mesh.js';
import { rebuildMesh } from '../editors/object/mesh-catalog.js';
import { nodeId, deleted } from '../editors/object/identity.js';
import { watchObject } from './main-sync-hooks.js';
import { CurveObject } from './curve/curve.js';
import { viewTransforms, looks } from './scene/render-babylon.js';
import { buildMesh } from '../editors/object/mesh-catalog.js';
import { blenderTransform } from '../editors/curve/curve-objects.js';
import { evaluateCurve } from './curve/curve.js';
import { mesh_batch_cache_apply } from '../draw/mesh-batch-cache.js';
import { asObject } from '../runtime/object-transform.js';
import { addModifier } from '../modifiers/stack.js';
import { BlenderAnimation } from './animation/anim-blender.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { Color3, FreeCamera, Material, Mesh, MultiMaterial, PBRMaterial, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { mainTexture, readTexture, writeTexture } from './texture/texture.js';

// ID codes (MAKE_ID2) and recalc tags (DNA_ID.h).
const ID_OB = 0x424f, ID_GR = 0x5247, ID_MA = 0x414d;
const ID_RECALC_GEOMETRY = 1 << 1;
const CURVE_TYPES = ['CURVE', 'FONT'];
const V3D_AROUND = { BOUNDING_BOX_CENTER: 0, CURSOR: 1, INDIVIDUAL_ORIGINS: 2, MEDIAN_POINT: 3, ACTIVE_ELEMENT: 4 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (matrix) => matrix.every((v, i) => v === IDENTITY[i]);
const FLAGS = { hideSelect: 'hide_select', hideViewport: 'hide_viewport', hideRender: 'hide_render' };
// Custom properties in Main for what only Babylon has: an object's identity in Bylonder, a material's kind and graph.
export const PROPERTIES = { id: 'bylonder_id', material: 'bylonder_material', graph: 'bylonder_node_material' };
const LAYER_FLAGS = { exclude: 'exclude', hideViewport: 'hide_viewport' };
// eRotationModes, and ModifierMode's viewport and render bits.
const ROTATION_MODES = { QUATERNION: 0, XYZ: 1, XZY: 2, YXZ: 3, YZX: 4, ZXY: 5, ZYX: 6, AXIS_ANGLE: -1 };
const MODIFIER_REALTIME = 1, MODIFIER_RENDER = 2;
// The Babylon objects a read Object becomes, by its type and its data's; a light of a type Babylon has no light for
// becomes the nearest, with a warning.
const MAKERS = {
  EMPTY: (scene, name) => new TransformNode(name, scene),
  CAMERA: (scene, name) => asObject(new FreeCamera(name, Vector3.Zero(), scene)),
  // A light Blender's code made is Blender's (docs/blender-boundary.md point 4a); pull fills its settings from Main.
  LIGHT: (scene, name, type) => createLight(name, type, {}, scene),
};

// A value as both models compare it: arrays plain, Main's floats being 32-bit.
const plain = (value) => (value && typeof value === 'object' ? Array.from(value) : value);
const close = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
export const same = (a, b) => (Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]))
  : typeof a === 'number' && typeof b === 'number' ? close(a, b) : a === b);
// Whether `main` holds every value `babylon` has (nested records, Main's floats being 32-bit).
const holdsAll = (main, babylon) => (babylon && typeof babylon === 'object' && !Array.isArray(babylon)
  ? !!main && typeof main === 'object' && Object.keys(babylon).every((key) => holdsAll(main[key], babylon[key]))
  : Array.isArray(babylon) ? Array.isArray(main) && main.length === babylon.length && babylon.every((v, i) => holdsAll(main[i], v)) : same(plain(babylon), plain(main)));
// A name as Blender keeps it, unique among its IDs: "Cube" may be "Cube.001".
const sameName = (babylon, main) => main === babylon || main.replace(/\.\d{3}$/, '') === babylon.slice(0, 63);
// A value DNA can hold: an enum's identifier must be one of its items.
const holds = (field, value) => field.type !== 'ENUM' || typeof value !== 'string' || dnaIsText(field) || field.items?.some(([, id]) => id === value);

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
  const SCENE_STRUCTS = { RenderSettings: 'render', UnitSettings: 'unit_settings', ColorManagedViewSettings: 'view_settings', ColorManagedDisplaySettings: 'display_settings' };
  const sceneStruct = (name) => ({ struct: name, ptr: blender.scene + dnaProperty('Scene', SCENE_STRUCTS[name]).offset, shadow: new Map() });
  const render = sceneStruct('RenderSettings'), units = sceneStruct('UnitSettings');
  const view = sceneStruct('ColorManagedViewSettings'), display = sceneStruct('ColorManagedDisplaySettings');
  const tools = { struct: 'ToolSettings', ptr: dnaGet('Scene', blender.scene, 'tool_settings'), shadow: new Map() };
  // The scene's records, over the world: the scene, its render, unit and tool settings, those whose slices it has.
  const sceneRecords = () => [scene, ...(world.renderSettings ? [render, view] : []), ...(world.sceneSettings ? [units] : []), tools, display];
  // The scene's view transform and look as Blender names them (Bylonder's are Babylon's tone maps).
  const viewNames = () => {
    const settings = rna.pointer('Scene', world).view_settings;
    return { view_transform: viewTransforms[settings.view_transform]?.ocioView ?? 'Standard', look: looks[settings.look]?.[0] ?? 'None' };
  };
  let applying = false, scheduled = false, sceneChanged = true, listed = -1;
  // The objects hooks saw change since the last flush.
  const dirty = new Set();
  const filled = new Set();
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
      apply: (node, parent) => node.setParent(nodeOf(parent)),
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
  function pullRelations(entry) {
    for (const [, relation] of relations(entry)) {
      const value = relation.main(entry.ob);
      if (relation.apply && !exact(value, relation.babylon(entry.node))) relation.apply(entry.node, value);
    }
  }

  // Main into Babylon for what Main holds and the sync does not (a read file's IDs, or objects Blender's code added):
  // each made in Babylon of its kind and given Main's values through the mapping (pull, with nothing synced yet), its
  // relations (RELATIONS), modifiers and animation. Geometry goes to Babylon once and Main's Mesh is released.
  // Returns what Bylonder cannot show, as warnings, which Blender's Info shows.
  const fcurvePaths = (id) => animationData.fcurves(id).map((fcurve) => fcurve.rna_path);
  function adopt(scene = world.scene) {
    const warnings = [], was = applying;
    applying = true;
    try {
      for (const ma of blender.ids(ID_MA)) if (!materialFor(ma)) adoptMaterial(ma, scene, warnings);
      const made = [];
      for (const ob of blender.ids(ID_OB)) {
        if (nodeOf(ob)) continue;
        const type = dnaGet('Object', ob, 'type'), name = blender.name(ob), data = blender.data(ob);
        const lightType = type === 'LIGHT' ? dnaGet('Light', data, 'type') : null;
        if (!MAKERS[type] && type !== 'MESH' && !CURVE_TYPES.includes(type)) { warnings.push(`"${name}": ${type.toLowerCase()} objects are not opened`); continue; }
        if (lightType === 'AREA') warnings.push(`"${name}": an Area light opens as a point light`);
        const node = type === 'MESH' ? adoptMesh(scene, name, ob) : CURVE_TYPES.includes(type) ? adoptCurve(scene, name, ob, type) : MAKERS[type](scene, name, lightType);
        node.metadata = { ...node.metadata, editable: true, wbId: blender.property(ob, PROPERTIES.id) ?? name };
        made.push(adoptEntry(node, ob, type));
      }
      for (const entry of made) pullRelations(entry);
      for (const entry of made) {
        const { node, ob } = entry, wanted = rna.pointer('Object', node).rotation_mode;
        if (!isIdentity(blender.transform(ob).matrix_parent_inverse)) blender.foldParentInverse(ob);
        if (dnaGet('Object', ob, 'rotation_mode') !== wanted) {
          if (fcurvePaths(ob).includes('rotation_euler')) warnings.push(`"${node.name}": its rotation keys are in another rotation order than Bylonder's`);
          blender.setRotationMode(ob, ROTATION_MODES[wanted]);
        }
        pull(entry, node);
        if (entry.data.ptr && entry.data.struct) pull(entry.data, node);
        if (entry.type === 'MESH') adoptModifiers(entry, warnings);
        else if (blender.modifiers(ob).length) warnings.push(`"${node.name}": the modifiers of curve and text objects are not opened`);
        if (CURVE_TYPES.includes(entry.type)) drawCurve(node);
        if (blender.materials(ob).length > 1) warnings.push(`"${node.name}": its faces show its first material`);
        for (const path of new Set(fcurvePaths(ob))) if (!['location', 'rotation_euler', 'scale'].includes(path)) warnings.push(`"${node.name}": its ${path} keys are not opened`);
        if (blender.camera === ob) scene.activeCamera = node;
      }
      const wo = blender.world;
      if (wo && !ids.adopted.has('world')) adoptWorld(wo, scene, warnings);
      return { nodes: made.map(({ node }) => node), warnings };
    } finally {
      applying = was;
    }
  }
  // An object's entry, as syncObjects makes one, for an Object Main already holds.
  function adoptEntry(node, ob, type) {
    const entry = { struct: 'Object', ptr: ob, node, key: key(node), type, ob, shadow: new Map(), babylonName: node.name, name: blender.name(ob) };
    entry.data = { struct: dataStruct(node), ptr: blender.data(ob), shadow: new Map() };
    // The data's type is the Babylon object's own (a light's class).
    if (entry.data.struct === 'Light') entry.data.shadow.set('type', dnaGet('Light', entry.data.ptr, 'type'));
    ids.adopt(entry.key, ob, type);
    entry.unwatch = () => {};
    objects.set(node, entry);
    return entry;
  }
  // A read Mesh's geometry goes to Babylon, which owns it from then on.
  function adoptMesh(scene, name, ob) {
    blender.readAttributes(ob);
    const creation = { mesh: mesh_serialize(blender.mesh(ob)) }, node = buildMesh(scene, name, creation);
    node.metadata = { ...node.metadata, wbCreation: creation };
    blender.clearMesh(ob);
    return node;
  }
  // A read curve or text object: its Curve data held by its Babylon object too, as Bylonder's curves are.
  function adoptCurve(scene, name, ob, type) {
    const node = new Mesh(name, scene);
    node.metadata = { wbCreation: { curve: new CurveObject(type, name, ob, blender).data } };
    return node;
  }
  const drawCurve = (node) => {
    const data = node.metadata.wbCreation.curve;
    const mesh = evaluateCurve(data, { transform: blenderTransform(node), modifiers: data.modifiers ?? [], targets: {} });
    if (mesh) mesh_batch_cache_apply(mesh, node);
  };
  // A read object's modifiers, as Bylonder's stack holds Blender's; the types Bylonder does not have are left out.
  function adoptModifiers(entry, warnings) {
    const view = () => new DataView(blenderModule.exports.memory.buffer);
    for (const { type, name, mode, md } of blender.modifiers(entry.ob)) {
      const definition = blenderModifierDefinitions.find((d) => d.mesh.type === type);
      if (!definition) { warnings.push(`"${entry.node.name}": its modifier "${name}" is not opened`); continue; }
      const modifier = addModifier(entry.node, definition.id, definition.mesh.read(view(), md));
      Object.assign(modifier, { name, showViewport: !!(mode & MODIFIER_REALTIME), showRender: !!(mode & MODIFIER_RENDER) });
    }
  }
  // A read Material: Bylonder's kind of it (its custom properties tell a Standard or Node material, which a file
  // Bylonder wrote keeps), its values and its Principled BSDF inputs.
  function adoptMaterial(ma, scene, warnings) {
    const name = blender.name(ma), kind = blender.property(ma, PROPERTIES.material), graph = blender.property(ma, PROPERTIES.graph);
    const material = graph ? Material.Parse(JSON.parse(graph), scene, '') : kind === 'standard' ? new StandardMaterial(name, scene)
      : Object.assign(new PBRMaterial(name, scene), { metallic: 0, roughness: 0.5, albedoColor: new Color3(0.8, 0.8, 0.8) });
    material.name = name;
    material.metadata = { ...material.metadata, wbId: name };
    const record = { struct: 'Material', ma, ptr: ma, shadow: new Map(), kept: true };
    materials.set(material, record);
    ids.adopted.set(material, ma);
    pull(record, material);
    if (!graph) pullTree(ma, rna.pointer('Material', material), name, warnings);
  }
  // A read World: the scene's world as Blender's, which Bylonder's authored world reads.
  function adoptWorld(wo, scene, warnings) {
    const background = blender.nodeTree(wo).nodes.find((node) => node.idname === 'ShaderNodeBackground');
    const color = background?.inputs.Color ?? dnaGet('World', wo, 'color');
    createWorld(scene, color && { color: [...color].slice(0, 3) });
    if (background && background.inputs.Strength !== 1) warnings.push(`World "${blender.name(wo)}": its strength opens as 1`);
    ids.adopted.set('world', wo);
  }
  // An ID's node tree inputs that Bylonder's RNA of it binds, from Main's nodes of the same types.
  function pullTree(id, data, label, warnings) {
    const held = blender.nodeTree(id).nodes, mapped = new Set(['ShaderNodeOutputMaterial', 'ShaderNodeOutputWorld']);
    const visit = (node) => {
      mapped.add(node[INFO].struct);
      const from = held.find((h) => h.idname === node[INFO].struct);
      for (const input of node.inputs) {
        if (input.is_linked) { visit(input.links[0].from_node); continue; }
        const value = from?.inputs[input.identifier];
        if (value !== undefined && input[INFO].bound.has('default_value')) input.default_value = value;
      }
    };
    visit(data.node_tree.get_output_node());
    const unmapped = [...new Set(held.map((h) => h.idname).filter((idname) => !mapped.has(idname)))];
    if (unmapped.length) warnings.push(`Material "${label}": its ${unmapped.join(', ')} nodes are not opened`);
  }
  // A read file's scene, once the slices it sets exist: its settings, world and collections.
  function adoptScene() {
    applying = true;
    try {
      // Twice: a value the slice refuses before another is set (a frame range's start after its old end) is set after.
      for (const record of [...sceneRecords(), ...sceneRecords()]) {
        record.shadow.clear();
        try { pull(record, world); } catch { /* set on the second pass */ }
      }
      readCollections((pointer) => 'collection:' + blender.name(pointer));
    } finally {
      applying = false;
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
  // A record's values that Blender's code changed in Main, written to Babylon.
  function pull(record, owner) {
    let changed = false;
    for (const [name, binding] of syncBindings(rna, record.struct, owner)) {
      const field = dnaProperty(record.struct, name);
      if (!field || field.kind === 'pointer' || field.kind === 'struct' || record.unheld?.has(name)) continue;
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
      dirty.delete(entry);
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
      dirty.add(entry);
      objects.set(node, entry);
    }
  }
  // A hook saw an object change (or, without one, something no hook sees): it goes to Main at the end of the task.
  function changed(entry) {
    if (applying) return;
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
    if (node.name !== entry.babylonName) {
      blender.rename(ob, node.name);
      [entry.babylonName, entry.name] = [node.name, blender.name(ob)];
    }
    pushRelations(entry);
    blender.setMode(ob, data.mode);
    if (entry.id !== nodeId(node)) blender.setProperty(ob, PROPERTIES.id, (entry.id = nodeId(node)));
    push(entry, node);
    if (entry.data.ptr && entry.data.struct) push(entry.data, node);
    pushModifiers(entry);
    pushCurve(entry);
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
    const signature = JSON.stringify(stack.map(({ type, values, showViewport, showRender }) => [type, values, showViewport, showRender, textures.get(values.texture)?.tex]));
    if (signature === entry.modifiers) return;
    entry.modifiers = signature;
    // A textured modifier points at Main's Tex of its texture (blenkernel/texture/textures.js).
    blender.setModifiers(entry.ob, moduleModifiers(stack, (m) => textures.get(m.values.texture)?.tex ?? 0));
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
      if (!materials.has(material)) materials.set(material, { struct: 'Material', ma: ids.adopted.get(material) ?? blender.addMaterial(material.name), shadow: new Map() });
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
      if (!textures.has(entry.id)) textures.set(entry.id, { tex: mainTexture(blender.bmain, entry.name, entry.values), values: entry.values });
      const record = textures.get(entry.id);
      if (record.babylonName !== entry.name) { blender.rename(record.tex, entry.name); record.babylonName = entry.name; }
      blender.setFakeUser(record.tex, entry.fakeUser);
      if (record.values !== entry.values) { writeTexture(record.tex, entry.values); record.values = entry.values; }
    }
  }
  // What Blender's code changed of a Tex goes back to its record.
  function pullTextures() {
    for (const [id, record] of textures) {
      const entry = world.textures.byId(id), values = readTexture(record.tex);
      if (entry && !Object.entries(values).every(([name, value]) => same(value, entry.values[name]))) world.textures.assign(entry, values);
      if (entry) record.values = entry.values;
    }
  }
  function pushWorlds() {
    const all = world.worlds?.all() ?? [], kept = new Set(all.map((entry) => entry.id));
    for (const [id, record] of worlds) if (!kept.has(id)) { blender.removeID(record.wo); worlds.delete(id); }
    for (const entry of all) {
      if (!worlds.has(entry.id)) worlds.set(entry.id, { struct: 'World', wo: ids.adopted.get(entry.id) ?? blender.addWorld(entry.name), shadow: new Map() });
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
    if (applying) return;
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

  // Fills meshes' geometry, the one large buffer Main holds only while Blender's code needs it, from Babylon's (the
  // edit mesh's in Edit Mode), and releases it after.
  const curveObject = (entry) => new CurveObject(entry.type, entry.node.name, entry.ob, blender);
  function fill(nodes) {
    for (const node of nodes) {
      const entry = objects.get(node);
      if (!entry || filled.has(entry) || entry.type !== 'MESH') continue;
      blender.setMesh(entry.ob, world.editMode?.meshOf?.(node) ?? objectMesh(node));
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
      blender.cleanMasterCollection();
      for (const [node, entry] of [...objects]) {
        if (!alive.has(entry.ob)) {
          node.metadata = { ...node.metadata, wbDeleted: true };
          node.setEnabled(false);
          objects.delete(node);
          dirty.delete(entry);
          filled.delete(entry);
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
        pullRelations(entry);
        const base = blender.base(ob), data = rna.pointer('Object', node);
        if (base?.selected) (base.active ? active : chosen).push(node);
        if (base && data.hide_get() !== base.hidden) node.setEnabled(!base.hidden);
        if ((tags.object | tags.data) & ID_RECALC_GEOMETRY) {
          if (filled.has(entry)) rebuildMesh(node, { mesh: mesh_serialize(blender.mesh(ob)) });
          else if (CURVE_TYPES.includes(entry.type) && world.curves) {
            world.curves.set(node, curveObject(entry).data);
            entry.curve = JSON.stringify(world.curves.data(node));
          }
        }
      }
      const { nodes: added } = adopt();
      world.objects.push(...added);
      selection.replace([...chosen, ...active]);
      for (const [material, record] of materials) pull(record, material);
      for (const [id, record] of worlds) { const entry = world.worlds.byId(id); if (entry) pull(record, entry); }
      pullTextures();
      for (const record of sceneRecords()) pull(record, world);
      blender.evaluate();
    } finally {
      applying = false;
    }
    // Last, as the collections' subscribers (the Outliner) draw from Main as soon as they change.
    if (slice()) readCollections();
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
      for (const [name, relation] of relations(entry)) if (!exact(relation.babylon(node), relation.main(entry.ob))) diffs.push(`${label}.${name} differs`);
      const base = blender.base(entry.ob);
      if (base && base.selected !== selection.has(node)) diffs.push(`${label}: selected ${selection.has(node)}, Main ${base.selected}`);
      if (base && base.active !== (node === active) && base.selected) diffs.push(`${label}: active differs`);
      if (CURVE_TYPES.includes(entry.type) && world.curves && !holdsAll(curveObject(entry).data, world.curves.data(node))) diffs.push(`${label}: curve data differs`);
      if (filled.has(entry)) {
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
    // For editors that run Blender's code over several events (the Outliner's modal operators and drags): what it
    // changed, written back.
    writeBack: () => { writeBack(); flush(); if (api.debug) assertEqual('writeBack'); },
    geometryTagged,
    revert,
    check,
    evaluatedMesh,
    // For code that reads Main's geometry: fn runs with every object's geometry filled.
    withMeshes(fn, nodes) {
      flush();
      fill(nodes ?? [...objects.keys()]);
      try { return fn(); } finally { release(); }
    },
    // The scene as a .blend file (its bytes), written by Blender's writer from Main, with the geometry filled as it
    // writes.
    writeBlend: (filepath) => api.withMeshes(() => blender.writeBlend(filepath)),
    // A .blend's data read into Main and made Babylon's in `scene` (adopt); returns the Babylon objects it made and
    // Blender's and Bylonder's warnings. Its scene settings and collections follow when the scene sync of the world
    // starts (ids.read).
    readBlend(bytes, scene = world.scene) {
      const read = blender.readBlend(bytes), { nodes, warnings } = adopt(scene);
      if (world.collections) adoptScene();
      else ids.read = true;
      return { nodes, warnings: [...read, ...warnings] };
    },
    adopt,
    // Whether Blender's code may change an object's data: its geometry is filled for it (lights and cameras are
    // Bylonder's objects of their own kind).
    holdsData: (node) => ['MESH', 'EMPTY', ...CURVE_TYPES].includes(objects.get(node)?.type),
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
  if (ids.read && world.collections) {
    adoptScene();
    ids.read = false;
  }
  return api;
}
