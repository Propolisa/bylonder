// A package's controls (runtime/blend-scene.js): the exported objects' Blender properties by RNA path from bpy.data,
// each with what its value binds to in the exported Babylon scene. Transforms, visibility, a light's power and color and
// a camera's lens and clipping are bound; custom properties and SDK controls are values the page reads and sets. Where
// Bylonder draws a Blender value through a factor (a light's power as Babylon's intensity, a lens as a field of view,
// a camera turned to look along Babylon's +Z), the factor is measured here on the exported objects, so the page
// needs none of Bylonder's mapping code.
import { Matrix, Quaternion } from '@babylonjs/core';
import { blendData, customPropertyType, idStruct, pointerStruct, structFind } from '../python/bpy_rna.js';
import { declaration } from '../nodes/blender/declarations.js';
import { babylonRotation } from './runtime/blend-scene.js';
import { babylonMatrix } from '../blenkernel/main-view.js';
import { AREA_OFFSET, rigId } from './area-lights.js';
import { actionFCurves } from './ir-export.js';
import { limits } from './rig-description.js';

// Blender's own (Bylonder's ID properties, add-ons' groups) stay out of an ID's custom properties.
const OWN = /^(bylonder|_RNA_UI$|cycles)/;
const safe = (fn) => { try { return fn(); } catch { return undefined; } };

export const key = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
const typeOf = (value) => (typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'STRING' : Number.isInteger(value) ? 'INT' : 'FLOAT');
export const knob = (path, value, meta = {}, bind) => ({ path, type: typeOf(value), default: value, ...meta, ...(bind && { bind }) });

