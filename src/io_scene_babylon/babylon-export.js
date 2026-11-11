// File > Export > Babylon (.babylon): the scene as Babylon's SceneSerializer writes it, from the evaluated scene, as
// Blender's glTF exporter exports the evaluated depsgraph (docs/blender-boundary.md, Export for Babylon).
import { Animation, AnimationKeyInterpolation, Camera, GetClass, Light, Quaternion, RectAreaLight, SceneSerializer, Texture, Vector3, VertexBuffer } from '@babylonjs/core';
import { evaluatedMatrix, setEvaluatedMatrix, BLENDER_FORWARD } from '../runtime/object-transform.js';
import { idStruct } from '../python/bpy_rna.js';
import { deleted, nodeId } from '../editors/object/identity.js';
import { exportRuntimes } from '../runtimes/runtimes.js';
import { imageFile } from '../imbuf/image-textures.js';
import { exportNodeMaterial } from './node-material-export.js';
import { exactAnimation, stripKeys } from './exact-keys.js';
import { exportSampling } from './sampling.js';
import { liveConstraints, liveTransform } from './live-curves.js';
import { report } from '../windowmanager/wm-reports.js';
import { channelKey } from './modifiers-export.js';
import { AREA_LIGHT, rigAreaLights, rigId, rigTransform } from './area-lights.js';
import { eulerCameras, turnedCameras } from '../overrides/babylon/camera-quaternion.js';
import { writePostProcesses } from '../overrides/babylon/camera-post-processes.js';
import '../overrides/babylon/material-unique-id.js';
import { serializePipeline } from '../overrides/babylon/pipeline-effects.js';

// The World's skybox is Bylonder's (world-babylon.js) but is what a render shows; the loader rebuilds it.
const WORLD_SKYBOX = '__worldSkybox';
// Overlays, gizmos, extras, the grid and editor cameras are named "__" or marked doNotSerialize. A Mesh's loose edges
// (a line child it draws, mesh-batch-cache.js) stay out, as Blender's glTF exporter leaves them out by default.
// The objects and Geometry Nodes instances the view draws (main-view.js drawInstances) are thin instances of a mesh
// sharing their source's geometry: exported as such; a particle system's display shapes are overlays.
const instances = (node) => !!node.metadata?.instancers && !!node.metadata.workbench;
const helper = (node) => node.doNotSerialize || (node.name.startsWith('__') && !instances(node)) || deleted(node) || !!node.metadata?.drawOwner;
const excluded = (node) => { for (let n = node; n; n = n.parent) if (helper(n)) return true; return false; };
const BYLONDER_METADATA = /^(wb|editable$|editing$|drawOwner$|workbench$|instances|instancers$)/;
// A URL another page can load: a public https URL. Others (blob, data from code, this server) are embedded.
const portable = (url) => /^https:/.test(url) && !url.startsWith(globalThis.location?.origin);

// The mesh drawn for an object is its evaluated mesh: the modifier stack draws its result into it (modifiers/stack.js).
const evaluatedMesh = (node) => node;

// A material's serialization without Bylonder's own plugins (a point cloud's), the app's drawing: a page's Babylon has
// no class to parse them with, only the plugins its material of that class makes itself.
function withoutOwnPlugins(entry, scene) {
  const Type = entry.plugins && GetClass(entry.customType);
  if (!Type) return entry;
  const fresh = new Type('', scene), plugins = Object.fromEntries(Object.entries(entry.plugins).filter(([, data]) => fresh.pluginManager?.getPlugin(data.name)));
  fresh.dispose();
  return { ...entry, plugins };
}

// Sets flags for the export and gives the function that restores them.
function setFor(items, key, value) {
  const saved = items.map((item) => [item, item[key]]);
  for (const item of items) item[key] = value(item);
  return () => saved.forEach(([item, old]) => { item[key] = old; });
}

// A geometry is serialized unless all its meshes are not; the JS export reads vertex data from the meshes instead.
function withoutGeometry(geometries) {
  for (const g of geometries) Object.defineProperty(g, 'doNotSerialize', { value: true, configurable: true });
  return () => geometries.forEach((g) => delete g.doNotSerialize);
}

