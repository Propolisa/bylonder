// Bylonder's data under Blender's RNA (makesrna/intern/rna_*.cc): per struct, the properties Bylonder has, as
// { get(owner, r), set(owner, value, r) } or a bare getter for a read-only one. The rest read as Blender's defaults
// (rna.js). Values are in Blender's axes (Z up, right-handed): Babylon's (x, y, z) is Blender's (x, z, y).
// A write is RNA's set and update: it changes Bylonder's data and calls host.update (the notifier); undo steps are
// pushed by the UI that made the edit (host.undoPush), as Blender's buttons push them, never by RNA.
// A binding with `sync` (true, or a test of the owner) is also kept equal in Blender's Main, at the DNA field Blender's
// RNA names (blenkernel/main-sync.js): the same declaration reads and writes both ways.
//   host: { world (runtime/world.js), selection (editors/object/selection.js), preferences,
//           update(struct, name, owner), undoPush(name) }
import { blendData } from '../python/bpy_rna.js';
import { Camera, Light, PointLight, SpotLight, Quaternion } from '@babylonjs/core';
import { objectMesh } from '../editors/object/object-mesh.js';
import { rebuildMesh } from '../editors/object/mesh-catalog.js';
import { mesh_deserialize, mesh_serialize } from '../blenkernel/mesh/mesh.js';
import { rna, collection, baseOf, INFO, pyArgs, rnaProperty } from './rna.js';
import modifierTypes from './rna-modifiers.json' with { type: 'json' };
import { modifierStack } from '../modifiers/stack.js';
import { deleted, nodeId, hasMesh } from '../editors/object/identity.js';
import { address } from '../blenkernel/animation/model.js';
import { viewTransforms, looks } from '../blenkernel/scene/render-babylon.js';
import { fileFormats, containers, videoCodecs, qualities } from '../render/formats.js';
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE } from '../bmesh/intern/bmesh-marking.js';
import { curveStructs } from './rna-curve.js';
import { textureSettings, textureStruct } from '../blenkernel/texture/texture.js';
import { isBlenderLight, lightRecord, deriveBabylonLight, lightingMode, intensityOf, wattsOf } from '../blenkernel/light/light-home.js';
import { lightFields } from '../blenkernel/light/light-fields.js';

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
// A camera that looks at a target (an Arc Rotate camera, or one locked on a target) is turned by its view, not its rotation.
const aimed = (ob) => ob instanceof Camera && (ob.getClassName() === 'ArcRotateCamera' || !!ob.lockedTarget);
const viewQuaternion = (ob) => Quaternion.FromRotationMatrix(ob.getWorldMatrix().getRotationMatrix());
const lookingRotation = {
  get: (ob) => eulerXYZ(lookingFrame(quaternionMatrix(aimed(ob) ? viewQuaternion(ob) : babylonQuaternion(ob)))),
  set: (ob, value) => setRotation(ob, matrixQuaternion(lookingFrame(matrixXYZ(value)))),
};

// A number or boolean array (bpy_prop_array), its elements named x, y, z (or w, x, y, z): bind gives a copy whose elements
// write through.
const array = (get, set, names = 'xyz') => ({ get, set: set && ((owner, value, r) => set(owner, [...value], r)), names });
function elements(values, names, set) {
  const index = (key) => (key.length === 1 && names.includes(key) ? names.indexOf(key) : key);
  return new Proxy(Array.from(values), {
    get: (copy, key) => copy[typeof key === 'string' ? index(key) : key],
    set(copy, key, value) {
      if (!set) return false;
      copy[index(key)] = value;
      set([...copy]);
      return true;
    },
  });
}

const dimensions = (ob) => {
  const size = ob.getBoundingInfo?.().boundingBox.extendSize.scale(2) ?? { x: 0, y: 0, z: 0 };
  return axes([size.x * Math.abs(ob.scaling.x), size.y * Math.abs(ob.scaling.y), size.z * Math.abs(ob.scaling.z)]);
};
const SELECT_BITS = [SCE_SELECT_VERTEX, SCE_SELECT_EDGE, SCE_SELECT_FACE];
const lightType = (light) => lightRecord(light)?.type ?? (light instanceof SpotLight ? 'SPOT' : light instanceof PointLight ? 'POINT' : light.getClassName() === 'RectAreaLight' ? 'AREA' : 'SUN');
export const LIGHT_STRUCTS = { POINT: 'PointLight', SPOT: 'SpotLight', SUN: 'SunLight', AREA: 'AreaLight' };
const OBJECT_DATA = { MESH: () => 'Mesh', LIGHT: (ob) => LIGHT_STRUCTS[lightType(ob)], CAMERA: () => 'Camera', FONT: () => 'TextCurve', CURVE: () => 'Curve', ARMATURE: () => 'Armature' };
// An object the view made for a type of Blender's it draws only as evaluated (a surface, a metaball, a lattice) keeps it.
const objectType = (ob) => (ob.metadata?.wbType ?? (ob instanceof Camera ? 'CAMERA' : ob instanceof Light ? 'LIGHT' : ob.metadata?.wbCreation?.curve?.type
  ?? (ob.metadata?.wbCreation?.armature ? 'ARMATURE' : ob.metadata?.wbCurve ? 'CURVE' : ob.getTotalVertices && hasMesh(ob) ? 'MESH' : 'EMPTY')));
