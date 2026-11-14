// File > Export > JavaScript: a package whose scene.js builds the exported scene with Babylon's API. Objects (meshes,
// empties) are written as their initialization code, with geometry read straight from the evaluated meshes into
// scene.bin (scene-bin.js); materials, lights, cameras, shadows, animation and effects are Babylon's own serialization,
// passed to their Parse functions as Babylon's .babylon loader does, with images as files beside it. `load(engine)`
// gives the scene with its controls (runtime/blend-scene.js), `createScene(engine, canvas)` the scene alone. The scene's IR
// (docs/ir.md), its properties and computed entities among it, is scene.ir.json beside it.
import { findRoles } from './runtime/character/roles.js';
import { AbstractEngine, Animation, Matrix } from '@babylonjs/core';
import { objectMatrix } from '../runtime/object-transform.js';
import { CLOCK, sampledGaps, serializeScene } from './babylon-export.js';
import { binaryClipKeys, CLIP_KEYS_SOURCE, irClips, isClip } from './clip-export.js';
import { binaryMorphTargets, MORPH_KEYS_SOURCE } from './morph-export.js';
import { remappedIndices, skinSkeletons } from './skeleton-export.js';
import { exportRuntimes } from '../runtimes/runtimes.js';
import { exportSampling } from './sampling.js';
import { prepareKernels } from './pose-export.js';
import { chosenState, CLIP_COMPRESSION, NAVIGATION, TARGETS } from './export-options.js';
import { exportControls, controlTypes, sceneOf, withUI } from './controls-export.js';
import { evaluateForRender } from './render-evaluation.js';
import { exportCollections } from './collections-export.js';
import { exportNodeMaterial, kernelsFile, materialKernels } from './node-material-export.js';
import { fillMaterials, MESH_VALUE } from './runtime/materials.js';
import { exportSounds } from './sound-export.js';
import { worldNodes } from '../blenkernel/scene/world-babylon.js';
import { createSceneBin } from './scene-bin.js';
import { digest, imageFiles } from './image-files.js';
import { exportCompositor } from './compositor-export.js';
import { fogGlowOnGPU } from '../compositor/compositor-replay.js';
import { exportIR, idKey } from './ir-export.js';
import { animationTables, irTables, keyed, tableKeys } from './scene-tables.js';
import { packageState } from './scene-patch.js';
import { channels, liveStack } from './modifiers-export.js';
import { AREA_LIGHTS_LTC, AREA_SPECULAR, FOG_GLOW, PANEL_ICONS, BABYLON_ASSETS, CHUNKS, COMPILER_FOLDER, gplFolders, NODE_KERNELS, UNITS_FILE } from './runtime-files.js';
import { AREA_SPECULAR_UNIT, FOG_GLOW_UNIT, PANEL_ICONS_UNIT, replaces, stripEntities, stripPieces, unitManifest } from './unit-manifest.js';
import { CURVES_GLSL_FILE, curvesGlslFile } from './curves-export.js';
import { exportVolumes, VOLUMES_FILE } from './volumes-export.js';
import { idStruct } from '../python/bpy_rna.js';
import { displayExponent } from '../render/view-settings.js';
import { AREA_LIGHT } from './area-lights.js';
import { clusteredLights } from '../blenkernel/light/clustered-lights.js';
import { lightRecord } from '../blenkernel/light/light-home.js';
import { LOG_SIZE, STOPS } from '../render/display-lut.js';
import { colorManagementFiles } from '../imbuf/colormanagement.js';
import { halfFloats } from '../blenkernel/colorband.js';
import { babylonModule, sideEffectImports } from './babylon-modules.js';

const CDN = `https://cdn.jsdelivr.net/npm/@babylonjs/core@${AbstractEngine.Version}/`;
const json = (value) => JSON.stringify(value);
// What Babylon's SceneLoader loads the package into a scene from, once bylonder/scene-loader.js is imported.
const ASSET_FILE = 'scene.bylonder', ASSET_MANIFEST = `${JSON.stringify({ module: './scene.js', loader: './bylonder/scene-loader.js' })}
`;
const TARGET_NAMES = Object.fromEntries(TARGETS.map(([id, label]) => [id, label]));
// The page's createEngine for each target: WebGPU with the adapter's limits its materials need, and in a bundle with the
// GLSL to WGSL compilers it carries.
const engines = (bundle) => {
  // Babylon's CreateAsync never settles when the adapter or device fails to start; initAsync rejects.
  const START_WEBGPU = `async function webgpuEngine(WebGPU, canvas, options) {
  const settings = { ...WEBGPU_OPTIONS, ${bundle ? '...COMPILERS, ' : ''}...options };
  const engine = new WebGPU(canvas, settings);
  await engine.initAsync(settings.glslangOptions, settings.twgslOptions);
  return engine;
}
`;
  return {
    BOTH: `${START_WEBGPU}// A WebGPU engine where the browser has WebGPU and its device starts, else a WebGL 2 one: the page loads only the
// engines it tries.
export async function createEngine(canvas, options = {}) {
  const webgpu = globalThis.navigator?.gpu && (await import('@babylonjs/core/Engines/webgpuEngine.js')).WebGPUEngine;
  if (webgpu && (await webgpu.IsSupportedAsync)) {
    try { return await webgpuEngine(webgpu, canvas, options); } catch (error) { console.warn(\`WebGPU failed to start, drawing with WebGL 2: \${error?.message ?? error}\`); }
  }
  return new (await import('@babylonjs/core/Engines/engine.js')).Engine(canvas, true, options);
}`,
    WEBGPU: `${START_WEBGPU}export const createEngine = (canvas, options = {}) => webgpuEngine(WebGPUEngine, canvas, options);`,
    WEBGL2: 'export const createEngine = async (canvas, options = {}) => new Engine(canvas, true, options);',
  };
};
// Where scene.js imports Babylon: the names its code uses, and the modules its data needs registered.
const BABYLON_IMPORTS = '/* @babylonjs/core imports */';
// Where scene.js names its scene.bin and IR's version, and its tables', filled once they are written.
const VERSION = '@scene-files-version@', TABLES_VERSION = '@scene-tables-version@';
const number = (v) => +v.toFixed(7);
const vector = (values) => values.map(number).join(', ');

// Babylon's classes the scene's data names, which parse only once their modules have registered them: each customType
// and className (BABYLON.PBRMaterial, a node material's blocks), each light's and camera's constructor, and the
// textures Texture.Parse makes through another module.
// The rig skeleton of each armature that skins one mesh, by the armature's name, its skin skeleton and that mesh.
function skeletonsOf(data) {
  return Object.fromEntries((data.skeletons ?? []).filter((s) => !s.rig).flatMap((s) => {
    const skin = data.skeletons.find((k) => k.rig === s.id), meshes = data.meshes.filter((m) => m.skeletonId === (skin?.id ?? s.id));
    return meshes.length === 1 ? [[s.name, { skeleton: s.id, ...(skin && { skin: skin.id }), mesh: meshes[0].id }]] : [];
  }));
}

// Each armature with clips: the names its character takes (controls-export.js characterNames).
function armatureNames(data, ir) {
  /** @type {Record<string, { actions: string[], markers: string[], groups: string[], roles: string[], properties: string[] }>} */
  const armatures = {};
  for (const clip of data.clips ?? []) {
    for (const id of clip.ids ?? []) {
      if (!id.pose) continue;
      const bones = [...id.pose.bones].map((b) => b.name);
      const entry = armatures[id.name] ??= { actions: [], markers: [], groups: [...(id.data?.collections_all ?? [])].map((c) => c.name), roles: Object.keys(findRoles(bones)), properties: [] };
      entry.actions.push(clip.name);
      entry.markers.push(...[...(clip.action?.pose_markers ?? [])].map((m) => m.name));
    }
  }
  for (const [name, entry] of Object.entries(armatures)) {
    const own = `objects[${JSON.stringify(name)}]`;
    for (const path of Object.keys(ir.properties)) {
      const m = path.startsWith(own) && /\["((?:[^"\\]|\\.)*)"\]$/.exec(path);
      if (m) entry.properties.push(JSON.parse(`"${m[1]}"`));
    }
  }
  return armatures;
}

