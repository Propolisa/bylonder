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

const key = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
const typeOf = (value) => (typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'STRING' : Number.isInteger(value) ? 'INT' : 'FLOAT');
const knob = (path, value, meta = {}, bind) => ({ path, type: typeOf(value), default: value, ...meta, ...(bind && { bind }) });

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

// The project's SDK controls (sdk.controls), as Main holds them: custom properties of the Scene.
function sdkControls(world, scene) {
  const base = `scenes${key(scene.name)}`;
  return [...world.animation.channels].filter(([, channel]) => channel.id.startsWith('store:') && channel.available())
    .map(([ref, channel]) => knob(base + world.animation.dataPath(ref), channel.get(), { suggested: true }));
}

// The controls of the serialized scene `data`, as the package's CONTROLS: none without Main.
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
  list.push(...customProperties(mainScene, `scenes${key(mainScene.name)}`), ...sdkControls(world, mainScene));
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
