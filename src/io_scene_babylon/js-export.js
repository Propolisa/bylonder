// File > Export > JavaScript: a package whose scene.js builds the exported scene with Babylon's API. Objects (meshes,
// empties) are written as their initialization code, with geometry read straight from the evaluated meshes into
// scene.bin (scene-bin.js); materials, lights, cameras, shadows, animation and effects are Babylon's own serialization,
// passed to their Parse functions as Babylon's .babylon loader does, with images as files beside it. `load(engine)`
// gives the scene with its controls (runtime/blend-scene.js), `createScene(engine, canvas)` the scene alone. The scene's IR
// (docs/ir.md), its properties and computed entities among it, is scene.ir.json beside it.
import { AbstractEngine, Animation, Matrix } from '@babylonjs/core';
import { objectMatrix } from '../runtime/object-transform.js';
import { CLOCK, sampledGaps, serializeScene } from './babylon-export.js';
import { exportRuntimes } from '../runtimes/runtimes.js';
import { exportControls, controlTypes } from './controls-export.js';
import { exportNodeMaterial, materialKernels } from './node-material-export.js';
import { fillMaterials, MESH_VALUE } from './runtime/materials.js';
import { worldNodes } from '../blenkernel/scene/world-babylon.js';
import { createSceneBin } from './scene-bin.js';
import { imageFiles } from './image-files.js';
import { exportCompositor } from './compositor-export.js';
import { exportIR, idKey } from './ir-export.js';
import { channels, readsOtherIDs } from './modifiers-export.js';
import { AREA_SPECULAR, gplFolders, NODE_KERNELS } from './runtime-files.js';
import { CURVES_GLSL_FILE, curvesGlslFile } from './curves-export.js';
import { exportVolumes, VOLUMES_FILE } from './volumes-export.js';
import { idStruct } from '../python/bpy_rna.js';
import { displayExponent } from '../render/view-settings.js';
import { AREA_LIGHT } from './area-lights.js';
import { LOG_SIZE, STOPS } from '../render/display-lut.js';
import { colorManagementFiles } from '../imbuf/colormanagement.js';
import { halfFloats } from '../blenkernel/colorband.js';

const CDN = `https://cdn.jsdelivr.net/npm/@babylonjs/core@${AbstractEngine.Version}/+esm`;
const json = (value) => JSON.stringify(value);
const number = (v) => +v.toFixed(7);
const vector = (values) => values.map(number).join(', ');

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
  if (live) lines.push(`node.metadata = ${json({ bylonderChannels: channels(live) })};`);
  lines.push(`nodes[${entry.uniqueId}] = node;`);
  return lines.filter(Boolean);
}

// Remesh's Voxel mode needs OpenVDB, which the kernels module is built without: such a stack stays applied.
const needsOpenVDB = (modifier) => modifier.kind === 'REMESH' && modifier.values.mode === 'VOXEL';

// The thin instances of one instancer (main-view.js drawInstances) become its child's, in its space: they follow it when
// it moves, as Blender's instances do. Instances of several instancers stay in world space.
function parentInstances(objects) {
  const exported = new Set(objects.map(({ entry }) => entry.uniqueId));
  for (const { entry, mesh } of objects) {
    const [instancer, ...more] = mesh?.metadata?.instancers ?? [], { thinInstances } = entry;
    if (!thinInstances?.instancesCount || !instancer || more.length || !exported.has(instancer.uniqueId)) continue;
    const inverse = objectMatrix(instancer).clone().invert();
    for (let i = 0; i < thinInstances.instancesCount; i++) Matrix.FromArray(thinInstances.matrixData, i * 16).multiply(inverse).copyToArray(thinInstances.matrixData, i * 16);
    entry.parentId = instancer.uniqueId;
  }
}

const indent = (lines, by = '    ') => lines.map((l) => by + l).join('\n');