function parsedClasses(data) {
  const names = new Set([...data.lights.map((l) => `node:Light_Type_${l.type}`), ...data.cameras.map((c) => `node:${c.type}`)]);
  // Material.Parse reads a material without a customType as a StandardMaterial.
  if (data.materials.some((m) => !m.customType)) names.add('StandardMaterial');
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value.isCube) names.add(value.isRenderTarget ? 'RenderTargetTexture' : 'CubeTexture');
    else if (value.isRenderTarget) names.add(value.mirrorPlane ? 'MirrorTexture' : 'RenderTargetTexture');
    for (const [key, v] of Object.entries(value)) {
      if ((key === 'customType' || key === 'className') && typeof v === 'string') names.add(v);
      // A StandardMaterial's Fresnel parameters, which its parse reads through the registry.
      else if (key.endsWith('FresnelParameters') && v) names.add('FresnelParameters');
      else walk(v);
    }
  };
  walk(data);
  return [...[...names].map(babylonModule).filter(Boolean), ...(names.has('BABYLON.NodeMaterial') ? NODE_MATERIAL_INCLUDES : [])];
}
// Babylon's node blocks that emit the helperFunctions include without importing it (TransformBlock, FragmentOutputBlock
// and others), which a page that loads only its own modules would fetch from Babylon's shader folder.
const NODE_MATERIAL_INCLUDES = ['Shaders/ShadersInclude/helperFunctions.js', 'ShadersWGSL/ShadersInclude/helperFunctions.js'];
// The scene components the parsed objects add themselves to.
const COMPONENTS = { shadowGenerators: 'Lights/Shadows/shadowGeneratorSceneComponent.js', effectLayers: 'Layers/effectLayerSceneComponent.js', particleSystems: 'Particles/particleSystemComponent.js' };
// What every page uses: picking under the pointer (Ray) and the color curves its image processing parses; and the
// material a mesh without its own draws with.
const PAGE_MODULES = ['Culling/ray.js', 'Materials/colorCurves.js'], DEFAULT_MATERIAL = 'Materials/standardMaterial.js';
// The names scene.js imports from @babylonjs/core, each only where its code uses it.
const BABYLON_NAMES = ['Animation', 'AnimationGroup', 'Camera', 'CascadedShadowGenerator', 'Color3', 'Color4', 'Constants', 'CubeTexture', 'EffectLayer', 'Engine', 'Geometry', 'HDRCubeTexture', 'Light',
  'LinesMesh', 'Material', 'Matrix', 'Mesh', 'MorphTargetManager', 'MultiMaterial', 'ParticleSystem', 'Quaternion', 'ReflectionProbe', 'Scene', 'SerializationHelper', 'ShadowGenerator', 'Skeleton',
  'SSAO2RenderingPipeline', 'SSRRenderingPipeline', 'SubMesh', 'Tools', 'TransformNode', 'Vector3', 'WebGPUEngine'];
const usedNames = (source) => {
  const code = source.replace(/^\s*\/\/.*$/gm, '').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  return BABYLON_NAMES.filter((name) => new RegExp(String.raw`(?<![\w$.])${name}\b`).test(code));
};

// Babylon's screen-space pipelines, made as scene.js makes them (below), by customType, on the geometry buffer's scene
// component, which they use without importing it.
const GEOMETRY_BUFFER = 'Rendering/geometryBufferRendererSceneComponent.js';
// The scene's depth renderer, which the pipelines with depth of field or ambient occlusion turn on through the scene.
const DEPTH_RENDERER = 'Rendering/depthRendererSceneComponent.js', DEPTH_PIPELINES = ['DefaultRenderingPipeline', 'LensRenderingPipeline', 'SSAORenderingPipeline'];
const SCREEN_SPACE_PIPELINES = {
  SSRRenderingPipeline: '(entry, scene) => new SSRRenderingPipeline(entry._name, scene, undefined, true, Constants.TEXTURETYPE_HALF_FLOAT)',
  SSAO2RenderingPipeline: '(entry, scene) => new SSAO2RenderingPipeline(entry._name, scene, entry._ratio, undefined, true, Constants.TEXTURETYPE_HALF_FLOAT)',
};

// A geometry's vertex buffers by Babylon kind, with their sizes, and its indices, as buffers of scene.bin: one entry per
// geometry, shared by its meshes. A thin instance buffer (world0 to world3, per instance) is the mesh's thinInstances,
// written with its node.
function geometryEntry(mesh, bin, skins) {
  const kinds = mesh.getVerticesDataKinds().filter((kind) => !mesh.getVertexBuffer(kind).getIsInstanced());
  const map = mesh.skeleton && skins?.get(mesh.skeleton.id)?.map;
  const vertices = Object.fromEntries(kinds.map((kind) => {
    const size = mesh.getVertexBuffer(kind).getSize(), data = Float32Array.from(mesh.getVerticesData(kind, false, false));
    return [kind, [size, bin.add(map ? remappedIndices(kind, data, map, mesh.skeleton.bones.length) : data)]];
  }));
  const indices = mesh.getIndices();
  const wide = mesh.getTotalVertices() > 65535;
  return { vertices, ...(indices?.length && { indices: bin.add(wide ? Uint32Array.from(indices) : Uint16Array.from(indices)) }) };
}

const DEFAULTS = { isVisible: true, visibility: 1, receiveShadows: false, pickable: true, billboardMode: 0, checkCollisions: false, infiniteDistance: false, layerMask: 0x0fffffff, alwaysSelectAsActiveMesh: false, isBlocker: false, hasVertexAlpha: false };
const numbers = (values) => values.map(number);
const identity = (matrix) => matrix.every((x, i) => x === (i % 5 === 0 ? 1 : 0));

// One node's entry (runtime/scene-tables.js makes it), from its serialization (`entry`) and, for a mesh, its Babylon
// mesh and its geometry's key.
function nodeEntry(entry, mesh, geometry, live, bin) {
  const lines = entry.type === 'LinesMesh', set = Object.fromEntries(Object.entries(DEFAULTS).filter(([key, def]) => key in entry && entry[key] !== def).map(([key]) => [key, entry[key]]));
  const metadata = { ...(live && { bylonderChannels: channels(live) }), ...(entry.metadata?.bylonderDualQuaternions && { bylonderDualQuaternions: true }), ...(entry.metadata?.bylonderBounds && { bylonderBounds: entry.metadata.bylonderBounds }) };
  return {
    type: mesh ? (lines ? 'LinesMesh' : 'Mesh') : 'TransformNode', name: entry.name, id: entry.id, uniqueId: entry.uniqueId,
    ...(mesh && lines && { color: numbers(mesh.color.asArray()), ...(mesh.alpha !== 1 && { alpha: mesh.alpha }) }),
    // A points mesh without indices (a PointsCloudSystem's) draws its vertices in order, as in the app.
    ...(mesh?.material?.pointsCloud && !mesh.getIndices()?.length && { unIndexed: true }),
    ...(mesh?.geometry && { geometry }),
    position: numbers(entry.position),
    ...(entry.rotationQuaternion ? { rotationQuaternion: numbers(entry.rotationQuaternion) } : entry.rotation?.some(Boolean) && { rotation: numbers(entry.rotation) }),
    ...(entry.scaling?.some((s) => s !== 1) && { scaling: numbers(entry.scaling) }),
    ...(entry.pivotMatrix && !identity(entry.pivotMatrix) && { pivotMatrix: numbers(entry.pivotMatrix) }),
    ...(entry.isEnabled === false && { enabled: false }),
    ...(Object.keys(set).length && { set }),
    ...(entry.alphaIndex !== undefined && entry.alphaIndex !== Number.MAX_VALUE && entry.alphaIndex !== null && { alphaIndex: entry.alphaIndex }),
    ...(entry.materialUniqueId !== undefined && mesh?.material && { material: entry.materialUniqueId }),
    ...(mesh && entry.subMeshes?.length > 1 && { subMeshes: entry.subMeshes.map((s) => [s.materialIndex, s.verticesStart, s.verticesCount, s.indexStart, s.indexCount]) }),
    ...(entry.skeletonId !== undefined && { skeleton: entry.skeletonId, numBoneInfluencers: entry.numBoneInfluencers }),
    ...(entry.morphTargetManagerId !== undefined && { morphTargets: entry.morphTargetManagerId }),
    ...(entry.thinInstances?.instancesCount && { thinInstances: bin.add(Float32Array.from(entry.thinInstances.matrixData.slice(0, entry.thinInstances.instancesCount * 16))) }),
    ...(entry.instances?.length && { instances: entry.instances.map(({ name, position, rotationQuaternion, rotation, scaling }) => ({ name, position: numbers(position),
      ...(rotationQuaternion ? { rotationQuaternion: numbers(rotationQuaternion) } : { rotation: numbers(rotation) }), scaling: numbers(scaling) })) }),
    ...(entry.animations?.length && { animations: entry.animations }),
    // Its channels, and dual quaternion skinning (armature.js), which BlendScene turns on.
    ...(Object.keys(metadata).length && { metadata }),
    ...(entry.parentId !== undefined && { parentId: entry.parentId }),
    ...(entry.parentBone && { parentBone: entry.parentBone }),
    ...(entry.poseMatrix && { poseMatrix: Array.from(entry.poseMatrix) }),
  };
}