// The nodes the export holds, each the evaluated object, and the materials they use; with `only` (Selected Objects), the
// nodes it keeps and what they draw.
function exportedContent(scene, only) {
  const kept = (n) => !only || only.has(n) || (!only.objects.has(n) && (!!n.metadata?.instancers?.some((i) => only.has(i)) || (!!n.parent && kept(n.parent))));
  const nodes = [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras].filter((n) => !excluded(n) && kept(n)).map(evaluatedMesh);
  const meshes = nodes.filter((n) => n.geometry !== undefined);
  // Curves are drawn by the page (curves-export.js) in the materials the app draws them in.
  const curves = scene.meshes.filter((m) => m.metadata?.curves && !m.metadata.overlay && m.isEnabled());
  const materials = new Set([...meshes, ...curves].flatMap((m) => (m.material ? [m.material, ...(m.material.subMaterials ?? [])] : [])).filter(Boolean));
  // An object without a material draws Blender's default surface (material/library.js), as the page's default material.
  const defaultMaterial = meshes.some((m) => !m.material && m.getTotalVertices() > 0) ? scene._defaultMaterial : null;
  if (defaultMaterial) materials.add(defaultMaterial);
  return { nodes: new Set(nodes), meshes, materials, defaultMaterial };
}

// Babylon ids need not be unique, but the file refers to nodes by id: each exported node gets its object's name,
// unique in Bylonder, for the export.
function uniqueIds(nodes) {
  const seen = new Set();
  return setFor([...nodes], 'id', (node) => { const id = seen.has(node.name) ? node.name + '#' + node.uniqueId : node.name; seen.add(id); return id; });
}

// Rendering pipelines and post-processes on the scene camera, in Babylon's own serialization, with the render effects
// Bylonder attaches to rendered cameras (render-babylon.js).
export function cameraEffects(world, scene, camera) {
  const rendered = world.renderSettings.renderedCameras;
  world.renderSettings.setRenderedCameras([...rendered, camera]);
  try {
    const pipelines = scene.postProcessRenderPipelineManager.supportedPipelines.filter((p) => p.cameras?.includes(camera) && p.serialize);
    const owned = new Set(pipelines.flatMap((p) => Object.values(p._renderEffects ?? {}).flatMap((e) => e.getPostProcesses(camera) ?? [])));
    // Bylonder's film (render/film.js) stays out.
    return {
      renderingPipelines: pipelines.map(serializePipeline),
      postProcesses: (camera._postProcesses ?? []).filter((pp) => pp && !owned.has(pp) && !pp.name.startsWith('__')),
    };
  } finally {
    world.renderSettings.setRenderedCameras(rendered);
  }
}

async function embedded(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
}

// The environment as the loader reads it: a URL with its kind. A reflection probe's cube is drawn, not loaded: the
// file names the probe (environmentProbe) for the JS export.
async function environment(json, scene) {
  const texture = scene.environmentTexture;
  delete json.environmentTexture;
  const probe = scene.reflectionProbes?.find((p) => p.cubeTexture === texture);
  if (probe) json.environmentProbe = probe.name;
  if (!texture || texture.isRenderTarget || texture._files?.length || !texture.url) return;
  json.environmentTexture = portable(texture.url) ? texture.url : await embedded(texture.url);
  json.environmentTextureRotationY = texture.rotationY;
  if (texture.getClassName() === 'HDRCubeTexture') Object.assign(json, { environmentTextureType: 'BABYLON.HDRCubeTexture', environmentTextureSize: texture.getSize().width });
  else if (!/\.env$/i.test(json.environmentTexture)) json.environmentTextureForcedExtension = texture._forcedExtension || '.env';
  if (scene.getMeshByName(WORLD_SKYBOX)) Object.assign(json, { createDefaultSkybox: true, isPBR: true });
}