// The world's node material, as the export writes a material's, or null for a world of one color.
async function worldMaterial(scene, parity, graphOf) {
  const material = worldNodes.get(scene);
  return material ? exportNodeMaterial(material, { parity, graph: graphOf(material) }) : null;
}

// The per-node kernels of the materials built from the IR's graphs (runtime-files.js NODE_KERNELS), or null. A material
// whose nodes the page cannot build from its graph ships its own code instead.
async function irMaterials(materials, graphs, ir, parity) {
  const source = await materialKernels(graphs, { parity });
  const kernels = source && JSON.parse(source.slice(source.indexOf('export default ') + 'export default '.length).trim().replace(/;$/, ''));
  for (const [material, key] of graphs) {
    const at = materials.findIndex((entry) => entry.blocks?.some((block) => block.options?.blender?.graph === key) && entry.name === material.name);
    if (at < 0) continue;
    try {
      fillMaterials([structuredClone(materials[at])], ir, kernels);
    } catch (error) {
      console.warn(`${material.name}: built from its own code, not the IR (${error.message})`);
      materials[at] = await exportNodeMaterial(material, { parity });
    }
  }
  return materials.some((entry) => entry.blocks?.some((block) => block.options?.blender)) ? source : null;
}

// The IR graph key of each material and world of Blender's nodes (ir-export.js idGraphs), which the page builds them
// from (runtime/materials.js fillMaterials); `graphs` collects them, for their kernels. With `volume`, its volume
// material (volumes-export.js) and the mesh it draws in, whose kernels are the graph's `<key>/volume`.
function materialGraphs(world, graphs) {
  const sync = world.mainSync, mainWorld = sync && idStruct(sync.blender.scene).world;
  return (material, volume = null) => {
    const ma = sync?.materialOf(material), id = ma ? idStruct(ma) : material === worldNodes.get(world.scene) ? mainWorld : null;
    if (!id?.node_tree) return null;
    const key = `${idKey(id)}/node_tree`;
    graphs.push(volume ? [volume.material, key, { kernel: `${key}/volume`, mesh: volume.mesh }] : [material, key]);
    return key;
  };
}

// Node materials' custom block code, each body once: the blocks name its index in the module's CODE.
function sharedCode(materials) {
  const bodies = new Map();
  for (const entry of materials) for (const block of entry.blocks ?? []) {
    const body = block.options?.code;
    if (!Array.isArray(body)) continue;
    const key = JSON.stringify(body);
    if (!bodies.has(key)) bodies.set(key, bodies.size);
    block.options.code = bodies.get(key);
  }
  return [...bodies.keys()].map((key) => JSON.parse(key));
}

const PIPELINE_EFFECTS = ['bloomEnabled', 'depthOfFieldEnabled', 'fxaaEnabled', 'sharpenEnabled', 'chromaticAberrationEnabled', 'grainEnabled', 'glowLayerEnabled'];
// A rendered view's display transform (runtime/view-transform.js) as Main's view settings give it: its lattice of
// Blender's display processor goes to scene.bin, but for Standard without a look, which is sRGB's encoding. Standard
// too is a post process, as the app's: the world's clear color, which no material draws, is scene linear.
async function displaySettings(world, bin) {
  const sync = world.mainSync, view = sync && idStruct(sync.blender.scene).view_settings;
  if (!view) return null;
  const standard = view.view_transform === 'Standard' && view.look === 'None';
  let lattice = null;
  if (!standard) {
    await colorManagementFiles();
    const made = sync.blender.displayLut(LOG_SIZE, STOPS);
    if (made) lattice = { size: LOG_SIZE, stops: STOPS, range: made.range, texels: bin.add(halfFloats(made.rgba)) };
  }
  return { exposure: 2 ** view.exposure, exponent: displayExponent(view.gamma), lattice };
}

