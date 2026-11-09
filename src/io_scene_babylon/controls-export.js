// A package's controls (runtime/blend-scene.js): the exported objects' Blender properties by RNA path from bpy.data,
// each with what its value binds to in the exported Babylon scene. Transforms, visibility, a light's power and color and
// a camera's lens and clipping are bound; custom properties and SDK controls are values the page reads and sets. Where
// Bylonder draws a Blender value through a factor (a light's power as Babylon's intensity, a lens as a field of view,
// a camera turned to look along Babylon's +Z), the factor is measured here on the exported objects, so the page
// needs none of Bylonder's mapping code.
import { Matrix, Quaternion } from '@babylonjs/core';
import { idStruct, pointerStruct, structFind } from '../python/bpy_rna.js';
import { babylonRotation } from './runtime/blend-scene.js';
import { babylonMatrix } from '../blenkernel/main-view.js';
import { AREA_OFFSET, rigId } from './area-lights.js';

// Blender's own (Bylonder's ID properties, add-ons' groups) stay out of an ID's custom properties.
const OWN = /^(bylonder|_RNA_UI$|cycles)/;

export const key = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
const typeOf = (value) => (typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'STRING' : Number.isInteger(value) ? 'INT' : 'FLOAT');
export const knob = (path, value, meta = {}, bind) => ({ path, type: typeOf(value), default: value, ...meta, ...(bind && { bind }) });

// An ID's custom properties: numbers, booleans and strings, suggested to authors.
function customProperties(id, base) {
  return [...(id.keys?.() ?? [])].filter((name) => !OWN.test(name)).flatMap((name) => {
    const value = id.get(name);
    return ['number', 'boolean', 'string'].includes(typeof value) ? [knob(base + key(name), value, { suggested: true })] : [];
  });
}

// What turns Blender's rotation, as the page draws it (blend-scene.js babylonRotation), into the node's own: a camera's
// turn to look along Babylon's +Z, else nothing.
function rotationOffset(node, mode, values) {
  const own = node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation);
  const offset = Quaternion.Inverse(babylonRotation(mode, values)).multiply(own);
  return Quaternion.Identity().equalsWithEpsilon(offset, 1e-6) || Quaternion.Identity().equalsWithEpsilon(offset.scale(-1), 1e-6) ? undefined : offset.asArray();
}

const IDENTITY = Matrix.Identity().asArray();
// The binding of the object's location, rotation and scale: the node they place and how (blend-scene.js Transform), or
// none for a rotation mode the page does not compose (Axis Angle).
function transformBinding(node, ob, rotation, parentInverse) {
  const mode = ob.rotation_mode;
  if (mode === 'AXIS_ANGLE') return undefined;
  const inverse = babylonMatrix(parentInverse).asArray();
  const parent = inverse.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-7) ? { parent_inverse: inverse } : {};
  // An area light turns by its rig (area-lights.js); another light turns its direction, Blender's -Z, Babylon's -Y.
  if (node.getClassName() === 'RectAreaLight') return { node: rigId(node.id), transform: { mode, ...parent, offset: AREA_OFFSET } };
  if (node.getClassName() === 'PointLight') return { node: node.id, transform: { mode, ...parent, direction: null } };
  if (node.getClassName().endsWith('Light')) return { node: node.id, transform: { mode, ...parent, direction: [0, -1, 0] } };
  const offset = rotationOffset(node, mode, rotation);
  return { node: node.id, transform: { mode, ...parent, ...(offset && { offset }) } };
}

function objectControls(node, ob, parentInverse) {
  const base = `objects${key(ob.name)}`, list = [];
  const [property, meta] = { QUATERNION: ['rotation_quaternion', { type: 'FLOAT', subtype: 'QUATERNION' }], AXIS_ANGLE: ['rotation_axis_angle', { type: 'FLOAT', subtype: 'AXISANGLE' }] }[ob.rotation_mode]
    ?? ['rotation_euler', { type: 'FLOAT', subtype: 'EULER', unit: 'ROTATION' }];
  const bind = transformBinding(node, ob, [...ob[property]], parentInverse);
  [...ob.location].forEach((v, i) => list.push(knob(`${base}.location[${i}]`, v, { type: 'FLOAT', subtype: 'TRANSLATION', unit: 'LENGTH' }, bind)));
  [...ob[property]].forEach((v, i) => list.push(knob(`${base}.${property}[${i}]`, v, meta, bind)));
  [...ob.scale].forEach((v, i) => list.push(knob(`${base}.scale[${i}]`, v, { type: 'FLOAT', subtype: 'XYZ' }, bind)));
  for (const hide of ['viewport', 'render']) list.push(knob(`${base}.hide_${hide}`, !!ob[`hide_${hide}`], {}, { node: node.id, hide }));
  return [...list, ...customProperties(ob, base)];
}

