// The view (docs/model.md): Babylon's scene drawn from Blender's state in Main, one way. After Blender's code ran or
// an undo step loaded, every object's values come from Main through the RNA mapping (rna-bylonder.js `sync`
// bindings at their DNA fields), its relations and base, the geometry Blender tagged, a curve's Curve data and an
// armature's bones; Main's objects without a Babylon object get one, linked by id (`bylonder_id`), and objects Main
// no longer holds are deleted. Materials, worlds, textures, scene settings and collections are read the same way.
import { dnaGet, dnaProperty } from '../makesrna/dna-struct.js';
import { syncBindings } from '../makesrna/rna-bylonder.js';
import { INFO } from '../makesrna/rna.js';
import { createLight } from './light/light-home.js';
import { createWorld } from './scene/world.js';
import { blenderModifierDefinitions } from '../modifiers/blender.js';
import { addModifier, modifierStack } from '../modifiers/stack.js';
import { mesh_serialize } from './mesh/mesh.js';
import { buildMesh, rebuildMesh } from '../editors/object/mesh-catalog.js';
import { nodeId, deleted } from '../editors/object/identity.js';
import { CurveObject, evaluateCurve } from './curve/curve.js';
import { blenderTransform } from '../editors/curve/curve-objects.js';
import { mesh_batch_cache_apply } from '../draw/mesh-batch-cache.js';
import { asObject } from '../runtime/object-transform.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { Color3, FreeCamera, Material, Mesh, PBRMaterial, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { armatureData, armatureDrawn } from './armature/armature.js';
import { readTexture } from './texture/texture.js';
import { armature_draw } from '../draw/overlay-armature.js';
import { principledPBR, applyPBR } from './material/principled-gltf.js';
import { createEditMeshOverlay } from '../draw/overlay-edit-mesh.js';

export const ID_OB = 0x424f, ID_GR = 0x5247, ID_MA = 0x414d, ID_WO = 0x4f57;
export const ID_RECALC_GEOMETRY = 1 << 1;
// The data an undo step read again (memfile_undosys_step_decode) is tagged to be copied for evaluation.
const ID_RECALC_SYNC_TO_EVAL = 1 << 13;
export const CURVE_TYPES = ['CURVE', 'FONT'];
// Custom properties in Main for what only Babylon has: an object's identity in Bylonder, a material's kind and graph.
// `bylonder_standin`: a Mesh that stands in for geometry Babylon built (a MeshBuilder's), which Babylon draws itself.
export const PROPERTIES = { id: 'bylonder_id', material: 'bylonder_material', graph: 'bylonder_node_material', standin: 'bylonder_standin' };
// eRotationModes, and ModifierMode's viewport and render bits.
export const ROTATION_MODES = { QUATERNION: 0, XYZ: 1, XZY: 2, YXZ: 3, YZX: 4, ZXY: 5, ZYX: 6, AXIS_ANGLE: -1 };
const MODIFIER_REALTIME = 1, MODIFIER_RENDER = 2;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const isIdentity = (matrix) => matrix.every((v, i) => v === IDENTITY[i]);
// A value as both models compare it: arrays plain, Main's floats being 32-bit.
export const plain = (value) => (value && typeof value === 'object' ? Array.from(value) : value);
const close = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
export const same = (a, b) => (Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]))
  : typeof a === 'number' && typeof b === 'number' ? close(a, b) : a === b);
// The Babylon objects a read Object becomes, by its type; a light of a type Babylon has no light for becomes the
// nearest, with a warning.
const MAKERS = {
  EMPTY: (scene, name) => new TransformNode(name, scene),
  CAMERA: (scene, name) => asObject(new FreeCamera(name, Vector3.Zero(), scene)),
  // A light Blender's code made is Blender's (docs/blender-boundary.md point 4a); the view fills its settings from Main.
  LIGHT: (scene, name, ob, blender) => createLight(name, dnaGet('Light', blender.data(ob), 'type'), {}, scene),
  MESH: (scene, name) => new Mesh(name, scene),
  ARMATURE: (scene, name) => new Mesh(name, scene),
  CURVE: (scene, name) => new Mesh(name, scene),
  FONT: (scene, name) => new Mesh(name, scene),
};

// A mesh object's Mesh drawn as Main holds it, Main owning it (its recipe is the Mesh data, for saving).
export function drawMesh(entry, blender) {
  rebuildMesh(entry.node, { mesh: mesh_serialize(blender.mesh(entry.ob)) });
  [entry.creation, entry.owned] = [entry.node.metadata.wbCreation, true];
  blender.setProperty(entry.ob, PROPERTIES.standin, '');
}

