// Bylonder's data under Blender's RNA (makesrna/intern/rna_*.cc): per struct, the properties Bylonder has, as
// { get(owner, r), set(owner, value, r) } or a bare getter for a read-only one. The rest read as Blender's defaults
// (rna.js). Values are in Blender's axes (Z up, right-handed): Babylon's (x, y, z) is Blender's (x, z, y).
// A write is RNA's set and update: it changes Bylonder's data and calls host.update (the notifier); undo steps are
// pushed by the UI that made the edit (host.undoPush), as Blender's buttons push them, never by RNA.
//   host: { world (runtime/world.js), selection (editors/object/selection.js), preferences,
//           update(struct, name, owner), undoPush(name) }
import { Camera, Light, PointLight, SpotLight, Quaternion, VertexBuffer } from '@babylonjs/core';
import { rna, collection, baseOf, INFO, pyArgs, rnaProperty, operatorStruct } from './rna.js';
import modifierTypes from './rna-modifiers.json' with { type: 'json' };
import rnaOperators from './rna-operators.json' with { type: 'json' };
import { modifierStack } from '../modifiers/stack.js';
import { deleted, nodeId, hasMesh } from '../editors/object/identity.js';
import { address } from '../blenkernel/animation/model.js';
import { viewTransforms, looks } from '../blenkernel/scene/render-babylon.js';
import { fileFormats, containers, videoCodecs, qualities } from '../render/formats.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../bmesh/intern/bmesh-marking.js';
import { curveStructs } from './rna-curve.js';
import { isSyntaxHighlightSupported } from '../editors/space_text/text-format.js';

// Swapping two axes is its own inverse and flips handedness.
const axes = ([x, y, z]) => [x, z, y];
// A Babylon rotation about its x, y, z is one about Blender's -X, -Z, -Y, applied z first: Blender's YXZ order.
const eulerFromBabylon = ({ x, y, z }) => [-x, -z, -y];
const eulerToBabylon = ([x, y, z]) => ({ x: -x, y: -z, z: -y });
const babylonQuaternion = (node) => node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
const babylonEuler = (node) => (node.rotationQuaternion ? node.rotationQuaternion.toEulerAngles() : node.rotation);
function setRotation(node, quaternion) {
  if (node.rotationQuaternion) node.rotationQuaternion.copyFrom(quaternion);
  else node.rotation.copyFrom(quaternion.toEulerAngles());
}

// Cameras and lights look along Babylon's local +Z and Blender's -Z: their rotation in Blender's axes is S·M·C, where
// M is Babylon's, S swaps y and z (Blender's axes) and C flips z, which keeps both frames' x right and y up. Read and
// written as rotation matrices (column vectors), in Blender's XYZ Euler order.
const quaternionMatrix = ({ x, y, z, w }) => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
function matrixQuaternion(m) {
  const trace = m[0][0] + m[1][1] + m[2][2];
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); return new Quaternion((m[2][1] - m[1][2]) * s, (m[0][2] - m[2][0]) * s, (m[1][0] - m[0][1]) * s, 0.25 / s); }
  const i = m[0][0] > m[1][1] && m[0][0] > m[2][2] ? 0 : m[1][1] > m[2][2] ? 1 : 2, j = (i + 1) % 3, k = (i + 2) % 3;
  const s = 2 * Math.sqrt(1 + m[i][i] - m[j][j] - m[k][k]), q = [0, 0, 0];
  q[i] = s / 4; q[j] = (m[j][i] + m[i][j]) / s; q[k] = (m[k][i] + m[i][k]) / s;
  return new Quaternion(q[0], q[1], q[2], (m[k][j] - m[j][k]) / s);
}
// S·M·C, and its inverse S·R·C: S swaps rows 1 and 2, C negates column 2.
const lookingFrame = (m) => [m[0], m[2], m[1]].map((row) => [row[0], row[1], -row[2]]);
const eulerXYZ = (m) => [Math.atan2(m[2][1], m[2][2]), Math.asin(Math.max(-1, Math.min(1, -m[2][0]))), Math.atan2(m[1][0], m[0][0])];
function matrixXYZ([x, y, z]) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  return [[cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz], [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz], [-sy, sx * cy, cx * cy]];
}
const looksAlongZ = (ob) => ob instanceof Camera || ob instanceof Light;
const lookingRotation = {
  get: (ob) => eulerXYZ(lookingFrame(quaternionMatrix(babylonQuaternion(ob)))),
  set: (ob, value) => setRotation(ob, matrixQuaternion(lookingFrame(matrixXYZ(value)))),
};

// A number or boolean array (bpy_prop_array): a copy whose elements write through, with x, y, z (or w, x, y, z).
function array(get, set, names = 'xyz') {
  const index = (key) => (key.length === 1 && names.includes(key) ? names.indexOf(key) : key);
  return {
    get: (owner, r) => new Proxy(get(owner, r), {
      get: (values, key) => values[typeof key === 'string' ? index(key) : key],
      set(values, key, value) {
        if (!set) return false;
        values[index(key)] = value;
        set(owner, [...values], r);
        return true;
      },
    }),
    set: set && ((owner, value, r) => set(owner, [...value], r)),
  };
}

const dimensions = (ob) => {
  const size = ob.getBoundingInfo?.().boundingBox.extendSize.scale(2) ?? { x: 0, y: 0, z: 0 };
  return axes([size.x * Math.abs(ob.scaling.x), size.y * Math.abs(ob.scaling.y), size.z * Math.abs(ob.scaling.z)]);
};
const SELECT_BITS = [SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE];
const lightType = (light) => (light instanceof SpotLight ? 'SPOT' : light instanceof PointLight ? 'POINT' : light.getClassName() === 'RectAreaLight' ? 'AREA' : 'SUN');
const LIGHT_STRUCTS = { POINT: 'PointLight', SPOT: 'SpotLight', SUN: 'SunLight', AREA: 'AreaLight' };
const OBJECT_DATA = { MESH: () => 'Mesh', LIGHT: (ob) => LIGHT_STRUCTS[lightType(ob)], CAMERA: () => 'Camera', FONT: () => 'TextCurve', CURVE: () => 'Curve' };
const objectType = (ob) => (ob instanceof Camera ? 'CAMERA' : ob instanceof Light ? 'LIGHT' : ob.metadata?.wbCreation?.curve?.type
  ?? (ob.metadata?.wbCurve ? 'CURVE' : ob.getTotalVertices && hasMesh(ob) ? 'MESH' : 'EMPTY'));
const editing = (ob, r) => !!ob && r.world.editMode?.object === ob;
const editTotals = (ob, r) => (editing(ob, r) && r.world.editMode.stats) || { verts: [0], edges: [0], faces: [0] };