// Remesh's Voxel mode needs OpenVDB, which the kernels module is built without: such a stack stays applied.

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


// A node graph's blocks (a node material's, the compositor's render graph) named by their place in it, as their unique
// ids are new at each export.
function blocksByPlace(graph) {
  if (!graph?.blocks) return;
  const places = new Map(graph.blocks.map((block, i) => [block.id, i + 1])), place = (id) => places.get(id) ?? id;
  for (const block of graph.blocks) {
    block.id = place(block.id);
    for (const input of block.inputs ?? []) if (input.targetBlockId !== undefined) input.targetBlockId = place(input.targetBlockId);
  }
  if (graph.outputNodes) graph.outputNodes = graph.outputNodes.map(place);
  if (graph.outputNodeId !== undefined) graph.outputNodeId = place(graph.outputNodeId);
  for (const location of graph.editorData?.locations ?? []) location.blockId = place(location.blockId);
}

// Entries name materials and what has a place in the scene by key, as unique ids are new at each export and differ
// between a whole export and one of selected objects: nodes' materials and parents, multi-materials, the scene's default
// and world materials, the volumes' domains and the lights clustered.
function stableReferences(tables, settings, volumes, clustered) {
  const placed = new Map(['nodes', 'lights', 'cameras'].flatMap((table) => Object.entries(tables[table]).map(([key, entry]) => [entry.uniqueId, key])));
  for (const table of ['nodes', 'lights', 'cameras']) for (const entry of Object.values(tables[table])) {
    if (entry.parentId !== undefined) entry.parent = placed.get(entry.parentId) ?? null;
    if (entry.parentBone) { const { meshId, ...bone } = entry.parentBone; entry.parentBone = { ...bone, mesh: placed.get(meshId) ?? null }; }
    delete entry.parentId;
    delete entry.uniqueId;
  }
  if (clustered) clustered.splice(0, clustered.length, ...clustered.map((id) => placed.get(id)));
  const keys = new Map(Object.entries({ ...tables.materials, ...tables.multiMaterials }).map(([key, entry]) => [entry.uniqueId, key]));
  const key = (id) => keys.get(id) ?? null;
  for (const node of Object.values(tables.nodes)) if (node.material !== undefined) node.material = key(node.material);
  for (const multi of Object.values(tables.multiMaterials)) multi.materialsUniqueIds = multi.materialsUniqueIds?.map(key);
  if (settings.defaultMaterial !== null) settings.defaultMaterial = key(settings.defaultMaterial);
  if (settings.world?.material != null) settings.world.material = key(settings.world.material);
  for (const domain of volumes?.domains ?? []) domain[1] = key(domain[1]);
  for (const entry of [...Object.values(tables.materials), ...Object.values(tables.multiMaterials)]) delete entry.uniqueId;
}

// The world's node material, as the export writes a material's, or null for a world of one color.
async function worldMaterial(scene, parity, graphOf) {
  const material = worldNodes.get(scene);
  return material ? exportNodeMaterial(material, { parity, graph: graphOf(material) }) : null;
}