// A scene whose only animation is its Grease Pencil drawings plays its frames all the same: an animation group counting
// the frames (CLOCK) on a Grease Pencil object's node, whose frame the page shows.
function greasePencilClock(world, ir, groups) {
  const animated = Object.values(ir.entities).find((e) => e.type === 'grease_pencil:LAYER' && e.inputs.frames.length > 1);
  if (groups.length || !animated) return;
  const { fps, frameStart, frameEnd, loop } = world.animation.time.state;
  const animation = new Animation('Frame', CLOCK, fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  animation.setKeys([{ frame: frameStart, value: frameStart }, { frame: frameEnd, value: frameEnd }]);
  groups.push({ name: 'Grease Pencil', from: frameStart, to: frameEnd, speedRatio: 1, loopAnimation: !!loop, isAdditive: false, weight: -1, playOrder: 0,
    targetedAnimations: [{ animation: animation.serialize(), targetId: animated.outputs.geometry.draw }] });
}

// The package's files but the runtime's: scene.js, scene.d.ts, scene.ir.json, scene.bin and images/. With `live`, objects whose
// modifiers are all Blender's keep them live (modifiers-export.js), run by modifiers.wasm in bylonder-modifiers/. With
// `bakeAnimation`, what Babylon cannot play as its F-Curve is sampled per frame.
export async function exportModule(world, { live: keepLive = false, parity = false, hostCompression = false, bakeAnimation = false } = {}) {
  const live = new Map(keepLive ? world.objects.map((node) => [node, world.modifiers.live(node)]).filter(([node, stack]) => stack && !stack.modifiers.some(needsOpenVDB) && !readsOtherIDs(world, node)) : []);
  await world.modifiers.settled();
  // The mapped meshes' geometry is read below: their mapping holds until the module is written.
  const mapped = exportRuntimes(world, { bake: bakeAnimation });
  try {
    return await moduleSource(world, live, mapped, { parity, hostCompression, bakeAnimation });
  } finally {
    mapped.restore();
  }
}

async function moduleSource(world, live, mapped, { parity, hostCompression, bakeAnimation }) {
  const graphs = [], graphOf = materialGraphs(world, graphs);
  const data = await serializeScene(world, { geometry: false, live, mapped, parity, graphOf, bake: bakeAnimation });
  const { scene } = world;
  const worldEntry = await worldMaterial(scene, parity, graphOf);
  if (worldEntry) data.materials.push(worldEntry);
  const volumes = await exportVolumes(scene, { parity, graphOf, meshes: new Set(data.meshes.map((m) => m.id)), lights: new Set(data.lights.map((l) => l.id)) });
  if (volumes) data.materials.push(...volumes.materials);
  const bin = createSceneBin({ gzip: !hostCompression }), images = imageFiles(data);
  const geometries = new Map(), geometryLines = [];
  const objects = [...data.transformNodes.map((entry) => ({ entry })), ...data.meshes.map((entry) => ({ entry, mesh: scene.getMeshByUniqueId(entry.uniqueId) }))];
  for (const { mesh } of objects) if (mesh?.geometry && !geometries.has(mesh.geometry)) {
    geometries.set(mesh.geometry, `geometries[${geometries.size}]`);
    geometryLines.push(`  ${geometryCode(mesh, bin)},`);
  }
  const composited = data.cameras.length ? exportCompositor(world) : null;
  const display = await displaySettings(world, bin);
  // Area lights as Bylonder's (runtime/area-light.js): lit once parsed, and casting shadows as its Area Light Shadows
  // extension has them.
  const areaLights = data.lights.some((l) => l.type === AREA_LIGHT), areaSpecular = data.materials.some((m) => m.customType === 'BABYLON.PBRMaterial');
  // Bylonder's own pipeline of a rendered view (render-babylon.js SceneLinearPipeline) turns the scene's image processing
  // off, so materials would encode to display themselves: with the view transform, which displays instead, it stays out
  // unless one of its effects is on.
  if (display) data.renderingPipelines = data.renderingPipelines.filter((p) => !(p._name?.startsWith('__display:') && !PIPELINE_EFFECTS.some((e) => p[e])));
  const controls = [...exportControls(world, data), ...(composited?.knobs ?? [])];
  const ir = exportIR(world, { controls, live, bin, animationGroups: data.animationGroups, curves: data.liveCurves, constraints: data.liveConstraints }), irJson = json(ir);
  sampledGaps(data, ir);
  greasePencilClock(world, ir, data.animationGroups);
  const kernels = await irMaterials(data.materials, graphs, ir, parity), code = sharedCode(data.materials);
  const curves = Object.values(ir.entities).some((e) => e.implementation === 'curves');
  const meshValued = data.materials.some((m) => m.blocks?.some((b) => b.name.startsWith(MESH_VALUE)));
  volumes?.dispose();
  parentInstances(objects);
  const parented = [...data.transformNodes, ...data.meshes, ...data.lights, ...data.cameras].filter((e) => e.parentId !== undefined);
  const parse = (name, list, code) => (list?.length ? `  for (const entry of ${name}) ${code};\n` : '');
  const settings = {
    clearColor: data.clearColor, ambientColor: data.ambientColor, gravity: data.gravity, autoClear: data.autoClear, collisionsEnabled: data.collisionsEnabled,
    fog: data.fogMode ? { fogMode: data.fogMode, fogColor: data.fogColor, fogStart: data.fogStart, fogEnd: data.fogEnd, fogDensity: data.fogDensity } : null,
    environment: data.environmentTexture ? { url: data.environmentTexture, rotationY: data.environmentTextureRotationY ?? 0, hdr: data.environmentTextureType === 'BABYLON.HDRCubeTexture', size: data.environmentTextureSize, extension: data.environmentTextureForcedExtension, skybox: !!data.createDefaultSkybox } : null,
    world: !data.environmentTexture && scene.metadata?.wbWorld ? { color: scene.metadata.wbWorld.color.map((v) => v * (scene.metadata.wbWorld.strength ?? 1)), material: worldEntry?.uniqueId ?? null } : null,
    defaultMaterial: data.defaultMaterialId ?? null, environmentProbe: data.environmentProbe ?? null, environmentIntensity: data.environmentIntensity, iblIntensity: data.iblIntensity, useRightHandedSystem: data.useRightHandedSystem,
  };
  // Written before the module's tables: they add thin instance buffers to scene.bin.
  const objectLines = objects.map(({ entry, mesh }) => `  // ${entry.name}\n  {\n${indent(nodeCode(entry, mesh, geometries, live.get(mesh), bin))}\n  }`).join('\n');
  const name = world.sceneSettings.state.name || 'Scene';
  const source = `// ${name}, exported from Bylonder: load(engine) gives it with its controls, createScene(engine, canvas) builds it
// alone, with Babylon.js ${AbstractEngine.Version}. On WebGPU, create the engine with the adapter's limits, as its materials
// need: WebGPUEngine.CreateAsync(canvas, { ...WEBGPU_OPTIONS }), from './bylonder/overrides/webgpu/maximum-limits.js'.
// In a page, map @babylonjs/core to the same version:
// <script type="importmap">{ "imports": { "@babylonjs/core": "${CDN}" } }</script>${[...gplFolders(irJson), ...(kernels ? [NODE_KERNELS.split('/')[0]] : []), ...(volumes ? [VOLUMES_FILE.split('/')[0]] : [])].map((folder) => `
// Includes GPL code: ${folder}/, Blender's code (GPL-3.0-or-later, ${folder}/LICENSE.md), loaded only when a control
// that needs it is set.`).join('')}${areaSpecular ? `
// Includes GPL code: ${AREA_SPECULAR}, Blender's light specular (GPL-3.0-or-later, ${AREA_SPECULAR.split('/')[0]}/LICENSE.md).` : ''}
import { readBuffers, readBytes } from './bylonder/buffers.js';
import { worldColor, worldNodes } from './bylonder/world.js';
import { BlendScene } from './bylonder/blend-scene.js';
import { derivativeUniformity } from './bylonder/overrides/webgpu/derivative-uniformity.js';
import { reservedNames } from './bylonder/overrides/webgpu/reserved-names.js';
import { webgpuSamplers } from './bylonder/overrides/webgpu/samplers.js';
import { warnUnlessMaximumLimits } from './bylonder/overrides/webgpu/maximum-limits.js';
import { depthMetricVaryings } from './bylonder/overrides/webgpu/depth-metric-varyings.js';
import { lightBlocksWhereRead } from './bylonder/overrides/webgpu/vertex-light-blocks.js';
import { pbrFromGLSL } from './bylonder/overrides/webgpu/pbr-from-glsl.js';
import { parsePostProcess } from './bylonder/overrides/babylon/god-rays-parse.js';
import { parsedPipeline } from './bylonder/overrides/babylon/pipeline-effects.js';
import './bylonder/overrides/babylon/chromatic-aberration-size.js';
import './bylonder/overrides/babylon/geometry-gamma-albedo.js';
import './bylonder/overrides/babylon/environment-probe.js';
import './bylonder/overrides/babylon/srgb-texture-parse.js';
import { parseCamera } from './bylonder/overrides/babylon/camera-quaternion.js';
import { orthoScaled } from './bylonder/ortho-scale.js';${kernels || meshValued ? `
import { ${[kernels && 'fillMaterials', meshValued && 'meshValues'].filter(Boolean).join(', ')} } from './bylonder/materials.js';` : ''}${kernels ? `
import kernels from './${NODE_KERNELS}';` : ''}${curves ? `
// The curves blocks the materials drawing curves use, before they are parsed.
import './${CURVES_GLSL_FILE}';` : ''}${volumes ? `
// The volume passes, whose blocks the volume materials use, before they are parsed.
import { sceneVolumes } from './${VOLUMES_FILE}';` : ''}${display ? `
import { viewTransform } from './bylonder-view-transform.js';
import './bylonder/overrides/babylon/linear-image-processing.js';` : ''}${areaLights ? `
import { AreaLight } from './bylonder-area-light.js';
import { parseLight } from './bylonder/overrides/babylon/area-light-parse.js';` : ''}${composited ? `
import { compositor } from './bylonder-blocks.js';` : ''}${areaSpecular ? `
import { blenderAreaSpecular } from './${AREA_SPECULAR}';` : ''}
import { Animation, AnimationGroup, CascadedShadowGenerator, Color3, Color4, CubeTexture, EffectLayer, Geometry, HDRCubeTexture, Light, LinesMesh, Material, Matrix, Mesh, MorphTargetManager, MultiMaterial, Quaternion, ReflectionProbe, Scene, SerializationHelper, ShadowGenerator, Skeleton, SubMesh, TransformNode, Vector3, Camera, ParticleSystem } from '@babylonjs/core';
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
const CODE = ${json(code)};
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
const BUFFERS = ${json(bin.views)};${volumes ? `
const VOLUMES = ${json(volumes.config)};` : ''}${display ? `
const DISPLAY = ${json(display)};` : ''}${composited ? `
const COMPOSITOR = ${json(composited.compositor)};` : ''}

// Babylon's screen-space pipelines draw from its geometry buffer in half floats, as Bylonder's rendered views have them:
// their own Parse takes its prepass, which turns the scene's image processing back into the materials, and 8-bit targets.
const SCREEN_SPACE = {
  SSRRenderingPipeline: (entry, scene) => new BABYLON.SSRRenderingPipeline(entry._name, scene, undefined, true, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT),
  SSAO2RenderingPipeline: (entry, scene) => new BABYLON.SSAO2RenderingPipeline(entry._name, scene, entry._ratio, undefined, true, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT),
};

// Each built scene's IR, world, compositor and scene.bin buffers, which load gives its controls.
const IRS = new WeakMap(), WORLDS = new WeakMap(), COMPOSITORS = new WeakMap(), SCENE_BUFFERS = new WeakMap();
export async function load(engine) {
  warnUnlessMaximumLimits(engine);
  const scene = await createScene(engine, engine.getRenderingCanvas());
  return new BlendScene(scene, IRS.get(scene), { root: ROOT, world: WORLDS.get(scene), compositor: COMPOSITORS.get(scene), buffers: SCENE_BUFFERS.get(scene) });
}

export async function createScene(engine, canvas) {
  // On WebGPU, GLSL converted to WGSL keeps GLSL's rules, and PBR materials compile from GLSL with their shadows' depth
  // metrics derived in the fragment stage, within WebGPU's 28 values between stages, as in the app.
  if (engine.isWebGPU) pbrFromGLSL();
  const scene = new Scene(derivativeUniformity(reservedNames(engine.isWebGPU ? depthMetricVaryings(lightBlocksWhereRead(engine)) : engine)));
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
  SCENE_BUFFERS.set(scene, buffers);
  // The IR as data: read as bytes, as Node's fetch reads no file: URL.
  const ir = JSON.parse(new TextDecoder().decode(await readBytes(new URL('scene.ir.json', ROOT))));
  IRS.set(scene, ir);

  const materials = {};
  // A custom block's code is written once for every material that shares it.
  for (const entry of MATERIALS) for (const block of entry.blocks ?? []) if (typeof block.options?.code === 'number') block.options.code = CODE[block.options.code];
${kernels ? `  // Blender's nodes of each material and world, made from the IR's graphs.
  fillMaterials(MATERIALS, ir, kernels);
` : ''}  for (const entry of MATERIALS) materials[entry.uniqueId] = Material.Parse(entry, scene, ROOT);
  if (SCENE.defaultMaterial !== null) scene.defaultMaterial = materials[SCENE.defaultMaterial];
  // Node materials' samplers as WebGPU binds them.
  for (const material of Object.values(materials)) if (material.getClassName() === 'NodeMaterial') webgpuSamplers(material);${meshValued ? `
  // Each mesh's own texture space, in the materials it shares.
  for (const material of Object.values(materials)) meshValues(material);` : ''}${areaSpecular ? `
  // Lights' specular as EEVEE's, as the app's PBR materials have it.
  for (const material of Object.values(materials)) if (material.getClassName() === 'PBRMaterial') blenderAreaSpecular(material);` : ''}
  // A multi-material's slots by the exported materials' unique ids, as Babylon's loader resolves them after parsing.
  for (const entry of MULTI_MATERIALS) {
    const multi = materials[entry.uniqueId] = MultiMaterial.ParseMultiMaterial(entry, scene);
    multi.subMaterials = (entry.materialsUniqueIds ?? []).map((id) => materials[id] ?? null);
  }
  // The world lights the scene: its color, or its nodes baked once their shader is ready.
  const world = SCENE.world;
  if (world) WORLDS.set(scene, world.material !== null ? worldNodes(scene, materials[world.material]) : worldColor(scene, world.color));
  for (const entry of SKELETONS) Skeleton.Parse(entry, scene);
  const morphTargets = {};
  for (const entry of MORPH_TARGETS) morphTargets[entry.id] = MorphTargetManager.Parse(entry, scene);
  const geometries = [
${geometryLines.join('\n')}
  ];

  const nodes = {};
${objectLines}
${parse('LIGHTS', data.lights, `nodes[entry.uniqueId] = ${areaLights ? 'parseLight(entry, scene, AreaLight)' : 'Light.Parse(entry, scene)'}`)}${parse('CAMERAS', data.cameras, 'nodes[entry.uniqueId] = orthoScaled(parseCamera(entry, scene))')}
${parented.map((e) => `  nodes[${e.uniqueId}].parent = nodes[${e.parentId}] ?? null;`).join('\n')}${data.lights.some((l) => l.excludedMeshesIds?.length || l.includedOnlyMeshesIds?.length) ? `
  // The meshes each light leaves out or lights alone, by id, as Babylon's loader resolves them once the meshes exist.
  const meshes = (ids) => ids.map((id) => scene.getMeshById(id)).filter(Boolean);
  for (const entry of LIGHTS) {
    const light = nodes[entry.uniqueId];
    if (entry.excludedMeshesIds?.length) light.excludedMeshes = meshes(entry.excludedMeshesIds);
    if (entry.includedOnlyMeshesIds?.length) light.includedOnlyMeshes = meshes(entry.includedOnlyMeshesIds);
  }` : ''}

${parse('REFLECTION_PROBES', data.reflectionProbes, "ReflectionProbe.Parse(entry, scene, ROOT)")}${parse('SHADOW_GENERATORS', data.shadowGenerators, "(entry.className === 'CascadedShadowGenerator' ? CascadedShadowGenerator : ShadowGenerator).Parse(entry, scene)")}${parse('EFFECT_LAYERS', data.effectLayers, "EffectLayer.Parse(entry, scene, ROOT)")}${parse('PARTICLE_SYSTEMS', data.particleSystems, "ParticleSystem.Parse(entry, scene, ROOT)")}  if (SCENE.environmentProbe) scene.environmentTexture = scene.reflectionProbes.find((p) => p.name === SCENE.environmentProbe)?.cubeTexture ?? scene.environmentTexture;
  scene.activeCamera = scene.getCameraById(${json(data.activeCameraID ?? null)}) ?? scene.cameras[0] ?? null;
  for (const entry of RENDERING_PIPELINES) {
    const make = SCREEN_SPACE[entry.customType];
    if (make) SerializationHelper.Parse(() => make(entry, scene), entry, scene, ROOT);
    else parsedPipeline(BABYLON[entry.customType]?.Parse(entry, scene, ROOT), entry);
  }
  for (const entry of POST_PROCESSES) parsePostProcess(entry, scene, ROOT);${volumes ? `
  // EEVEE's volumes, resolved over each camera's render before its other post-processes.
  sceneVolumes(scene, VOLUMES, materials, WORLDS.get(scene)?.box ?? null);` : ''}
${data.animationGroups.some((g) => g.targetedAnimations.some((t) => t.animation.property === CLOCK)) ? `  // The frame Babylon's animation keeps where the page's F-Curves are all that moves.
  for (const entry of ANIMATION_GROUPS) for (const { animation, targetId } of entry.targetedAnimations) if (animation.property === '${CLOCK}') scene.getNodeById(targetId).${CLOCK} = entry.from;
` : ''}  for (const entry of ANIMATION_GROUPS) AnimationGroup.Parse(entry, scene).play(entry.loopAnimation);${display ? `
  // Displayed as Blender's rendered view: scene linear, ${composited ? 'composited, ' : ''}then the view transform.
  const camera = scene.activeCamera;
  if (camera) {
    const display = viewTransform(camera, { ...DISPLAY, lattice: DISPLAY.lattice && { ...DISPLAY.lattice, texels: buffers[DISPLAY.lattice.texels] } });${composited ? `
    COMPOSITORS.set(scene, (await compositor(scene, camera, COMPOSITOR, display)).graph);` : ''}
  }` : ''}
  if (canvas) scene.activeCamera?.attachControl(canvas, true);
  return scene;
}
`;
  // An ES module package in Node too (the headless SDK), needing only Babylon.
  const manifest = { name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), type: 'module', main: 'scene.js', types: 'scene.d.ts', peerDependencies: { '@babylonjs/core': AbstractEngine.Version } };
  return { 'scene.js': source, 'scene.d.ts': controlTypes(Object.entries(ir.properties).map(([path, { type }]) => ({ path, type }))), 'scene.ir.json': irJson, ...(kernels && { [NODE_KERNELS]: kernels }), ...(curves && { [CURVES_GLSL_FILE]: curvesGlslFile() }), 'scene.bin': bin.bytes(), 'package.json': `${JSON.stringify(manifest, null, 2)}\n`, ...images };
}