// Bylonder's modifier types that are Blender's keep their type; its own (Array as Geometry Nodes) are Nodes modifiers.
const modifierType = (modifier) => (modifierTypes.types[modifier.type] ? modifier.type : 'NODES');
const modifierStruct = (modifier) => modifierTypes.types[modifier.type]?.struct ?? 'NodesModifier';
const modifierFlag = (key) => ({ get: ({ modifier }) => modifier[key], set: ({ modifier }, value, r) => { modifier[key] = value; r.world.modifiers.refresh(); } });
// A Blender modifier's settings, stored by RNA identifier (`count`, `use_axis[0]`, see modifiers/blender.js).
function modifierValues({ node, modifier }) {
  const set = (path, value, r) => r.world.modifiers.set(node, modifier.id, path, value, { finish: false });
  const names = Object.keys(modifier.values).map((path) => path.replace(/\[\d+\]$/, ''));
  return Object.fromEntries([...new Set(names)].filter((name) => modifierTypes.types[modifier.type]?.properties[name]).map((name) => [name,
    name in modifier.values
      ? { get: () => modifier.values[name], set: (owner, value, r) => set(name, value, r) }
      : array(() => Object.keys(modifier.values).filter((path) => path.startsWith(name + '[')).map((path) => modifier.values[path]),
        (owner, values, r) => values.forEach((value, i) => set(`${name}[${i}]`, value, r)))]));
}

// An object transform's animation channels, by Blender's axis (Blender's X, Y, Z are Babylon's x, z, y).
const objectChannel = (property) => (ob, index) => address('object:' + nodeId(ob), property + '.' + 'xzy'[index]);
// Bylonder's transform locks (metadata.wbTransformLocks, by Babylon path) as Blender's lock_location and the like.
const transformLocks = (property) => array((ob) => [...'xzy'].map((axis) => !!ob.metadata?.wbTransformLocks?.[property + '.' + axis]), (ob, value) => {
  ob.metadata = { ...ob.metadata, wbTransformLocks: { ...ob.metadata?.wbTransformLocks, ...Object.fromEntries(value.map((locked, i) => [property + '.' + 'xzy'[i], !!locked])) } };
});
// A light's power in Blender's units from Babylon's intensity: watts for point, spot and area lights (1000 W, Blender's
// default point light, as intensity 1) and irradiance in W/m² for the sun.
const watts = (light) => (lightType(light) === 'SUN' ? 1 : 1000);
// A camera's sensor along the fitted axis: Babylon fixes the horizontal or the vertical field of view.
const horizontal = (camera) => camera.fovMode === Camera.FOVMODE_HORIZONTAL_FIXED;
const sensor = (camera) => (horizontal(camera) ? 36 : 24);
const settable = (key) => ({ get: (owner) => owner[key], set: (owner, value) => { owner[key] = value; } });
// A setting of an editor's space data (SpaceText, SpaceConsole), which redraws it.
const spaceSetting = (key) => ({ get: (space) => space.settings[key], set: (space, value) => { space.settings[key] = value; space.changed(); } });
// Enum items for Bylonder's own choices, as RNA's [identifier, name, description, icon].
const choices = (table, label = (entry) => entry.label) => () => Object.entries(table).map(([id, entry]) => [id, label(entry), '', 'NONE']);
// A slice's setting by path, written without a commit (the UI that made the edit pushes the undo step).
const sliceValue = (slice, path) => ({ get: (world) => world[slice] && path.split('.').reduce((o, k) => o?.[k], world[slice].state),
  set: (world, value) => world[slice].set(path, value, false) });

// Blender's shader nodes over Bylonder's world and materials, for the panels that draw a node tree's inputs
// (template_node_view): a node is [name, Blender's node type, inputs], an input [name, socket type, value or a linked node].
// A value is { get, set } on the data; host.update is the notifier, as for bound properties.
function shaderNode(r, [name, type, inputs]) {
  return rna(type, { name, label: '', bl_idname: type, inputs: collection(inputs.map(([input, socket, value]) => {
    const linked = Array.isArray(value) ? shaderNode(r, value) : null;
    const data = { name: input, identifier: input, enabled: true, hide_value: false, is_linked: !!linked,
      links: collection(linked ? [rna('NodeLink', { from_node: linked, from_socket: null, is_valid: true })] : []) };
    if (value && !linked) Object.defineProperty(data, 'default_value', { enumerable: true, get: value.get, set: (v) => { value.set(v); r.host.update?.(socket, 'default_value', data); } });
    return rna(socket, data);
  })), outputs: collection() });
}
const nodeTree = (r, output) => rna('ShaderNodeTree', { get_output_node: () => shaderNode(r, output) });
const rgba = (get, set) => ({ get: () => [...get(), 1], set: (value) => set([...value].slice(0, 3)) });
// A Babylon material's inputs as Principled BSDF sockets: a PBR material's own, a Standard material's color and alpha.
const color3 = (owner, key) => ({ get: () => [owner[key].r, owner[key].g, owner[key].b, 1], set: ([red, green, blue]) => owner[key].set(red, green, blue) });
const materialValue = (material, path) => {
  const keys = path.split('.'), key = keys.pop(), owner = () => keys.reduce((o, k) => o?.[k], material);
  return owner()?.[key] === undefined ? null : { get: () => owner()[key], set: (value) => { owner()[key] = value; } };
};
function principledInputs(material) {
  const pbr = material.getClassName() === 'PBRMaterial', value = (path) => materialValue(material, path);
  return [
    ['Base Color', 'NodeSocketColor', color3(material, pbr ? 'albedoColor' : 'diffuseColor')],
    ['Metallic', 'NodeSocketFloatFactor', pbr && value('metallic')],
    ['Roughness', 'NodeSocketFloatFactor', pbr && value('roughness')],
    ['IOR', 'NodeSocketFloat', pbr && value('indexOfRefraction')],
    ['Alpha', 'NodeSocketFloatFactor', value('alpha')],
    ['Normal', 'NodeSocketVector', null],
    ['Specular IOR Level', 'NodeSocketFloatFactor', pbr && value('metallicF0Factor')],
    ['Coat Weight', 'NodeSocketFloatFactor', pbr && value('clearCoat.intensity')],
    ['Sheen Weight', 'NodeSocketFloatFactor', pbr && value('sheen.intensity')],
    ['Emission Color', 'NodeSocketColor', material.emissiveColor && color3(material, 'emissiveColor')],
    ['Emission Strength', 'NodeSocketFloat', pbr && value('emissiveIntensity')],
  ].map(([name, socket, binding]) => [name, socket, binding || null]);
}
const worldValue = (r, entry, path) => ({ get: () => path.split('.').reduce((o, k) => o[k], entry), set: (value) => r.world.worlds.set(entry, path, value, false) });

// A view layer's objects (LayerObjects): its collection, with the active object, which selecting makes.
function layerObjects(r) {
  const objects = collection(r.objects().map((ob) => r.pointer('Object', ob)));
  Object.defineProperty(objects, 'active', { enumerable: true, get: () => r.pointer('Object', r.host.selection?.nodes.at(-1)),
    set: (ob) => { r.host.selection?.replace(ob ? [ob[INFO].owner] : []); r.host.update?.('LayerObjects', 'active', objects); } });
  return rna('LayerObjects', objects);
}