// The per-node kernels of the materials built from the IR's graphs (runtime-files.js NODE_KERNELS), or null. A material
// whose nodes the page cannot build from its graph ships its own code instead, its name added to `ownCode`.
async function irMaterials(materials, graphs, ir, parity, ownCode) {
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
      ownCode.push(material.name);
    }
  }
  return materials.some((entry) => entry.blocks?.some((block) => block.options?.blender)) ? kernels : null;
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
// Bylonder's own pipeline of a rendered view with none of its effects on: it only displays (render-babylon.js).
export const displayOnly = (pipeline) => pipeline._name?.startsWith('__display:') && !PIPELINE_EFFECTS.some((e) => pipeline[e]);
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
function greasePencilClock(world, ir, groups, timeline) {
  const animated = Object.values(ir.entities).find((e) => e.type === 'grease_pencil:LAYER' && e.inputs.frames.length > 1);
  if (timeline || !animated) return;
  const { fps, frameStart, frameEnd, loop } = world.animation.time.state;
  const animation = new Animation('Frame', CLOCK, fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  animation.setKeys([{ frame: frameStart, value: frameStart }, { frame: frameEnd, value: frameEnd }]);
  groups.push({ name: 'Grease Pencil', from: frameStart, to: frameEnd, speedRatio: 1, loopAnimation: !!loop, isAdditive: false, weight: -1, playOrder: 0,
    targetedAnimations: [{ animation: animation.serialize(), targetId: animated.outputs.geometry.draw }] });
}

// Selected Objects, as Blender's glTF exporter's use_selection: the world with the selected objects and the parents that
// place them (an armature its meshes hang from) as its objects; `only` the set the export keeps.
function selectedWorld(world, selected) {
  const objects = new Set(world.objects), only = new Set();
  // A node placing an object that is no object itself (a light's or camera's rig) is kept with it; a bone is not a node.
  const placing = (node) => objects.has(node) || node.getClassName?.() === 'TransformNode';
  const keep = (node) => { if (!node || only.has(node) || !placing(node)) return; only.add(node); keep(node.parent); };
  selected.forEach(keep);
  return Object.create(world, { objects: { value: Object.assign(world.objects.filter((n) => only.has(n)), { scene: world.objects.scene }) },
    only: { value: Object.assign(only, { objects }) } });
}

// The package's files but the runtime's: scene.js, scene.d.ts, scene.ir.json, scene.bin and images/. With `live` (the
// Modifiers branch's default state), objects whose modifiers are all Blender's keep them live (modifiers-export.js), run
// by modifiers.wasm in bylonder-modifiers/. With `bakeAnimation`, what Babylon cannot play as its F-Curve is sampled; `sampleRate`, the keys per
// second of what is sampled (export-options.js), a key per frame unset; `target`, the GPU engine its page makes
// (export-options.js TARGETS); `runtime`, `runtimes`, the runtimes its features export with (runtimes.js chosenRuntime);
// `replace`, the type keys of units the page registers itself, which the package ships none of (unit-manifest.js); `bundle`,
// whether the package is then bundled (bundle.js); `branchState` and `branches`, the states of the scene's branches
// (export-options.js chosenState); `scope`, the whole scene or its `selected` objects (export-options.js SCOPES);
// `clipCompression`, how clips' bone keys are compressed (export-options.js CLIP_COMPRESSION).

export const exportModule = async (world, options) => (await exportPackage(world, options)).files;

// The package's files, its tables by datablock and its buffers by key (scene-patch.js makes a patch of two).
export async function exportPackage(whole, { scope = 'SCENE', selected = [], live: keepLive = false, parity = false, hostCompression = false, bakeAnimation = false, animations = 'TIMELINE', clipCompression = 'STANDARD', target = 'BOTH', runtime = null, runtimes = {}, replace = [], bundle = false, controlPanel = true, devTools = 'CDN', navigation = 'FIXED', navigationModes = {}, branchState = null, branches = {}, sampleRate = {} } = {}) {
  const world = scope === 'SELECTED' ? selectedWorld(whole, selected) : whole;
  const states = { branchState, branches }, stackState = (node) => chosenState(states, 'modifiers', node.name) ?? (keepLive ? 'LIVE' : 'BAKED');
  const live = new Map(world.objects.filter((node) => stackState(node) === 'LIVE').map((node) => [node, liveStack(world, node)]).filter(([, stack]) => stack));
  const disable = evaluateForRender(whole);
  try {
    await world.modifiers.settled();
    await prepareKernels();
    // The mapped meshes' geometry is read below: their mapping holds until the module is written.
    const sampling = exportSampling(world.animation.time.state, sampleRate);
    const mapped = exportRuntimes(world, { bake: bakeAnimation, runtime, runtimes, sampling });
    try {
      return await moduleSource(world, live, mapped, { parity, hostCompression, bakeAnimation, animations, clipCompression, target, replace, bundle, controlPanel, devTools, navigation, navigationModes, states, sampling });
    } finally {
      mapped.restore();
    }
  } finally {
    disable();
  }
}

async function moduleSource(world, live, mapped, { parity, hostCompression, bakeAnimation, animations, clipCompression, target, replace, bundle, controlPanel, devTools, navigation, navigationModes, states, sampling }) {
  const graphs = [], graphOf = materialGraphs(world, graphs), asset = !!world.only;
  const data = await serializeScene(world, { geometry: false, live, mapped, parity, graphOf, bake: bakeAnimation, sampling, only: world.only, animations, onBones: true });
  if (chosenState(states, 'postProcessing') === 'OFF') Object.assign(data, { renderingPipelines: [], postProcesses: [] });
  // Selected objects bring none of the scene's settings: its world, environment, effect layers or volumes.
  if (asset) Object.assign(data, { environmentTexture: undefined, effectLayers: [] });
  const { scene } = world;
  const worldEntry = asset ? null : await worldMaterial(scene, parity, graphOf);
  if (worldEntry) data.materials.push(worldEntry);
  const volumes = asset || chosenState(states, 'volumes') === 'OFF' ? null : await exportVolumes(scene, { parity, graphOf, meshes: new Set(data.meshes.map((m) => m.id)), lights: new Set(data.lights.map((l) => l.id)) });
  if (volumes) data.materials.push(...volumes.materials);
  const bin = createSceneBin({ gzip: !hostCompression }), images = imageFiles(data);
  // The skin skeletons the meshes skin to, of the rig skeletons' bones they weight.
  const skins = skinSkeletons(scene, data);
  // Each geometry once, by the id of the first node using it.
  const geometries = new Map(), geometryEntries = [];
  const objects = [...data.transformNodes.map((entry) => ({ entry })), ...data.meshes.map((entry) => ({ entry, mesh: scene.getMeshByUniqueId(entry.uniqueId) }))];
  for (const { entry, mesh } of objects) if (mesh?.geometry && !geometries.has(mesh.geometry)) {
    geometries.set(mesh.geometry, entry.id);
    geometryEntries.push([entry.id, geometryEntry(mesh, bin, skins)]);
  }
  const compositorState = chosenState(states, 'compositor') ?? 'LIVE';
  const composited = !asset && data.cameras.length && compositorState !== 'OFF' ? exportCompositor(world) : null;
  const display = asset ? null : await displaySettings(world, bin);
  // Area lights as Bylonder's (runtime/area-light.js): lit once parsed, and casting shadows as its Area Light Shadows
  // extension has them.
  const pbr = data.materials.filter((m) => m.customType === 'BABYLON.PBRMaterial').length;
  const areaLights = data.lights.some((l) => l.type === AREA_LIGHT), areaSpecular = pbr > 0, blenderSpecular = areaSpecular && !replaces(replace, AREA_SPECULAR_UNIT);
  // More lights than any device's material takes (8 at least) drawn in clusters (Clustered Lights), but where the page's
  // volumes, which read the scene's lights, would lose them; a light with a Custom Distance kept out where there is room.
  const clustered = !asset && !volumes && data.lights.length > 8 && clusteredLights.enabled(scene)
    && data.lights.filter((l) => { const light = scene.getLightByUniqueId(l.uniqueId); return light && lightRecord(light)?.use_custom_distance; }).map((l) => l.uniqueId);
  // Bylonder's own pipeline of a rendered view (render-babylon.js SceneLinearPipeline) turns the scene's image processing
  // off, so materials would encode to display themselves: with the view transform, which displays instead, it stays out
  // unless one of its effects is on.
  if (display) data.renderingPipelines = data.renderingPipelines.filter((p) => !displayOnly(p));
  // Baked, the compositor runs with its settings as exported: none of them a control.
  const collected = world.mainSync && !asset ? exportCollections(sceneOf(world.mainSync)) : null;
  const controls = withUI([...exportControls(world, data), ...(collected?.controls ?? []), ...(compositorState === 'LIVE' ? composited?.knobs ?? [] : [])]);
  const timelineGroups = data.animationGroups.filter((group) => !isClip(group)), markers = world.mainSync ? [...sceneOf(world.mainSync).timeline_markers].map(({ name, frame }) => ({ name, frame })) : [];
  const { sounds, files: soundFiles } = world.mainSync && !asset ? await exportSounds(sceneOf(world.mainSync)) : { sounds: [], files: {} };
  const ir = exportIR(world, { controls, collections: collected, live, bin, animationGroups: timelineGroups, sampleRates: data.sampleRates, clips: irClips(data.clips), markers, sounds, curves: data.liveCurves, constraints: data.liveConstraints, skeletons: skeletonsOf(data), states });
  const computed = { ...ir, entities: structuredClone(ir.entities) };
  stripEntities(ir, replace);
  const irJson = json(ir);
  sampledGaps(data, ir);
  greasePencilClock(world, ir, data.animationGroups, timelineGroups.length > 0);
  const ownCode = [], shipped = await irMaterials(data.materials, graphs, ir, parity, ownCode), code = sharedCode(data.materials);
  // Materials made again from their own code carry their images inline: moved to files as the others' were.
  imageFiles({ materials: data.materials.filter((m) => ownCode.includes(m.name)) }, images);
  const pieces = stripPieces(ir, shipped, replace), kernels = pieces && kernelsFile(pieces);
  const curves = Object.values(ir.entities).some((e) => e.implementation === 'curves');
  const meshValued = data.materials.some((m) => m.blocks?.some((b) => b.name.startsWith(MESH_VALUE)));
  const environmentLit = data.materials.some((m) => m.blocks?.some((b) => ['BABYLON.ReflectionBlock', 'BABYLON.RefractionBlock'].includes(b.customType)));
  // A composite convolving with Glare's Fog Glow kernel (compositor-replay.js fogGlowRecording), Blender's unless replaced,
  // with the Fog Glow render setting on.
  const fogGlow = !!composited && json(composited.compositor).includes('"op":"fogGlow"') && fogGlowOnGPU.enabled(world.scene), blenderFogGlow = fogGlow && !replaces(replace, FOG_GLOW_UNIT);
  const areaLitBlocks = areaLights && data.materials.some((m) => m.blocks?.some((b) => b.customType === 'BABYLON.PBRMetallicRoughnessBlock'));
  // The panel's Collections view, for a scene with collections, and its timeline, for a scene with frames to play, in
  // Blender's icons unless a unit replaces them.
  const timeline = ir.scene.time.frame_end > ir.scene.time.frame_start && controls.some((c) => c.bind?.frame);
  const panelIcons = controlPanel && (Object.keys(collected?.collections ?? {}).length > 1 || timeline), blenderIcons = panelIcons && !replaces(replace, PANEL_ICONS_UNIT);
  const units = json(unitManifest(computed, { kernels: shipped, replace, blocks: {
    ...(areaSpecular && { [AREA_SPECULAR_UNIT]: { files: [AREA_SPECULAR], interface: { apply: '(material: PBRMaterial) => void' }, use: { materials: pbr } } }),
    ...(panelIcons && { [PANEL_ICONS_UNIT]: { files: [PANEL_ICONS], interface: { icons: 'Record<string, [svg: string, width: number, height: number]>' }, use: { what: "the control panel's Collections view and timeline" } } }),
    ...(volumes && { 'block:volumes': { files: [VOLUMES_FILE], swappable: false, use: { materials: volumes.materials.length } } }),
    ...(fogGlow && { [FOG_GLOW_UNIT]: { files: [FOG_GLOW], interface: { value: '(x: number, y: number, degreesPerTexel: number) => number' }, use: { what: "Glare's Fog Glow in the composite" } } }),
    ...(composited && { 'block:compositor': { files: ['scene.js'], swappable: false, use: { what: "Blender's compositor GLSL made at export, in scene.js" } } }),
    ...(ownCode.length && { 'block:material_code': { files: ['scene.js'], swappable: false, use: { materials: ownCode } } }),
  } }));
  volumes?.dispose();
  parentInstances(objects);
  const pipelineTypes = [...new Set(data.renderingPipelines.map((p) => p.customType))];
  const pipelineClasses = pipelineTypes.filter((type) => !SCREEN_SPACE_PIPELINES[type] && babylonModule(type));
  const parse = (name, list, code) => (list?.length ? `  for (const entry of ${name}) ${code};\n` : '');
  // A table's parser (bylonder/scene-tables.js), where the scene has entries for it.
  const parser = (list, name, code) => (list?.length ? `\n    ${name}: ${code},` : '');
  const settings = {
    clearColor: data.clearColor, ambientColor: data.ambientColor, gravity: data.gravity, autoClear: data.autoClear, collisionsEnabled: data.collisionsEnabled,
    fog: data.fogMode ? { fogMode: data.fogMode, fogColor: data.fogColor, fogStart: data.fogStart, fogEnd: data.fogEnd, fogDensity: data.fogDensity } : null,
    environment: data.environmentTexture ? { url: data.environmentTexture, rotationY: data.environmentTextureRotationY ?? 0, hdr: data.environmentTextureType === 'BABYLON.HDRCubeTexture', size: data.environmentTextureSize, extension: data.environmentTextureForcedExtension, skybox: !!data.createDefaultSkybox } : null,
    world: !asset && !data.environmentTexture && scene.metadata?.wbWorld ? { color: scene.metadata.wbWorld.color.map((v) => v * (scene.metadata.wbWorld.strength ?? 1)), material: worldEntry?.uniqueId ?? null } : null,
    defaultMaterial: data.defaultMaterialId ?? null, environmentProbe: data.environmentProbe ?? null, environmentIntensity: data.environmentIntensity, iblIntensity: data.iblIntensity, useRightHandedSystem: data.useRightHandedSystem,
  };
  // The scene's tables by datablock (scene-tables.js); nodes first, as they add thin instance buffers to scene.bin.
  const keys = tableKeys(world, ir, data, worldEntry?.uniqueId ?? null), table = (name, list) => keyed(list ?? [], keys[name]);
  const nodes = keyed(objects.map(({ entry, mesh }) => nodeEntry(entry, mesh, mesh?.geometry && keys.geometries(geometries.get(mesh.geometry)), live.get(mesh), bin)), keys.nodes);
  const tables = { materials: table('materials', data.materials), multiMaterials: table('multiMaterials', data.multiMaterials), skeletons: table('skeletons', data.skeletons),
    morphTargets: table('morphTargets', binaryMorphTargets(data.morphTargetManagers ?? [], world.scene.meshes, bin)),
    geometries: Object.fromEntries(geometryEntries.map(([user, entry]) => [keys.geometries(user), entry])), nodes, lights: table('lights', data.lights), cameras: table('cameras', data.cameras),
    shadowGenerators: table('shadowGenerators', data.shadowGenerators), reflectionProbes: table('reflectionProbes', data.reflectionProbes), particleSystems: table('particleSystems', data.particleSystems),
    ...animationTables(data.animationGroups, keys, (groups) => binaryClipKeys(groups, bin, CLIP_COMPRESSION.find(([id]) => id === clipCompression)?.[3] ?? 1)) };
  // Nodes name their morph targets by key: a manager's id is new at each export.
  const morphKeys = new Map(Object.entries(tables.morphTargets).map(([key, { id }]) => [id, key]));
  for (const node of Object.values(nodes)) if (node.morphTargets !== undefined) node.morphTargets = morphKeys.get(node.morphTargets);
  for (const entry of Object.values(tables.morphTargets)) delete entry.id;
  stableReferences(tables, settings, volumes?.config, clustered || null);
  for (const graph of [...Object.values(tables.materials), composited?.compositor.graph]) blocksByPlace(graph);
  const name = world.sceneSettings.state.name || 'Scene', webgpu = target !== 'WEBGL2';
  const source = `// ${name}, exported from Bylonder: load(engine) gives it with its controls, createScene(engine, canvas) builds it
// alone, with Babylon.js ${AbstractEngine.Version}; createEngine(canvas) makes the engine it is exported for: ${TARGET_NAMES[target]}.${bundle ? `
// Bundled with the Babylon.js modules its scene uses (${CHUNKS}/, Apache-2.0, ${CHUNKS}/LICENSE.md): a page imports it as
// it is, with no import map, CDN or bundler.` : `
// It imports Babylon module by module, so a page loads only the modules its scene uses. In a page, map them to the
// same version: <script type="importmap">{ "imports": { "@babylonjs/core/": "${CDN}" } }</script>
// or, with @babylonjs/core installed, bundle it beside this module and import ./scene.bundle.js: npx esbuild scene.js --bundle
// --splitting --format=esm --minify --external:node:* --outdir=. --entry-names=[name].bundle --chunk-names=bundle/[name]-[hash]`}${[...gplFolders({ 'scene.ir.json': irJson, [UNITS_FILE]: units }), ...(pieces && Object.keys(pieces.pieces).length ? [NODE_KERNELS.split('/')[0]] : []), ...(volumes ? [VOLUMES_FILE.split('/')[0]] : [])].map((folder) => `
// Includes GPL code: ${folder}/, Blender's code (GPL-3.0-or-later, ${folder}/LICENSE.md), loaded only when a control
// that needs it is set.`).join('')}${blenderSpecular ? `
// Includes GPL code: ${AREA_SPECULAR}, Blender's light specular (GPL-3.0-or-later, ${AREA_SPECULAR.split('/')[0]}/LICENSE.md).` : ''}${blenderFogGlow ? `
// Includes GPL code: ${FOG_GLOW}, Blender's Fog Glow kernel (GPL-3.0-or-later, ${FOG_GLOW.split('/')[0]}/LICENSE.md).` : ''}${blenderIcons ? `
// Includes GPL code: ${PANEL_ICONS}, Blender's icons, loaded when the control panel opens (GPL-3.0-or-later, ${PANEL_ICONS.split('/')[0]}/LICENSE.md).` : ''}
import { readBuffers, readBytes } from './bylonder/buffers.js';
import { worldColor, worldNodes } from './bylonder/world.js';
import { cameraEffects, pipelineEffect, postProcessEffect } from './bylonder/camera-effects.js';
import { BlendScene } from './bylonder/blend-scene.js';
import { whenDrawable } from './bylonder/ready.js';
import { loadTables } from './bylonder/scene-tables.js';
import { mirrored } from './bylonder/skin-skeleton.js';
import { addAsset, assetContainer, cloneAsset } from './bylonder/asset.js';${controlPanel ? `
import { controlPanel } from './bylonder/control-panel.js';` : ''}
${webgpu ? `import { derivativeUniformity } from './bylonder/overrides/webgpu/derivative-uniformity.js';
import { reservedNames } from './bylonder/overrides/webgpu/reserved-names.js';
import { webgpuSamplers } from './bylonder/overrides/webgpu/samplers.js';
import { WEBGPU_OPTIONS, warnUnlessMaximumLimits } from './bylonder/overrides/webgpu/maximum-limits.js';
import { depthMetricVaryings } from './bylonder/overrides/webgpu/depth-metric-varyings.js';
import { lightBlocksWhereRead } from './bylonder/overrides/webgpu/vertex-light-blocks.js';
import { pbrFromGLSL } from './bylonder/overrides/webgpu/pbr-from-glsl.js';
` : ''}${data.postProcesses.length ? `import { parsePostProcess } from './bylonder/overrides/babylon/god-rays-parse.js';
` : ''}${pipelineTypes.length ? `import { parsedPipeline } from './bylonder/overrides/babylon/pipeline-effects.js';
import './bylonder/overrides/babylon/chromatic-aberration-size.js';
` : ''}${data.shadowGenerators?.length ? `import './bylonder/overrides/babylon/lit-side-normal-bias.js';
` : ''}import './bylonder/overrides/babylon/geometry-gamma-albedo.js';
import './bylonder/overrides/babylon/environment-probe.js';
import './bylonder/overrides/babylon/srgb-texture-parse.js';
import { lightBudget, reachLights } from './bylonder/overrides/babylon/light-reach.js';${clustered ? `
import { clusterLights } from './bylonder/overrides/babylon/clustered-lights.js';` : ''}
import { parseCamera } from './bylonder/overrides/babylon/camera-quaternion.js';
import { orthoScaled } from './bylonder/ortho-scale.js';${kernels || meshValued || environmentLit ? `
import { ${[kernels && 'fillMaterials', meshValued && 'meshValues', environmentLit && 'followsEnvironment'].filter(Boolean).join(', ')} } from './bylonder/materials.js';` : ''}${kernels ? `
import kernels from './${NODE_KERNELS}';` : ''}${curves ? `
// The curves blocks the materials drawing curves use, before they are parsed.
import './${CURVES_GLSL_FILE}';` : ''}${volumes ? `
// The volume passes, whose blocks the volume materials use, before they are parsed.
import { sceneVolumes } from './${VOLUMES_FILE}';` : ''}${display ? `
import { viewTransform } from './bylonder-view-transform.js';
import './bylonder/overrides/babylon/linear-image-processing.js';` : ''}${areaLights ? `
import { AreaLight } from './bylonder-area-light.js';
import { parseLight } from './bylonder/overrides/babylon/area-light-parse.js';` : ''}${areaLitBlocks ? `
// Babylon's PBR block with the area lights' samplers, before the materials using it are parsed.
import './bylonder/overrides/babylon/pbr-block-area-lights.js';` : ''}${composited ? `
import { compositor${fogGlow ? ', ReplayTask' : ''} } from './bylonder-blocks.js';` : ''}${fogGlow ? `
import { fftConvolution } from './bylonder-fft-convolution.js';` : ''}${blenderFogGlow ? `
import { fogGlowKernelValue } from './${FOG_GLOW}';` : ''}${areaSpecular || panelIcons || fogGlow ? `
import { unitFor } from './bylonder/units.js';` : ''}${blenderSpecular ? `
import { blenderAreaSpecular } from './${AREA_SPECULAR}';` : ''}
${BABYLON_IMPORTS}

// Images and scene.bin sit beside this module (its folder by text: bundlers such as Vite rewrite new URL('./', ...)).
const ROOT = import.meta.url.replace(/[^/]*$/, '');${areaLights ? `
// Babylon's assets too, unless the page has its own: its area lights' LTC table, ${AREA_LIGHTS_LTC}.
Tools.AssetBaseUrl ||= new URL('${BABYLON_ASSETS}', ROOT).href;` : ''}
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
// The scene's tables, each entry keyed by the datablock it is made from (bylonder/scene-tables.js).
const MATERIALS = ${json(tables.materials)};
const MULTI_MATERIALS = ${json(tables.multiMaterials)};
const SKELETONS = ${json(tables.skeletons)};
const MORPH_TARGETS = ${json(tables.morphTargets)};
const GEOMETRIES = ${json(tables.geometries)};
const NODES = ${json(tables.nodes)};
const LIGHTS = ${json(tables.lights)};
const CAMERAS = ${json(tables.cameras)};
const SHADOW_GENERATORS = ${json(tables.shadowGenerators)};
const EFFECT_LAYERS = ${json(data.effectLayers ?? [])};
const REFLECTION_PROBES = ${json(tables.reflectionProbes)};
const PARTICLE_SYSTEMS = ${json(tables.particleSystems)};
const ANIMATION_GROUPS = ${json(tables.animationGroups)};
const ANIMATIONS = ${json(tables.animations)};
const RENDERING_PIPELINES = ${json(data.renderingPipelines)};
const POST_PROCESSES = ${json(data.postProcesses)};
const BUFFERS = ${json(bin.views)};
// The tables' version (scene-patch.js), which a patch names as its base.
const TABLES_VERSION = '${TABLES_VERSION}';${volumes ? `
const VOLUMES = ${json(volumes.config)};` : ''}${display ? `
const DISPLAY = ${json(display)};` : ''}${composited ? `
const COMPOSITOR = ${json(composited.compositor)};` : ''}
${pipelineTypes.length ? `
// Babylon's screen-space pipelines draw from its geometry buffer in half floats, as Bylonder's rendered views have them:
// their own Parse takes its prepass, which turns the scene's image processing back into the materials, and 8-bit targets.
const SCREEN_SPACE = {${pipelineTypes.filter((type) => SCREEN_SPACE_PIPELINES[type]).map((type) => `
  ${type}: ${SCREEN_SPACE_PIPELINES[type]},`).join('')}
};
// Babylon's other pipelines, by their customType.
const PIPELINES = { ${pipelineClasses.join(', ')} };
` : ''}
// Each built scene's IR, world, compositor and scene.bin buffers, which load gives its controls.
const IRS = new WeakMap(), WORLDS = new WeakMap(), COMPOSITORS = new WeakMap(), SCENE_BUFFERS = new WeakMap(), TABLES = new WeakMap();${bundle && webgpu ? `
// Babylon's GLSL to WGSL compilers, which WebGPU needs, in the package.
const compiler = (name) => ({ jsPath: new URL(\`${COMPILER_FOLDER}/\${name}.js\`, ROOT).href, wasmPath: new URL(\`${COMPILER_FOLDER}/\${name}.wasm\`, ROOT).href });
const COMPILERS = { glslangOptions: compiler('glslang'), twgslOptions: compiler('twgsl') };` : ''}
${engines(bundle)[target]}
${data.skeletons?.length ? `// The character animation system (docs/character-animation.md), for the page's characters.
export * from './bylonder/character/api.js';
export * from './bylonder/character/effects/index.js';
` : ''}
// The scene with its controller: load(engine) builds it in a scene of its own, as the page does, with the scene's
// settings${controlPanel ? ' and the control panel' : ''}; load({ scene, root }) adds its objects to a scene of yours, as a .glb's are, under
// a root of their own, "__root__" (bylonder/asset.js), itself under \`root\` (a node of yours) if given, with none of the
// scene's settings; load({ instance, root }) copies what a load added, sharing its geometry, materials and textures. A
// load resolves once the scene's shaders are compiled.
export async function load(target) {
  if (target.scene || target.instance) {
    const { ir, buffers } = target.instance ?? await readData(), options = { root: target.root,
      controller: (view, entries, dispose) => new BlendScene(view, ir, { root: ROOT, buffers, entries, dispose, reload: (old) => { old.dispose(); return load(target); } }) };
    if (target.instance) return cloneAsset(target.instance.entries, options);
    const added = addAsset(target.scene, (into, lookup) => addObjects(into, { ir, buffers }, lookup), options);
    await entitiesRun(target.scene, added);
    await shadersCompiled(target.scene);
    return added;
  }
  const engine = target;${webgpu ? `
  warnUnlessMaximumLimits(engine);` : ''}
  const scene = await createScene(engine, engine.getRenderingCanvas());
  const blend = new BlendScene(scene, IRS.get(scene), { root: ROOT, world: WORLDS.get(scene), compositor: COMPOSITORS.get(scene), buffers: SCENE_BUFFERS.get(scene), tables: TABLES.get(scene),
    reload: (old) => { old.dispose(); return load(engine); } });
  await entitiesRun(scene, blend);
  await shadersCompiled(scene);${controlPanel ? `
  // The page's control panel, at the canvas's top right corner (none in Node).
  controlPanel(blend, ${json({ tools: devTools, navigation, offer: NAVIGATION.map(([id]) => id).filter((id) => navigationModes[id] !== false) }).replace('}', `, root: ROOT${panelIcons ? `, icons: () => Promise.resolve(unitFor('${PANEL_ICONS_UNIT}')?.icons${blenderIcons ? ` ?? import('./${PANEL_ICONS}').then((m) => m.default)` : ''})` : ''} }`)});
` : ''}
  return blend;
}

// A frame's entities run once and settled, so what they make (a rig the page's native runtime solves, its solver attached)
// is in place before the load resolves: the scheduler runs them after a frame's animations.
async function entitiesRun(scene, blend) {
  scene.animate();
  await blend.settled?.();
}

// Once the scene's shaders are compiled, so that a page's first frames do not stall on them: a frame drawn (its time
// held) sets what each material compiles for, within the engine's frame: an engine that submits a frame's commands at
// its end would send them with a later frame, to a canvas texture that has expired, and the page stays black. At once
// without a canvas (Node's Null engine compiles nothing).
async function shadersCompiled(scene) {
  const engine = scene.getEngine();
  if (!engine.getRenderingCanvas() || !scene.activeCamera) return;
  engine.beginFrame();
  scene.render(true, true);
  engine.endFrame();
  await whenDrawable(scene);
}

// The objects in an AssetContainer, as LoadAssetContainerAsync gives a .glb's: instantiate() loads a copy with its own controller.
export async function loadAssetContainer(scene) {
  const blend = await load({ scene });
  return assetContainer(blend, (root) => load({ instance: blend, root }));
}

// scene.bin's buffers and the IR, asked for by this export's version of them, so a cache never pairs them with
// another export's scene.js.
async function readData() {
  const buffers = await readBuffers(new URL('scene.bin?v=${VERSION}', ROOT), BUFFERS, ${!hostCompression});
  // The IR as data: read as bytes, as Node's fetch reads no file: URL.
  const ir = JSON.parse(new TextDecoder().decode(await readBytes(new URL('scene.ir.json?v=${VERSION}', ROOT))));
  return { buffers, ir };
}

export async function createScene(engine, canvas) {${webgpu ? `
  // On WebGPU, GLSL converted to WGSL keeps GLSL's rules, and PBR materials compile from GLSL with their shadows' depth
  // metrics derived in the fragment stage, within WebGPU's 28 values between stages, as in the app.
  if (engine.isWebGPU) pbrFromGLSL();
  const scene = new Scene(derivativeUniformity(reservedNames(engine.isWebGPU ? depthMetricVaryings(lightBlocksWhereRead(engine)) : engine)));` : `
  const scene = new Scene(engine);`}
  scene.useRightHandedSystem = SCENE.useRightHandedSystem;
  scene.autoClear = SCENE.autoClear;
  scene.clearColor = Color4.FromArray(SCENE.clearColor);
  scene.ambientColor = Color3.FromArray(SCENE.ambientColor);
  scene.gravity = Vector3.FromArray(SCENE.gravity);
  scene.collisionsEnabled = SCENE.collisionsEnabled;
  if (SCENE.fog) Object.assign(scene, SCENE.fog, { fogColor: Color3.FromArray(SCENE.fog.fogColor) });
  SerializationHelper.Parse(() => scene.imageProcessingConfiguration, IMAGE_PROCESSING, scene);
${settings.environment ? `  const env = SCENE.environment;
  scene.environmentTexture = ${settings.environment.hdr ? 'new HDRCubeTexture(new URL(env.url, ROOT).href, scene, env.size ?? 128)' : 'CubeTexture.CreateFromPrefilteredData(new URL(env.url, ROOT).href, scene, env.extension)'};
  scene.environmentTexture.rotationY = env.rotationY;
  if (env.skybox) scene.createDefaultSkybox(scene.environmentTexture, true, 1000, 0);
` : ''}  scene.environmentIntensity = SCENE.environmentIntensity;
  scene.iblIntensity = SCENE.iblIntensity ?? 1;
  const data = await readData(), { buffers } = data;
  SCENE_BUFFERS.set(scene, buffers);
  IRS.set(scene, data.ir);
  // The world lights the scene: its color, or its nodes baked once their shader is ready. Its environment exists before
  // the other materials are made, as Babylon's PBR block leaves out the light of an environment made after it.
  const world = SCENE.world;
  if (world?.material === null) WORLDS.set(scene, worldColor(scene, world.color));
  const made = addObjects(scene, data), materials = made.materialsByKey;
  TABLES.set(scene, made.state);
  if (SCENE.defaultMaterial !== null) scene.defaultMaterial = materials[SCENE.defaultMaterial];
  // A world of nodes the tables did not make first (one not keyed by a World, as code makes it).
  if (world && !WORLDS.has(scene)) WORLDS.set(scene, worldNodes(scene, materials[world.material]));
${parse('EFFECT_LAYERS', data.effectLayers, "EffectLayer.Parse(entry, scene, ROOT)")}  if (SCENE.environmentProbe) scene.environmentTexture = scene.reflectionProbes.find((p) => p.name === SCENE.environmentProbe)?.cubeTexture ?? scene.environmentTexture;
  scene.activeCamera = scene.getCameraById(${json(data.activeCameraID ?? null)}) ?? scene.cameras[0] ?? null;
${pipelineTypes.length ? `  for (const entry of RENDERING_PIPELINES) {
    const make = SCREEN_SPACE[entry.customType];
    if (make) SerializationHelper.Parse(() => make(entry, scene), entry, scene, ROOT);
    else parsedPipeline(PIPELINES[entry.customType]?.Parse(entry, scene, ROOT), entry);
  }
  for (const pipeline of scene.postProcessRenderPipelineManager.supportedPipelines) cameraEffects(scene).add(pipelineEffect(scene, pipeline._name), true);
` : ''}${parse('POST_PROCESSES', data.postProcesses, 'cameraEffects(scene).add(postProcessEffect(parsePostProcess(entry, scene, ROOT)), true)').trimEnd()}${volumes ? `
  // EEVEE's volumes, resolved over the active camera's render before its other post-processes.
  const volumesOn = new Map(), box = WORLDS.get(scene)?.box ?? null;
  cameraEffects(scene).add({
    attach: (camera) => volumesOn.set(camera, sceneVolumes(scene, VOLUMES, materials, box, [camera])[0]),
    detach: (camera) => { volumesOn.get(camera)?.dispose(); volumesOn.delete(camera); },
  });` : ''}${display ? `
  // Displayed as Blender's rendered view: scene linear, ${composited ? 'composited, ' : ''}then the view transform.
  const camera = scene.activeCamera;
  if (camera) {
    const display = cameraEffects(scene).add(postProcessEffect(viewTransform(camera, { ...DISPLAY, lattice: DISPLAY.lattice && { ...DISPLAY.lattice, texels: buffers[DISPLAY.lattice.texels] } })), true).post;${composited ? `${fogGlow ? `
    // Glare's Fog Glow: its kernel a registered unit gives, else Blender's, convolved by an FFT on the GPU.
    const fogGlowKernel = unitFor('${FOG_GLOW_UNIT}')?.value${blenderFogGlow ? ' ?? fogGlowKernelValue' : ''};
    if (fogGlowKernel) ReplayTask.operations.fogGlow = (task, step, read) => fftConvolution(task, step, read, fogGlowKernel);` : ''}
    const composited = await compositor(scene, COMPOSITOR, display);
    if (composited.render) cameraEffects(scene).add(postProcessEffect(composited.render, display));
    COMPOSITORS.set(scene, composited.graph);` : ''}
  }` : ''}
  if (canvas) scene.activeCamera?.attachControl(canvas, true);
  return scene;
}

${CLIP_KEYS_SOURCE}
${MORPH_KEYS_SOURCE}
// The exported objects added to \`scene\` at once, without awaiting: \`lookup\` finds by id what this call made
// (bylonder/asset.js). Gives the materials by their exported unique ids.
function addObjects(scene, { buffers, ir }, lookup = scene) {
  const materials = structuredClone(MATERIALS);
  // A custom block's code is written once for every material that shares it.
  for (const entry of Object.values(materials)) for (const block of entry.blocks ?? []) if (typeof block.options?.code === 'number') block.options.code = CODE[block.options.code];
${kernels ? `  // Blender's nodes of each material and world, made from the IR's graphs.
  fillMaterials(Object.values(materials), ir, kernels);
` : ''}${areaSpecular ? `  // Lights' specular as a registered unit gives it${blenderSpecular ? `, else as EEVEE's, as the app's PBR materials have it` : ', else as Babylon lights them'}.
  const areaSpecular = unitFor('${AREA_SPECULAR_UNIT}')?.apply${blenderSpecular ? ' ?? blenderAreaSpecular' : ''};
` : ''}${data.animationGroups.some((g) => g.targetedAnimations.some((t) => t.animation.dataType === Animation.ANIMATIONTYPE_MATRIX)) ? `  // Bones' poses interpolated between their keys, as between frames and on a grid sparser than the frames.
  Animation.AllowMatricesInterpolation = true;
` : ''}  const parsers = {${parser(data.materials, 'materials', `(entry) => {
      const material = Material.Parse(entry, scene, ROOT);${webgpu ? `
      // Node materials' samplers as WebGPU binds them.
      if (material.getClassName() === 'NodeMaterial') webgpuSamplers(material);` : ''}${meshValued ? `
      // Each mesh's own texture space, in the materials it shares.
      meshValues(material);` : ''}${environmentLit ? `
      // Lit or refracting by the scene's environment, built again as one appears or goes.
      followsEnvironment(material);` : ''}${areaSpecular ? `
      if (areaSpecular && material.getClassName() === 'PBRMaterial') areaSpecular(material);` : ''}
      return material;
    }`)}${parser(data.multiMaterials, 'multiMaterials', `(entry, key, made) => {
      // Its slots by the materials' keys, as Babylon's loader resolves them after parsing.
      const multi = MultiMaterial.ParseMultiMaterial(entry, scene);
      multi.subMaterials = (entry.materialsUniqueIds ?? []).map((key) => made.materials[key] ?? null);
      return multi;
    }`)}${parser(data.skeletons, 'skeletons', '(entry) => (entry.rig ? mirrored(Skeleton.Parse(entry, scene), entry.rig, lookup) : Skeleton.Parse(entry, scene))')}${parser(data.morphTargetManagers, 'morphTargets', '(entry) => Object.assign(MorphTargetManager.Parse(morphKeys(entry, buffers), scene), { optimizeInfluencers: false })')}${parser(data.meshes.filter((m) => m.type === 'LinesMesh'), 'linesMesh', '(entry) => new LinesMesh(entry.name, scene)')}${parser(data.lights, 'lights', `(entry) => ${areaLights ? 'parseLight(entry, scene, AreaLight)' : 'Light.Parse(entry, scene)'}`)}${parser(data.cameras, 'cameras', '(entry) => orthoScaled(parseCamera(entry, scene))')}${parser(data.reflectionProbes, 'reflectionProbes', '(entry) => ReflectionProbe.Parse(entry, scene, ROOT)')}${parser(data.shadowGenerators, 'shadowGenerators', "(entry) => Object.assign((entry.className === 'CascadedShadowGenerator' ? CascadedShadowGenerator : ShadowGenerator).Parse(entry, lookup), { customShaderOptions: entry.customShaderOptions })")}
    // Every material takes as many lights as its shader holds, each mesh the package's lights that reach it, the strongest
    // first (EEVEE has no cap); lights the page adds come first where they light.
    worldMade: (material) => { if (SCENE.world?.material !== null) WORLDS.set(scene, worldNodes(scene, material)); },
    lightsMade: (lights, key, made) => {${clustered ? `
      // Its point and spot lights in clusters where it has more lights than a material takes, as EEVEE has no cap; a light
      // with a Custom Distance out of them while there is room, as a cluster cuts it only per screen tile.
      const exact = new Set(${json(clustered)}.map((key) => made.lights[key])), cut = clusterLights(scene, lights, lightBudget(scene.getEngine()), (light) => exact.has(light))?.cutPerTile;
      if (cut?.length) console.warn(\`Clustered with their Custom Distance cut per screen tile: \${cut.map((light) => light.name).join(', ')}\`);` : ''}
      reachLights(scene, lights);
    },${parser(data.particleSystems, 'particleSystems', '(entry) => ParticleSystem.Parse(entry, scene, ROOT)')}${parser(data.animationGroups, 'animationGroups', `(entry) => {${data.animationGroups.some((g) => g.targetedAnimations.some((t) => t.animation.property === CLOCK)) ? `
      // The frame Babylon's animation keeps where the page's F-Curves are all that moves.
      for (const { animation, targetId } of entry.targetedAnimations) if (animation.property === '${CLOCK}') lookup.getNodeById(targetId).${CLOCK} = entry.from;` : ''}
      // Started and held: the page's playhead (playhead.js) sets them to its frame; a clip (an action's) waits to be played.
      const group = AnimationGroup.Parse(clipKeys(entry, buffers), lookup);
      if (!entry.metadata?.bylonder?.clip) group.start(entry.loopAnimation).pause();
      return group;
    }`)}
  };
  return loadTables({ scene, lookup, buffers, parsers }, { materials, multiMaterials: MULTI_MATERIALS, skeletons: SKELETONS, morphTargets: MORPH_TARGETS, geometries: GEOMETRIES,
    nodes: NODES, lights: LIGHTS, cameras: CAMERAS, reflectionProbes: REFLECTION_PROBES, shadowGenerators: SHADOW_GENERATORS, particleSystems: PARTICLE_SYSTEMS,
    animationGroups: ANIMATION_GROUPS, animations: ANIMATIONS }, TABLES_VERSION);
}
`;
  const unmaterialed = settings.defaultMaterial === null && data.meshes.some((m) => m.materialUniqueId === undefined);
  const geometryBuffer = pipelineTypes.some((type) => SCREEN_SPACE_PIPELINES[type]);
  const babylonImports = `${sideEffectImports([...PAGE_MODULES, ...(unmaterialed ? [DEFAULT_MATERIAL] : []), ...(geometryBuffer ? [GEOMETRY_BUFFER] : []), ...(pipelineTypes.some((type) => DEPTH_PIPELINES.includes(type)) ? [DEPTH_RENDERER] : []), ...parsedClasses(data), ...Object.entries(COMPONENTS).filter(([key]) => data[key]?.length).map(([, file]) => file)])}
import { ${[...usedNames(source), ...pipelineClasses].join(', ')} } from '@babylonjs/core';`;
  // An ES module package in Node too (the headless SDK), needing only Babylon.
  const manifest = { name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), type: 'module', main: 'scene.js', types: 'scene.d.ts', peerDependencies: { '@babylonjs/core': AbstractEngine.Version } };
  const binBytes = bin.bytes(), version = [binBytes, new TextEncoder().encode(irJson)].map((bytes) => digest(bytes).replace(':', '.')).join('-');
  // What a patch is made from (scene-patch.js): the tables, the scene's own settings and the IR's, and the buffers.
  Object.assign(tables, { scene: { [ir.scene.id ?? 'scene']: { settings, imageProcessing: data.imageProcessingConfiguration, code, effectLayers: data.effectLayers ?? [],
    renderingPipelines: data.renderingPipelines, postProcesses: data.postProcesses, volumes: volumes?.config ?? null, display, compositor: composited?.compositor ?? null } }, ...irTables(ir) });
  const files = { 'scene.js': source.replace(BABYLON_IMPORTS, babylonImports).replaceAll(VERSION, version).replace(TABLES_VERSION, packageState({ tables }).version), 'scene.d.ts': controlTypes(Object.entries(ir.properties).map(([path, { type }]) => ({ path, type })), armatureNames(data, ir), !!data.skeletons?.length), 'scene.ir.json': irJson, [UNITS_FILE]: units, ...(kernels && { [NODE_KERNELS]: kernels }), ...(curves && { [CURVES_GLSL_FILE]: curvesGlslFile() }), 'scene.bin': binBytes, [ASSET_FILE]: ASSET_MANIFEST, 'package.json': `${JSON.stringify(manifest, null, 2)}\n`, ...images, ...soundFiles };
  return { files, tables, buffers: bin.arrays() };
}