// A custom property's hard limits where they bound it: not a type's whole range, as UI data defaults to.
const UNBOUNDED = 2147483647;
const limited = (range) => ({ ...(range?.min > -UNBOUNDED && { hard_min: range.min }), ...(range?.max < UNBOUNDED && { hard_max: range.max }) });
// An ID's custom properties: numbers, booleans and strings, suggested to authors; a number within its hard limits.
function customProperties(id, base) {
  const ranges = limits(id);
  return [...(id.keys?.() ?? [])].filter((name) => !OWN.test(name)).flatMap((name) => {
    const value = id.get(name), range = ranges[name];
    // A float holding a whole number is still a float, which an F-Curve animates.
    const type = typeof value === 'number' && customPropertyType(id, name) === 'FLOAT' ? { type: 'FLOAT' } : {};
    return ['number', 'boolean', 'string'].includes(typeof value) ? [knob(base + key(name), value, { suggested: true, ...type, ...limited(range) })] : [];
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
export function transformBinding(node, ob, rotation, parentInverse) {
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

// The location, rotation and scale of an object or a pose bone at `base`, each bound by `bind`.
function transformControls(base, owner, bind) {
  const [property, meta] = { QUATERNION: ['rotation_quaternion', { type: 'FLOAT', subtype: 'QUATERNION' }], AXIS_ANGLE: ['rotation_axis_angle', { type: 'FLOAT', subtype: 'AXISANGLE' }] }[owner.rotation_mode]
    ?? ['rotation_euler', { type: 'FLOAT', subtype: 'EULER', unit: 'ROTATION' }];
  return [...[...owner.location].map((v, i) => knob(`${base}.location[${i}]`, v, { type: 'FLOAT', subtype: 'TRANSLATION', unit: 'LENGTH' }, bind)),
    ...[...owner[property]].map((v, i) => knob(`${base}.${property}[${i}]`, v, meta, bind)),
    ...[...owner.scale].map((v, i) => knob(`${base}.scale[${i}]`, v, { type: 'FLOAT', subtype: 'XYZ' }, bind))];
}

function objectControls(node, ob, parentInverse) {
  const base = `objects${key(ob.name)}`, property = { QUATERNION: 'rotation_quaternion', AXIS_ANGLE: 'rotation_axis_angle' }[ob.rotation_mode] ?? 'rotation_euler';
  const list = transformControls(base, ob, transformBinding(node, ob, [...ob[property]], parentInverse));
  // A driven Disable in Viewports switches a viewport's proxies (driver-export.js leaves it out): the page shows renders.
  const driven = (hide) => hide === 'viewport' && [...(ob.animation_data?.drivers ?? [])].some((fc) => fc.data_path === 'hide_viewport');
  for (const hide of ['viewport', 'render']) list.push(knob(`${base}.hide_${hide}`, !driven(hide) && !!ob[`hide_${hide}`], {}, { node: node.id, hide }));
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

// A world of one color: the Color and Strength of the Background node its output draws (else its first), which light
// the page's scene (runtime/world.js).
function worldControls(scene) {
  const tree = scene.world?.node_tree, isBackground = (node) => node?.bl_idname === 'ShaderNodeBackground';
  const drawn = tree?.links && [...tree.links].find((link) => link.to_node.bl_idname === 'ShaderNodeOutputWorld' && link.to_socket.identifier === 'Surface')?.from_node;
  const background = isBackground(drawn) ? drawn : tree?.nodes && [...tree.nodes].find(isBackground);
  if (!background) return [];
  const inputs = `worlds${key(scene.world.name)}.node_tree.nodes${key(background.name)}.inputs`, color = [...background.inputs[0].default_value];
  return [...color.slice(0, 3).map((v, i) => knob(`${inputs}[0].default_value[${i}]`, v, { type: 'FLOAT', subtype: 'COLOR', soft_min: 0, soft_max: 1, suggested: true }, { world: true })),
    knob(`${inputs}[1].default_value`, background.inputs[1].default_value, { type: 'FLOAT', soft_min: 0, suggested: true }, { world: true })];
}

// The project's SDK controls (sdk.controls), as Main holds them: custom properties of the Scene.
// An armature's pose bones, where one skeleton of the file draws it (armature.js): each bone's location, rotation and
// scale pose its Babylon Bone (blend-scene.js posedBone); an Axis Angle rotation is not composed. Its custom properties
// and its constraints' influences, which the page's constraints and drivers read, too.
// A pose bone's own B-Bone shape (Bone Properties > Bendy Bones), by path: what the constraint kernels bend its segments
// by, which an animation sets.
export const BBONE_SHAPE = ['bbone_curveinx', 'bbone_curveinz', 'bbone_curveoutx', 'bbone_curveoutz', 'bbone_rollin', 'bbone_rollout',
  'bbone_easein', 'bbone_easeout', 'bbone_scalein', 'bbone_scaleout'];
export const bboneShape = (pose) => BBONE_SHAPE.flatMap((name) => (typeof pose[name] === 'number' ? [[name, pose[name]]] : [...pose[name]].map((v, i) => [`${name}[${i}]`, v])));

// Above this many bones (a production rig's mechanism bones), a bone's location, rotation and scale are controls only
// where the page reads or writes them: bones in a collection named POSED_COLLECTION, bones a driver reads by path or
// writes, and bones the rig's F-Curves key. Its custom properties, influences and B-Bone shape stay for every bone.
const POSED_BONES = 64, POSED_COLLECTION = 'Controls';
const boneIn = (path) => /pose\.bones\["((?:[^"\\]|\\.)*)"\]\.(?:location|rotation_\w+|scale)/.exec(path ?? '')?.[1];
export function posedByPage(ob) {
  if ([...ob.pose.bones].length <= POSED_BONES) return () => true;
  const named = new Set([...(ob.data.collections_all?.get?.(POSED_COLLECTION)?.bones ?? [])].map((bone) => bone.name));
  for (const driver of ob.animation_data?.drivers ?? []) {
    named.add(boneIn(driver.data_path));
    for (const variable of driver.driver.variables) for (const target of variable.targets) if (target.id?.name === ob.name) named.add(boneIn(target.data_path));
  }
  const adt = ob.animation_data, actions = [adt?.action, ...[...(adt?.nla_tracks ?? [])].flatMap((track) => [...track.strips].map((strip) => strip.action))];
  for (const action of actions.filter(Boolean)) for (const fc of actionFCurves({ action })) named.add(boneIn(fc.data_path));
  return (pose) => named.has(pose.name);
}

// A pose bone's controls, on the armature's rig skeleton (skeleton-export.js; not its skin skeleton), bound to its first
// where meshes in other spaces have their own.
function poseControls(ob, skeletons) {
  const rigs = skeletons.filter((s) => !s.rig), drawn = rigs.find((s) => s.id === ob.name) ?? rigs.find((s) => s.id.startsWith(`${ob.name} `));
  if (!drawn) return [];
  const idOf = (pose) => `${drawn.id} ${pose.name}`, posed = posedByPage(ob);
  return [...ob.pose.bones].flatMap((pose) => {
    const base = `objects${key(ob.name)}.pose.bones${key(pose.name)}`;
    return [...(posed(pose) ? transformControls(base, pose, pose.rotation_mode !== 'AXIS_ANGLE' && { node: idOf(pose), transform: { mode: pose.rotation_mode } }) : []),
      ...customProperties(pose, base), ...[...pose.constraints].map((c) => knob(`${base}.constraints${key(c.name)}.influence`, c.influence, { type: 'FLOAT', subtype: 'FACTOR', hard_min: 0, hard_max: 1 })),
      ...(ob.data.bones.get(pose.name).bbone_segments > 1 ? bboneShape(pose).map(([path, v]) => knob(`${base}.${path}`, v, { type: 'FLOAT' })) : [])];
  });
}

// A mesh's shape keys, where the file morphs it (shape-keys.js): each key's value is its morph target's influence.
function shapeKeyControls(node, ob, entry) {
  const shapes = ob.data?.shape_keys;
  if (!shapes || entry?.morphTargetManagerId === undefined) return [];
  return [...shapes.key_blocks].filter((kb) => kb.name !== shapes.reference_key.name)
    .map((kb) => knob(`shape_keys${key(shapes.name)}.key_blocks${key(kb.name)}.value`, kb.value, { type: 'FLOAT', subtype: 'FACTOR', soft_min: kb.slider_min, soft_max: kb.slider_max,
      hard_min: kb.slider_min, hard_max: kb.slider_max, suggested: true }, { node: node.id, morph: kb.name }));
}

function sdkControls(world, scene) {
  const base = `scenes${key(scene.name)}`;
  return [...world.animation.channels].filter(([, channel]) => channel.id.startsWith('store:') && channel.available())
    .map(([ref, channel]) => knob(base + world.animation.dataPath(ref), channel.get(), { suggested: true }));
}

// Main's scene, as RNA.
export const sceneOf = (sync) => pointerStruct(structFind('Scene'), sync.blender.scene, sync.blender.scene);

// The controls of the serialized scene `data`, the IR's properties (ir-export.js): none without Main.
export function exportControls(world, data) {
  const sync = world.mainSync;
  if (!sync) return [];
  const { scene } = world, byUniqueId = new Map([...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras].map((n) => [n.uniqueId, n]));
  const nodes = [...data.meshes, ...data.transformNodes, ...data.lights, ...data.cameras].map((entry) => byUniqueId.get(entry.uniqueId)).filter(Boolean);
  const entryOf = new Map(data.meshes.map((entry) => [entry.uniqueId, entry]));
  const mainScene = sceneOf(sync);
  const list = [];
  for (const node of nodes) {
    const pointer = sync.objectOf(node);
    if (!pointer) continue;
    const ob = idStruct(pointer);
    list.push(...objectControls(node, ob, sync.blender.transform(pointer).matrix_parent_inverse));
    if (ob.type === 'LIGHT') list.push(...lightControls(node, ob.data));
    if (ob.type === 'CAMERA') list.push(...cameraControls(node, ob.data));
    if (ob.type === 'ARMATURE') list.push(...poseControls(ob, data.skeletons ?? []));
    if (ob.type === 'MESH') list.push(...shapeKeyControls(node, ob, entryOf.get(node.uniqueId)));
  }
  list.push(...data.materials.flatMap(nodeMaterialControls), ...data.materials.flatMap((entry) => principledControls(entry, scene, sync)));
  if (!data.materials.some((m) => m.name?.startsWith('__world '))) list.push(...worldControls(mainScene));
  list.push(frameControl(world, mainScene), ...customProperties(mainScene, `scenes${key(mainScene.name)}`), ...sdkControls(world, mainScene));
  return [...new Map(list.map((k) => [k.path, k])).values()];
}

// A path's last step: the owner's path and a property name, an index or a custom property's key.
const STEP = /^(.*?)(?:\.(\w+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\])$/;
const unquote = (key) => key.replace(/\\(.)/g, '$1');
const finite = (v) => (typeof v === 'number' && Math.abs(v) < 1e30 ? v : undefined);
const TREES = { ShaderNodeTree: 'shader', CompositorNodeTree: 'compositor' };
const fromRNA = (value) => (typeof value === 'number' ? Math.fround(value) === value ? value : Number(value.toPrecision(7)) : value);

// A node socket's value as a new node of its type has it (declarations.js), by the socket's identifier.
function socketDefault(socket, index) {
  const node = socket.node, tree = TREES[node?.id_data?.bl_idname];
  const value = tree && declaration(tree, node.bl_idname)?.inputs.find((s) => s.identifier === socket.identifier)?.default;
  return Array.isArray(value) ? value[index] : value;
}

// What Blender's UI shows of the property at `path`: its name, range, step and precision, and its value when new.
function uiOf(path) {
  const [, owner, name, index, key] = STEP.exec(path) ?? [];
  if (key !== undefined) return { name: unquote(key) };
  const [, base, property] = index === undefined ? [, owner, name] : STEP.exec(owner) ?? [];
  const struct = property && safe(() => blendData().path_resolve(base));
  const rna = struct?.bl_rna && [...struct.bl_rna.properties].find((p) => p.identifier === property);
  if (!rna) return {};
  const socket = property === 'default_value' && struct.rna_type.identifier.startsWith('NodeSocket');
  const at = index === undefined ? 0 : Number(index);
  const fallback = socket ? socketDefault(struct, at) : safe(() => (rna.array_length > 0 ? [...rna.default_array][at] : rna.default));
  const ui = { name: socket ? struct.name : rna.name, subtype: rna.subtype, unit: rna.unit, soft_min: finite(rna.soft_min), soft_max: finite(rna.soft_max),
    hard_min: finite(rna.hard_min), hard_max: finite(rna.hard_max), step: rna.step, precision: rna.precision, blender_default: fromRNA(fallback) };
  return Object.fromEntries(Object.entries(ui).filter(([, v]) => v !== undefined && v !== 'NONE' && v !== ''));
}

// The controls with what Blender's UI shows of each (uiOf), what they set themselves taking precedence.
export const withUI = (controls) => controls.map((control) => ({ ...uiOf(control.path), ...control }));

const TS_TYPES ={ FLOAT: 'number', INT: 'number', BOOLEAN: 'boolean', STRING: 'string' };
// scene.d.ts: the package's controls as a type, so `set` and `get` complete the scene's paths and check their values.
/**
 * The names each armature's character takes (runtime/character/names.d.ts): its actions and their markers, its bone
 * collections, roles and keyed properties, as string-literal unions augmenting CharacterNames.
 * @param {Record<string, { actions: string[], markers: string[], groups: string[], roles: string[], properties: string[] }>} armatures
 */
function characterNames(armatures) {
  const entries = Object.entries(armatures);
  if (!entries.length) return '';
  const union = (/** @type {string[]} */ names) => (names.length ? [...new Set(names)].map((n) => `'${n.replace(/['\\]/g, (c) => '\\' + c)}'`).join(' | ') : 'never');
  return `
declare module './bylonder/character/names.js' {
  interface CharacterNames {
${entries.map(([name, n]) => `    '${name.replace(/['\\]/g, (c) => '\\' + c)}': { actions: ${union(n.actions)}, markers: ${union(n.markers)}, groups: ${union(n.groups)}, roles: ${union(n.roles)}, properties: ${union(n.properties)} };`).join('\n')}
  }
}
`;
}

/**
 * @param {{ path: string, type: string }[]} controls @param {Parameters<typeof characterNames>[0]} [armatures]
 * @param {boolean} [characters] whether the scene has an armature, so its package exports the character system
 */
export function controlTypes(controls, armatures = {}, characters = Object.keys(armatures).length > 0) {
  return `// The controls of this scene, by Blender RNA path. Generated by Bylonder's export.