const STRUCTS = {
  Object: {
    name: { get: (ob) => ob.name, set: (ob, name) => { ob.name = name; } },
    type: objectType,
    mode: (ob, r) => (editing(ob, r) ? 'EDIT' : 'OBJECT'),
    data: (ob, r) => r.pointer(OBJECT_DATA[objectType(ob)]?.(ob), ob),
    location: { ...array((ob) => axes(ob.position.asArray()), (ob, value) => ob.position.copyFromFloats(...axes(value))), channel: objectChannel('position') },
    rotation_mode: (ob) => (ob.rotationQuaternion ? 'QUATERNION' : looksAlongZ(ob) ? 'XYZ' : 'YXZ'),
    rotation_euler: { ...array((ob) => (looksAlongZ(ob) ? lookingRotation.get(ob) : eulerFromBabylon(babylonEuler(ob))), (ob, value) => {
      if (looksAlongZ(ob)) return lookingRotation.set(ob, value);
      const { x, y, z } = eulerToBabylon(value);
      setRotation(ob, Quaternion.FromEulerAngles(x, y, z));
    }), channel: objectChannel('rotation') },
    rotation_quaternion: array((ob) => { const q = babylonQuaternion(ob); return [q.w, -q.x, -q.z, -q.y]; },
      (ob, [w, x, y, z]) => setRotation(ob, new Quaternion(-x, -z, -y, w)), 'wxyz'),
    scale: { ...array((ob) => axes(ob.scaling.asArray()), (ob, value) => ob.scaling.copyFromFloats(...axes(value))), channel: objectChannel('scaling') },
    lock_location: transformLocks('position'),
    lock_rotation: transformLocks('rotation'),
    lock_scale: transformLocks('scaling'),
    users_collection: (ob, r) => collection((r.world.collections?.memberships?.(nodeId(ob)) ?? []).map((id) => r.pointer('Collection', r.world.collections.byId(id)))),
    active_material_index: { get: (ob, r) => r.world.materials?.active(ob) ?? 0, set: (ob, index, r) => r.world.materials.setActive(ob, index) },
    // BKE_object_dimensions_get: the bounding box's size in the object's scale; setting it scales the object.
    dimensions: array((ob) => dimensions(ob), (ob, value) => {
      const now = dimensions(ob), scale = axes(ob.scaling.asArray());
      ob.scaling.copyFromFloats(...axes(scale.map((s, i) => (now[i] ? (s * value[i]) / now[i] : s))));
    }),
    parent: (ob, r) => (r.world.objects.includes(ob.parent) ? r.pointer('Object', ob.parent) : null),
    children: (ob, r) => collection(r.objects().filter((child) => child.parent === ob).map((child) => r.pointer('Object', child))),
    // The active modifier is the one last made active (object.modifier_set_active, or added), else the last.
    modifiers: (ob, r) => {
      const stack = modifierStack(ob), structs = stack.map((modifier) => r.pointer(modifierStruct(modifier), { node: ob, modifier }, modifier));
      return collection(structs, structs[stack.findIndex((m) => m.id === ob.metadata?.wbActiveModifier)] ?? structs.at(-1) ?? null);
    },
    material_slots: (ob, r) => collection((r.world.materials?.slots(ob) ?? []).map((material, slot_index) =>
      rna('MaterialSlot', { name: material?.name ?? '', material: r.pointer('Material', material), slot_index }))),
    active_material: (ob, r) => r.pointer('Material', r.world.materials?.activeMaterial(ob)),
    // Disable Selection is Bylonder's lock (commands.lock); Disable in Renders and in Viewports are kept with the object.
    hide_select: { get: (ob) => ob.isPickable === false || !!ob.metadata?.wbLocked, set: (ob, value) => {
      ob.metadata = { ...ob.metadata, wbLocked: !!value };
      if ('isPickable' in ob) ob.isPickable = !value;
    } },
    hide_render: { get: (ob) => !!ob.metadata?.wbHideRender, set: (ob, value) => { ob.metadata = { ...ob.metadata, wbHideRender: !!value }; } },
    hide_viewport: { get: (ob) => !!ob.metadata?.wbHideViewport, set: (ob, value) => { ob.metadata = { ...ob.metadata, wbHideViewport: !!value }; } },
    hide_get: (ob) => () => !ob.isEnabled(false),
    hide_set: (ob, r) => (hide) => { ob.setEnabled(!hide); r.host.update?.('Object', 'hide', ob); },
    visible_get: (ob) => () => !deleted(ob) && ob.isEnabled() && ob.isVisible !== false,
    select_get: (ob, r) => () => !!r.host.selection?.has(ob),
    select_set: (ob, r) => (state) => { if (!!r.host.selection?.has(ob) !== !!state) r.host.selection?.toggle(ob, true); },
  },
  // Bylonder's objects hold their mesh: the Mesh is the object's.
  Mesh: {
    name: (ob) => ob.name,
    total_vert_sel: (ob, r) => editTotals(ob, r).verts[0],
    total_edge_sel: (ob, r) => editTotals(ob, r).edges[0],
    total_face_sel: (ob, r) => editTotals(ob, r).faces[0],
    count_selected_items: (ob, r) => () => { const t = editTotals(ob, r); return [t.verts[0], t.edges[0], t.faces[0]]; },
    vertices: (ob, r) => meshVertices(ob, r),
  },
  // A material of the material library (blenkernel/material/library.js): Babylon's PBR or Standard material as
  // Blender's Principled BSDF, its settings as Blender's.
  Material: {
    name: { get: (material) => material.name, set: (material, name, r) => r.world.materials.rename(material, name) },
    use_fake_user: { get: (material) => !!material.metadata?.wbFakeUser, set: (material, value, r) => { if (!!value !== !!material.metadata?.wbFakeUser) r.world.materials.toggleFakeUser(material); } },
    use_nodes: () => true,
    node_tree: (material, r) => nodeTree(r, ['Material Output', 'ShaderNodeOutputMaterial', [
      ['Surface', 'NodeSocketShader', ['Principled BSDF', 'ShaderNodeBsdfPrincipled', principledInputs(material)]],
      ['Volume', 'NodeSocketShader', null]]]),
    use_backface_culling: settable('backFaceCulling'),
    alpha_threshold: settable('alphaCutOff'),
    surface_render_method: { get: (material) => (material.transparencyMode === 2 || material.transparencyMode === 3 ? 'BLENDED' : 'DITHERED'),
      set: (material, method) => { material.transparencyMode = method === 'BLENDED' ? 2 : null; } },
  },
  Modifier: (owner) => ({
    name: modifierFlag('name'),
    type: ({ modifier }) => modifierType(modifier),
    show_viewport: modifierFlag('showViewport'),
    show_render: modifierFlag('showRender'),
    ...modifierValues(owner),
  }),
  Scene: {
    name: { get: (world) => world.sceneSettings?.state.name ?? 'Scene', set: (world, name) => world.sceneSettings.set('name', name, false) },
    frame_current: { get: (world) => Math.round(world.animation.time.frame), set: (world, frame) => world.animation.time.configure({ frameCurrent: frame }, { record: false }) },
    ...Object.fromEntries([['frame_start', 'frameStart'], ['frame_end', 'frameEnd'], ['frame_step', 'frameStep'], ['use_preview_range', 'usePreviewRange'],
      ['frame_preview_start', 'framePreviewStart'], ['frame_preview_end', 'framePreviewEnd'], ['sync_mode', 'syncMode']].map(([name, key]) => [name, {
      get: (world) => world.animation.time.state[key], set: (world, value) => world.animation.time.configure({ [key]: value }, { record: false }) }])),
    camera: (world, r) => r.pointer('Object', world.sceneSettings?.camera()),
    objects: (world, r) => collection(r.objects().map((ob) => r.pointer('Object', ob))),
    use_gravity: { get: (world) => world.sceneSettings?.state.useGravity ?? true, set: (world, value) => world.sceneSettings.set('useGravity', value, false) },
    gravity: array((world) => axes(world.scene.gravity.asArray()), (world, value) => world.sceneSettings.set('gravity', axes(value), false)),
    render: (world, r) => r.pointer('RenderSettings', world),
    world: { get: (world, r) => r.pointer('World', world.worlds?.active()), set: (world, value) => world.worlds.link(value?.[INFO].owner ?? null) },
    eevee: (world, r) => r.pointer('SceneEEVEE', world),
    view_settings: (world, r) => r.pointer('ColorManagedViewSettings', world),
    display_settings: (world, r) => r.pointer('ColorManagedDisplaySettings', world),
    collection: (world, r) => world.collections && r.pointer('Collection', world.collections.byId('scene')),
    view_layers: (world, r) => collection((world.collections?.viewLayers() ?? []).map((layer) => r.pointer('ViewLayer', layer))),
    unit_settings: (world, r) => r.pointer('UnitSettings', world),
    tool_settings: (world, r) => r.pointer('ToolSettings', world),
    cursor: (world, r) => r.pointer('View3DCursor', world),
    // The scene's orientation, then the Move, Rotate and Scale tools' (Default: the scene's), as the scene keeps them.
    transform_orientation_slots: (world) => (orientationSlots.get(world) ?? orientationSlots.set(world, collection([0, 1, 2, 3].map((slot) =>
      rna('TransformOrientationSlot', { type: slot ? 'DEFAULT' : 'GLOBAL' }, { items: { type: () => [...(slot ? [ORIENTATION_DEFAULT] : []),
        ...rnaProperty('TransformOrientationSlot', 'type').items] } })))).get(world)),
  },
  View3DCursor: {
    location: array((world) => [...cursorOf(world).location], (world, value) => world.sceneSettings.setCursor({ location: value })),
    rotation_mode: { get: (world) => cursorOf(world).rotation_mode, set: (world, rotation_mode) => world.sceneSettings.setCursor({ rotation_mode }) },
    rotation_euler: array((world) => [...cursorOf(world).rotation_euler], (world, value) => world.sceneSettings.setCursor({ rotation_euler: value })),
    rotation_quaternion: array((world) => [...cursorOf(world).rotation_quaternion],
      (world, value) => world.sceneSettings.setCursor({ rotation_quaternion: value }), 'wxyz'),
  },
  ToolSettings: {
    workspace_tool_type: { get: (world) => world.toolsystem?.workspace_tool_type ?? 'FALLBACK', set: (world, value) => { world.toolsystem.workspace_tool_type = value; } },
    mesh_select_mode: array((world) => SELECT_BITS.map((bit) => !!((world.editMode?.selectmode ?? SCE_SELECT_VERTEX) & bit)), (world, value) => {
      const mode = SELECT_BITS.reduce((mask, bit, i) => (value[i] ? mask | bit : mask), 0);
      if (mode && world.editMode) world.editMode.selectmode = mode;
    }, ''),
    use_keyframe_insert_auto: { get: (world) => world.animation.time.state.autoKey, set: (world, value) => world.animation.time.configure({ autoKey: !!value }, { record: false }) },
  },
  RenderSettings: {
    fps: { get: (world) => world.animation.time.state.fps, set: (world, fps) => world.animation.time.configure({ fps }, { record: false }) },
    ...Object.fromEntries([['resolution_x', 'resolutionX'], ['resolution_y', 'resolutionY'], ['resolution_percentage', 'resolutionPercentage'],
      ['use_motion_blur', 'useMotionBlur'], ['motion_blur_shutter', 'motionBlurShutter'], ['use_sequencer', 'useSequencer']].map(([name, key]) => [name, {
      get: (world) => world.renderSettings?.state.render[key], set: (world, value) => world.renderSettings.set('render.' + key, value, false) }])),
    image_settings: (world, r) => r.pointer('ImageFormatSettings', world),
    // Bylonder renders with Babylon, set up as Blender's EEVEE (render-babylon.js): the engines are Blender's, their
    // choice decides which of Blender's render panels show.
    engine: { ...sliceValue('renderSettings', 'render.blenderEngine'), get: (world) => world.renderSettings?.state.render.blenderEngine ?? 'BLENDER_EEVEE',
      items: () => [['BLENDER_EEVEE', 'EEVEE', '', 'NONE'], ['BLENDER_WORKBENCH', 'Workbench', '', 'NONE'], ['CYCLES', 'Cycles', '', 'NONE']] },
    has_multiple_engines: () => true,
    ffmpeg: (world, r) => r.pointer('FFmpegSettings', world),
  },
  UnitSettings: Object.fromEntries([['system', 'system'], ['scale_length', 'scale'], ['use_separate', 'separate'], ['system_rotation', 'rotation'],
    ['length_unit', 'length']].map(([name, key]) => [name, {
    get: (world) => world.sceneSettings?.state.unitSettings[key], set: (world, value) => world.sceneSettings.set('unitSettings.' + key, value, false) }])),
  ...curveStructs,
  // A Graph Editor and a Dope Sheet (editors/animation/anim-editor.js): their space's flags, in the module (rna_space.cc).
  SpaceGraphEditor: {
    type: () => 'GRAPH_EDITOR',
    show_region_ui: regionShown(4),
    show_region_channels: regionShown(2),
    cursor_position_y: { get: (editor) => editor.area.cursorValue, set: (editor, value) => { editor.area.cursorValue = value; editor.changed(); } },
    mode: (editor) => ['FCURVES', 'DRIVERS'][editor.area.settings.mode],
    ui_mode: (editor) => ['FCURVES', 'DRIVERS'][editor.area.settings.mode],
    show_handles: spaceFlag(1 << 2, true),
    use_only_selected_keyframe_handles: spaceFlag(1 << 9),
    show_seconds: spaceFlag(1 << 4),
    show_sliders: spaceFlag(1 << 7),
    show_cursor: spaceFlag(1 << 8, true),
    use_realtime_update: spaceFlag(1 << 11, true),
    use_normalization: spaceFlag(1 << 14),
    use_auto_normalization: spaceFlag(1 << 15, true),
    show_markers: spaceFlag(1 << 16),
    show_extrapolation: spaceFlag(1 << 17, true),
    use_auto_merge_keyframes: spaceFlag(1 << 1, true),
    has_ghost_curves: () => false,
    pivot_point: { get: (editor) => PIVOTS[editor.area.settings.around], set: (editor, value) => { editor.area.settings = { around: PIVOTS.indexOf(value) }; editor.changed(); } },
    dopesheet: (editor, r) => r.pointer('DopeSheet', editor),
  },
  SpaceDopeSheetEditor: {
    type: () => 'DOPESHEET_EDITOR',
    show_region_ui: regionShown(4),
    show_region_channels: regionShown(2),
    mode: (editor) => ACTION_MODES[editor.area.settings.mode],
    ui_mode: (editor) => ACTION_MODES[editor.area.settings.mode],
    show_sliders: spaceFlag(1 << 1),
    show_seconds: spaceFlag(1 << 2),
    use_auto_merge_keyframes: spaceFlag(1 << 4, true),
    show_pose_markers: spaceFlag(1 << 6),
    use_realtime_update: spaceFlag(1 << 10, true),
    use_marker_sync: spaceFlag(1 << 11),
    show_interpolation: spaceFlag(1 << 12),
    show_extremes: spaceFlag(1 << 13),
    show_markers: spaceFlag(1 << 14),
    dopesheet: (editor, r) => r.pointer('DopeSheet', editor),
  },
  DopeSheet: {
    show_only_selected: dopesheetFilter(1 << 0),
    show_hidden: dopesheetFilter(1 << 26),
    show_only_errors: dopesheetFilter(1 << 28),
  },
  // The module's animation data (blenkernel/animation/anim-blender.js): an F-Curve, a key of one ({ fcurve, index }),
  // an Action and its active slot, as the animation editors' sidebars edit them (rna_fcurve.cc, rna_action.cc).
  FCurve: {
    data_path: (fcurve) => fcurve.rna_path,
    array_index: (fcurve) => fcurve.array_index,
    color_mode: settable('color_mode'),
    color: array((fcurve) => fcurve.color, (fcurve, value) => { fcurve.color = value; }, 'rgb'),
    auto_smoothing: settable('auto_smoothing'),
    extrapolation: settable('extrapolation'),
  },
  Keyframe: {
    ...Object.fromEntries(['interpolation', 'easing', 'type', 'back', 'amplitude', 'period'].map((name) => [name, {
      get: ({ fcurve, index }) => fcurve.keys[index][name],
      set: ({ fcurve, index }, value) => fcurve.editKey(index, (key) => { key[name] = value; }),
    }])),
    ...Object.fromEntries([['co_ui', 'co'], ['handle_left', 'handle_left'], ['handle_right', 'handle_right']].map(([name, field]) => [name,
      array(({ fcurve, index }) => fcurve.keys[index][field], ({ fcurve, index }, value) => fcurve.editKeyPanel(index, name, value))])),
    ...Object.fromEntries(['handle_left_type', 'handle_right_type'].map((name) => [name, {
      get: ({ fcurve, index }) => fcurve.keys[index][name],
      set: ({ fcurve, index }, value) => fcurve.editKeyPanel(index, name, value),
    }])),
  },
  Action: {
    name: (action) => action.name,
    ...Object.fromEntries(['use_frame_range', 'use_cyclic', 'frame_start', 'frame_end'].map((name) => [name, settable(name)])),
    slots: (action, r) => Object.assign(collection(), { active: action.activeSlot && r.pointer('ActionSlot', action.activeSlot) }),
  },
  ActionSlot: {
    name_display: (slot) => slot.name_display,
    target_id_type: () => 'OBJECT',
    target_id_type_icon: (slot) => slot.icon,
  },
  Light: {
    name: settable('name'),
    type: lightType,
    color: array((light) => light.diffuse.asArray(), (light, value) => light.diffuse.copyFromFloats(...value), 'rgb'),
    energy: { get: (light) => light.intensity * watts(light), set: (light, value) => { light.intensity = value / watts(light); } },
    shadow_soft_size: settable('radius'),
    use_shadow: settable('shadowEnabled'),
    spot_size: settable('angle'),
    spot_blend: { get: (light) => (light.angle ? 1 - light.innerAngle / light.angle : 0), set: (light, value) => { light.innerAngle = (1 - value) * light.angle; } },
  },
  Camera: {
    name: settable('name'),
    type: { get: (camera) => (camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? 'ORTHO' : 'PERSP'), set: (camera, type) => { camera.mode = type === 'ORTHO' ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA; } },
    // A horizontally fixed field of view is Blender's Auto fit for landscape output.
    sensor_fit: { get: (camera) => (horizontal(camera) ? 'AUTO' : 'VERTICAL'), set: (camera, fit) => {
      const lens = sensor(camera) / 2 / Math.tan(camera.fov / 2);
      camera.fovMode = fit === 'VERTICAL' ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED;
      camera.fov = 2 * Math.atan(sensor(camera) / 2 / lens);
    } },
    lens: { get: (camera) => sensor(camera) / 2 / Math.tan(camera.fov / 2), set: (camera, lens) => { camera.fov = 2 * Math.atan(sensor(camera) / 2 / lens); } },
    angle: settable('fov'),
    // How the lens is shown (millimeters or field of view), kept with the camera.
    lens_unit: { get: (camera) => camera.metadata?.wbLensUnit ?? 'MILLIMETERS', set: (camera, unit) => { camera.metadata = { ...camera.metadata, wbLensUnit: unit }; } },
    clip_start: settable('minZ'),
    clip_end: settable('maxZ'),
  },
  // A world datablock of the worlds slice (blenkernel/scene/world.js): its Background and volume as Blender's nodes.
  World: (entry) => ({
    name: { get: () => entry.name, set: (owner, name, r) => r.world.worlds.rename(entry, name) },
    color: array(() => entry.background.color, (owner, value, r) => r.world.worlds.set(entry, 'background.color', value, false), 'rgb'),
    use_nodes: () => true,
    node_tree: (owner, r) => nodeTree(r, ['World Output', 'ShaderNodeOutputWorld', [
      ['Surface', 'NodeSocketShader', ['Background', 'ShaderNodeBackground', [
        ['Color', 'NodeSocketColor', rgba(() => entry.background.color, (value) => r.world.worlds.set(entry, 'background.color', value, false))],
        ['Strength', 'NodeSocketFloat', worldValue(r, entry, 'background.strength')]]]],
      ['Volume', 'NodeSocketShader', entry.volume.type === 'NONE' ? null : ['Volume Scatter', 'ShaderNodeVolumeScatter', [
        ['Color', 'NodeSocketColor', rgba(() => entry.volume.color, (value) => r.world.worlds.set(entry, 'volume.color', value, false))],
        ['Density', 'NodeSocketFloat', worldValue(r, entry, 'volume.density')]]]]]]),
  }),
  // A collection of the collections slice (blenkernel/scene/collections.js).
  Collection: (entry) => ({
    name: { get: () => entry.name ?? 'Scene Collection', set: (owner, name, r) => r.world.collections.rename(entry.id, name) },
    hide_select: { get: () => !!entry.hideSelect, set: (owner, value, r) => r.world.collections.set(entry.id, { hideSelect: !!value }) },
    hide_viewport: { get: () => !!entry.hideViewport, set: (owner, value, r) => r.world.collections.set(entry.id, { hideViewport: !!value }) },
    children: (owner, r) => collection(entry.children.map((id) => r.pointer('Collection', r.world.collections.byId(id)))),
  }),
  ViewLayer: (layer) => ({
    name: { get: () => layer.name, set: (owner, name, r) => r.world.collections.renameViewLayer(layer.id, name) },
    use: () => true,
    active_layer_collection: (owner, r) => r.pointer('LayerCollection', r.world.collections.byId(layer.active)),
    objects: (owner, r) => layerObjects(r),
  }),
  LayerCollection: (entry) => ({
    name: () => entry.name ?? 'Scene Collection',
    collection: (owner, r) => r.pointer('Collection', entry),
  }),
  SceneEEVEE: {
    taa_samples: sliceValue('renderSettings', 'eevee.taaSamples'),
    taa_render_samples: sliceValue('renderSettings', 'eevee.taaRenderSamples'),
    use_raytracing: sliceValue('renderSettings', 'eevee.useRaytracing'),
    ray_tracing_method: sliceValue('renderSettings', 'eevee.rayTracingMethod'),
    fast_gi_method: sliceValue('renderSettings', 'eevee.fastGiMethod'),
    fast_gi_distance: sliceValue('renderSettings', 'eevee.fastGiDistance'),
    ray_tracing_options: (world, r) => r.pointer('RaytraceEEVEE', world),
  },
  RaytraceEEVEE: {
    screen_trace_quality: sliceValue('renderSettings', 'eevee.screenTraceQuality'),
    screen_trace_thickness: sliceValue('renderSettings', 'eevee.screenTraceThickness'),
  },
  ColorManagedViewSettings: {
    view_transform: { ...sliceValue('renderSettings', 'viewSettings.viewTransform'), items: choices(viewTransforms) },
    look: { ...sliceValue('renderSettings', 'viewSettings.look'), items: choices(looks, ([label]) => label) },
    exposure: sliceValue('renderSettings', 'viewSettings.exposure'),
  },
  ColorManagedDisplaySettings: {
    display_device: { get: () => 'sRGB', items: () => [['sRGB', 'sRGB', '', 'NONE']] },
  },
  ImageFormatSettings: {
    file_format: { ...sliceValue('renderSettings', 'render.imageSettings.fileFormat'), items: choices(fileFormats) },
    quality: sliceValue('renderSettings', 'render.imageSettings.quality'),
  },
  FFmpegSettings: {
    format: { ...sliceValue('renderSettings', 'render.ffmpeg.format'), items: choices(containers) },
    codec: { ...sliceValue('renderSettings', 'render.ffmpeg.codec'), items: (world) => choices(videoCodecs)().filter(([id]) => containers[world.renderSettings.state.render.ffmpeg.format]?.codecs.includes(id)) },
    constant_rate_factor: { ...sliceValue('renderSettings', 'render.ffmpeg.constantRateFactor'), items: choices(qualities) },
    gopsize: sliceValue('renderSettings', 'render.ffmpeg.gopsize'),
  },
  // The Properties editor (space_buttons/editor.js): its tab, pinned data and search.
  SpaceProperties: {
    type: () => 'PROPERTIES',
    context: { get: (space) => space.context, set: (space, context) => { space.context = context; }, items: (space) => space.tabs() },
    use_pin_id: { get: (space) => !!space.pin, set: (space, value) => space.setPin(value) },
    pin_id: (space) => space.pinned?.() ?? null,
    search_filter: settable('search'),
    ...Object.fromEntries(['tool', 'render', 'output', 'view_layer', 'scene', 'world', 'collection', 'object', 'modifiers', 'effects', 'particles',
      'physics', 'constraints', 'data', 'bone', 'bone_constraints', 'material', 'texture', 'strip', 'strip_modifier'].map((tab) => ['show_properties_' + tab, () => true])),
  },
  // A 3D Viewport (space_view3d/view3d.js): its shading, overlays and view.
  // The workspace's active tools (bToolRef, windowmanager/wm-toolsystem.js), as rna_workspace_api.cc gives them.
  WorkSpace: {
    tools: (world, r) => Object.assign(collection(), {
      from_space_view3d_mode: (...list) => {
        const { mode, create } = pyArgs(list, ['mode', 'create']);
        return r.pointer('WorkSpaceTool', world.toolsystem?.ref('VIEW_3D', mode, !!create));
      },
    }),
  },
  WorkSpaceTool: {
    ...Object.fromEntries(['idname', 'idname_fallback', 'index', 'space_type', 'mode'].map((name) => [name, (ref) => ref[name]])),
    widget: (ref) => ref.gizmo_group,
    use_brushes: (ref) => ref.options.has('USE_BRUSHES'),
    use_paint_canvas: (ref) => ref.options.has('USE_PAINT_CANVAS'),
    setup: (ref, r) => (...list) => r.world.toolsystem.setup(ref, pyArgs(list, TOOL_SETUP)),
    refresh_from_context: () => () => {},
    operator_properties: (ref, r) => (idname) => operatorProperties(idname, r.world.toolsystem.properties(ref, idname), r.host),
    gizmo_group_properties: (ref, r) => (idname) => gizmoGroupProperties(idname, r.world.toolsystem.properties(ref, idname), r.host),
  },
  // A Text data-block (blenkernel/texts.js) and its lines; an edit saves the text with the project.
  Text: {
    name: { get: (text) => text.name, set: (text, name, r) => r.world.texts.rename(text, name) },
    filepath: (text) => text.filepath,
    is_in_memory: () => true,
    is_dirty: () => false,
    is_modified: () => false,
    indentation: { get: (text) => (text.tabsToSpaces ? 'SPACES' : 'TABS'), set: (text, value, r) => { text.tabsToSpaces = value === 'SPACES'; r.world.texts.edited(text); } },
    lines: (text, r) => collection(text.lines.map((_, i) => textLine(text, i, r))),
    current_line: (text, r) => textLine(text, text.curl, r),
    select_end_line: (text, r) => textLine(text, text.sell, r),
    ...Object.fromEntries([['current_line_index', 'curl'], ['current_character', 'curc'], ['select_end_line_index', 'sell'], ['select_end_character', 'selc']].map(([name, key]) => [name,
      { get: (text) => text[key], set: (text, value, r) => { text[key] = value; r.world.texts.edited(text); } }])),
    clear: (text, r) => () => { text.setContent(''); r.world.texts.edited(text); },
    write: (text, r) => (value) => { text.moveEof(false); text.insert(value); r.world.texts.edited(text); },
    from_string: (text, r) => (value) => { text.setContent(value); r.world.texts.edited(text); },
    as_string: (text) => () => text.content,
    cursor_set: (text, r) => (...list) => {
      const { line, character = 0, select = false } = pyArgs(list, ['line', 'character', 'select']);
      text.moveTo(line, character, !!select);
      r.world.texts.edited(text);
    },
    select_set: (text, r) => (...list) => {
      const { line_start, char_start, line_end, char_end } = pyArgs(list, ['line_start', 'char_start', 'line_end', 'char_end']);
      text.moveTo(line_start, char_start, false);
      text.moveTo(line_end, char_end, true);
      r.world.texts.edited(text);
    },
  },
  // The Text Editor (editors/space_text): its text and settings.
  SpaceTextEditor: {
    type: () => 'TEXT_EDITOR',
    text: { get: (st, r) => r.pointer('Text', st.text), set: (st, value) => st.setText(value?.[INFO].owner ?? null) },
    ...Object.fromEntries(['show_line_numbers', 'show_word_wrap', 'show_syntax_highlight', 'show_line_highlight', 'show_margin', 'margin_column', 'font_size', 'tab_width',
      'show_region_ui', 'show_region_footer', 'use_live_edit', 'use_match_case', 'use_find_wrap', 'use_find_all', 'find_text', 'replace_text'].map((name) => [name, spaceSetting(name)])),
    top: { get: (st) => st.top, set: (st, value) => st.scrollTo(value) },
    visible_lines: (st) => st.visibleLines(),
    use_overwrite: (st) => st.settings.overwrite,
    is_syntax_highlight_supported: (st) => () => isSyntaxHighlightSupported(st.text),
  },
  // The Python Console (editors/space_console): its lines, prompt and language.
  SpaceConsole: {
    type: () => 'CONSOLE',
    ...Object.fromEntries(['font_size', 'prompt', 'language', 'select_start', 'select_end'].map((name) => [name, spaceSetting(name)])),
    scrollback: (sc) => collection(sc.scrollback.map((line) => rna('ConsoleLine', line))),
    history: (sc) => collection(sc.history.map((line) => rna('ConsoleLine', line))),
  },
  SpaceInfo: { type: () => 'INFO' },
  WindowManager: {
    clipboard: { get: () => clipboard, set: (owner, value) => setClipboard(String(value)) },
  },
  // A 3D Viewport (space_view3d/view3d.js): its regions, shading, overlays and view.
  SpaceView3D: {
    type: () => 'VIEW_3D',
    ...Object.fromEntries(['show_region_toolbar', 'show_region_ui', 'show_region_tool_header', 'show_region_header', 'show_gizmo'].map((name) => [name,
      { get: (view) => view.state[name], set: (view, value) => setViewState(view, name, !!value) }])),
    shading: (view, r) => r.pointer('View3DShading', view),
    overlay: (view, r) => r.pointer('View3DOverlay', view),
    // rna_SpaceView3D_icon_from_show_object_viewport_get, by name: every object type visible and selectable.
    icon_from_show_object_viewport: () => 'VIS_SEL_11',
    region_3d: (view, r) => r.pointer('RegionView3D', view),
  },
  View3DShading: {
    type: { get: (view) => SHADING[view.state.shading], set: (view, type) => setViewState(view, 'shading', Object.keys(SHADING).find((id) => SHADING[id] === type)) },
    show_xray: { get: (view) => !!view.state.xray, set: (view, value) => setViewState(view, 'xray', !!value) },
  },
  View3DOverlay: { show_overlays: { get: (view) => view.state.overlays, set: (view, value) => setViewState(view, 'overlays', !!value) } },
  RegionView3D: {
    view_perspective: (view) => (view.state.cameraView ? 'CAMERA' : view.editorCamera?.mode === Camera.ORTHOGRAPHIC_CAMERA ? 'ORTHO' : 'PERSP'),
    is_perspective: (view) => view.editorCamera?.mode !== Camera.ORTHOGRAPHIC_CAMERA,
  },
  // The Outliner's SpaceOutliner is Blender's, in the module (space_outliner/outliner-area.js): its DNA, read in place.
  SpaceOutliner: (space) => ({ type: () => 'OUTLINER', ...Object.fromEntries(Object.keys(space).map((name) => [name,
    { get: () => space[name], set: (owner, value) => { space[name] = value; } }])) }),
};
const SHADING = { wire: 'WIREFRAME', solid: 'SOLID', rendered: 'RENDERED' };
// One of a text's lines (TextLine); writing its body edits the text.
const textLine = (text, i, r) => rna('TextLine', {
  get body() { return text.lines[i] ?? ''; },
  set body(value) { text.lines[i] = String(value); r.world.texts.edited(text); },
  format: '',
});
// Mesh.vertices over the Babylon mesh's position buffer, the geometry's one owner (docs/blender-boundary.md, Who owns
// what): `co` in Blender's axes, per vertex (MeshVertex, made when read) or whole through foreach_get and foreach_set,
// which copy the buffer once. Babylon's vertices are split where Blender's are shared.
function meshVertices(ob, r) {
  const positions = () => ob.getVerticesData?.(VertexBuffer.PositionKind) ?? [];
  const write = (data) => { ob.setVerticesData(VertexBuffer.PositionKind, data, ob.getVertexBuffer(VertexBuffer.PositionKind)?.isUpdatable()); ob.refreshBoundingInfo?.(); r.host.update?.('Mesh', 'vertices', ob); };
  const vertex = (i) => rna('MeshVertex', {
    index: i,
    get co() { const p = positions(); return axes([p[3 * i], p[3 * i + 1], p[3 * i + 2]]); },
    set co(value) { const p = Float32Array.from(positions()); [p[3 * i], p[3 * i + 2], p[3 * i + 1]] = value; write(p); },
  });
  const swap = (from, to) => { for (let i = 0; i < from.length; i += 3) { to[i] = from[i]; to[i + 1] = from[i + 2]; to[i + 2] = from[i + 1]; } return to; };
  const list = Object.assign(collection(new Array(positions().length / 3)), {
    __foreach_get__: (attr) => (attr === 'co' ? swap(positions(), new Float64Array(positions().length)) : undefined),
    __foreach_set__: (attr, values) => (attr === 'co' ? (write(swap(values, new Float32Array(values.length))), true) : undefined),
  });
  return new Proxy(list, { get: (target, key) => (typeof key === 'string' && /^\d+$/.test(key) ? vertex(Number(key)) : target[key]) });
}