// An object Main holds is drawn at the world matrix Blender evaluated (its drivers, constraints, NLA and parents;
// main-view.js), which its own transform may not be: the export writes that matrix as its transform, relative to its
// parent's, as Blender's glTF exporter writes the evaluated depsgraph. A light is its position and direction, a camera
// its position and the rotation its view looks with (a Track To aims both).
const placed = (world, nodes) => (world.mainSync ? [...nodes].filter((node) => (node.freezeWorldMatrix || evaluatedMatrix(node)) && world.mainSync.objectOf(node)) : []);
function evaluatedTransform(sync, node) {
  const parent = node.parent && (sync.worldMatrix(node.parent) ?? node.parent.computeWorldMatrix(true)), toParent = parent?.clone().invert();
  const position = new Vector3(), rotationQuaternion = new Quaternion(), scaling = new Vector3();
  // An area light's transform is its rig's (area-lights.js).
  if (node instanceof RectAreaLight) return rigTransform(sync.worldMatrix(node) ?? evaluatedMatrix(node), toParent);
  if (node instanceof Light) {
    const matrix = sync.worldMatrix(node) ?? evaluatedMatrix(node), direction = Vector3.TransformNormal(BLENDER_FORWARD, matrix);
    if (!toParent) return { position: matrix.getTranslation(), direction: direction.normalize() };
    return { position: Vector3.TransformCoordinates(matrix.getTranslation(), toParent), direction: Vector3.TransformNormal(direction, toParent).normalize() };
  }
  if (node instanceof Camera && sync.worldMatrix(node)) setEvaluatedMatrix(node, sync.worldMatrix(node));
  const matrix = node instanceof Camera ? node.getViewMatrix(true).clone().invert() : sync.worldMatrix(node);
  (toParent ? matrix.multiply(toParent) : matrix).decompose(scaling, rotationQuaternion, position);
  return node instanceof Camera ? { position, rotationQuaternion } : { position, rotationQuaternion, scaling };
}
const TRANSFORM = ['position', 'rotation', 'rotationQuaternion', 'scaling', 'direction'];
// Each placed object's evaluated transform and each animated channel's evaluated value at each of the sampling's frames
// (sampling.js), as Blender's animation system evaluates the frames (its actions, NLA strips, drivers and constraints,
// or a parent's); the frame shown is evaluated again after. `refs`: channels whose owner has animation data; `checks`:
// constraint stacks the page may apply (live-curves.js liveConstraints), checked at each frame.
function evaluatedFrames(world, nodes, refs, checks, sampling) {
  const sync = world.mainSync, { frameStart, frameEnd } = world.animation.time.state, current = world.animation.time.frame;
  const moves = (node) => { const ob = idStruct(sync.objectOf(node)); return !!ob.animation_data || ob.constraints.length > 0; };
  if (frameEnd <= frameStart || (!nodes.some(moves) && !refs.length)) return { transforms: null, channels: new Map() };
  const transforms = new Map(nodes.map((node) => [node, []])), channels = new Map(refs.map((ref) => [ref, []]));
  for (const frame of sampling.frames) {
    sync.frameChanged(frame, { draw: false });
    for (const node of nodes) transforms.get(node).push(evaluatedTransform(sync, node));
    for (const ref of refs) channels.get(ref).push(world.animation.evaluated(ref));
    for (const stack of checks) stack.check();
  }
  sync.frameChanged(current);
  return { transforms, channels: new Map([...channels].filter(([, values]) => values.every((v) => v !== undefined))) };
}
// The channels with a place in the file whose value Main evaluates and whose owner is animated (an action or NLA
// strips), but objects' transforms, which are sampled as transforms.
function animatedChannels(world, content, live) {
  const { animation } = world;
  return [...animation.channels].filter(([ref, channel]) => channel.available() && !channel.transform && animationTarget(channel, content, live)
    && !!idStruct(animation.ownerOf(ref))?.animation_data).map(([ref]) => ref);
}
// The keys of each transform channel of objects (`position.x`), as their actions hold them, or as their NLA strips play
// them (exact-keys.js stripKeys); read while the objects' metadata, which names their channels, is theirs.
const TRANSFORM_PATHS = ['position', 'scaling'].flatMap((key) => ['x', 'y', 'z'].map((c) => `${key}.${c}`));
// Blender's property and index of each, Babylon's y being Blender's z.
const BLENDER_CHANNELS = { position: 'location', scaling: 'scale', x: 0, y: 2, z: 1 };
function transformKeys(world, nodes) {
  const keysOf = (node, path) => {
    const animation = idStruct(world.mainSync.objectOf(node)).animation_data, [key, c] = path.split('.');
    if (animation?.nla_tracks.length) return stripKeys(animation, BLENDER_CHANNELS[key], BLENDER_CHANNELS[c]);
    return world.animation.track(world.animation.ref('object:' + nodeId(node), path))?.keys;
  };
  return new Map(nodes.map((node) => [node, Object.fromEntries(TRANSFORM_PATHS.map((path) => [path, keysOf(node, path)]))]));
}
// The animations of the transforms that change over the range, from their values at the sampling's frames: a position
// or scale whose changing components are their F-curves exactly (exact-keys.js) as one float animation each; else, with
// `runs` (live-curves.js), F-Curves the page runs, added to `curves`; else every transform keyed on the node's grid,
// named in `gaps` when the page could have run it.
function transformAnimations(node, keys, sampled, { frameStart, fps }, sampling, runs, curves, gaps) {
  const changes = (key) => sampled.some((t) => !t[key].equalsWithEpsilon(sampled[0][key], 1e-6));
  // Exact keys and the page's F-Curves are checked at each whole frame.
  const frames = sampled.filter((_, i) => Number.isInteger(sampling.frames[i]));
  return Object.keys(frames[0]).filter(changes).flatMap((key) => {
    if (key === 'position' || key === 'scaling') {
      const moving = ['x', 'y', 'z'].filter((c) => frames.some((t) => Math.abs(t[key][c] - frames[0][key][c]) > 1e-6));
      const exact = moving.map((c) => exactAnimation(`${node.name} ${key}.${c}`, `${key}.${c}`, keys?.[`${key}.${c}`], frames.map((t) => t[key][c]), { frameStart, fps }));
      if (exact.every(Boolean)) return exact;
    }
    const run = runs?.(key, frames, frameStart);
    if (run) {
      curves.push(...run);
      return [];
    }
    if (runs) gaps.push({ message: `${node.name} ${key}: its F-Curves are not all that moves it (NLA, drivers, constraints, F-modifiers but Cycles) or the unit misses Main` });
    const animation = new Animation(node.name + ' ' + key, key, fps, ANIMATION_TYPES[frames[0][key].getClassName()], Animation.ANIMATIONLOOPMODE_CYCLE);
    const keeps = sampling.keeps(node.name);
    animation.setKeys(sampling.frames.map((frame, i) => ({ frame, value: sampled[i][key] })).filter(({ frame }) => keeps(frame)));
    return [animation];
  });
}