function lightControls(node, light) {
  const base = `lights${key(light.name)}`;
  const power = knob(`${base}.energy`, light.energy, { type: 'FLOAT', subtype: 'POWER', unit: 'POWER' }, light.energy ? { node: node.id, property: 'intensity', factor: node.intensity / light.energy } : undefined);
  const color = [...light.color].map((v, i) => knob(`${base}.color[${i}]`, v, { type: 'FLOAT', subtype: 'COLOR', soft_min: 0, soft_max: 1 }, { node: node.id, property: `diffuse.${'rgb'[i]}` }));
  return [power, ...color, ...customProperties(light, base)];
}

function cameraControls(node, camera) {
  const base = `cameras${key(camera.name)}`;
  return [
    knob(`${base}.lens`, camera.lens, { type: 'FLOAT', subtype: 'DISTANCE_CAMERA', unit: 'CAMERA', soft_min: 1, soft_max: 5000 }, { node: node.id, lens: Math.tan(node.fov / 2) * camera.lens }),
    knob(`${base}.clip_start`, camera.clip_start, { type: 'FLOAT', subtype: 'DISTANCE', unit: 'LENGTH' }, { node: node.id, property: 'minZ' }),
    knob(`${base}.clip_end`, camera.clip_end, { type: 'FLOAT', subtype: 'DISTANCE', unit: 'LENGTH' }, { node: node.id, property: 'maxZ' }),
    ...customProperties(camera, base),
  ];
}

// A node material's tunable values: its InputBlocks named by their RNA path from the material (node-material-export.js),
// a number or each component of a vector, and its images, a URL relative to the package.
// A world's material is named `__world <name>` (main-view.js adoptWorld): its paths are the World's.
function nodeMaterialControls(entry) {
  if (entry.customType !== 'BABYLON.NodeMaterial') return [];
  const world = /^__world (.*)$/.exec(entry.name), base = world ? `worlds${key(world[1])}` : `materials${key(entry.name)}`, named = entry.blocks.filter((b) => b.name.startsWith('node_tree.'));
  const images = named.filter((b) => b.customType === 'BABYLON.ImageSourceBlock' && b.texture?.name)
    .map((b) => knob(`${base}.${b.name}`, b.texture.name, { type: 'STRING', suggested: true }, { material: entry.id, block: b.name, image: true }));
  return images.concat(named.filter((b) => b.customType === 'BABYLON.InputBlock').flatMap((b) => (Array.isArray(b.value)
    ? b.value.map((v, i) => knob(`${base}.${b.name}[${i}]`, v, { type: 'FLOAT' }, { material: entry.id, block: b.name, component: i }))
    : [knob(`${base}.${b.name}`, b.value, { type: 'FLOAT' }, { material: entry.id, block: b.name })])));
}

// A material of one Principled BSDF, exported as Babylon's PBRMaterial: the inputs it maps to the material's own
// properties (rna-bylonder.js principledInputs), each scaled by the factor measured between the two.
const PRINCIPLED = [['Base Color', 'albedoColor', 'COLOR'], ['Metallic', 'metallic'], ['Roughness', 'roughness'], ['Alpha', 'alpha'],
  ['Emission Color', 'emissiveColor', 'COLOR'], ['Emission Strength', 'emissiveIntensity']];
function principledControls(entry, scene, sync) {
  const material = scene.getMaterialByUniqueId(entry.uniqueId), ma = material?.getClassName() === 'PBRMaterial' && sync.materialOf(material);
  const tree = ma && idStruct(ma).node_tree;
  const node = tree && [...tree.nodes].find((n) => n.bl_idname === 'ShaderNodeBsdfPrincipled');
  if (!node) return [];
  const inputs = [...node.inputs], base = `materials${key(entry.name)}.node_tree.nodes${key(node.name)}.inputs`;
  return PRINCIPLED.flatMap(([name, property, subtype]) => {
    const index = inputs.findIndex((i) => i.name === name);
    if (index < 0 || inputs[index].is_linked) return [];
    const blender = inputs[index].default_value, babylon = material[property];
    const bound = (value, own, path) => {
      if (Math.abs(value) < 1e-6) return Math.abs(own) < 1e-6 ? { property: path } : null;
      return Math.abs(own / value - 1) < 1e-6 ? { property: path } : { property: path, factor: own / value };
    };
    const knobs = subtype ? [0, 1, 2].map((c) => [`${base}[${index}].default_value[${c}]`, blender[c], bound(blender[c], babylon['rgb'[c]], `${property}.${'rgb'[c]}`)])
      : [[`${base}[${index}].default_value`, blender, bound(blender, babylon, property)]];
    return knobs.filter(([, , bind]) => bind).map(([path, value, bind]) => knob(path, value, { type: 'FLOAT', ...(subtype && { subtype, soft_min: 0, soft_max: 1 }), suggested: true },
      { material: entry.id, ...bind }));
  });
}