// The window manager's clipboard (WM_clipboard_text_set); the system's is written too, and read where it can be.
let clipboard = '';
export const setClipboard = (value) => { clipboard = value; globalThis.navigator?.clipboard?.writeText(value).catch(() => {}); };
export const readClipboard = async () => { try { return (await globalThis.navigator.clipboard.readText()) ?? clipboard; } catch { return clipboard; } };
// A flag of an animation editor's space (eGraphEdit_Flag, eSAction_Flag), and of its dope sheet's filters; `inverted`
// for a property that is on when the flag is off (show_handles is !SIPO_NOHANDLES).
function spaceFlag(bit, inverted = false) {
  return {
    get: (editor) => !!(editor.area.settings.flag & bit) !== inverted,
    set: (editor, value) => { const { flag } = editor.area.settings; editor.area.settings = { flag: !!value !== inverted ? flag | bit : flag & ~bit }; editor.changed(); },
  };
}
// Whether an animation editor's region (RGN_TYPE_UI 4, RGN_TYPE_CHANNELS 2) shows.
function regionShown(type) {
  return { get: (editor) => editor.area.shown(type), set: (editor, value) => { editor.area.show(type, value); editor.changed(); } };
}
function dopesheetFilter(bit) {
  return {
    get: (editor) => !!(editor.area.settings.filterflag & bit),
    set: (editor, value) => { const { filterflag } = editor.area.settings; editor.area.settings = { filterflag: value ? filterflag | bit : filterflag & ~bit }; editor.changed(); },
  };
}
const PIVOTS = ['BOUNDING_BOX_CENTER', 'CURSOR', 'INDIVIDUAL_ORIGINS'];
const ACTION_MODES = ['ACTION', 'SHAPEKEY', 'GPENCIL', 'DOPESHEET', 'MASK', 'CACHEFILE', 'TIMELINE'];
// Scenes' transform orientation slots (Scene.transform_orientation_slots).
const orientationSlots = new WeakMap();
// The scene's 3D cursor, or Blender's default one in a world without scene settings.
const DEFAULT_CURSOR = { location: [0, 0, 0], rotation_mode: 'XYZ', rotation_euler: [0, 0, 0], rotation_quaternion: [1, 0, 0, 0] };
const cursorOf = (world) => world.sceneSettings?.state.cursor ?? DEFAULT_CURSOR;
const TOOL_SETUP = ['idname', 'keymap', 'cursor', 'options', 'gizmo_group', 'brush_type', 'data_block', 'operator', 'index', 'idname_fallback', 'keymap_fallback'];