const editing = (ob, r) => !!ob && r.world.editMode?.object === ob;
const editTotals = (ob, r) => (editing(ob, r) && r.world.editMode.stats) || { verts: [0], edges: [0], faces: [0] };

// Bylonder's modifier types that are Blender's keep their type; its own (Array as Geometry Nodes) are Nodes modifiers.
const modifierType = (modifier) => (modifierTypes.types[modifier.type] ? modifier.type : 'NODES');
const modifierStruct = (modifier) => modifierTypes.types[modifier.type]?.struct ?? 'NodesModifier';
// A modifier as its stack holds it now (Main's are read again each time).
const current = ({ node, modifier }, r) => r.world.modifiers?.stack(node).find((m) => m.id === modifier.id) ?? modifier;
const modifierFlag = (key) => ({ get: (owner, r) => current(owner, r)[key], set: ({ node, modifier }, value, r) => r.world.modifiers.update(node, modifier.id, { [key]: value }) });
// A Blender modifier's settings, stored by RNA identifier (`count`, `use_axis[0]`, see modifiers/blender.js).
function modifierValues(owner) {
  const { node, modifier } = owner, values = (r) => current(owner, r).values;
  const set = (path, value, r) => r.world.modifiers.set(node, modifier.id, path, value, { finish: false });
  const names = Object.keys(modifier.values).map((path) => path.replace(/\[\d+\]$/, ''));
  return Object.fromEntries([...new Set(names)].filter((name) => modifierTypes.types[modifier.type]?.properties[name]).map((name) => [name,
    name in modifier.values
      ? { get: (o, r) => values(r)[name], set: (o, value, r) => set(name, value, r) }
      : array((o, r) => Object.entries(values(r)).filter(([path]) => path.startsWith(name + '[')).map(([, value]) => value),
        (o, list, r) => list.forEach((value, i) => set(`${name}[${i}]`, value, r)))]));
}

// A texture of the textures slice as its type's struct (CloudsTexture), as RNA refines a Texture.
const texturePointer = (r, entry) => r.pointer(entry && textureStruct(entry.values.type), entry);

