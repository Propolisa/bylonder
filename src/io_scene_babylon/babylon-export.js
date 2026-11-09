// File > Export > Babylon (.babylon): the scene as Babylon's SceneSerializer writes it, from the evaluated scene, as
// Blender's glTF exporter exports the evaluated depsgraph (docs/blender-boundary.md, Export for Babylon).
import { Animation, AnimationKeyInterpolation, Camera, Light, Quaternion, SceneSerializer, Texture, Vector3, VertexBuffer } from '@babylonjs/core';
import { evaluatedMatrix, BLENDER_FORWARD } from '../runtime/object-transform.js';
import { idStruct } from '../python/bpy_rna.js';
import { deleted, nodeId } from '../editors/object/identity.js';
import { exportRuntimes } from '../runtimes/runtimes.js';
import { straightImageData } from '../imbuf/image-textures.js';
import { exportNodeMaterial } from './node-material-export.js';
import { exactAnimation } from './exact-keys.js';

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

// The nodes the export holds, each the evaluated object, and the materials they use.
function exportedContent(scene) {
  const nodes = [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras].filter((n) => !excluded(n)).map(evaluatedMesh);
  const meshes = nodes.filter((n) => n.geometry !== undefined);
  const materials = new Set(meshes.flatMap((m) => (m.material ? [m.material, ...(m.material.subMaterials ?? [])] : [])).filter(Boolean));
  return { nodes: new Set(nodes), meshes, materials };
}

// Babylon ids need not be unique, but the file refers to nodes by id: each exported node gets its object's name,
// unique in Bylonder, for the export.
function uniqueIds(nodes) {
  const seen = new Set();
  return setFor([...nodes], 'id', (node) => { const id = seen.has(node.name) ? node.name + '#' + node.uniqueId : node.name; seen.add(id); return id; });
}