// The scene's frame: what the animation shows, from its first frame to its last.
function frameControl(world, scene) {
  const { frameStart, frameEnd } = world.animation.time.state;
  return knob(`scenes${key(scene.name)}.frame_current`, scene.frame_current, { type: 'INT', soft_min: frameStart, soft_max: frameEnd, suggested: true }, { frame: true });
}

// A world of one color: its Background node's Color and Strength, which light the page's scene (runtime/world.js).
function worldControls(scene) {
  const background = scene.world?.node_tree?.nodes && [...scene.world.node_tree.nodes].find((node) => node.bl_idname === 'ShaderNodeBackground');
  if (!background) return [];
  const inputs = `worlds${key(scene.world.name)}.node_tree.nodes${key(background.name)}.inputs`, color = [...background.inputs[0].default_value];
  return [...color.slice(0, 3).map((v, i) => knob(`${inputs}[0].default_value[${i}]`, v, { type: 'FLOAT', subtype: 'COLOR', soft_min: 0, soft_max: 1, suggested: true }, { world: true })),
    knob(`${inputs}[1].default_value`, background.inputs[1].default_value, { type: 'FLOAT', soft_min: 0, suggested: true }, { world: true })];
}

// The project's SDK controls (sdk.controls), as Main holds them: custom properties of the Scene.
function sdkControls(world, scene) {
  const base = `scenes${key(scene.name)}`;
  return [...world.animation.channels].filter(([, channel]) => channel.id.startsWith('store:') && channel.available())
    .map(([ref, channel]) => knob(base + world.animation.dataPath(ref), channel.get(), { suggested: true }));
}

// The controls of the serialized scene `data`, the IR's properties (ir-export.js): none without Main.
export function exportControls(world, data) {
  const sync = world.mainSync;
  if (!sync) return [];
  const { scene } = world, byUniqueId = new Map([...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras].map((n) => [n.uniqueId, n]));
  const nodes = [...data.meshes, ...data.transformNodes, ...data.lights, ...data.cameras].map((entry) => byUniqueId.get(entry.uniqueId)).filter(Boolean);
  const mainScene = pointerStruct(structFind('Scene'), sync.blender.scene, sync.blender.scene);
  const list = [];
  for (const node of nodes) {
    const pointer = sync.objectOf(node);
    if (!pointer) continue;
    const ob = idStruct(pointer);
    list.push(...objectControls(node, ob, sync.blender.transform(pointer).matrix_parent_inverse));
    if (ob.type === 'LIGHT') list.push(...lightControls(node, ob.data));
    if (ob.type === 'CAMERA') list.push(...cameraControls(node, ob.data));
  }
  list.push(...data.materials.flatMap(nodeMaterialControls), ...data.materials.flatMap((entry) => principledControls(entry, scene, sync)));
  if (!data.materials.some((m) => m.name?.startsWith('__world '))) list.push(...worldControls(mainScene));
  list.push(frameControl(world, mainScene), ...customProperties(mainScene, `scenes${key(mainScene.name)}`), ...sdkControls(world, mainScene));
  return [...new Map(list.map((k) => [k.path, k])).values()];
}

const TS_TYPES = { FLOAT: 'number', INT: 'number', BOOLEAN: 'boolean', STRING: 'string' };
// scene.d.ts: the package's controls as a type, so `set` and `get` complete the scene's paths and check their values.
export function controlTypes(controls) {
  return `// The controls of this scene, by Blender RNA path. Generated by Bylonder's export.
import type { AbstractEngine } from '@babylonjs/core';
import type { BlendScene } from './bylonder/blend-scene.js';

export interface Controls {
${controls.map(({ path, type }) => `  '${path.replace(/['\\]/g, (c) => '\\' + c)}': ${TS_TYPES[type]};`).join('\n')}
}

export function load(engine: AbstractEngine): Promise<BlendScene<Controls>>;
export function createScene(engine: AbstractEngine, canvas?: HTMLCanvasElement | null): Promise<import('@babylonjs/core').Scene>;
`;
}