// A tool's orientation slot's own choice (rna_scene.cc: rna_TransformOrientation_with_scene_itemf).
const ORIENTATION_DEFAULT = ['DEFAULT', 'Default', 'Use the scene orientation', 'OBJECT_ORIGIN'];

// The properties tools set on their gizmo groups (the groups' RNA_def_* in transform_gizmo_3d.cc,
// transform_gizmo_extrude_3d.cc and view3d_gizmo_tool_generic.cc): default and enum items.
const GIZMO_GROUP_PROPERTIES = {
  VIEW3D_GGT_xform_gizmo: { drag_action: ['TRANSLATE', [['TRANSLATE', 'Move', '', 'NONE'], ['ROTATE', 'Rotate', '', 'NONE'], ['SCALE', 'Scale', '', 'NONE'], ['NONE', 'None', '', 'NONE']]] },
  VIEW3D_GGT_xform_extrude: { axis_type: ['NORMAL', [['NORMAL', 'Normal', 'Only show normal axis', 'NONE'], ['XYZ', 'XYZ', 'Follow scene orientation', 'NONE']]] },
  VIEW3D_GGT_tool_generic_handle_normal: { radius: [100] },
  VIEW3D_GGT_tool_generic_handle_free: { radius: [36], backdrop_fill_alpha: [0.125] },
};
// A tool's properties of a gizmo group (WM_toolsystem_ref_properties_ensure_from_gizmo_group): the values set on it
// over the group's defaults.
export function gizmoGroupProperties(idname, values, host) {
  const data = {}, items = {};
  for (const [name, [def, enumItems]] of Object.entries(GIZMO_GROUP_PROPERTIES[idname] ?? {})) {
    Object.defineProperty(data, name, { enumerable: true, get: () => values[name] ?? def, set: (value) => { values[name] = value; host?.update?.('GizmoGroupProperties', name, values); } });
    if (enumItems) items[name] = () => enumItems;
  }
  return rna('GizmoGroupProperties', data, { items });
}