import type { AbstractEngine, AssetContainer, Scene, TransformNode } from '@babylonjs/core';
import type { BlendScene } from './bylonder/blend-scene.js';

export interface Controls {
${controls.map(({ path, type }) => `  '${path.replace(/['\\]/g, (c) => '\\' + c)}': ${TS_TYPES[type]};`).join('\n')}
}

/** The scene in a scene of its own, or its objects added to a scene of yours under "__root__" (under root if given), with their controller. */
export function load(target: AbstractEngine | { scene: Scene, root?: TransformNode } | { instance: BlendScene<Controls>, root?: TransformNode }): Promise<BlendScene<Controls>>;
export function createScene(engine: AbstractEngine, canvas?: HTMLCanvasElement | null): Promise<Scene>;
/** The objects in an AssetContainer; instantiate() copies them, sharing geometry, materials and textures, with a controller of its own. */
export function loadAssetContainer(scene: Scene): Promise<AssetContainer & { blend: BlendScene<Controls>, instantiate(root?: TransformNode): Promise<BlendScene<Controls>> }>;
/** The engine the package is exported for: WebGPU, WebGL 2, or WebGPU where the browser has it, else WebGL 2. */
export function createEngine(canvas: HTMLCanvasElement, options?: object): Promise<AbstractEngine>;
${characters ? `export * from './bylonder/character/api.js';
export * from './bylonder/character/effects/index.js';
${characterNames(armatures)}` : ''}`;
}