// Rendering pipelines and post-processes on the scene camera, in Babylon's own serialization, with the render effects
// Bylonder attaches to rendered cameras (render-babylon.js).
function cameraEffects(world, scene, camera) {
  const rendered = world.renderSettings.renderedCameras;
  world.renderSettings.setRenderedCameras([...rendered, camera]);
  try {
    const pipelines = scene.postProcessRenderPipelineManager.supportedPipelines.filter((p) => p.cameras?.includes(camera) && p.serialize);
    const owned = new Set(pipelines.flatMap((p) => Object.values(p._renderEffects ?? {}).flatMap((e) => e.getPostProcesses(camera) ?? [])));
    // Bylonder's film (render/film.js) stays out.
    return {
      renderingPipelines: pipelines.map((p) => p.serialize()),
      postProcesses: (camera._postProcesses ?? []).filter((pp) => pp && !owned.has(pp) && !pp.name.startsWith('__')).map((pp) => pp.serialize()),
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
  if (!texture || texture.isRenderTarget || texture._files || !texture.url) return;
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
  if (node instanceof Light) {
    const matrix = evaluatedMatrix(node), direction = Vector3.TransformNormal(BLENDER_FORWARD, matrix);
    if (!toParent) return { position: matrix.getTranslation(), direction: direction.normalize() };
    return { position: Vector3.TransformCoordinates(matrix.getTranslation(), toParent), direction: Vector3.TransformNormal(direction, toParent).normalize() };
  }
  const matrix = node instanceof Camera ? node.getViewMatrix(true).clone().invert() : sync.worldMatrix(node);
  (toParent ? matrix.multiply(toParent) : matrix).decompose(scaling, rotationQuaternion, position);
  return node instanceof Camera ? { position, rotationQuaternion } : { position, rotationQuaternion, scaling };
}
const TRANSFORM = ['position', 'rotation', 'rotationQuaternion', 'scaling', 'direction'];
// Each placed object's evaluated transform and each animated channel's evaluated value at every frame of the scene
// range, as Blender's animation system evaluates the frames (its actions, NLA strips, drivers and constraints, or a
// parent's); the frame shown is evaluated again after. `refs`: channels whose owner has animation data.
function evaluatedFrames(world, nodes, refs) {
  const sync = world.mainSync, { frameStart, frameEnd } = world.animation.time.state, current = world.animation.time.frame;
  const moves = (node) => { const ob = idStruct(sync.objectOf(node)); return !!ob.animation_data || ob.constraints.length > 0; };
  if (frameEnd <= frameStart || (!nodes.some(moves) && !refs.length)) return { transforms: null, channels: new Map() };
  const transforms = new Map(nodes.map((node) => [node, []])), channels = new Map(refs.map((ref) => [ref, []]));
  for (let frame = frameStart; frame <= frameEnd; frame++) {
    sync.frameChanged(frame);
    for (const node of nodes) transforms.get(node).push(evaluatedTransform(sync, node));
    for (const ref of refs) channels.get(ref).push(world.animation.evaluated(ref));
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
// The keys of each transform channel of objects (`position.x`), as their actions hold them; read while the objects'
// metadata, which names their channels, is theirs.
const TRANSFORM_PATHS = ['position', 'scaling'].flatMap((key) => ['x', 'y', 'z'].map((c) => `${key}.${c}`));
const transformKeys = (world, nodes) => new Map(nodes.map((node) => [node, Object.fromEntries(TRANSFORM_PATHS.map((path) => [path, world.animation.track(world.animation.ref('object:' + nodeId(node), path))?.keys]))]));
// The animations of the transforms that change over the range: a position or scale whose changing components are their
// F-curves exactly (exact-keys.js) as one float animation each, else every transform sampled at each frame.
function transformAnimations(node, keys, frames, { frameStart, fps }) {
  const changes = (key) => frames.some((t) => !t[key].equalsWithEpsilon(frames[0][key], 1e-6));
  return Object.keys(frames[0]).filter(changes).flatMap((key) => {
    if (key === 'position' || key === 'scaling') {
      const moving = ['x', 'y', 'z'].filter((c) => frames.some((t) => Math.abs(t[key][c] - frames[0][key][c]) > 1e-6));
      const exact = moving.map((c) => exactAnimation(`${node.name} ${key}.${c}`, `${key}.${c}`, keys?.[`${key}.${c}`], frames.map((t) => t[key][c]), { frameStart, fps }));
      if (exact.every(Boolean)) return exact;
    }
    const animation = new Animation(node.name + ' ' + key, key, fps, ANIMATION_TYPES[frames[0][key].getClassName()], Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys(frames.map((t, i) => ({ frame: frameStart + i, value: t[key] })));
    return [animation];
  });
}

const ANIMATION_TYPES = { Vector2: Animation.ANIMATIONTYPE_VECTOR2, Vector3: Animation.ANIMATIONTYPE_VECTOR3, Color3: Animation.ANIMATIONTYPE_COLOR3, Color4: Animation.ANIMATIONTYPE_COLOR4, Quaternion: Animation.ANIMATIONTYPE_QUATERNION };
const read = (object, path) => path.reduce((value, key) => value?.[key], object);

// Where a channel lands in the file, as its owner node, the property path on it, the value there and the component the
// channel sets: its Babylon target's property, a material's through a mesh using it ('material.diffuseColor'), or with
// live modifiers a modifier setting in the stack the polyfill evaluates ('metadata.bylonderModifiers.stack.0.values.levels').
function animationTarget(channel, content, live) {
  const { target, property } = channel;
  const modifier = live && /^modifier:(.*):([^:]+)$/.exec(channel.id);
  if (modifier) {
    const [node, stack] = live.get(modifier[1]) ?? [];
    const index = stack?.modifiers.findIndex((m) => m.id === modifier[2]) ?? -1;
    if (index < 0) return null;
    return { owner: node, path: ['metadata', 'bylonderModifiers', 'stack', String(index), 'values', channel.path], value: +stack.modifiers[index].values[channel.path], component: null };
  }
  const owner = content.nodes.has(target) ? target : content.meshes.find((m) => target && m.material === target);
  if (!owner || !property) return null;
  const parts = property.split('.'), compound = parts.length > 1 && typeof read(target, parts.slice(0, -1)) === 'object';
  const base = compound ? parts.slice(0, -1) : parts;
  return { owner, path: (owner === target ? [] : ['material']).concat(base), value: read(target, base), component: compound ? parts.at(-1) : null };
}

// Each animated channel with a place in the file (animationTarget), sampled at every frame of the scene range, and the
// runtimes' animations (`mapped`, a skeleton's bones). Channels without one (stores, modifier settings unless they are
// live, depthOfField) stay out.
function bakeAnimations(world, samples, content, live, mapped, transforms, keys) {
  const { fps, frameStart, frameEnd } = world.animation.time.state;
  const tracks = new Map();
  for (const { channel, start, values } of samples) {
    const at = animationTarget(channel, content, live);
    if (!at || (transforms?.has(at.owner) && TRANSFORM.includes(at.path[0]))) continue;
    const key = at.owner.uniqueId + ':' + at.path.join('.');
    if (!tracks.has(key)) tracks.set(key, { ...at, components: [], step: false });
    const track = tracks.get(key);
    // A boolean animates as 0 and 1, held from key to key.
    track.step ||= typeof values[0] === 'boolean';
    track.components.push({ component: at.component, start, ref: world.animation.ref(channel.id, channel.path), values: values.map((v) => (typeof v === 'boolean' ? +v : v)) });
  }
  const targetedAnimations = mapped.map(({ animation, target }) => ({ animation: animation.serialize(), targetId: target.id }));
  for (const [node, frames] of transforms ?? []) {
    for (const animation of transformAnimations(node, keys.get(node), frames, { frameStart, fps })) targetedAnimations.push({ animation: animation.serialize(), targetId: node.id });
  }
  for (const { owner, path, value, components, step } of tracks.values()) {
    if (typeof value !== 'number' && !ANIMATION_TYPES[value?.getClassName?.()]) continue;
    // Each component's F-curve exactly, where every one is (exact-keys.js); an Euler rotation drawn as a quaternion is not.
    const exact = !step && !(path.join('.') === 'rotation' && owner.rotationQuaternion) && components.map(({ component, values, ref }) => values.length === frameEnd - frameStart + 1
      && exactAnimation(`${owner.name} ${path.join('.')}`, [...path, component].filter(Boolean).join('.'), world.animation.track(ref)?.keys, values, { frameStart, fps }));
    if (exact && exact.every(Boolean)) {
      for (const animation of exact) targetedAnimations.push({ animation: animation.serialize(), targetId: owner.id });
      continue;
    }
    const quaternion = path.join('.') === 'rotation' && owner.rotationQuaternion;
    const frames = Array.from({ length: frameEnd - frameStart + 1 }, (_, i) => {
      const frame = frameStart + i;
      let sample = typeof value === 'number' ? value : value.clone();
      for (const { component, start, values } of components) {
        const v = values[frame - start];
        if (typeof v !== 'number') continue;
        if (component) sample[component] = v; else sample = v;
      }
      return { frame, value: quaternion ? Quaternion.FromEulerVector(sample) : sample, ...(step && { interpolation: AnimationKeyInterpolation.STEP }) };
    });
    const property = quaternion ? 'rotationQuaternion' : path.join('.');
    const type = quaternion ? Animation.ANIMATIONTYPE_QUATERNION : typeof value === 'number' ? Animation.ANIMATIONTYPE_FLOAT : ANIMATION_TYPES[value.getClassName()];
    const animation = new Animation(owner.name + ' ' + property, property, fps, type, Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys(frames);
    targetedAnimations.push({ animation: animation.serialize(), targetId: owner.id });
  }
  if (!targetedAnimations.length) return [];
  return [{ name: world.animation.action.name || 'Action', from: frameStart, to: frameEnd, speedRatio: 1, loopAnimation: !!world.animation.time.state.loop, isAdditive: false, weight: -1, playOrder: 0, targetedAnimations }];
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
  entry.rotation = rotation.toEulerAngles().asArray();
  delete entry.rotationQuaternion;
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
export async function serializeScene(world, { geometry = true, live = null, mapped = null, parity = false } = {}) {
  await world.modifiers.settled();
  const runtimes = mapped ?? exportRuntimes(world);
  try {
    return await serializeMapped(world, { geometry, live, mapped: runtimes.animations, parity });
  } finally {
    if (!mapped) runtimes.restore();
  }
}

async function serializeMapped(world, { geometry, live, mapped, parity }) {
  const { scene } = world;
  const camera = world.sceneSettings.camera() ?? scene.activeCamera;
  const content = exportedContent(scene);
  const effects = camera ? cameraEffects(world, scene, camera) : { renderingPipelines: [], postProcesses: [] };
  const all = [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras];
  const straight = new Map(scene.textures.filter((t) => t instanceof Texture).map((t) => [t, straightImageData(t)]).filter(([, data]) => data));
  // Sampled before the export's flags and metadata are set, which channels read to know they are available.
  const samples = world.animation.sample(), liveIds = live && new Map([...live].map(([node, stack]) => [nodeId(node), [node, stack]]));
  // Objects' evaluated transforms too, while their metadata, which evaluating a frame reads, is theirs.
  const objects = placed(world, content.nodes), refs = world.mainSync ? animatedChannels(world, content, liveIds) : [];
  const evaluated = objects.length || refs.length ? evaluatedFrames(world, objects, refs) : { transforms: null, channels: new Map() };
  const { frameStart } = world.animation.time.state, keys = transformKeys(world, objects);
  // A channel Main evaluates is its value at each frame (its NLA strips and drivers too), not its F-curve's.
  const sampled = [...samples.filter(({ channel }) => !evaluated.channels.has(world.animation.ref(channel.id, channel.path))),
    ...[...evaluated.channels].map(([ref, values]) => ({ channel: world.animation.channels.get(ref), start: frameStart, values }))];
  const transforms = new Map(objects.map((node) => [node.uniqueId, evaluatedTransform(world.mainSync, node)]));
  const restores = [
    setFor(all, 'doNotSerialize', (n) => !content.nodes.has(n)),
    setFor(scene.materials, 'doNotSerialize', (m) => !content.materials.has(m)),
    geometry ? () => {} : withoutGeometry(scene.getGeometries()),
    setFor(scene.textures.filter((t) => t instanceof Texture && !t.isRenderTarget), '_forceSerialize', (t) => t._forceSerialize || !portable(t.url ?? '')),
    // A float image's texture is written from Blender's straight pixels (Texture.serialize's data URL buffer), not read back.
    setFor([...straight.keys()], '_buffer', (t) => straight.get(t)),
    // Instances named by their instancers.
    setFor([...content.nodes].filter(instances), 'name', (node) => `${node.metadata.instancers.map((n) => n.name).join(', ') || 'Scene'} Instances`),
    setFor(all, 'metadata', authoredMetadata),
    setFor([scene], 'metadata', () => null),
    uniqueIds(content.nodes),
  ];
  let pending, animationGroups, activeCameraID;
  try {
    // The serializer reads the scene synchronously; only texture readbacks finish later.
    pending = SceneSerializer.SerializeAsync(scene);
    animationGroups = bakeAnimations(world, sampled, content, liveIds, mapped, evaluated.transforms, keys);
    activeCameraID = camera?.id;
  } finally {
    restores.forEach((restore) => restore());
  }
  const json = await pending;
  for (const entry of [...json.meshes, ...(json.transformNodes ?? []), ...json.lights, ...json.cameras]) {
    const transform = transforms.get(entry.uniqueId);
    if (!transform) continue;
    for (const [key, value] of Object.entries(transform)) entry[key] = value.asArray();
    if (transform.rotationQuaternion) entry.rotation = [0, 0, 0];
  }
  // Babylon's camera parser reads no rotationQuaternion: a camera keeps its rotation as Euler angles, Babylon's yaw,
  // pitch and roll.
  for (const entry of json.cameras) {
    if (!entry.rotationQuaternion) continue;
    entry.rotation = Quaternion.FromArray(entry.rotationQuaternion).toEulerAngles().asArray();
    delete entry.rotationQuaternion;
  }
  json.materials = await Promise.all(json.materials.map(async (entry) => {
    const material = scene.materials.find((m) => m.uniqueId === entry.uniqueId);
    return (material && await exportNodeMaterial(material, { parity })) ?? entry;
  }));
  const kept = (list, items, keep) => list.filter((_, i) => keep(items[i]));
  json.multiMaterials = kept(json.multiMaterials, scene.multiMaterials, (m) => content.materials.has(m) || content.meshes.some((mesh) => mesh.material === m));
  json.particleSystems = kept(json.particleSystems, scene.particleSystems, (p) => !p.emitter?.getClassName || content.nodes.has(p.emitter));
  for (const entry of json.cameras) aimed(entry, scene.getCameraByUniqueId(entry.uniqueId));
  extraInfluences(json, scene);
  Object.assign(json, { animationGroups, activeCameraID, renderingPipelines: effects.renderingPipelines, imageProcessingConfiguration: scene.imageProcessingConfiguration.serialize(), producer: { name: 'Bylonder', file: 'scene.babylon' } });
  json.postProcesses.push(...effects.postProcesses);
  await environment(json, scene);
  return json;
}
