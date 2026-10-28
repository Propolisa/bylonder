// Bylonder's data under Blender's RNA (makesrna/intern/rna_*.cc): per struct, the properties Bylonder has, as
// { get(owner, r), set(owner, value, r) } or a bare getter for a read-only one. The rest read as Blender's defaults
// (rna.js). Values are in Blender's axes (Z up, right-handed): Babylon's (x, y, z) is Blender's (x, z, y).
// A write is RNA's set and update: it changes Bylonder's data and calls host.update (the notifier); undo steps are
// pushed by the UI that made the edit (host.undoPush), as Blender's buttons push them, never by RNA.
//   host: { world (runtime/world.js), selection (editors/object/selection.js), preferences,
//           update(struct, name, owner), undoPush(name) }
import { Camera, Light, PointLight, SpotLight, Quaternion } from '@babylonjs/core';
import { rna, collection, baseOf, INFO, pyArgs, rnaProperty, operatorStruct } from './rna.js';
import modifierTypes from './rna-modifiers.json' with { type: 'json' };
import rnaOperators from './rna-operators.json' with { type: 'json' };
import { modifierStack } from '../modifiers/stack.js';
import { deleted, nodeId } from '../editors/object/identity.js';
import { address } from '../blenkernel/animation/model.js';
import { viewTransforms, looks } from '../blenkernel/scene/render-babylon.js';
import { fileFormats, containers, videoCodecs, qualities } from '../render/formats.js';
import { textDefaults, updateText } from '../blenkernel/text/text.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../bmesh/intern/bmesh-marking.js';

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
const objectType = (ob) => (ob instanceof Camera ? 'CAMERA' : ob instanceof Light ? 'LIGHT' : ob.metadata?.wbCreation?.text ? 'FONT'
  : ob.metadata?.wbCurve ? 'CURVE' : ob.getTotalVertices?.() > 0 ? 'MESH' : 'EMPTY');
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
// A text object's options, and one of them as an RNA property (with Blender's units where they differ).
const text = (ob) => ({ ...textDefaults, ...ob.metadata?.wbCreation?.text });
const textOption = (key, read = (v) => v, write = (v) => v) => ({ get: (ob) => read(text(ob)[key]), set: (ob, value) => { updateText(ob, { [key]: write(value) }); } });
// A camera's sensor along the fitted axis: Babylon fixes the horizontal or the vertical field of view.
const horizontal = (camera) => camera.fovMode === Camera.FOVMODE_HORIZONTAL_FIXED;
const sensor = (camera) => (horizontal(camera) ? 36 : 24);
const settable = (key) => ({ get: (owner) => owner[key], set: (owner, value) => { owner[key] = value; } });
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
    hide_select: { get: (ob) => ob.isPickable === false, set: (ob, value) => { ob.isPickable = !value; } },
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
    // The scene's orientation, then the Move, Rotate and Scale tools' (Default: the scene's), as the scene keeps them.
    transform_orientation_slots: (world) => (orientationSlots.get(world) ?? orientationSlots.set(world, collection([0, 1, 2, 3].map((slot) =>
      rna('TransformOrientationSlot', { type: slot ? 'DEFAULT' : 'GLOBAL' }, { items: { type: () => [...(slot ? [ORIENTATION_DEFAULT] : []),
        ...rnaProperty('TransformOrientationSlot', 'type').items] } })))).get(world)),
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
  // Bylonder's text objects (blenkernel/text/text.js): the text and its options, which regenerate the object's mesh.
  // Blender's extrude is half the depth, its spacings are factors of the font's (Bylonder's line height 1.2 is 1).
  TextCurve: {
    name: settable('name'),
    body: textOption('text'),
    size: textOption('size'),
    extrude: textOption('depth', (depth) => depth / 2, (extrude) => extrude * 2),
    space_character: textOption('spacing', (spacing) => spacing + 1, (factor) => factor - 1),
    space_line: textOption('lineHeight', (height) => height / 1.2, (factor) => factor * 1.2),
    align_x: textOption('align', (align) => align.toUpperCase(), (align) => (['LEFT', 'CENTER', 'RIGHT'].includes(align) ? align.toLowerCase() : 'left')),
    resolution_u: textOption('resolution'),
    font: (ob) => rna('VectorFont', { name: text(ob).family, filepath: '' }),
  },
  // Bylonder's curves (metadata.wbCurve): poly splines of points in Blender's axes.
  Curve: {
    name: settable('name'),
    dimensions: () => '3D',
    splines: (ob) => collection((ob.metadata?.wbCurve ?? []).map((path) => rna('Spline', {
      type: 'POLY', use_cyclic_u: path.closed, points: collection(path.points.map((point) => rna('SplinePoint', { co: [...axes(point), 1] }))) }))),
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
    gizmo_group_properties: () => () => rna('GizmoGroupProperties'),
  },
  // A 3D Viewport (space_view3d/view3d.js): its regions, shading, overlays and view.
  SpaceView3D: {
    type: () => 'VIEW_3D',
    ...Object.fromEntries(['show_region_toolbar', 'show_region_ui', 'show_region_tool_header', 'show_region_header'].map((name) => [name,
      { get: (view) => view.state[name], set: (view, value) => setViewState(view, name, !!value) }])),
    shading: (view, r) => r.pointer('View3DShading', view),
    overlay: (view, r) => r.pointer('View3DOverlay', view),
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
};
const SHADING = { wire: 'WIREFRAME', solid: 'SOLID', rendered: 'RENDERED' };
// Scenes' transform orientation slots (Scene.transform_orientation_slots).
const orientationSlots = new WeakMap();
const TOOL_SETUP = ['idname', 'keymap', 'cursor', 'options', 'gizmo_group', 'brush_type', 'data_block', 'operator', 'index', 'idname_fallback', 'keymap_fallback'];

// A tool's orientation slot's own choice (rna_scene.cc: rna_TransformOrientation_with_scene_itemf).
const ORIENTATION_DEFAULT = ['DEFAULT', 'Default', 'Use the scene orientation', 'OBJECT_ORIGIN'];

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