const ANIMATION_TYPES = { Vector2: Animation.ANIMATIONTYPE_VECTOR2, Vector3: Animation.ANIMATIONTYPE_VECTOR3, Color3: Animation.ANIMATIONTYPE_COLOR3, Color4: Animation.ANIMATIONTYPE_COLOR4, Quaternion: Animation.ANIMATIONTYPE_QUATERNION };
const read = (object, path) => path.reduce((value, key) => value?.[key], object);
// Values Babylon's serializer does not write, so the page animates them whole: a component alone has nothing to set.
const UNWRITTEN = ['lockedTarget'];

// Where a channel lands in the file, as its owner node, the property path on it, the value there and the component the
// channel sets: its Babylon target's property, a material's through a mesh using it ('material.diffuseColor'), or with
// live modifiers a modifier setting, by its node's channel (modifiers-export.js: 'metadata.bylonderChannels.0:levels').
function animationTarget(channel, content, live) {
  const { target, property } = channel;
  const modifier = live && /^modifier:(.*):([^:]+)$/.exec(channel.id);
  if (modifier) {
    const [node, stack] = live.get(modifier[1]) ?? [];
    const index = stack?.modifiers.findIndex((m) => m.id === modifier[2]) ?? -1;
    if (index < 0) return null;
    return { owner: node, path: ['metadata', 'bylonderChannels', channelKey(index, channel.path)], value: +stack.modifiers[index].values[channel.path], component: null };
  }
  const owner = content.nodes.has(target) ? target : content.meshes.find((m) => target && m.material === target);
  if (!owner || !property) return null;
  const parts = property.split('.'), compound = parts.length > 1 && typeof read(target, parts.slice(0, -1)) === 'object';
  const base = compound ? parts.slice(0, -1) : parts;
  return { owner, path: (owner === target ? [] : ['material']).concat(base), value: read(target, base), component: compound ? parts.at(-1) : null };
}

