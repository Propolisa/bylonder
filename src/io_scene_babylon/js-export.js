// File > Export > JavaScript: a package whose scene.js builds the exported scene with Babylon's API. Objects (meshes,
// empties) are written as their initialization code, with geometry read straight from the evaluated meshes into
// scene.bin (scene-bin.js); materials, lights, cameras, shadows, animation and effects are Babylon's own serialization,
// passed to their Parse functions as Babylon's .babylon loader does, with images as files beside it. `load(engine)`
// gives the scene with its controls (runtime/blend-scene.js), `createScene(engine, canvas)` the scene alone.
import { AbstractEngine } from '@babylonjs/core';
import { serializeScene } from './babylon-export.js';
import { exportRuntimes } from '../runtimes/runtimes.js';
import { exportControls, controlTypes } from './controls-export.js';
import { createSceneBin } from './scene-bin.js';
import { imageFiles } from './image-files.js';
import { areaRigs } from './area-lights.js';

const CDN = `https://cdn.jsdelivr.net/npm/@babylonjs/core@${AbstractEngine.Version}/+esm`;
const json = (value) => JSON.stringify(value);
const number = (v) => +v.toFixed(7);
const vector = (values) => values.map(number).join(', ');

function base64(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// Vertex buffers by Babylon kind, with their sizes, and the indices, as buffers of scene.bin: one entry per geometry,
// shared by its meshes. A thin instance buffer (world0 to world3, per instance) is the mesh's thinInstances, written
// with its node.
function geometryCode(mesh, bin) {
  const kinds = mesh.getVerticesDataKinds().filter((kind) => !mesh.getVertexBuffer(kind).getIsInstanced());
  const buffers = kinds.map((kind) => {
    const size = mesh.getVertexBuffer(kind).getSize();
    return `${json(kind)}: [${size}, buffers[${bin.add(Float32Array.from(mesh.getVerticesData(kind, false, false)))}]]`;
  });
  const indices = mesh.getIndices();
  const wide = mesh.getTotalVertices() > 65535;
  const index = indices?.length ? `, buffers[${bin.add(wide ? Uint32Array.from(indices) : Uint16Array.from(indices))}]` : '';
  return `geometry(scene, { ${buffers.join(', ')} }${index})`;
}

const DEFAULTS = { isVisible: true, visibility: 1, receiveShadows: false, pickable: true, billboardMode: 0, checkCollisions: false, infiniteDistance: false, layerMask: 0x0fffffff, alwaysSelectAsActiveMesh: false, isBlocker: false, hasVertexAlpha: false };
const PROPERTIES = { pickable: 'isPickable' };

// One node's initialization code, from its serialization (`entry`) and, for a mesh, its Babylon mesh.
function nodeCode(entry, mesh, geometries, live, bin) {
  const lines = [];
  const v = (name) => `node.${name}`;
  if (mesh) {
    const lines_ = entry.type === 'LinesMesh';
    lines.push(`const node = new ${lines_ ? 'LinesMesh' : 'Mesh'}(${json(entry.name)}, scene);`);
    if (lines_) lines.push(`node.color = new Color3(${vector(mesh.color.asArray())});`, mesh.alpha !== 1 ? `node.alpha = ${mesh.alpha};` : '');
    if (mesh.geometry) lines.push(`${geometries.get(mesh.geometry)}.applyToMesh(node);`);
  } else lines.push(`const node = new TransformNode(${json(entry.name)}, scene);`);
  lines.push(`node.id = ${json(entry.id)};`);
  lines.push(`node.position.set(${vector(entry.position)});`);
  if (entry.rotationQuaternion) lines.push(`node.rotationQuaternion = new Quaternion(${vector(entry.rotationQuaternion)});`);
  else if (entry.rotation?.some(Boolean)) lines.push(`node.rotation.set(${vector(entry.rotation)});`);
  if (entry.scaling?.some((s) => s !== 1)) lines.push(`node.scaling.set(${vector(entry.scaling)});`);
  if (entry.pivotMatrix && entry.pivotMatrix.some((x, i) => x !== (i % 5 === 0 ? 1 : 0))) lines.push(`node.setPivotMatrix(Matrix.FromArray(${json(entry.pivotMatrix.map(number))}), false);`);
  if (entry.isEnabled === false) lines.push('node.setEnabled(false);');
  for (const [key, def] of Object.entries(DEFAULTS)) if (key in entry && entry[key] !== def) lines.push(`${v(PROPERTIES[key] ?? key)} = ${json(entry[key])};`);
  if (entry.alphaIndex !== undefined && entry.alphaIndex !== Number.MAX_VALUE && entry.alphaIndex !== null) lines.push(`node.alphaIndex = ${entry.alphaIndex};`);
  if (entry.materialUniqueId !== undefined && mesh?.material) lines.push(`node.material = materials[${json(entry.materialUniqueId)}] ?? null;`);
  if (mesh && entry.subMeshes?.length > 1) lines.push(`node.subMeshes = [];`, ...entry.subMeshes.map((s) => `new SubMesh(${s.materialIndex}, ${s.verticesStart}, ${s.verticesCount}, ${s.indexStart}, ${s.indexCount}, node);`));
  if (entry.skeletonId !== undefined) lines.push(`node.skeleton = scene.getSkeletonById(${json(entry.skeletonId)});`, `node.numBoneInfluencers = ${entry.numBoneInfluencers};`);
  if (entry.morphTargetManagerId !== undefined) lines.push(`node.morphTargetManager = morphTargets[${json(entry.morphTargetManagerId)}];`);
  if (entry.thinInstances?.instancesCount) lines.push(`node.thinInstanceSetBuffer('matrix', buffers[${bin.add(Float32Array.from(entry.thinInstances.matrixData.slice(0, entry.thinInstances.instancesCount * 16)))}], 16, true);`);
  for (const instance of entry.instances ?? []) {
    lines.push(`{ const instance = node.createInstance(${json(instance.name)}); instance.position.set(${vector(instance.position)}); ${instance.rotationQuaternion ? `instance.rotationQuaternion = new Quaternion(${vector(instance.rotationQuaternion)});` : `instance.rotation.set(${vector(instance.rotation)});`} instance.scaling.set(${vector(instance.scaling)}); }`);
  }
  if (entry.animations?.length) lines.push(`node.animations = ${json(entry.animations)}.map((a) => Animation.Parse(a));`);
  if (live) lines.push(`node.metadata = ${json({ bylonderModifiers: liveStack(live) })};`);
  lines.push(`nodes[${entry.uniqueId}] = node;`);
  return lines.filter(Boolean);
}

// Remesh's Voxel mode needs OpenVDB, which the kernels module is built without: such a stack stays applied.
const needsOpenVDB = (modifier) => modifier.kind === 'REMESH' && modifier.values.mode === 'VOXEL';

// An object's live stack as the polyfill takes it: the base Mesh's arrays as base64, and each modifier's settings with
// their DNA layouts.
const liveStack = ({ mesh, modifiers }) => ({
  base: Object.fromEntries(Object.entries({
    vert_positions: Float32Array.from(mesh.vert_positions), edges: Int32Array.from(mesh.edges), face_offsets: Int32Array.from(mesh.face_offsets),
    corner_verts: Int32Array.from(mesh.corner_verts), corner_edges: Int32Array.from(mesh.corner_edges), uvs: mesh.attribute('UVMap') && Float32Array.from(mesh.attribute('UVMap')),
  }).filter(([, array]) => array).map(([name, array]) => [name, base64(array)])),
  stack: modifiers.map(({ type, layouts, values }) => ({ type, layouts, values })),
});

const indent = (lines, by = '    ') => lines.map((l) => by + l).join('\n');

// The package's files but the runtime's: scene.js, scene.d.ts, scene.bin and images/. With `live`, objects whose
// modifiers are all Blender's keep them live through the modifier kernels polyfill, which createScene loads from
// `bylonder-modifiers/` next to the module (or its `modifiers` option).
export async function exportModule(world, { live: keepLive = false, parity = false, hostCompression = false } = {}) {
  const live = new Map(keepLive ? world.objects.map((node) => [node, world.modifiers.live(node)]).filter(([, stack]) => stack && !stack.modifiers.some(needsOpenVDB)) : []);
  await world.modifiers.settled();
  // The mapped meshes' geometry is read below: their mapping holds until the module is written.
  const mapped = exportRuntimes(world);
  try {
    return await moduleSource(world, live, mapped, parity, hostCompression);
  } finally {
    mapped.restore();
  }
}

async function moduleSource(world, live, mapped, parity, hostCompression) {
  const data = await serializeScene(world, { geometry: false, live, mapped, parity });
  const { scene } = world;
  const bin = createSceneBin({ gzip: !hostCompression }), images = imageFiles(data);
  const geometries = new Map(), geometryLines = [];
  const objects = [...data.transformNodes.map((entry) => ({ entry })), ...data.meshes.map((entry) => ({ entry, mesh: scene.getMeshByUniqueId(entry.uniqueId) }))];
  for (const { mesh } of objects) if (mesh?.geometry && !geometries.has(mesh.geometry)) {
    geometries.set(mesh.geometry, `geometries[${geometries.size}]`);
    geometryLines.push(`  ${geometryCode(mesh, bin)},`);
  }
  const controls = exportControls(world, data), rigs = areaRigs(world, data);
  const parented = [...data.transformNodes, ...data.meshes, ...data.lights, ...data.cameras].filter((e) => e.parentId !== undefined);
  const parse = (name, list, code) => (list?.length ? `  for (const entry of ${name}) ${code};\n` : '');
  const settings = {
    clearColor: data.clearColor, ambientColor: data.ambientColor, gravity: data.gravity, autoClear: data.autoClear, collisionsEnabled: data.collisionsEnabled,
    fog: data.fogMode ? { fogMode: data.fogMode, fogColor: data.fogColor, fogStart: data.fogStart, fogEnd: data.fogEnd, fogDensity: data.fogDensity } : null,
    environment: data.environmentTexture ? { url: data.environmentTexture, rotationY: data.environmentTextureRotationY ?? 0, hdr: data.environmentTextureType === 'BABYLON.HDRCubeTexture', size: data.environmentTextureSize, extension: data.environmentTextureForcedExtension, skybox: !!data.createDefaultSkybox } : null,
    environmentProbe: data.environmentProbe ?? null, environmentIntensity: data.environmentIntensity, iblIntensity: data.iblIntensity, useRightHandedSystem: data.useRightHandedSystem,
  };
  const name = world.sceneSettings.state.name || 'Scene';
  const source = `// ${name}, exported from Bylonder: load(engine) gives it with its controls, createScene(engine, canvas) builds it
// alone, with Babylon.js ${AbstractEngine.Version}. In a page, map @babylonjs/core to the same version:
// <script type="importmap">{ "imports": { "@babylonjs/core": "${CDN}" } }</script>
import { readBuffers } from './bylonder/buffers.js';
import { BlendScene } from './bylonder/blend-scene.js';
import { Animation, AnimationGroup, CascadedShadowGenerator, Color3, Color4, CubeTexture, EffectLayer, Geometry, HDRCubeTexture, Light, LinesMesh, Material, Matrix, Mesh, MorphTargetManager, MultiMaterial, PostProcess, Quaternion, ReflectionProbe, Scene, SerializationHelper, ShadowGenerator, Skeleton, SubMesh, TransformNode, Vector3, Camera, ParticleSystem } from '@babylonjs/core';
import * as BABYLON from '@babylonjs/core';

// Images and scene.bin sit beside this module.
const ROOT = new URL('./', import.meta.url).href;
let geometryCount = 0;
function geometry(scene, vertices, indices) {
  const result = new Geometry('geometry' + geometryCount++, scene);
  for (const [kind, [size, data]] of Object.entries(vertices)) result.setVerticesData(kind, data, false, size);
  if (indices) result.setIndices(indices);
  return result;
}

const SCENE = ${json(settings)};
const IMAGE_PROCESSING = ${json(data.imageProcessingConfiguration)};
const MATERIALS = ${json(data.materials)};
const MULTI_MATERIALS = ${json(data.multiMaterials)};
const SKELETONS = ${json(data.skeletons)};
const MORPH_TARGETS = ${json(data.morphTargetManagers)};
const LIGHTS = ${json(data.lights)};
const CAMERAS = ${json(data.cameras)};
const SHADOW_GENERATORS = ${json(data.shadowGenerators ?? [])};
const EFFECT_LAYERS = ${json(data.effectLayers ?? [])};
const REFLECTION_PROBES = ${json(data.reflectionProbes ?? [])};
const PARTICLE_SYSTEMS = ${json(data.particleSystems)};
const ANIMATION_GROUPS = ${json(data.animationGroups)};
const RENDERING_PIPELINES = ${json(data.renderingPipelines)};
const POST_PROCESSES = ${json(data.postProcesses)};
const BUFFERS = ${json(bin.views)};
const CONTROLS = ${json(controls)};
const AREA_RIGS = ${json(rigs)};

export async function load(engine) {
  return new BlendScene(await createScene(engine, engine.getRenderingCanvas()), CONTROLS);
}

export async function createScene(engine, canvas${live.size ? ", { modifiers = new URL('./bylonder-modifiers/', import.meta.url) } = {}" : ''}) {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = SCENE.useRightHandedSystem;
  scene.autoClear = SCENE.autoClear;
  scene.clearColor = Color4.FromArray(SCENE.clearColor);
  scene.ambientColor = Color3.FromArray(SCENE.ambientColor);
  scene.gravity = Vector3.FromArray(SCENE.gravity);
  scene.collisionsEnabled = SCENE.collisionsEnabled;
  if (SCENE.fog) Object.assign(scene, SCENE.fog, { fogColor: Color3.FromArray(SCENE.fog.fogColor) });
  SerializationHelper.Parse(() => scene.imageProcessingConfiguration, IMAGE_PROCESSING, scene);
  const env = SCENE.environment;
  if (env) {
    scene.environmentTexture = env.hdr ? new HDRCubeTexture(new URL(env.url, ROOT).href, scene, env.size ?? 128) : CubeTexture.CreateFromPrefilteredData(new URL(env.url, ROOT).href, scene, env.extension);
    scene.environmentTexture.rotationY = env.rotationY;
    if (env.skybox) scene.createDefaultSkybox(scene.environmentTexture, true, 1000, 0);
  }
  scene.environmentIntensity = SCENE.environmentIntensity;
  scene.iblIntensity = SCENE.iblIntensity ?? 1;
  const buffers = await readBuffers(new URL('scene.bin', ROOT), BUFFERS, ${!hostCompression});

  const materials = {};
  for (const entry of MATERIALS) materials[entry.uniqueId] = Material.Parse(entry, scene, ROOT);
  for (const entry of MULTI_MATERIALS) materials[entry.uniqueId] = MultiMaterial.ParseMultiMaterial(entry, scene);
  for (const entry of SKELETONS) Skeleton.Parse(entry, scene);
  const morphTargets = {};
  for (const entry of MORPH_TARGETS) morphTargets[entry.id] = MorphTargetManager.Parse(entry, scene);
  const geometries = [
${geometryLines.join('\n')}
  ];

  const nodes = {};
${objects.map(({ entry, mesh }) => `  // ${entry.name}\n  {\n${indent(nodeCode(entry, mesh, geometries, live.get(mesh), bin))}\n  }`).join('\n')}
${parse('LIGHTS', data.lights, 'nodes[entry.uniqueId] = Light.Parse(entry, scene)')}${parse('CAMERAS', data.cameras, 'nodes[entry.uniqueId] = Camera.Parse(entry, scene)')}
${parented.map((e) => `  nodes[${e.uniqueId}].parent = nodes[${e.parentId}] ?? null;`).join('\n')}
  // An area light turns by its parent: a rig placed as its object.
  for (const rig of AREA_RIGS) {
    const light = nodes[rig.light], node = new TransformNode(rig.id, scene);
    node.rotationQuaternion = new Quaternion();
    Matrix.FromArray(rig.matrix).decompose(node.scaling, node.rotationQuaternion, node.position);
    node.parent = light.parent;
    light.parent = node;
    light.position.setAll(0);
  }

${parse('REFLECTION_PROBES', data.reflectionProbes, "ReflectionProbe.Parse(entry, scene, ROOT)")}${parse('SHADOW_GENERATORS', data.shadowGenerators, "(entry.className === 'CascadedShadowGenerator' ? CascadedShadowGenerator : ShadowGenerator).Parse(entry, scene)")}${parse('EFFECT_LAYERS', data.effectLayers, "EffectLayer.Parse(entry, scene, ROOT)")}${parse('PARTICLE_SYSTEMS', data.particleSystems, "ParticleSystem.Parse(entry, scene, ROOT)")}  if (SCENE.environmentProbe) scene.environmentTexture = scene.reflectionProbes.find((p) => p.name === SCENE.environmentProbe)?.cubeTexture ?? scene.environmentTexture;
  scene.activeCamera = scene.getCameraById(${json(data.activeCameraID ?? null)}) ?? scene.cameras[0] ?? null;
  for (const entry of RENDERING_PIPELINES) BABYLON[entry.customType]?.Parse(entry, scene, ROOT);
  for (const entry of POST_PROCESSES) PostProcess.Parse(entry, scene, ROOT);
  for (const entry of ANIMATION_GROUPS) AnimationGroup.Parse(entry, scene).play(entry.loopAnimation);
  if (canvas) scene.activeCamera?.attachControl(canvas, true);${live.size ? `
  // Blender's modifiers stay live: the polyfill evaluates them in a worker and again when an animated setting changes.
  try {
    const { liveModifiers } = await import(new URL('modifiers.js', modifiers).href);
    scene.metadata = { ...scene.metadata, liveModifiers: await liveModifiers(scene, { url: modifiers }) };
  } catch (error) {
    console.warn('Live modifiers unavailable, drawn applied:', error.message);
  }` : ''}
  return scene;
}
`;
  // An ES module package in Node too (the headless SDK), needing only Babylon.
  const manifest = { name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), type: 'module', main: 'scene.js', types: 'scene.d.ts', peerDependencies: { '@babylonjs/core': AbstractEngine.Version } };
  return { 'scene.js': source, 'scene.d.ts': controlTypes(controls), 'scene.bin': bin.bytes(), 'package.json': `${JSON.stringify(manifest, null, 2)}\n`, ...images };
}
