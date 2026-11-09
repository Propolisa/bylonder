// The view (docs/model.md): Babylon's scene drawn from Blender's state in Main, one way. After Blender's code ran or
// an undo step loaded, every object's values come from Main through the RNA mapping (rna-bylonder.js `sync`
// bindings at their DNA fields), its relations and base, the geometry Blender tagged, a curve's Curve data and an
// armature's bones; Main's objects without a Babylon object get one, linked by id (`bylonder_id`), and objects Main
// no longer holds are deleted. Materials, worlds, scene settings and collections are read the same way.
import { dnaGet, dnaProperty } from '../makesrna/dna-struct.js';
import { syncBindings, LIGHT_STRUCTS } from '../makesrna/rna-bylonder.js';
import { INFO } from '../makesrna/rna.js';
import { BLENDER, createLight, deriveBabylonLight, isBlenderLight, lightRecord } from './light/light-home.js';
import { createWorld } from './scene/world.js';
import { createMesh, mesh_serialize } from './mesh/mesh.js';
import { nodeId, deleted, setHidden } from '../editors/object/identity.js';
import { meshHidden } from './scene/mesh-hiding.js';
import { CurveObject } from './curve/curve.js';
import { mesh_batch_cache_apply } from '../draw/mesh-batch-cache.js';
import { asObject, setEvaluatedMatrix } from '../runtime/object-transform.js';
import { ID_RECALC_GEOMETRY, ID_RECALC_SHADING, ID_RECALC_SYNC_TO_EVAL, ID_RECALC_ALL } from '../bmesh/bmesh-wasm.js';
import { Camera, Color3, FreeCamera, Material, Matrix, Mesh, MultiMaterial, PBRMaterial, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { particleShapeMesh, particleShapeMaterial, hairOverlay, particleEditOverlay } from '../draw/overlay-particle.js';
import { drawPointClouds } from '../draw/pointcloud.js';
import { paintWeightOverlay } from '../draw/overlay-paint-weight.js';
import { boundsLines } from '../draw/overlay-bounds.js';
import { curvesData, curvesMesh, disposeCurvesData, CurvesPlugin } from '../draw/curves.js';
import { armatureData } from './armature/armature.js';
import { armatureChanged } from '../draw/overlay-armature.js';
import { principledPBR, applyPBR } from './material/principled-gltf.js';
import { materialType } from './material/schema.js';
import { attributesWanted, nodeMaterialFromTree, nodeProperties, outputValues } from '../nodes/blender/shader-nodes.js';
import { pullEeveeParity } from '../draw/eevee-parity.js';
import { pullRenderExtensions } from '../draw/render-extension.js';
import { syncVolumeProbes } from '../draw/light-probes.js';
import { idStruct, pointerStruct, structFind } from '../python/bpy_rna.js';
import { createEditMeshOverlay } from '../draw/overlay-edit-mesh.js';
import { createGreasePencilDraw, BLENDER_LOOK } from '../draw/grease-pencil.js';
import { provideGreasePencilRender } from '../draw/grease-pencil-render.js';
import * as runtimes from '../runtimes/runtimes.js';
import { uploadImageTextures } from '../imbuf/image-textures.js';
import { ID_OB, ID_GR, ID_MA, ID_WO, babylonMatrix, blenderMatrix, drawThinInstances } from './main-evaluated.js';

export { ID_OB, ID_GR, ID_MA, ID_WO, babylonMatrix, blenderMatrix };
export const CURVE_TYPES = ['CURVE', 'FONT'];
// Types of Blender's the view draws only as the depsgraph evaluates them: as their evaluated mesh, or placed where they
// are (what they do, a lattice's deform or a speaker's sound, is Blender's; a Curves object's curves, drawCurves; a Grease
// Pencil object's drawings, drawGreasePencil).
const EVALUATED = ['SURFACE', 'META'], PLACED = ['LATTICE', 'SPEAKER', 'LIGHT_PROBE', 'CURVES', 'GREASEPENCIL'];
// The objects drawn from what the depsgraph evaluated.
const DRAWN = ['MESH', 'EMPTY', 'LIGHT', 'CAMERA', ...CURVE_TYPES, ...EVALUATED, ...PLACED];
// Custom properties in Main for what only Babylon has: an object's identity in Bylonder, a material's kind and graph.
// `bylonder_standin`: a Mesh that stands in for geometry Babylon built (a MeshBuilder's), which Babylon draws itself.
export const PROPERTIES = { id: 'bylonder_id', material: 'bylonder_material', graph: 'bylonder_node_material', standin: 'bylonder_standin' };
// eRotationModes.
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
  // A camera Blender's code made is Blender's: its lens is Main's, which frames its field of view (main-sync fitCamera).
  CAMERA: (scene, name) => Object.assign(asObject(new FreeCamera(name, Vector3.Zero(), scene)), { metadata: { wbHome: BLENDER } }),
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

//   state: the scene sync's records (main-sync.js): rna, world, selection, blender, ids, objects, materials, worlds,
//   sceneRecords(), readCollections(), relations(entry), nodeOf, forget(node, entry), and `applying`, which mutes its hooks.
const emptyMesh = () => createMesh({ vert_positions: new Float32Array(), edges: new Int32Array(), face_offsets: new Int32Array(1), corner_verts: new Int32Array(),
  corner_edges: new Int32Array() });

// One edit overlay per object, whichever sync drew it first: a file a project's code read is adopted again by the
// scene's sync.
const editOverlays = new WeakMap();
export function createMainView(state) {
  const { rna, world, selection, blender, ids, objects, materials, worlds } = state;

  // A record's values Main holds that Babylon does not yet, written to Babylon. A new rotation mode changes which
  // rotation is synced: that one is read again.
  // An enum whose items Blender makes at run time (an itemf: a unit system's lengths) is read through RNA, by them.
  const dynamicEnum = (field) => field.type === 'ENUM' && !field.items?.length;
  function pull(record, owner) {
    let changed = false;
    for (const [name, binding] of syncBindings(rna, record.struct, owner)) {
      const field = dnaProperty(record.struct, name);
      if (!field || field.kind === 'pointer' || field.kind === 'struct' || record.unheld?.has(name)) continue;
      const value = dynamicEnum(field) ? pointerStruct(structFind(record.struct), record.holder ?? record.ptr, record.ptr)[name] : dnaGet(record.struct, record.ptr, name);
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
      displayAs(node, idStruct(entry.ob).display_type);
    }
    else if (CURVE_TYPES.includes(type)) {
      // Its recipe; the depsgraph's evaluation draws it.
      node.metadata = { ...node.metadata, wbCreation: { curve: { ...curveObject(entry).data, modifiers: node.metadata?.wbCreation?.curve?.modifiers } } };
      entry.drawn = false;
    } else if (type === 'ARMATURE') pullArmature(entry, true);
  }
  // An object keeps Blender's parent inverse where the view draws it at Main's evaluated matrix (DRAWN); one Babylon
  // places by its parent alone (an armature) has it folded into its own transform, which Babylon has no place for.
  const foldUndrawn = ({ type, ob }) => !DRAWN.includes(type) && !isIdentity(blender.transform(ob).matrix_parent_inverse) && blender.foldParentInverse(ob);
  // Meshes shown as their bounds in the viewport (Display As > Bounds), an instanced one's carrier too: the edges of their
  // local bounds, at each instance, drawn while the scene is not rendering, in place of their surfaces.
  const bounded = new Map(); // mesh -> { lines, key }
  function displayBounds(mesh, on) {
    if (on) return bounded.has(mesh) || bounded.set(mesh, {});
    const entry = bounded.get(mesh);
    if (!entry) return;
    entry.lines?.dispose();
    bounded.delete(mesh);
    if (!meshHidden(mesh)) mesh.isVisible = true;
  }
  // Meshes shown as their edges in the viewport (Display As > Wire): Workbench's wire in every shading, in place of
  // their surfaces, which renders draw.
  const wired = new Set();
  function displayAs(mesh, type) {
    displayBounds(mesh, type === 'BOUNDS');
    if (type === 'WIRE') wired.add(mesh);
    else if (wired.delete(mesh)) { if (!meshHidden(mesh)) mesh.isVisible = true; world.workbench?.displayAsWire(mesh, false); }
  }
  const displayed = world.scene.onBeforeRenderObservable.add(() => {
    const rendering = !!world.collections?.rendering;
    // The workbench may come after Main's objects (main.js makes it once the world is built).
    for (const mesh of wired) if (mesh.isDisposed()) wired.delete(mesh); else if (!meshHidden(mesh)) { mesh.isVisible = rendering; world.workbench?.displayAsWire(mesh, true); }
    for (const [mesh, entry] of bounded) {
      if (mesh.isDisposed()) { displayBounds(mesh, false); continue; }
      const instanced = mesh.hasThinInstances, box = (instanced ? mesh.rawBoundingInfo : mesh.getBoundingInfo())?.boundingBox;
      if (!box) continue;
      const key = [box.minimum, box.maximum].map((v) => v.asArray().join()).join() + (mesh.metadata?.instancesVersion ?? '');
      if (key !== entry.key) {
        entry.key = key;
        entry.lines = boundsLines(world.scene, '__bounds ' + mesh.name, box, instanced ? mesh.thinInstanceGetWorldMatrices() : undefined, entry.lines);
        if (!instanced) entry.lines.parent = mesh;
      }
      if (meshHidden(mesh)) { entry.lines.isVisible = false; continue; }
      mesh.isVisible = rendering;
      entry.lines.isVisible = !rendering;
    }
  });
  // What Blender's code changed of an armature (bones, pose, its mode), after Main is evaluated; its overlay draws
  // what Main evaluated anew.
  function pullArmature(entry, always = false) {
    const { node, ob } = entry, data = armatureData(ob), signature = JSON.stringify(data), mode = dnaGet('Object', ob, 'mode');
    armatureChanged(node);
    if (!always && signature === entry.armature && mode === node.metadata.wbMode) return;
    entry.armature = signature;
    node.metadata = { ...node.metadata, wbCreation: { armature: data }, wbMode: mode };
  }

  // A mesh object in Blender's Edit Mode in Main: its edit mesh drawn as the edit overlay over its evaluated mesh (which
  // the depsgraph evaluates from the edit mesh, its modifiers shown in Edit Mode included), its mode Main's; leaving it,
  // the Mesh Blender wrote is kept. Returns whether it is in Edit Mode.
  function drawEditMode(entry) {
    const edit = blender.editMesh(entry.ob), { node } = entry;
    if (!edit && !entry.overlay) return false;
    node.metadata = { ...node.metadata, wbMode: blender.mode(entry.ob) };
    if (!edit) {
      entry.overlay.dispose();
      editOverlays.delete(node);
      entry.overlay = null;
      keepMesh(entry, blender);
      entry.drawn = false;
      return false;
    }
    entry.overlay ??= editOverlays.get(node) ?? createEditMeshOverlay(node);
    editOverlays.set(node, entry.overlay);
    entry.overlay.update(edit.mesh, { selectmode: edit.selectmode });
    return true;
  }

  // What the extras overlay draws an object by (overlay-extra.js): an empty's Display As and Size, a camera's Display Size,
  // a lattice's points (its deformed coordinates, Blender's BPoint vec) and dimensions.
  const EXTRA_DISPLAY = {
    EMPTY: (ob) => { const { empty_display_type, empty_display_size } = idStruct(ob); return { empty_display_type, empty_display_size }; },
    CAMERA: (ob) => ({ display_size: idStruct(ob).data.display_size }),
    LATTICE: (ob) => {
      const { points_u, points_v, points_w, use_outside, points } = idStruct(ob).data;
      return { lattice: { dims: [points_u, points_v, points_w], outside: use_outside, points: [...points].flatMap((point) => [...point.co_deform]) } };
    },
  };
  function extraDisplay({ node, ob, type }) {
    const values = EXTRA_DISPLAY[type]?.(ob);
    if (!values || Object.entries(values).every(([key, value]) => JSON.stringify(node.metadata?.[key]) === JSON.stringify(value))) return;
    node.metadata = { ...node.metadata, ...values };
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

  // The library a linked ID is read from, or undefined: a linked ID may have a local one's name.
  const library = (id) => idStruct(id).library?.filepath;

  // Main's objects that have no Babylon object: the one their id names (the project's code built it, or Bylonder deleted
  // it and an undo brought it back), else a new one of their type. Returns the new objects, the revived ones and what Bylonder cannot show.
  function adopt(scene = world.scene) {
    const warnings = [], made = [], revived = [], was = state.applying;
    state.applying = true;
    try {
      // A Grease Pencil material is drawn with its strokes (grease-pencil-api.cc), not as a Babylon material.
      for (const ma of blender.ids(ID_MA)) if (!materialFor(ma) && !idStruct(ma).is_grease_pencil) adoptMaterial(ma, scene, warnings);
      for (const ob of blender.ids(ID_OB)) {
        if (state.nodeOf(ob)) continue;
        const type = dnaGet('Object', ob, 'type'), name = blender.name(ob), id = blender.property(ob, PROPERTIES.id) ?? name;
        if (!MAKERS[type]) { warnings.push(`"${name}": ${type.toLowerCase()} objects are not opened`); continue; }
        const kept = world.objects.find((node) => !objects.has(node) && nodeId(node) === id);
        if (kept) {
          kept.metadata = { ...kept.metadata, wbDeleted: false };
          setHidden(kept, !!blender.base(ob)?.hidden);
          revived.push(link(kept, ob, type));
          continue;
        }
        const node = MAKERS[type](scene, name, ob, blender);
        // One outside the view layer (a linked collection's, instanced by an empty) is drawn only by what instances it.
        if (!blender.base(ob)) node.setEnabled(false);
        // A copy Blender's code made (object.duplicate) carries its original's id: it gets one of its own.
        const taken = world.objects.some((other) => !deleted(other) && nodeId(other) === id) || [...objects.keys()].some((other) => nodeId(other) === id);
        // Its mode is Main's: a file read enters the modes objects were saved in (ED_editors_init).
        node.metadata = { ...node.metadata, editable: true, wbId: taken ? crypto.randomUUID() : id, ...(type !== 'ARMATURE' && { wbMode: blender.mode(ob) }) };
        made.push(link(node, ob, type));
      }
      for (const entry of [...made, ...revived]) {
        pullRelations(entry);
        if (entry.type === 'MESH' || CURVE_TYPES.includes(entry.type) || entry.type === 'ARMATURE') drawData(entry);
        extraDisplay(entry);
        // One read in Edit Mode draws its edit mesh too.
        if (entry.type === 'MESH') drawEditMode(entry);
      }
      for (const entry of made) {
        const { node, ob } = entry;
        // Hidden as the file keeps it (H), once its kind is known.
        if (blender.base(ob)?.hidden) setHidden(node, true);
        foldUndrawn(entry);
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
    const tree = !graph && !kind ? nodeTreeOf(ma, warnings) : null;
    const nodes = tree && !tree.nodes.every((node) => PRINCIPLED_TREE.includes(node.idname)) ? nodeMaterialFromTree(name, scene, tree) : null;
    if (nodes?.missing.length) warnings.push(`Material "${name}": its ${nodes.missing.join(', ')} nodes are not opened`);
    const material = graph ? Material.Parse(JSON.parse(graph), scene, '') : nodes ? nodes.material : kind === 'standard' ? new StandardMaterial(name, scene, true)
      : Object.assign(new PBRMaterial(name, scene), { metallic: 0, roughness: 0.5, albedoColor: new Color3(0.8, 0.8, 0.8) });
    material.name = name;
    material.metadata = { ...material.metadata, wbId: name };
    const record = { struct: 'Material', ma, ptr: ma, shadow: new Map() };
    materials.set(material, record);
    ids.adopted.set(material, ma);
    drawShading(record, material, 'Material', warnings);
  }
  // A material's node tree in Main as plain data (nodeMaterialFromTree), its nodes' properties as RNA reads them. One with
  // node groups or zones is the tree EEVEE compiles, inlined.
  const PRINCIPLED_TREE = ['ShaderNodeBsdfPrincipled', 'ShaderNodeOutputMaterial'];
  const INLINED = ['ShaderNodeGroup', 'GeometryNodeRepeatInput', 'NodeClosureOutput', 'NodeEvaluateClosure', 'NodeCombineBundle', 'NodeSeparateBundle'];
  // The integer and boolean inputs Main's description leaves out (a repeat zone's iterations), as RNA reads them.
  // A compositor's menus too, by item name.
  const wholeValues = (inputs, rnaNode, menus = false) => Object.fromEntries(Object.entries(inputs).filter(([, value]) => value === null)
    .map(([id]) => [id, [...rnaNode.inputs].find((s) => s.identifier === id)?.default_value])
    .filter(([, value]) => typeof value === 'number' || typeof value === 'boolean' || (menus && typeof value === 'string'))
    .map(([id, value]) => [id, typeof value === 'string' ? value : Number(value)]));
  const plainTree = ({ nodes, links }, rnaNodes) => ({ links, nodes: nodes.map((node) => {
    const rnaNode = rnaNodes.get(node.name);
    return { ...node, values: { ...node.inputs, ...wholeValues(node.inputs, rnaNode), ...outputValues(rnaNode) }, properties: nodeProperties(rnaNode) };
  }) });
  // The scene's compositing node group (Blender 5's own NodeTree ID) as plain data, with its nodes' locations and mutes;
  // null without one.
  function compositingTree() {
    const group = idStruct(blender.scene).compositing_node_group;
    if (!group) return null;
    const { nodes, links } = blender.nodeGroup(group.as_pointer());
    return { name: group.name, links, nodes: nodes.map((node) => {
      const rnaNode = group.nodes.get(node.name);
      return { ...node, values: { ...node.inputs, ...wholeValues(node.inputs, rnaNode, true) }, properties: nodeProperties(rnaNode, 'compositor'), location: [...rnaNode.location], mute: rnaNode.mute };
    }) };
  }
  function nodeTreeOf(ma, warnings = [], label = 'Material') {
    const tree = blender.nodeTree(ma), rnaNodes = idStruct(ma).node_tree?.nodes;
    if (!rnaNodes || !tree.nodes.length) return null;
    if (!tree.nodes.some((node) => INLINED.includes(node.idname))) return plainTree(tree, rnaNodes);
    return blender.withInlinedNodeTree(ma, (inlined) => {
      warnings.push(...inlined.errors.map((error) => `${label} "${blender.name(ma)}": ${error}`));
      return plainTree(inlined, idStruct(inlined.id).nodes);
    });
  }
  // A read World: the scene's world as Blender's, which Bylonder's authored world reads; a tree of more than a
  // Background is drawn as EEVEE draws it (world-babylon.js), its nodes as a material's.
  const BACKGROUND_TREE = ['ShaderNodeBackground', 'ShaderNodeOutputWorld'];
  function adoptWorld(wo, scene, warnings) {
    const name = blender.name(wo), tree = nodeTreeOf(wo, warnings, 'World');
    const background = tree?.nodes.find((node) => node.idname === 'ShaderNodeBackground');
    const color = background?.values.Color ?? dnaGet('World', wo, 'color');
    const nodes = tree && !(tree.nodes.every((node) => BACKGROUND_TREE.includes(node.idname)) && tree.links.length <= 1)
      ? nodeMaterialFromTree(`__world ${name}`, scene, tree) : null;
    if (nodes?.missing.length) warnings.push(`World "${name}": its ${nodes.missing.join(', ')} nodes are not opened`);
    if (nodes) nodes.material.blenderProbeClamp = [idStruct(wo).sun_threshold, idStruct(blender.scene).eevee.clamp_surface_indirect];
    createWorld(scene, color && { color: [...color].slice(0, 3), strength: background?.values.Strength, nodes: nodes?.material });
    ids.adopted.set('world', wo);
  }
  // A material's or world's values and node tree from Main. A PBR material is its Principled BSDF as Blender's glTF
  // exporter and Babylon's loader convert it (principled-gltf.js); a node material's graph is Babylon's (Main holds a
  // stand-in of it).
  function drawShading(record, owner, struct, warnings = []) {
    pull(record, owner);
    if (struct === 'Material') {
      owner.metadata = { ...owner.metadata, wbViewportDisplay: viewportDisplay(record.ptr) };
      // What EEVEE's volume probes see of its back faces (draw/light-probes.js).
      owner.blenderProbeBackfaceCulling = dnaGet('Material', record.ptr, 'use_backface_culling_lightprobe_volume');
    }
    // By the material's class: a saved project opens its .blend before the world has its material library.
    const type = struct === 'Material' ? materialType(owner) : null;
    if (type === 'node') return;
    const pbr = type === 'pbr' && mainPBR(blender, record.ptr);
    if (pbr) applyPBR(owner, pbr);
    pullTree(record.ptr, rna.pointer(struct, owner), owner.name, warnings, !pbr);
  }
  // An ID's node tree inputs that Bylonder's RNA of it binds, from Main's node of the same name (else the first of the
  // same type), where they differ (when `values`); a warning names the node types it has no binding for.
  function pullTree(id, data, label, warnings = [], values = true) {
    const held = blender.nodeTree(id).nodes, mapped = new Set(['ShaderNodeOutputMaterial', 'ShaderNodeOutputWorld']);
    const visit = (node) => {
      mapped.add(node[INFO].struct);
      const from = held.find((h) => h.name === node.name && h.idname === node[INFO].struct) ?? held.find((h) => h.idname === node[INFO].struct);
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
  // A read file's scene, once the slices it sets exist: its settings, world, collections and compositing node group
  // (returns the compositor's adopting it).
  function adoptScene() {
    state.applying = true;
    try {
      // Twice: a value the slice refuses before another is set (a frame range's start after its old end) is set after.
      for (const record of [...state.sceneRecords(), ...state.sceneRecords()]) {
        record.shadow.clear();
        try { pull(record, world); } catch { /* set on the second pass */ }
      }
      state.readCollections((pointer) => 'collection:' + blender.name(pointer) + (library(pointer) ? '@' + library(pointer) : ''));
    } finally {
      state.applying = false;
    }
    const sce = idStruct(blender.scene);
    return sce.compositing_node_group && world.compositor?.adopt({ use_compositing: sce.render.use_compositing });
  }

  // Babylon drawn from Main, after Blender's code ran: what it deleted is deleted, every object's values, relations,
  // base and tagged geometry, objects it added made, then materials, worlds and the scene.
  function view() {
    let modeChanged = false;
    state.applying = true;
    try {
      const alive = new Set(blender.ids(ID_OB)), chosen = [];
      let active = null;
      blender.cleanMasterCollection();
      const kept = [...objects].filter(([node, entry]) => alive.has(entry.ob) || state.forget(node, entry));
      for (const [node, entry] of kept) {
        const { ob } = entry, tags = blender.tags(ob);
        entry.data.ptr = blender.data(ob);
        foldUndrawn(entry);
        pull(entry, node);
        if (entry.data.ptr && entry.data.struct) pull(entry.data, node);
        const name = blender.name(ob);
        if (name !== entry.name) [node.name, entry.name, entry.babylonName] = [name, name, name];
        // Its mode is Main's (an armature's, with its record, pullArmature's).
        const mode = blender.mode(ob);
        if (entry.type !== 'ARMATURE' && mode !== node.metadata?.wbMode) {
          node.metadata = { ...node.metadata, wbMode: mode };
          modeChanged = true;
        }
        const base = blender.base(ob), data = rna.pointer('Object', node);
        if (base?.selected) chosen.push(node);
        if (base?.active) active = node;
        if (base && data.hide_get() !== base.hidden) setHidden(node, base.hidden);
        if (entry.type === 'MESH') displayAs(node, idStruct(ob).display_type);
        extraDisplay(entry);
        // A stand-in Blender's code changed becomes Main's; one an undo step read again stays Babylon's.
        const changed = ((tags.object | tags.data) & ID_RECALC_GEOMETRY) || (entry.owned && tags.data & ID_RECALC_SYNC_TO_EVAL) || sculpted(entry, tags.object);
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
        if (base?.selected) chosen.push(node);
        if (base?.active) active = node;
      }
      // The active object is Main's, selected or not (view_layer.objects.active).
      selection.replace(chosen);
      selection.setActive(active);
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
    if (modeChanged) {
      for (const node of objects.keys()) world.workbench?.refresh(node);
      world.onModeChange?.();
    }
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
        if ((recalc & ID_RECALC_GEOMETRY || sculpted(entry, recalc)) && drawsGeometry(entry) && !runtimes.evaluates(entry)) drawGeometry(entry);
      }
      runtimes.evaluated({ ...runtimeView, updates });
      const shading = [...materials.values()].map((record) => record.ma).concat([...worlds.values()].map((record) => record.wo));
      const nodeTrees = [...updates.keys()].some((id) => !drawn.has(id) && id !== blender.scene && !shading.includes(id));
      for (const [material, record] of materials) if (nodeTrees || updates.has(record.ma)) drawShading(record, material, 'Material');
      for (const [id, record] of worlds) if (world.worlds.byId(id) && (nodeTrees || updates.has(record.wo))) drawShading(record, world.worlds.byId(id), 'World');
      if (scene ?? updates.has(blender.scene)) {
        for (const record of state.sceneRecords()) pull(record, world);
        pullEeveeParity(world.scene, blender.scene);
        pullRenderExtensions(world.scene, blender.scene);
      }
      if (updates.size) { drawInstances(); drawCurves(); drawGreasePencil(); drawLightProbes(); particleEdit = particleEditOverlay(world.scene, blender.particleEdit(), particleEdit); }
    } finally {
      state.applying = was;
    }
    if (updates.size) {
      // Rendered views accumulate their samples again (render/film.js), as EEVEE's viewport does after an update.
      world.renderSettings?.resetFilms?.();
      world.shadows?.changed();
      state.evaluated();
    }
  }
  // The light probes EEVEE lights with (draw/light-probes.js): each Light Probe object's matrix and settings.
  function drawLightProbes() {
    const probes = [...objects.values()].filter((entry) => entry.type === 'LIGHT_PROBE')
      .map(({ ob, node }) => ({ ob, name: node.name, matrix: blender.transform(ob).matrix_world, data: idStruct(ob).data }));
    syncVolumeProbes(world.scene, probes);
  }
  // What objects draw as instances (main-api.cc main_instances), as Blender's draw engines draw them, each group as
  // thin instances on a mesh of the view's own sharing its shape's geometry: an instanced object's at their world
  // matrices in its material; geometry nodes' instances of a mesh in that mesh's geometry and first material; a
  // particle system's overlay shape drawn by Blender's shaders from each particle's point (overlay-particle.js); and the
  // point clouds found with them, each point a sphere (pointcloud.js). The instance data is copied once, from the module's memory
  // into a thin instance buffer that grows by doubling and is otherwise reused. A render leaves out the overlay.
  const instanced = new Map(), pointClouds = new Map();
  // Particle Edit Mode's overlay (overlay-particle.js particleEditOverlay), made on first use.
  let particleEdit = null;
  function drawInstances() {
    const byOb = new Map([...objects.values()].map((e) => [e.ob, e.node])), drawn = new Set(), rendering = !!world.collections?.rendering, { scene } = world;
    // A mesh group's Mesh, and a point cloud, are new at each evaluation: each is kept as its instancer's nth.
    const nth = new Map(), nthOf = (place) => nth.set(place, (nth.get(place) ?? -1) + 1).get(place);
    // An object instanced by several instancers is one carrier: carriers sharing its geometry would share their
    // instance buffers too (Babylon keeps them on the geometry), so all would draw the last one's instances.
    const carriers = new Map(), lights = new Map(), cameras = [];
    for (const group of blender.instances()) {
      const { instancer, ob, shape, overlay, drawSize, color } = group;
      const geometric = shape === 'MESH';
      const key = geometric ? `${instancer}:MESH:${nthOf(instancer + ':MESH')}` : shape === 'OBJECT' ? `OBJECT:${ob}` : `${instancer}:${shape}:${color}:${drawSize}`;
      const source = shape === 'OBJECT' ? byOb.get(ob) : geometric ? null : particleShapeMesh(scene, shape);
      if (source && isBlenderLight(source)) {
        lights.set(source, [...(lights.get(source) ?? []), group]);
        continue;
      }
      if (source instanceof Camera) { cameras.push(group); continue; }
      if ((!source?.geometry && !geometric) || (overlay && rendering)) continue;
      if (carriers.has(key)) carriers.get(key).groups.push(group);
      else carriers.set(key, { source, groups: [group] });
    }
    for (const [key, { source, groups: [first, ...more] }] of carriers) {
      const { shape, drawSize, color, geometry, material } = first, geometric = shape === 'MESH';
      drawn.add(key);
      let carrier = instanced.get(key);
      if (!carrier) {
        instanced.set(key, carrier = Object.assign(new Mesh('__instances ' + key, scene), { isPickable: false, alwaysSelectAsActiveMesh: true, metadata: { workbench: geometric || shape === 'OBJECT' } }));
        if (!geometric && shape !== 'OBJECT') carrier.material = particleShapeMaterial(scene, shape, color, drawSize);
        if (carrier.material) carrier.onDisposeObservable.add(() => carrier.material.dispose());
      }
      if (geometric) mesh_batch_cache_apply(blender.instanceMesh(geometry), carrier);
      else if (carrier.geometry !== source.geometry) source.geometry.applyToMesh(carrier);
      if (shape === 'OBJECT') carrier.material = source.material;
      if (geometric) carrier.material = materialFor(material);
      // Read after instanceMesh and materialFor, which can grow the module's memory.
      const groups = [first, ...more];
      drawThinInstances(carrier, groups);
      // Its instancers, whose selection outlines it (overlay_outline.cc draws a selected object's instances).
      carrier.metadata.instancers = [...new Set(groups.map((group) => byOb.get(group.instancer)).filter(Boolean))];
      if (shape === 'OBJECT') displayBounds(carrier, bounded.has(source));
    }
    for (const [key, carrier] of instanced) if (!drawn.has(key)) { carrier.dispose(); instanced.delete(key); }
    drawLightInstances(scene, lights);
    keepCameraInstances(cameras, byOb);
    const clouds = blender.pointClouds().map((record) => Object.assign(record, { key: `${record.instancer}:${nthOf(record.instancer + ':POINTCLOUD')}` }));
    const shown = drawPointClouds(scene, clouds, pointClouds, materialFor);
    for (const [key, mesh] of pointClouds) if (!shown.has(key)) { mesh.dispose(); pointClouds.delete(key); }
  }
  // An instanced light lights at each instance, as Blender's do: a light of its settings at each instance's matrix.
  const instanceLights = new Map(); // source light -> its instances' lights
  function drawLightInstances(scene, lights) {
    for (const [source, made] of instanceLights) if (!lights.has(source)) { made.forEach((light) => light.dispose()); instanceLights.delete(source); }
    for (const [source, groups] of lights) {
      // Only its instances light where the light is in no view layer (a linked collection's).
      if (!blender.base(objects.get(source).ob)) source.setEnabled(false);
      const matrices = groups.flatMap(({ data }) => Array.from({ length: data.length / 16 }, (_, i) => Matrix.FromArray(data, i * 16)));
      const record = lightRecord(source), made = instanceLights.get(source) ?? [];
      while (made.length > matrices.length) made.pop().dispose();
      while (made.length < matrices.length) made.push(createLight('__instance ' + source.name, record.type, record, scene));
      made.forEach((light, i) => {
        if (lightRecord(light).type !== record.type) made[i] = (light.dispose(), createLight('__instance ' + source.name, record.type, record, scene));
        else Object.assign(lightRecord(made[i]), record);
        deriveBabylonLight(made[i]);
        setEvaluatedMatrix(made[i], matrices[i]);
      });
      instanceLights.set(source, made);
    }
  }
  // An instanced camera's overlay draws at each instance (draw/overlay-extra.js), as Blender's overlay draws a dupli's:
  // { node, instancer, matrix }, each kept while its camera is, so the overlay remakes only what is new.
  const cameraInstances = [];
  function keepCameraInstances(groups, byOb) {
    const instances = groups.flatMap(({ ob, instancer, data }) => Array.from({ length: data.length / 16 }, (_, i) => ({ node: byOb.get(ob), instancer: byOb.get(instancer), matrix: Matrix.FromArray(data, i * 16) }))).filter(({ node, instancer }) => node && instancer);
    instances.forEach((instance, i) => { if (cameraInstances[i]?.node === instance.node) Object.assign(cameraInstances[i], instance); else cameraInstances[i] = instance; });
    cameraInstances.length = instances.length;
  }
  // The curves objects draw (Curves objects' evaluated curves, particle hair), as Blender's engines draw them (curves.js),
  // one data each for: the render engines' mesh in the object's slot material (Workbench's hair in Solid views, workbench.js), and the overlay's
  // strands where the viewport shows them as paths (overlay-particle.js).
  const curved = new Map();
  function drawCurves() {
    const byOb = new Map([...objects.values()].map((e) => [e.ob, e.node])), drawn = new Set(), rendering = !!world.collections?.rendering, { scene } = world;
    for (const record of blender.curves()) {
      const emitter = byOb.get(record.ob), key = record.ob + ':' + record.system;
      if (!emitter || (rendering && !record.render)) continue;
      drawn.add(key);
      const kept = curved.get(key) ?? {};
      if (kept.data) disposeCurvesData(kept.data);
      const data = curvesData(scene, record);
      const mesh = curvesMesh(scene, '__curves ' + key, data, record.faces, kept.mesh);
      Object.assign(mesh.metadata.curves, { render: record.render, viewport: record.viewport });
      const material = materialFor(record.material);
      mesh.material = material && CurvesPlugin.draws(material) ? material : null;
      let overlay = kept.overlay;
      if (record.viewport && !rendering) {
        overlay = curvesMesh(scene, '__curves overlay ' + key, data, 0, overlay);
        Object.assign(overlay.metadata, { overlay: true, explicit: record.overlay });
        if (!overlay.material) { const shown = overlay; hairOverlay(scene, shown, { workbench: world.workbench, explicit: () => shown.metadata.explicit, selected: () => selection.has(emitter), active: () => selection.active === emitter }); }
      } else if (overlay) { overlay.dispose(); overlay = null; }
      curved.set(key, { data, mesh, overlay });
    }
    for (const [key, { data, mesh, overlay }] of curved) if (!drawn.has(key)) { disposeCurvesData(data); mesh.dispose(); overlay?.dispose(); curved.delete(key); }
  }
  // Grease Pencil objects' visible drawings (draw/grease-pencil.js), onion skins but in a render or playback.
  let greasePencil = null, repack = false;
  function drawGreasePencil() {
    if (!greasePencil) {
      greasePencil = createGreasePencilDraw(world.scene, { matrix: babylonMatrix, look: (ob) => runtimes.look(idStruct(ob).data) ?? BLENDER_LOOK });
      provideGreasePencilRender(world.scene.getEngine());
    }
    const byOb = new Map([...objects.values()].map((e) => [e.ob, e.node])), onion = !world.collections?.rendering && !world.animation?.playing;
    repack = greasePencil.update(blender.greasePencil({ onion, repack }), (ob) => byOb.get(ob));
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
  // A sculpt stroke tags its object's shading only: Blender's engines draw the stroke from the object's pbvh::Tree,
  // which object_mesh_eval gives.
  const sculpted = (entry, recalc) => entry.type === 'MESH' && entry.node.metadata?.wbMode === 'SCULPT' && !!(recalc & ID_RECALC_SHADING);
  const drawsGeometry = ({ type, owned }) => (type === 'MESH' ? owned : CURVE_TYPES.includes(type) || EVALUATED.includes(type));
  // In Weight Paint Mode the weights are drawn over it (overlay-paint-weight.js), read with the mesh they are of. A mesh
  // object whose evaluated geometry has no mesh (geometry nodes made points or curves of it) draws none.
  function drawGeometry(entry) {
    const mesh = blender.evaluatedMesh(entry.ob) ?? (entry.type === 'MESH' ? emptyMesh() : null);
    if (!mesh) return;
    const mode = blender.mode(entry.ob);
    const weights = mode === 'WEIGHT_PAINT' ? blender.paintWeights(entry.ob, mesh.verts_num) : null;
    const colors = blender.paintColors(mesh.corners_num);
    drawMesh(entry, mesh, blender.modifiers(entry.ob).map(({ error }) => error));
    drawEvaluatedSlots(entry);
    entry.paintWeight = paintWeightOverlay(entry.node, mesh, weights, entry.paintWeight);
    drawColors(entry.node, colors);
  }
  // Its evaluated slots, where they differ from the object's own (Geometry Nodes' Set Material), are drawn; its own stay
  // the object's (Material Properties and saving read those).
  function drawEvaluatedSlots({ node, ob }) {
    const own = blender.materials(ob), drawn = blender.drawnMaterials(ob);
    if (drawn.length === own.length && drawn.every((ma, i) => ma === own[i])) return;
    // A material made since the last adoption (by Python, by a node's material field) is adopted first.
    for (const ma of drawn) if (ma && !materialFor(ma)) adoptMaterial(ma, world.scene, []);
    const list = drawn.map(materialFor);
    if (world.materials) world.materials.drawSlots(node, list);
    else if (list.length > 1) node.material = Object.assign(new MultiMaterial('__slots ' + node.name, node.getScene()), { subMaterials: list });
    else node.material = list[0] ?? null;
  }
  // The active color attribute, which Solid shows in Vertex Paint Mode and with its Attribute color (workbench.js), one
  // color per face corner as the mesh's vertices are; materials do not multiply it (Babylon's would), as Blender's do not.
  function drawColors(node, colors) {
    const had = node.isVerticesDataPresent('color');
    if (colors && node.getTotalVertices() * 4 === colors.length) node.setVerticesData('color', colors, true, 4);
    else if (had) node.removeVerticesData('color');
    node.useVertexColors = false;
    if (had !== node.isVerticesDataPresent('color')) world.workbench?.refresh(node);
  }
  function drawMesh({ node }, mesh, errors = []) {
    if (world.modifiers) world.modifiers.draw(node, mesh, errors);
    else mesh_batch_cache_apply(mesh, node);
  }
  // A mesh whose materials read attributes its draw buffers lack is drawn again with them.
  attributesWanted.add((node) => {
    const entry = objects.get(node);
    if (entry && drawsGeometry(entry)) drawGeometry(entry);
  });
  // What a runtime other than Blender's evaluates from (runtimes.js): Main, the objects' entries and how they draw.
  const runtimeView = { world, scene: world.scene, blender, entries: () => objects.values(), drawGeometry, drawMesh, drawsGeometry };

  // Materials and worlds as Main holds them: their values and their node trees' inputs, Babylon's derived from them.
  function pullShading() {
    for (const [material, record] of materials) drawShading(record, material, 'Material');
    for (const [id, record] of worlds) if (world.worlds.byId(id)) drawShading(record, world.worlds.byId(id), 'World');
  }
  // What is drawn from the module's memory, drawn again from Blender: after a lost GPU context, whose restore keeps no
  // view of that memory.
  function redrawAll() {
    uploadImageTextures(world.scene.getEngine());
  }

  return {
    pull, view, adopt, adoptScene, compositingTree, drawData, drawShading, drawEvaluated, redrawAll, cameraInstances,
    keepMesh: (entry) => { keepMesh(entry, blender); return true; },
    dispose: () => world.scene.onBeforeRenderObservable.remove(displayed),
  };
}

// A Material's Viewport Display settings, which Solid shading draws it with.
const viewportDisplay = (ma) => ({ color: dnaGet('Material', ma, 'diffuse_color').slice(0, 3), metallic: dnaGet('Material', ma, 'metallic'),
  roughness: dnaGet('Material', ma, 'roughness') });

// A Material's Principled BSDF in Main as PBRMaterial properties, null without one.
export function mainPBR(blender, ma) {
  const principled = blender.nodeTree(ma).nodes.find((node) => node.idname === 'ShaderNodeBsdfPrincipled');
  return principled && principledPBR(principled.inputs, { use_backface_culling: dnaGet('Material', ma, 'use_backface_culling'), surface_render_method: dnaGet('Material', ma, 'surface_render_method') });
}