// An object transform's animation channels, by Blender's axis (Blender's X, Y, Z are Babylon's x, z, y).
const objectChannel = (property) => (ob, index) => address('object:' + nodeId(ob), property + '.' + 'xzy'[index]);
// Bylonder's transform locks (metadata.wbTransformLocks, by Babylon path) as Blender's lock_location and the like.
const transformLocks = (property) => array((ob) => [...'xzy'].map((axis) => !!ob.metadata?.wbTransformLocks?.[property + '.' + axis]), (ob, value) => {
  ob.metadata = { ...ob.metadata, wbTransformLocks: { ...ob.metadata?.wbTransformLocks, ...Object.fromEntries(value.map((locked, i) => [property + '.' + 'xzy'[i], !!locked])) } };
});
// A camera's sensor along the fitted axis: Babylon fixes the horizontal or the vertical field of view.
const horizontal = (camera) => camera.fovMode === Camera.FOVMODE_HORIZONTAL_FIXED;
const sensor = (camera) => (horizontal(camera) ? 36 : 24);
const settable = (key) => ({ get: (owner) => owner[key], set: (owner, value) => { owner[key] = value; } });
const subframe = (world) => world.animation.time.frame - Math.floor(world.animation.time.frame);
const notPBR = (material) => material.getClassName() !== 'PBRMaterial';
const synced = (binding, sync = true) => ({ ...(typeof binding === 'function' ? { get: binding } : binding), sync });
const quaternion = (ob) => !!ob.rotationQuaternion;
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
    // A linked node, or { node, socket }: a node and the output it links from.
    const from = Array.isArray(value) ? { node: value } : value?.node ? value : null, linked = from && shaderNode(r, from.node);
    const fromSocket = from?.socket ? rna(from.socket.type, { identifier: from.socket.identifier, name: from.socket.identifier }) : null;
    const data = { name: input, identifier: input, enabled: true, hide_value: false, is_linked: !!linked,
      links: collection(linked ? [rna('NodeLink', { from_node: linked, from_socket: fromSocket, is_valid: true })] : []) };
    if (value && !linked) Object.defineProperty(data, 'default_value', { enumerable: true, get: value.get, set: (v) => { value.set(v); r.host.update?.(socket, 'default_value', data); } });
    return rna(socket, data);
  })), outputs: collection() });
}
// An object's AnimData: the scene's Action (Blender 5's layered one: a layer with a keyframe strip) with its slot for
// the object, whose channelbag holds the F-Curves on the Object that stands for it in the module's Blender world.
function animationData(r, ob) {
  const { animation } = r.world, owner = animation?.ids.find('object:' + nodeId(ob)), fcurves = owner ? animation.anim.fcurves(owner) : [];
  if (!fcurves.length) return null;
  const slot = rna('ActionSlot', { identifier: 'OB' + ob.name, name_display: ob.name, target_id_type: 'OBJECT' });
  const keyframe = (key) => rna('Keyframe', { co: key.co, handle_left: key.handle_left, handle_right: key.handle_right, interpolation: key.interpolation });
  const fcurve = (curve) => rna('FCurve', { data_path: curve.rna_path, array_index: curve.array_index, group: curve.group, keyframe_points: collection(curve.keys.map(keyframe)) });
  const channelbag = rna('ActionChannelbag', { slot, fcurves: collection(fcurves.map(fcurve)) });
  const strip = rna('ActionKeyframeStrip', { type: 'KEYFRAME', channelbags: collection([channelbag]), channelbag: (forSlot) => (forSlot === slot ? channelbag : null) });
  const action = rna('Action', { name: animation.action.name, is_action_layered: true, slots: collection([slot]), layers: collection([rna('ActionLayer', { name: 'Layer', strips: collection([strip]) })]) });
  return rna('AnimData', { action, action_slot: slot });
}
// The nodes from a tree's output down its links, each once.
function treeNodes(output, found = new Map()) {
  if (found.has(output[0])) return found;
  found.set(output[0], output);
  for (const [, , value] of output[2]) {
    const linked = Array.isArray(value) ? value : value?.node;
    if (linked) treeNodes(linked, found);
  }
  return found;
}
const nodeTree = (r, output) => rna('ShaderNodeTree', {
  get_output_node: () => shaderNode(r, output),
  get nodes() { return collection([...treeNodes(output).values()].map((node) => shaderNode(r, node))); },
});
// Blender's socket types (node-types.json) as the socket structs Main's node trees are built with.
const SOCKET_STRUCTS = { VALUE: 'NodeSocketFloat', RGBA: 'NodeSocketColor', VECTOR: 'NodeSocketVector', SHADER: 'NodeSocketShader' };
const socketStruct = (s) => (s.type === 'VALUE' && s.subtype === 'FACTOR' ? 'NodeSocketFloatFactor' : SOCKET_STRUCTS[s.type]);
// A node material's Blender nodes (src/nodes/blender) as Blender's node tree, from its Material Output: each node's
// inputs, unlinked ones by their values. Babylon's blocks and the nodes' properties are kept in the material's graph
// only (main-sync's PROPERTIES.graph).
function blenderNodeTree(r, material) {
  const output = material.attachedBlocks?.find((b) => b.getClassName() === 'ShaderNodeOutputMaterial');
  if (!output) return null;
  const names = new Map();
  const nameOf = (block) => {
    if (!names.has(block)) {
      const taken = new Set(names.values());
      let name = block.name;
      for (let i = 1; taken.has(name); i++) name = `${block.name}.${String(i).padStart(3, '0')}`;
      names.set(block, name);
    }
    return names.get(block);
  };
  const isBlender = (block) => !!block?.declaration && !!block.idname;
  const node = (block) => [nameOf(block), block.idname, block.declaration.inputs.filter(socketStruct).map((s) => {
    const from = block.getInputByName(s.identifier)?.connectedPoint;
    const out = isBlender(from?.ownerBlock) && from.ownerBlock.declaration.outputs.find((o) => o.identifier === from.name);
    const value = s.hide_value ? null : { get: () => block.values[s.identifier], set: (v) => { block.values[s.identifier] = v; } };
    return [s.identifier, socketStruct(s), out ? { node: node(from.ownerBlock), socket: { identifier: out.identifier, type: socketStruct(out) } } : value];
  })];
  return nodeTree(r, node(output));
}
const rgba = (get, set) => ({ get: () => [...get(), 1], set: (value) => set([...value].slice(0, 3)) });
// A Babylon material's inputs as Principled BSDF sockets: a PBR material's own, a Standard material's color and alpha.
const color3 = (owner, key) => owner[key] && ({ get: () => [owner[key].r, owner[key].g, owner[key].b, 1], set: ([red, green, blue]) => owner[key].set(red, green, blue) });
const materialValue = (material, path) => {
  const keys = path.split('.'), key = keys.pop(), owner = () => keys.reduce((o, k) => o?.[k], material);
  return owner()?.[key] === undefined ? null : { get: () => owner()[key], set: (value) => { owner()[key] = value; } };
};
// A PBR layer's weight (clear coat, sheen): its intensity while enabled, as Blender's weight 0 turns the layer off.
const layerWeight = (layer) => layer && { get: () => (layer.isEnabled ? layer.intensity : 0), set: (weight) => { layer.isEnabled = weight > 0; if (weight > 0) layer.intensity = weight; } };
// Babylon's F0 factor is 1 where Blender's Specular IOR Level is 0.5 (the IOR's own reflectance).
const specularLevel = (material) => ({ get: () => material.metallicF0Factor / 2, set: (level) => { material.metallicF0Factor = level * 2; } });
function principledInputs(material) {
  const pbr = material.getClassName() === 'PBRMaterial', value = (path) => materialValue(material, path);
  return [
    ['Base Color', 'NodeSocketColor', color3(material, pbr ? 'albedoColor' : 'diffuseColor')],
    ['Metallic', 'NodeSocketFloatFactor', pbr && value('metallic')],
    ['Roughness', 'NodeSocketFloatFactor', pbr && value('roughness')],
    ['IOR', 'NodeSocketFloat', pbr && value('indexOfRefraction')],
    ['Alpha', 'NodeSocketFloatFactor', value('alpha')],
    ['Normal', 'NodeSocketVector', null],
    ['Specular IOR Level', 'NodeSocketFloatFactor', pbr && specularLevel(material)],
    ['Coat Weight', 'NodeSocketFloatFactor', pbr && layerWeight(material.clearCoat)],
    ['Sheen Weight', 'NodeSocketFloatFactor', pbr && layerWeight(material.sheen)],
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

const babylonLight = {
  name: settable('name'),
  type: synced(lightType),
  color: synced(array((light) => light.diffuse.asArray(), (light, value) => light.diffuse.copyFromFloats(...value), 'rgb')),
  energy: { get: (light) => wattsOf(lightType(light), light.intensity, lightingMode(light.getScene())),
    set: (light, value) => { light.intensity = intensityOf(lightType(light), value, lightingMode(light.getScene())); }, sync: true },
  shadow_soft_size: synced(settable('radius'), (light) => lightType(light) !== 'SUN'),
  use_shadow: synced(settable('shadowEnabled')),
  spot_size: synced(settable('angle'), (light) => lightType(light) === 'SPOT'),
  spot_blend: { get: (light) => (light.angle ? 1 - light.innerAngle / light.angle : 0), set: (light, value) => { light.innerAngle = (1 - value) * light.angle; },
    sync: (light) => lightType(light) === 'SPOT' },
};
// Every Light setting Blender's DNA has for the light's type, over its record.
const blenderLight = (light) => {
  const record = lightRecord(light);
  const values = Object.fromEntries(lightFields(record.type).map((name) => [name, {
    get: () => record[name], set: (owner, value) => { record[name] = value; deriveBabylonLight(owner); }, sync: name !== 'type' }]));
  return { ...values, name: settable('name'), type: synced(() => record.type) };
};
const STRUCTS = {
  Object: {
    name: { get: (ob) => ob.name, set: (ob, name) => { ob.name = name; } },
    type: objectType,
    // An armature's mode is Blender's (main-sync.js keeps it on the object).
    mode: (ob, r) => (editing(ob, r) ? 'EDIT' : ob.metadata?.wbMode ?? 'OBJECT'),
    data: (ob, r) => r.pointer(OBJECT_DATA[objectType(ob)]?.(ob), ob),
    location: { ...array((ob) => axes(ob.position.asArray()), (ob, value) => ob.position.copyFromFloats(...axes(value))), channel: objectChannel('position'), sync: true },
    // Babylon has a quaternion or its own Euler order (Blender's YXZ), so setting it switches between the two only.
    rotation_mode: synced({ get: (ob) => (ob.rotationQuaternion ? 'QUATERNION' : looksAlongZ(ob) ? 'XYZ' : 'YXZ'), set: (ob, mode) => {
      if ((mode === 'QUATERNION') === !!ob.rotationQuaternion) return;
      const rotation = babylonQuaternion(ob);
      ob.rotationQuaternion = mode === 'QUATERNION' ? rotation : null;
      if (!ob.rotationQuaternion) ob.rotation.copyFrom(rotation.toEulerAngles());
    } }),
    rotation_euler: { ...array((ob) => (looksAlongZ(ob) ? lookingRotation.get(ob) : eulerFromBabylon(babylonEuler(ob))), (ob, value) => {
      if (looksAlongZ(ob)) return lookingRotation.set(ob, value);
      const { x, y, z } = eulerToBabylon(value);
      setRotation(ob, Quaternion.FromEulerAngles(x, y, z));
    }), channel: objectChannel('rotation'), sync: (ob) => !quaternion(ob) },
    rotation_quaternion: synced(array((ob) => { const q = babylonQuaternion(ob); return [q.w, -q.x, -q.z, -q.y]; },
      (ob, [w, x, y, z]) => setRotation(ob, new Quaternion(-x, -z, -y, w)), 'wxyz'), quaternion),
    scale: { ...array((ob) => axes(ob.scaling.asArray()), (ob, value) => ob.scaling.copyFromFloats(...axes(value))), channel: objectChannel('scaling'), sync: true },
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
    // ObjectModifiers.new(name, type) and remove(modifier).
    modifiers: (ob, r) => {
      const stack = r.world.modifiers?.stack(ob) ?? modifierStack(ob), pointer = (modifier) => r.pointer(modifierStruct(modifier), { node: ob, modifier }, `${nodeId(ob)}:${modifier.id}`), structs = stack.map(pointer);
      const add = (...list) => {
        const { name, type } = pyArgs(list, ['name', 'type']), modifier = r.world.modifiers.add(ob, type);
        if (name) r.world.modifiers.update(ob, modifier.id, { name });
        return pointer(modifier);
      };
      const remove = (...list) => r.world.modifiers.remove(ob, pyArgs(list, ['modifier']).modifier[INFO].owner.modifier.id);
      return Object.assign(collection(structs, structs[stack.findIndex((m) => m.id === ob.metadata?.wbActiveModifier)] ?? structs.at(-1) ?? null),
        { new: add, py_new: add, remove });
    },
    animation_data: (ob, r) => animationData(r, ob),
    material_slots: (ob, r) => collection((r.world.materials?.slots(ob) ?? []).map((material, slot_index) =>
      rna('MaterialSlot', { name: material?.name ?? '', material: r.pointer('Material', material), slot_index }))),
    active_material: (ob, r) => r.pointer('Material', r.world.materials?.activeMaterial(ob)),
    // Disable Selection is Bylonder's lock (commands.lock); Disable in Renders and in Viewports are kept with the object.
    hide_select: { get: (ob) => ob.isPickable === false || !!ob.metadata?.wbLocked, set: (ob, value) => {
      ob.metadata = { ...ob.metadata, wbLocked: !!value };
      if ('isPickable' in ob) ob.isPickable = !value;
    }, sync: true },
    hide_render: { get: (ob) => !!ob.metadata?.wbHideRender, set: (ob, value) => { ob.metadata = { ...ob.metadata, wbHideRender: !!value }; }, sync: true },
    hide_viewport: { get: (ob) => !!ob.metadata?.wbHideViewport, set: (ob, value) => { ob.metadata = { ...ob.metadata, wbHideViewport: !!value }; }, sync: true },
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
    vertices: (ob, r) => meshElements(ob, r).vertices,
    edges: (ob, r) => meshElements(ob, r).edges,
    polygons: (ob, r) => meshElements(ob, r).polygons,
  },
  // A material of the material library (blenkernel/material/library.js): Babylon's PBR or Standard material as
  // Blender's Principled BSDF, its settings as Blender's.
  Material: {
    name: { get: (material) => material.name, set: (material, name, r) => r.world.materials.rename(material, name) },
    use_fake_user: { get: (material) => !!material.metadata?.wbFakeUser, set: (material, value, r) => { if (!!value !== !!material.metadata?.wbFakeUser) r.world.materials.toggleFakeUser(material); } },
    use_nodes: () => true,
    node_tree: (material, r) => blenderNodeTree(r, material) ?? nodeTree(r, ['Material Output', 'ShaderNodeOutputMaterial', [
      ['Surface', 'NodeSocketShader', ['Principled BSDF', 'ShaderNodeBsdfPrincipled', principledInputs(material)]],
      ['Volume', 'NodeSocketShader', null]]]),
    use_backface_culling: synced(settable('backFaceCulling')),
    // A node material has no cutoff of its own: Blender's default.
    // A PBR material's transparency is its Principled BSDF's alpha, as glTF has it (principled-gltf.js).
    alpha_threshold: synced({ ...settable('alphaCutOff'), get: (material) => material.alphaCutOff ?? 0.5 }, notPBR),
    surface_render_method: synced({ get: (material) => (material.transparencyMode === 2 || material.transparencyMode === 3 ? 'BLENDED' : 'DITHERED'),
      set: (material, method) => { material.transparencyMode = method === 'BLENDED' ? 2 : null; } }, notPBR),
  },
  Modifier: (owner) => ({
    name: modifierFlag('name'),
    type: ({ modifier }) => modifierType(modifier),
    show_viewport: modifierFlag('showViewport'),
    show_render: modifierFlag('showRender'),
    ...modifierValues(owner),
    ...('texture' in owner.modifier.values && { texture: {
      get: (owner, r) => texturePointer(r, r.world.textures?.byId(current(owner, r).values.texture)),
      set: ({ node, modifier }, value, r) => r.world.modifiers.set(node, modifier.id, 'texture', value?.[INFO].owner.id ?? null, { finish: false }),
    } }),
    // The object a modifier deforms by (an Armature modifier's armature), held by its id.
    ...('object' in owner.modifier.values && { object: {
      get: (owner, r) => r.pointer('Object', r.objects().find((ob) => nodeId(ob) === current(owner, r).values.object)),
      set: ({ node, modifier }, value, r) => r.world.modifiers.set(node, modifier.id, 'object', value ? nodeId(value[INFO].owner) : null, { finish: false }),
    } }),
  }),
  // A texture of the textures slice (blenkernel/texture/textures.js): the settings of its type's Tex.
  Texture: (entry) => ({
    name: { get: () => entry.name, set: (owner, name, r) => r.world.textures.rename(entry, name) },
    use_fake_user: { get: () => entry.fakeUser, set: (owner, value, r) => { if (!!value !== entry.fakeUser) r.world.textures.toggleFakeUser(entry); } },
    users: (owner, r) => r.world.textures.users(entry),
    ...Object.fromEntries(textureSettings(entry.values.type).map((name) => [name,
      { get: () => entry.values[name], set: (owner, value, r) => r.world.textures.set(entry, name, value, false) }])),
  }),
  Scene: {
    name: { get: (world) => world.sceneSettings?.state.name ?? 'Scene', set: (world, name) => world.sceneSettings.set('name', name, false) },
    // The frame is Blender's whole frame and its subframe (playback that drops frames is between frames).
    frame_current: { get: (world) => Math.floor(world.animation.time.frame), set: (world, frame) => world.animation.time.configure({ frameCurrent: frame + subframe(world) }, { record: false }), sync: true },
    frame_subframe: { get: subframe, set: (world, value) => world.animation.time.configure({ frameCurrent: Math.floor(world.animation.time.frame) + value }, { record: false }), sync: true },
    ...Object.fromEntries([['frame_start', 'frameStart'], ['frame_end', 'frameEnd'], ['frame_step', 'frameStep'], ['use_preview_range', 'usePreviewRange'],
      ['frame_preview_start', 'framePreviewStart'], ['frame_preview_end', 'framePreviewEnd'], ['sync_mode', 'syncMode']].map(([name, key]) => [name, {
      get: (world) => world.animation.time.state[key], set: (world, value) => world.animation.time.configure({ [key]: value }, { record: false }), sync: name !== 'sync_mode' }])),
    camera: (world, r) => r.pointer('Object', world.sceneSettings?.camera()),
    objects: (world, r) => collection(r.objects().map((ob) => r.pointer('Object', ob))),
    use_gravity: { get: (world) => world.sceneSettings?.state.useGravity ?? true, set: (world, value) => world.sceneSettings.set('useGravity', value, false), sync: true },
    gravity: synced(array((world) => axes(world.scene.gravity.asArray()), (world, value) => world.sceneSettings.set('gravity', axes(value), false))),
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
    location: { ...array((world) => [...cursorOf(world).location], (world, value) => world.sceneSettings.setCursor({ location: value })), sync: true },
    rotation_mode: { get: (world) => cursorOf(world).rotation_mode, set: (world, rotation_mode) => world.sceneSettings.setCursor({ rotation_mode }), sync: true },
    rotation_euler: { ...array((world) => [...cursorOf(world).rotation_euler], (world, value) => world.sceneSettings.setCursor({ rotation_euler: value })), sync: true },
    rotation_quaternion: { ...array((world) => [...cursorOf(world).rotation_quaternion],
      (world, value) => world.sceneSettings.setCursor({ rotation_quaternion: value }), 'wxyz'), sync: true },
  },
  ToolSettings: {
    mesh_select_mode: array((world) => SELECT_BITS.map((bit) => !!((world.editMode?.selectmode ?? SCE_SELECT_VERTEX) & bit)), (world, value) => {
      const mode = SELECT_BITS.reduce((mask, bit, i) => (value[i] ? mask | bit : mask), 0);
      if (mode && world.editMode) world.editMode.selectmode = mode;
    }, ''),
    use_keyframe_insert_auto: { get: (world) => world.animation.time.state.autoKey, set: (world, value) => world.animation.time.configure({ autoKey: !!value }, { record: false }), sync: true },
  },
  RenderSettings: {
    fps: { get: (world) => world.animation.time.state.fps, set: (world, fps) => world.animation.time.configure({ fps }, { record: false }), sync: true },
    ...Object.fromEntries([['resolution_x', 'resolutionX'], ['resolution_y', 'resolutionY'], ['resolution_percentage', 'resolutionPercentage'],
      ['use_motion_blur', 'useMotionBlur'], ['motion_blur_shutter', 'motionBlurShutter'], ['use_sequencer', 'useSequencer']].map(([name, key]) => [name, {
      get: (world) => world.renderSettings?.state.render[key], set: (world, value) => world.renderSettings.set('render.' + key, value, false), sync: name !== 'use_sequencer' }])),
    image_settings: (world, r) => r.pointer('ImageFormatSettings', world),
    // Bylonder renders with Babylon, set up as Blender's EEVEE (render-babylon.js): the engines are Blender's, their
    // choice decides which of Blender's render panels show.
    engine: { ...sliceValue('renderSettings', 'render.blenderEngine'), get: (world) => world.renderSettings?.state.render.blenderEngine ?? 'BLENDER_EEVEE', sync: true,
      items: () => [['BLENDER_EEVEE', 'EEVEE', '', 'NONE'], ['BLENDER_WORKBENCH', 'Workbench', '', 'NONE'], ['CYCLES', 'Cycles', '', 'NONE']] },
    has_multiple_engines: () => true,
    ffmpeg: (world, r) => r.pointer('FFmpegSettings', world),
  },
  UnitSettings: Object.fromEntries([['system', 'system'], ['scale_length', 'scale'], ['use_separate', 'separate'], ['system_rotation', 'rotation'],
    ['length_unit', 'length']].map(([name, key]) => [name, {
    get: (world) => world.sceneSettings?.state.unitSettings[key], set: (world, value) => world.sceneSettings.set('unitSettings.' + key, value, false), sync: true }])),
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
    ui_mode: {
      get: (editor) => ACTION_MODES[editor.area.settings.mode],
      set: (editor, value) => { editor.area.setSpaceProperty('SpaceDopeSheetEditor', 'ui_mode', ACTION_MODES.indexOf(value)); editor.changed(); },
    },
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
    filter_text: { get: (editor) => editor.area.filterText, set: (editor, value) => { editor.area.filterText = value; editor.changed(); } },
    // ADS_FLAG_INVERT_FILTER.
    use_filter_invert: { get: (editor) => !!(editor.area.dopesheetFlag & (1 << 4)),
      set: (editor, value) => { const flag = editor.area.dopesheetFlag; editor.area.dopesheetFlag = value ? flag | (1 << 4) : flag & ~(1 << 4); editor.changed(); } },
    show_only_selected: dopesheetFilter(1 << 0),
    show_hidden: dopesheetFilter(1 << 26),
    show_only_errors: dopesheetFilter(1 << 28),
  },
  // The module's animation data (blenkernel/animation/anim-blender.js): an Action and its active slot, as the Dope
  // Sheet's sidebar edits them (rna_action.cc).
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
  // A light by its home world (blenkernel/light/light-home.js): a Blender light's settings are its own, a Babylon
  // light's are Babylon's with Blender's derived as the glTF exporter derives them.
  Light: (light) => (isBlenderLight(light) ? blenderLight(light) : babylonLight),
  Camera: {
    name: settable('name'),
    type: { get: (camera) => (camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? 'ORTHO' : 'PERSP'), set: (camera, type) => { camera.mode = type === 'ORTHO' ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA; }, sync: true },
    // A horizontally fixed field of view is Blender's Auto fit for landscape output.
    sensor_fit: { get: (camera) => (horizontal(camera) ? 'AUTO' : 'VERTICAL'), set: (camera, fit) => {
      const lens = sensor(camera) / 2 / Math.tan(camera.fov / 2);
      camera.fovMode = fit === 'VERTICAL' ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED;
      camera.fov = 2 * Math.atan(sensor(camera) / 2 / lens);
    }, sync: true },
    lens: { get: (camera) => sensor(camera) / 2 / Math.tan(camera.fov / 2), set: (camera, lens) => { camera.fov = 2 * Math.atan(sensor(camera) / 2 / lens); }, sync: true },
    angle: settable('fov'),
    // How the lens is shown (millimeters or field of view), kept with the camera.
    lens_unit: { get: (camera) => camera.metadata?.wbLensUnit ?? 'MILLIMETERS', set: (camera, unit) => { camera.metadata = { ...camera.metadata, wbLensUnit: unit }; }, sync: true },
    clip_start: synced(settable('minZ')),
    clip_end: synced(settable('maxZ')),
  },
  // A world datablock of the worlds slice (blenkernel/scene/world.js): its Background and volume as Blender's nodes.
  World: (entry) => ({
    name: { get: () => entry.name, set: (owner, name, r) => r.world.worlds.rename(entry, name) },
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
    hide_select: { get: () => !!entry.hideSelect, set: (owner, value, r) => r.world.collections.set(entry.id, { hideSelect: !!value }), sync: true },
    hide_viewport: { get: () => !!entry.hideViewport, set: (owner, value, r) => r.world.collections.set(entry.id, { hideViewport: !!value }), sync: true },
    hide_render: { get: () => !!entry.hideRender, set: (owner, value, r) => r.world.collections.set(entry.id, { hideRender: !!value }), sync: true },
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
    exclude: { get: (owner, r) => !!r.world.collections.layerFlags(entry.id).exclude, set: (owner, value, r) => r.world.collections.setLayer(entry.id, { exclude: !!value }), sync: true },
    hide_viewport: { get: (owner, r) => !!r.world.collections.layerFlags(entry.id).hideViewport,
      set: (owner, value, r) => r.world.collections.setLayer(entry.id, { hideViewport: !!value }), sync: true },
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
    exposure: synced(sliceValue('renderSettings', 'viewSettings.exposure')),
  },
  ColorManagedDisplaySettings: {
    display_device: { get: () => 'sRGB', items: () => [['sRGB', 'sRGB', '', 'NONE']], sync: true },
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
const SHADING = { wire: 'WIREFRAME', solid: 'SOLID', material: 'MATERIAL', rendered: 'RENDERED' };
// Mesh.vertices, edges and polygons: the object's Mesh (objectMesh, its Blender topology in Blender's axes), filled
// from Babylon's side when read (docs/blender-boundary.md, Who owns what, point 5). `co` reads and writes per vertex
// (MeshVertex, made when read) or whole through foreach_get and foreach_set; a write rebuilds the object's mesh.
function meshElements(ob, r) {
  // A copy JS owns: a primitive's Mesh can be views of the module's memory, which growing it detaches.
  const mesh = mesh_deserialize(mesh_serialize(objectMesh(ob))), positions = mesh.vert_positions;
  const write = () => {
    const recipe = { mesh: mesh_serialize(mesh) };
    ob.metadata = { ...ob.metadata, wbCreation: recipe };
    rebuildMesh(ob, recipe);
    r.host.update?.('Mesh', 'vertices', ob);
  };
  const indexed = (list, element) => new Proxy(list, { get: (target, key) => (typeof key === 'string' && /^\d+$/.test(key) ? element(Number(key)) : target[key]) });
  const vertex = (i) => rna('MeshVertex', {
    index: i,
    get co() { return [...positions.subarray(3 * i, 3 * i + 3)]; },
    set co(value) { positions.set(value, 3 * i); write(); },
  });
  const vertices = Object.assign(collection(new Array(mesh.verts_num)), {
    __foreach_get__: (attr) => (attr === 'co' ? Float64Array.from(positions) : undefined),
    __foreach_set__: (attr, values) => (attr === 'co' ? (positions.set(values), write(), true) : undefined),
  });
  const edge = (i) => rna('MeshEdge', { index: i, vertices: [...mesh.edges.subarray(2 * i, 2 * i + 2)] });
  const polygon = (i) => rna('MeshPolygon', { index: i, vertices: [...mesh.corner_verts.subarray(mesh.face_offsets[i], mesh.face_offsets[i + 1])] });
  return {
    vertices: indexed(vertices, vertex),
    edges: indexed(collection(new Array(mesh.edges_num)), edge),
    polygons: indexed(collection(new Array(mesh.faces_num)), polygon),
  };
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

// A tool's orientation slot's own choice (rna_scene.cc: rna_TransformOrientation_with_scene_itemf).
const ORIENTATION_DEFAULT = ['DEFAULT', 'Default', 'Use the scene orientation', 'OBJECT_ORIGIN'];

function setViewState(view, key, value) {
  if (value === undefined) throw TypeError(`bpy_struct: invalid ${key}`);
  if (key === 'shading' && view.setShading) return view.setShading(value);
  view.state[key] = value;
  view.sync?.();
}

// A struct's bindings over an owner, as { get, set, ... } by name: its own table or its nearest base's (PointLight binds
// as Light).
function bindingsOf(struct, owner) {
  let base = struct;
  while (base && !STRUCTS[base]) base = baseOf(base);
  const bindings = STRUCTS[base] ?? {}, table = typeof bindings === 'function' ? bindings(owner) : bindings;
  return Object.fromEntries(Object.entries(table).map(([name, binding]) => [name, typeof binding === 'function' ? { get: binding } : binding]));
}

// The properties of a struct over an owner that are kept equal in Blender's Main (main-sync.js): [name, { get(), set(value) }]
// pairs, set undefined for a read-only one. Their writes do not notify; the caller does once.
export function syncBindings(r, struct, owner) {
  return Object.entries(bindingsOf(struct, owner)).filter(([, { sync }]) => (typeof sync === 'function' ? sync(owner) : sync))
    .map(([name, { get, set }]) => [name, { get: () => get(owner, r), set: set && ((value) => set(owner, value, r)) }]);
}

// The RNA of one host's data: pointer(struct, owner) is the struct over a Bylonder owner (None for none), one per owner
// so scripts see the same struct each time; `key` is the owner's identity when the owner is made per call.
export function createRNA(host) {
  // Structs by their owner, or by a name for an owner made per call (a modifier Main holds: its object's id and name).
  const cache = new WeakMap(), named = new Map();
  const r = {
    host,
    world: host.world,
    objects: () => host.world.objects.filter((ob) => !deleted(ob)),
    // bpy.data.texts: Main's (blenkernel/text-files.js).
    texts: () => blendData().texts,
    // bpy.data.textures, with new(name, type).
    textures() {
      const textures = host.world.textures;
      if (!textures) return collection();
      const add = (...list) => {
        const { name, type } = pyArgs(list, ['name', 'type']), entry = textures.create();
        if (name) textures.rename(entry, name);
        if (type) textures.set(entry, 'type', type);
        return r.texture(entry);
      };
      return Object.assign(collection(textures.all().map((entry) => r.texture(entry))), { new: add, py_new: add });
    },
    texture: (entry) => texturePointer(r, entry),
    pointer(struct, owner, key = owner) {
      if (!owner || !struct) return null;
      const store = Object(key) === key ? cache : named;
      const structs = store.get(key) ?? store.set(key, new Map()).get(key);
      if (!structs.has(struct)) structs.set(struct, bind(struct, owner));
      return structs.get(struct);
    },
  };
  function bind(struct, owner) {
    const data = {}, items = {}, channels = {};
    for (const [name, { get, set, sync, names, items: enumItems, channel }] of Object.entries(bindingsOf(struct, owner))) {
      // A value Main holds is read and written there, and drawn back to Babylon (main-sync.js).
      const held = () => ((typeof sync === 'function' ? sync(owner) : sync) && host.world.mainSync?.held(struct, owner, name)) || null;
      const value = () => { const record = held(); return record ? host.world.mainSync.read(record, name) : get(owner, r); };
      const write = set && ((v) => {
        const record = held();
        if (!record || !host.world.mainSync.write(record, name, v)) set(owner, v, r);
        host.update?.(struct, name, owner);
      });
      Object.defineProperty(data, name, { enumerable: true, get: () => (names === undefined ? value() : elements(value(), names, write)), set: write });
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