// An operator's properties (OperatorProperties) over the values stored for it: Blender's defaults (rna-operators.json)
// until set. Writing one is an update (host.update), as a tool setting is.
export function operatorProperties(idname, values, host) {
  const data = {};
  for (const [name, def] of Object.entries(rnaOperators[idname]?.properties ?? {})) {
    Object.defineProperty(data, name, {
      enumerable: true,
      get: () => values[name] ?? def.default,
      set: (value) => { values[name] = value; host?.update?.('OperatorProperties', name, values); },
    });
  }
  return rna(operatorStruct(idname), data);
}
function setViewState(view, key, value) {
  if (value === undefined) throw TypeError(`bpy_struct: invalid ${key}`);
  if (key === 'shading' && view.setShading) return view.setShading(value);
  view.state[key] = value;
  view.sync?.();
}

// The RNA of one host's data: pointer(struct, owner) is the struct over a Bylonder owner (None for none), one per owner
// so scripts see the same struct each time; `key` is the owner's identity when the owner is made per call.
export function createRNA(host) {
  const cache = new WeakMap();
  const r = {
    host,
    world: host.world,
    objects: () => host.world.objects.filter((ob) => !deleted(ob)),
    // bpy.data.texts: the project's texts, with new and remove (py_new as Transcrypt names it).
    texts() {
      const texts = host.world.texts;
      if (!texts) return collection();
      const add = (...list) => r.pointer('Text', texts.new(pyArgs(list, ['name']).name ?? 'Text'));
      return Object.assign(collection(texts.all.map((text) => r.pointer('Text', text))), {
        new: add, py_new: add, remove: (...list) => texts.remove(pyArgs(list, ['text']).text?.[INFO].owner),
      });
    },
    pointer(struct, owner, key = owner) {
      if (!owner || !struct) return null;
      const structs = cache.get(key) ?? cache.set(key, new Map()).get(key);
      if (!structs.has(struct)) structs.set(struct, bind(struct, owner));
      return structs.get(struct);
    },
  };
  // A struct's bindings are its own table or its nearest base's (PointLight binds as Light).
  function bind(struct, owner) {
    let base = struct;
    while (base && !STRUCTS[base]) base = baseOf(base);
    const bindings = STRUCTS[base] ?? {};
    const table = typeof bindings === 'function' ? bindings(owner) : bindings, data = {}, items = {}, channels = {};
    for (const [name, binding] of Object.entries(table)) {
      const { get, set, items: enumItems, channel } = typeof binding === 'function' ? { get: binding } : binding;
      Object.defineProperty(data, name, {
        enumerable: true,
        get: () => get(owner, r),
        set: set && ((value) => { set(owner, value, r); host.update?.(struct, name, owner); }),
      });
      if (enumItems) items[name] = () => enumItems(owner, r);
      if (channel) channels[name] = (index) => channel(owner, index);
    }
    return rna(struct, data, { items, channels, owner });
  }
  return r;
}

// What layout.prop shows (editors/interface/ui-layout.js, as `ui.prop`): a bound boolean as a check item whose edit is an
// undo step.
export const propBinding = (host) => (data, name) => {
  if (!data || typeof data[name] !== 'boolean' || !Object.getOwnPropertyDescriptor(Object(data), name)?.set) return null;
  const label = name.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  return { label, get: () => data[name], set: (value) => { data[name] = value; host.undoPush?.(label); } };
};