// Each animated channel with a place in the file (animationTarget), from its values at the sampling's frames
// (sampling.js), and the runtimes' animations (`mapped`, a skeleton's bones). Channels without one (stores, modifier
// settings unless they are live, depthOfField) stay out. With `curves`, an object's transform F-Curves the page runs go
// there instead, and what is still sampled goes in `gaps`.
function bakeAnimations(world, samples, content, live, mapped, transforms, keys, sampling, curves, gaps) {
  const { fps, frameStart, frameEnd } = world.animation.time.state;
  const whole = (values) => values.filter((_, i) => Number.isInteger(sampling.frames[i]));
  const tracks = new Map();
  for (const { channel, values } of samples) {
    const at = animationTarget(channel, content, live);
    if (!at || (transforms?.has(at.owner) && TRANSFORM.includes(at.path[0]))) continue;
    const key = at.owner.uniqueId + ':' + at.path.join('.');
    if (!tracks.has(key)) tracks.set(key, { ...at, components: [], step: false });
    const track = tracks.get(key);
    // A boolean animates as 0 and 1, held from key to key.
    track.step ||= typeof values[0] === 'boolean';
    track.components.push({ component: at.component, ref: world.animation.ref(channel.id, channel.path), values: values.map((v) => (typeof v === 'boolean' ? +v : v)) });
  }
  const targetedAnimations = mapped.map(({ animation, target }) => ({ animation: animation.serialize(), targetId: target.id }));
  for (const [node, frames] of transforms ?? []) {
    const runs = curves && liveTransform(world.mainSync, node);
    for (const animation of transformAnimations(node, keys.get(node), frames, { frameStart, fps }, sampling, runs, curves, gaps)) targetedAnimations.push({ animation: animation.serialize(), targetId: node instanceof RectAreaLight ? rigId(node.id) : node.id });
  }
  for (const { owner, path, value, components, step } of tracks.values()) {
    if (typeof value !== 'number' && !ANIMATION_TYPES[value?.getClassName?.()]) continue;
    // Each component's F-curve exactly, where every one is (exact-keys.js); an Euler rotation drawn as a quaternion is not.
    const exact = !step && !(path.join('.') === 'rotation' && owner.rotationQuaternion) && !UNWRITTEN.includes(path[0]) && components.map(({ component, values, ref }) => exactAnimation(`${owner.name} ${path.join('.')}`, [...path, component].filter(Boolean).join('.'), world.animation.track(ref)?.keys, whole(values), { frameStart, fps }));
    if (exact && exact.every(Boolean)) {
      for (const animation of exact) targetedAnimations.push({ animation: animation.serialize(), targetId: owner.id });
      continue;
    }
    const quaternion = path.join('.') === 'rotation' && owner.rotationQuaternion;
    const frames = sampling.frames.map((frame, i) => {
      let sample = typeof value === 'number' ? value : value.clone();
      for (const { component, values } of components) {
        const v = values[i];
        if (typeof v !== 'number') continue;
        if (component) sample[component] = v; else sample = v;
      }
      return { frame, value: quaternion ? Quaternion.FromEulerVector(sample) : sample, ...(step && { interpolation: AnimationKeyInterpolation.STEP }) };
    });
    // A value held from key to key is keyed at each whole frame it changes at; one interpolated, on its object's grid.
    const keeps = !step && sampling.keeps(owner.name);
    const kept = step ? frames.filter(({ frame }) => Number.isInteger(frame)).filter((key, i, held) => i === 0 || key.value !== held[i - 1].value)
      : frames.filter(({ frame }) => keeps(frame));
    const property = quaternion ? 'rotationQuaternion' : path.join('.');
    const type = quaternion ? Animation.ANIMATIONTYPE_QUATERNION : typeof value === 'number' ? Animation.ANIMATIONTYPE_FLOAT : ANIMATION_TYPES[value.getClassName()];
    const animation = new Animation(owner.name + ' ' + property, property, fps, type, Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys(kept);
    targetedAnimations.push({ animation: animation.serialize(), targetId: owner.id });
    gaps?.push({ message: `${owner.name} ${property}: no F-Curve the page runs sets it`, sampled: targetedAnimations.at(-1) });
  }
  // Babylon's animation keeps the page's time where F-Curves the page runs are all that moves.
  if (!targetedAnimations.length && curves?.length) targetedAnimations.push({ animation: clock(frameStart, frameEnd, fps).serialize(), targetId: curves[0].node });
  if (!targetedAnimations.length) return [];
  return [{ name: world.animation.action.name || 'Action', from: frameStart, to: frameEnd, speedRatio: 1, loopAnimation: !!world.animation.time.state.loop, isAdditive: false, weight: -1, playOrder: 0, targetedAnimations }];
}

// The scene's frame, which the page's F-Curves read through the animation group playing it: a property of its node the
// page adds (js-export.js).
export const CLOCK = 'bylonderFrame';
function clock(frameStart, frameEnd, fps) {
  const animation = new Animation('Frame', CLOCK, fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  animation.setKeys([{ frame: frameStart, value: frameStart }, { frame: frameEnd, value: frameEnd }]);
  return animation;
}

// The samples a package's page also runs an F-Curve for (an IR `fcurve` entity writing a property bound to the same
// node property) leave its animation groups; each other one is reported as a gap to close.
export function sampledGaps(json, ir) {
  const run = new Set(Object.values(ir.entities).filter((e) => e.implementation === 'fcurve').map((e) => ir.properties[e.outputs.value?.property]?.bind)
    .filter((bind) => bind?.node !== undefined && bind.property).map((bind) => `${bind.node}:${bind.property}`));
  for (const { message, sampled } of json.sampledAnimation) {
    if (!sampled || !run.has(`${sampled.targetId}:${sampled.animation.property}`)) {
      report('WARNING', `Export: ${message}, so it is sampled per frame`);
      continue;
    }
    const group = json.animationGroups.find((g) => g.targetedAnimations.includes(sampled));
    group.targetedAnimations.splice(group.targetedAnimations.indexOf(sampled), 1);
    if (!group.targetedAnimations.length) group.targetedAnimations.push({ animation: clock(group.from, group.to, sampled.animation.framePerSecond).serialize(), targetId: sampled.targetId });
  }
}

// Babylon's serializer writes a skinned geometry's first four bone influences and its loader reads the extra four only
// with a mesh's own geometry: such a geometry is written into its meshes with them.
function extraInfluences(json, scene) {
  const extra = (entry) => scene.getGeometryById(entry.id)?.isVerticesDataPresent(VertexBuffer.MatricesIndicesExtraKind);
  const inlined = new Set(json.geometries?.vertexData.filter(extra) ?? []);
  for (const entry of inlined) {
    const geometry = scene.getGeometryById(entry.id), { id, uniqueId, updatable, ...data } = entry;
    Object.assign(data, { matricesIndicesExtra: Array.from(geometry.getVerticesData(VertexBuffer.MatricesIndicesExtraKind)), matricesIndicesExtraExpanded: true,
      matricesWeightsExtra: Array.from(geometry.getVerticesData(VertexBuffer.MatricesWeightsExtraKind)) });
    for (const mesh of json.meshes.filter((m) => m.geometryId === id)) {
      delete mesh.geometryId;
      delete mesh.geometryUniqueId;
      Object.assign(mesh, data);
    }
  }
  if (inlined.size) json.geometries.vertexData = json.geometries.vertexData.filter((entry) => !inlined.has(entry));
}

// A camera aimed at a point (lockedTarget, which Babylon does not serialize) keeps the rotation it looks with.
function aimed(entry, camera) {
  if (!camera?.lockedTarget || !entry.rotation) return;
  const rotation = new Quaternion();
  camera.getViewMatrix().clone().invert().decompose(undefined, rotation);
  entry.rotationQuaternion = rotation.asArray();
  eulerCameras([entry]);
}

// A node's own metadata, without Bylonder's (modifier bases, creation records, draw owners).
const authoredMetadata = (node) => {
  const kept = Object.entries(node.metadata ?? {}).filter(([key]) => !BYLONDER_METADATA.test(key));
  return kept.length ? Object.fromEntries(kept) : null;
};

// The serialized scene. `geometry: false` leaves vertex data out, for the JS export, which reads it from the meshes;
// `live` (object to its modifier stack, as modifiers.live gives it) animates those stacks' settings. Features with a
// runtime (runtimes.js) are written through their mapping to Babylon: `mapped`, an exportRuntimes result the caller
// restores, else one made and restored here. Materials of Blender's shader nodes are written as Babylon's own blocks
// (node-material-export.js), with Bylonder's EEVEE extensions when `parity`.
// `graphOf` gives a material's IR graph key, for a package whose page builds its nodes from the IR. `bake: false` is for a
// package whose page runs F-Curves Babylon cannot play exactly. `runtime`, `runtimes`: the runtimes chosen for the export
// (export-options.js); `sampling`, the frames what is baked is sampled at (sampling.js), a key per frame unset.
export async function serializeScene(world, { geometry = true, live = null, mapped = null, parity = false, graphOf = () => null, bake = true, runtime = null, runtimes: chosen = {}, sampling = null, only = null } = {}) {
  await world.modifiers.settled();
  sampling ??= exportSampling(world.animation.time.state);
  const runtimes = mapped ?? exportRuntimes(world, { bake, runtime, runtimes: chosen, sampling });
  try {
    return await serializeMapped(world, { geometry, live, mapped: runtimes, parity, graphOf, bake, sampling, only });
  } finally {
    if (!mapped) runtimes.restore();
  }
}

// Bylonder's shadow generators (light-shadows.js), which Babylon's serializer does not reach from the lights it writes,
// each on its exported light by name; null without them.
function shadowsOf(world, content) {
  const generators = world.shadows?.generators;
  if (!generators?.length) return null;
  const lights = new Map([...content.nodes].filter((n) => n.getClassName().endsWith('Light')).map((l) => [l.name, l]));
  // With Bylonder's shadow map shader (lit-side-normal-bias.js), which the page carries.
  return generators.filter((g) => lights.has(g.getLight().name)).map((g) => ({ ...g.serialize(), lightId: lights.get(g.getLight().name).id, customShaderOptions: g.customShaderOptions }));
}

async function serializeMapped(world, { geometry, live, mapped, parity, graphOf, bake, sampling, only }) {
  const { scene } = world;
  // An asset brings no camera, so none of a camera's effects.
  const camera = only ? null : world.sceneSettings.camera() ?? scene.activeCamera;
  const content = exportedContent(scene, only);
  // Shadows as a rendered view draws them: each light's casters and every receiver (light-shadows.js setActive), while
  // the lights' metadata, which it reads, is theirs; the views set them back as they next draw.
  world.shadows?.setActive(true, world.renderSettings.state.eevee.shadowRayCount);
  // The world as a rendered view shows it: a code-built scene's own sky meshes on (runtime/world.js beforeViewRender).
  world.worlds?.setViewportActive(true, !world.compositor?.drawsScene);
  const effects = camera ? cameraEffects(world, scene, camera) : { renderingPipelines: [], postProcesses: [] };
  const imageData = new Map(scene.textures.filter((t) => t instanceof Texture).map((t) => [t, imageFile(t)]).filter(([, data]) => data));
  // Sampled before the export's flags and metadata are set, which channels read to know they are available.
  const samples = world.animation.sample(sampling.frames), liveIds = live && new Map([...live].map(([node, stack]) => [nodeId(node), [node, stack]]));
  // Objects' evaluated transforms too, while their metadata, which evaluating a frame reads, is theirs.
  const objects = placed(world, content.nodes), refs = world.mainSync ? animatedChannels(world, content, liveIds) : [];
  // Without Bake Animation, an object's constraints the page applies where they give Main's world matrix at every frame.
  const nodeOf = (ob) => objects.find((node) => idStruct(world.mainSync.objectOf(node)).name === ob.name);
  const stacks = bake || !world.mainSync ? new Map() : new Map(objects.map((node) => [node, liveConstraints(world.mainSync, node, nodeOf)]).filter(([, stack]) => stack));
  const evaluated = objects.length || refs.length ? evaluatedFrames(world, objects, refs, [...stacks.values()], sampling) : { transforms: null, channels: new Map() };
  for (const [node, stack] of stacks) if (!stack.entity()) stacks.delete(node);
  const keys = transformKeys(world, objects);
  // A channel Main evaluates is its value at each frame (its NLA strips and drivers too), not its F-curve's.
  const sampled = [...samples.filter(({ channel }) => !evaluated.channels.has(world.animation.ref(channel.id, channel.path))),
    ...[...evaluated.channels].map(([ref, values]) => ({ channel: world.animation.channels.get(ref), values }))];
  // A constrained object the page places is written at its own transform, which its constraints start from.
  const transforms = new Map(objects.map((node) => [node.uniqueId, stacks.has(node) ? { position: stacks.get(node).own.position, rotationQuaternion: stacks.get(node).own.rotation, scaling: stacks.get(node).own.scaling }
    : evaluatedTransform(world.mainSync, node)]));
  for (const node of stacks.keys()) evaluated.transforms?.delete(node);
  // Taken after the frames are evaluated, which redraw what the view draws per frame (a Grease Pencil's strokes).
  const all = [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras];
  const restores = [
    setFor(all, 'doNotSerialize', (n) => !content.nodes.has(n)),
    setFor(scene.materials, 'doNotSerialize', (m) => !content.materials.has(m)),
    geometry ? () => {} : withoutGeometry(scene.getGeometries()),
    setFor(scene.textures.filter((t) => t instanceof Texture && !t.isRenderTarget), '_forceSerialize', (t) => t._forceSerialize || !portable(t.url ?? '')),
    // Babylon's serializer leaves out a texture without a name (one made from code, a RawTexture).
    setFor(scene.textures.filter((t) => t instanceof Texture && !t.isRenderTarget && !t.name), 'name', (t) => `${t.getClassName()} ${t.uniqueId}`),
    // An image of Main's is written from Blender's data (Texture.serialize's data URL buffer), not read back, top row first.
    setFor([...imageData.keys()], '_buffer', (t) => imageData.get(t)),
    setFor([...imageData.keys()], '_invertY', () => true),
    // Instances named by their instancers.
    setFor([...content.nodes].filter(instances), 'name', (node) => `${node.metadata.instancers.map((n) => n.name).join(', ') || 'Scene'} Instances`),
    setFor(all, 'metadata', authoredMetadata),
    setFor([scene], 'metadata', () => null),
    uniqueIds(content.nodes),
  ];
  let pending, animationGroups, activeCameraID, shadowGenerators, constraints;
  // The runtimes' (a skeleton's bones) first.
  const curves = bake || !world.mainSync ? null : [...mapped.curves], gaps = curves && [...mapped.gaps];
  try {
    // The serializer reads the scene synchronously; only texture readbacks finish later.
    pending = SceneSerializer.SerializeAsync(scene);
    shadowGenerators = shadowsOf(world, content);
    animationGroups = bakeAnimations(world, sampled, content, liveIds, mapped.animations, evaluated.transforms, keys, sampling, curves, gaps);
    activeCameraID = camera?.id;
    constraints = [...stacks.values()].map((stack) => stack.entity());
  } finally {
    restores.forEach((restore) => restore());
  }
  const json = await pending;
  if (shadowGenerators) json.shadowGenerators = shadowGenerators;
  rigAreaLights(json, transforms);
  for (const entry of [...json.meshes, ...(json.transformNodes ?? []), ...json.lights, ...json.cameras]) {
    const transform = transforms.get(entry.uniqueId);
    if (!transform || entry.type === AREA_LIGHT) continue;
    // A point light has no direction: with one, Babylon draws its shadow as a spot's, not in a cube.
    for (const [key, value] of Object.entries(transform)) if (!(key === 'direction' && entry.type === Light.LIGHTTYPEID_POINTLIGHT)) entry[key] = value.asArray();
    if (transform.rotationQuaternion) entry.rotation = [0, 0, 0];
  }
  eulerCameras(json.cameras);
  json.materials = await Promise.all(json.materials.map(async (entry) => {
    const material = scene.materials.find((m) => m.uniqueId === entry.uniqueId);
    return (material && await exportNodeMaterial(material, { parity, graph: graphOf(material) })) ?? withoutOwnPlugins(entry, scene);
  }));
  const kept = (list, items, keep) => list.filter((_, i) => keep(items[i]));
  json.multiMaterials = kept(json.multiMaterials, scene.multiMaterials, (m) => content.materials.has(m) || content.meshes.some((mesh) => mesh.material === m));
  json.particleSystems = kept(json.particleSystems, scene.particleSystems, (p) => !p.emitter?.getClassName || content.nodes.has(p.emitter));
  for (const entry of json.cameras) aimed(entry, scene.getCameraByUniqueId(entry.uniqueId));
  turnedCameras(json.cameras, animationGroups);
  extraInfluences(json, scene);
  Object.assign(json, { animationGroups, activeCameraID, defaultMaterialId: content.defaultMaterial?.uniqueId, renderingPipelines: effects.renderingPipelines, imageProcessingConfiguration: scene.imageProcessingConfiguration.serialize(), producer: { name: 'Bylonder', file: 'scene.babylon' } });
  writePostProcesses(json, effects.postProcesses);
  await environment(json, scene);
  // The F-Curves the page runs (live-curves.js), for the package's IR, and what it still plays as samples (sampledGaps):
  // neither is part of the file.
  // The rate of each object whose animation is baked, for the IR's time.
  Object.defineProperties(json, { liveCurves: { value: curves ?? [] }, liveConstraints: { value: constraints }, sampledAnimation: { value: gaps ?? [] }, sampleRates: { value: sampling.rates() } });
  return json;
}