//   state: the scene sync's records (main-sync.js): rna, world, selection, blender, ids, objects, materials, worlds,
//   textures, sceneRecords(), readCollections(), relations(entry), nodeOf, forget(node, entry), and `applying`, which mutes its hooks.
export function createMainView(state) {
  const { rna, world, selection, blender, ids, objects, materials, worlds, textures } = state;

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
  const drawCurve = (node) => {
    const data = node.metadata.wbCreation.curve;
    const mesh = evaluateCurve(data, { transform: blenderTransform(node), modifiers: data.modifiers ?? [], targets: {} });
    if (mesh) mesh_batch_cache_apply(mesh, node);
  };
  // An object's data as Main holds it: a mesh's geometry, a curve's or text's Curve data, an armature's bones.
  function drawData(entry) {
    const { node, type } = entry;
    if (type === 'MESH') {
      if (blender.property(entry.ob, PROPERTIES.standin) === '1') entry.owned = false;
      else drawMesh(entry, blender);
    }
    else if (CURVE_TYPES.includes(type)) {
      const data = curveObject(entry).data;
      if (world.curves) {
        world.curves.set(node, data);
        entry.curve = JSON.stringify(world.curves.data(node));
      } else {
        node.metadata = { ...node.metadata, wbCreation: { curve: data } };
        drawCurve(node);
      }
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

  // A mesh object in Blender's Edit Mode in Main: its edit mesh drawn, shaded and as the edit overlay, its mode Main's;
  // leaving it, the Mesh Blender wrote is drawn. Returns whether it is in Edit Mode.
  function drawEditMode(entry) {
    const edit = blender.editMesh(entry.ob), { node } = entry;
    if (!edit && !entry.overlay) return false;
    node.metadata = { ...node.metadata, wbMode: edit ? 'EDIT' : 'OBJECT' };
    if (!edit) {
      entry.overlay.dispose();
      entry.overlay = null;
      drawMesh(entry, blender);
      return false;
    }
    mesh_batch_cache_apply(edit.mesh, node, { topology: true });
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
        if (type === 'LIGHT' && dnaGet('Light', blender.data(ob), 'type') === 'AREA') warnings.push(`"${name}": an Area light opens as a point light`);
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
        if (entry.type === 'MESH') adoptModifiers(entry, warnings);
        else if (blender.modifiers(ob).length) warnings.push(`"${node.name}": the modifiers of ${entry.type.toLowerCase()} objects are not opened`);
        if (blender.materials(ob).length > 1) warnings.push(`"${node.name}": its faces show its first material`);
        for (const path of new Set(fcurvePaths(ob))) if (!['location', 'rotation_euler', 'scale'].includes(path)) warnings.push(`"${node.name}": its ${path} keys are not opened`);
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
  // An object's modifiers as Main holds them, in the terms of Bylonder's stack; the types Bylonder does not have are
  // left out.
  // `resolve`: targets as the stack names them (a texture record, an object's id), else as Main's pointers.
  function mainModifiers(entry, warnings, resolve = true) {
    const view = new DataView(blenderModule.exports.memory.buffer);
    return blender.modifiers(entry.ob).flatMap(({ type, name, mode, md }) => {
      const definition = blenderModifierDefinitions.find((d) => d.mesh.type === type);
      if (!definition) { warnings.push(`"${entry.node.name}": its modifier "${name}" is not opened`); return []; }
      const values = definition.mesh.read(view, md);
      if (definition.mesh.textured) {
        const tex = view.getUint32(md + definition.mesh.texture, true);
        values.texture = resolve ? textureId(tex) : tex;
      }
      if (definition.mesh.scene) {
        const ob = view.getUint32(md + definition.mesh.object, true), target = state.nodeOf(ob);
        values.object = resolve ? (target ? nodeId(target) : null) : ob;
      }
      return [{ type: definition.id, name, showViewport: !!(mode & MODIFIER_REALTIME), showRender: !!(mode & MODIFIER_RENDER), values }];
    });
  }
  // The texture record of a Tex in Main, made for one Blender's code created (texture.new); null for none.
  function textureId(tex) {
    if (!tex) return null;
    const known = [...textures].find(([, record]) => record.tex === tex);
    if (known) return known[0];
    const entry = world.textures.create(null, { finish: false });
    entry.name = blender.name(tex);
    world.textures.assign(entry, readTexture(tex));
    textures.set(entry.id, { tex, values: entry.values });
    return entry.id;
  }
  function adoptModifiers(entry, warnings) {
    for (const { type, values, ...shown } of mainModifiers(entry, warnings)) Object.assign(addModifier(entry.node, type, values), shown);
  }
  // Modifiers Blender's code added, removed or changed (Add Modifier, Ctrl 2, a panel's value) become the stack's: a
  // changed list is taken whole, changed values in place, keeping a target (texture, object) Main has not been given yet.
  const modifiersOf = (entry) => JSON.stringify(mainModifiers(entry, [], false));
  // Main's stacks as the page last gave them to it (before Blender's code runs), so that a view takes only what that
  // code changed.
  function modifiersSynced() {
    for (const entry of objects.values()) if (entry.type === 'MESH') entry.modifiersSynced = modifiersOf(entry);
  }
  function pullModifiers(entry) {
    const synced = modifiersOf(entry);
    if (synced === (entry.modifiersSynced ??= synced)) return;
    entry.modifiersSynced = synced;
    const main = mainModifiers(entry, []), stack = modifierStack(entry.node);
    if (stack.length !== main.length || main.some((m, i) => stack[i].type !== m.type || stack[i].name !== m.name)) {
      if (entry.node.metadata) entry.node.metadata.wbModifiers = [];
      adoptModifiers(entry, []);
      return;
    }
    main.forEach(({ values, showViewport, showRender }, i) => {
      const modifier = stack[i];
      for (const key of ['texture', 'object']) if (values[key] === null && modifier.values[key] != null) values[key] = modifier.values[key];
      Object.assign(modifier, { showViewport, showRender });
      for (const [key, value] of Object.entries(values)) if (JSON.stringify(modifier.values[key]) !== JSON.stringify(value)) modifier.values[key] = value;
    });
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
  // What Blender's code changed of a Tex goes back to its record.
  function pullTextures() {
    for (const [id, record] of textures) {
      const entry = world.textures.byId(id), values = readTexture(record.tex);
      if (entry && !Object.entries(values).every(([name, value]) => same(value, entry.values[name]))) world.textures.assign(entry, values);
      if (entry) record.values = entry.values;
    }
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
  // base and tagged geometry, objects it added made, then materials, worlds, textures and the scene.
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
        if (entry.type === 'MESH') pullModifiers(entry);
        if (entry.type === 'MESH' && drawEditMode(entry)) continue;
        if (changed && entry.type === 'MESH') drawMesh(entry, blender);
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
      pullTextures();
      for (const record of state.sceneRecords()) pull(record, world);
      blender.evaluate();
      for (const entry of objects.values()) if (entry.type === 'ARMATURE') pullArmature(entry);
    } finally {
      state.applying = false;
    }
    // Last, as the collections' subscribers (the Outliner) draw from Main as soon as they change.
    if (world.collections) state.readCollections();
    world.modifiers?.refresh();
  }

  // Materials and worlds as Main holds them: their values and their node trees' inputs, Babylon's derived from them.
  function pullShading() {
    for (const [material, record] of materials) drawShading(record, material, 'Material');
    for (const [id, record] of worlds) if (world.worlds.byId(id)) drawShading(record, world.worlds.byId(id), 'World');
  }
  // Babylon drawn from Main's evaluated values (after a frame change evaluated Blender's animation), by kind: every
  // object's and its data's values (a light's, a camera's), an armature's pose, materials' and worlds' values and node
  // tree inputs, the scene's settings. Nothing comes or goes, and no geometry changes.
  function evaluated() {
    state.applying = true;
    try {
      for (const entry of objects.values()) {
        pull(entry, entry.node);
        if (entry.data.ptr && entry.data.struct) pull(entry.data, entry.node);
        if (entry.type === 'ARMATURE') pullArmature(entry);
      }
      pullShading();
      for (const record of state.sceneRecords()) pull(record, world);
    } finally {
      state.applying = false;
    }
  }

  return {
    pull, view, adopt, adoptScene, drawData, drawShading, evaluated, modifiersSynced,
  };
}

// A Material's Principled BSDF in Main as PBRMaterial properties, null without one.
export function mainPBR(blender, ma) {
  const principled = blender.nodeTree(ma).nodes.find((node) => node.idname === 'ShaderNodeBsdfPrincipled');
  return principled && principledPBR(principled.inputs, { use_backface_culling: dnaGet('Material', ma, 'use_backface_culling') });
}
