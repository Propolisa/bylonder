// File > Export > Babylon (.babylon): the scene as Babylon's SceneSerializer writes it, from the evaluated scene, as
// Blender's glTF exporter exports the evaluated depsgraph (docs/blender-boundary.md, Export for Babylon).
import { Animation, Quaternion, SceneSerializer, Texture } from '@babylonjs/core';
import { deleted } from '../editors/object/identity.js';

// The World's skybox is Bylonder's (world-babylon.js) but is what a render shows; the loader rebuilds it.
const WORLD_SKYBOX = '__worldSkybox';
// Overlays, gizmos, extras, the grid and editor cameras are named "__" or marked doNotSerialize. A Mesh's loose edges
// (a line child it draws, mesh-batch-cache.js) stay out, as Blender's glTF exporter leaves them out by default.
const helper = (node) => node.doNotSerialize || node.name.startsWith('__') || deleted(node) || !!node.metadata?.drawOwner;
const excluded = (node) => { for (let n = node; n; n = n.parent) if (helper(n)) return true; return false; };
const BYLONDER_METADATA = /^(wb|editable$|editing$|drawOwner$)/;
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
    return {
      renderingPipelines: pipelines.map((p) => p.serialize()),
      postProcesses: (camera._postProcesses ?? []).filter((pp) => pp && !owned.has(pp)).map((pp) => pp.serialize()),
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

const ANIMATION_TYPES = { Vector2: Animation.ANIMATIONTYPE_VECTOR2, Vector3: Animation.ANIMATIONTYPE_VECTOR3, Color3: Animation.ANIMATIONTYPE_COLOR3, Color4: Animation.ANIMATIONTYPE_COLOR4, Quaternion: Animation.ANIMATIONTYPE_QUATERNION };
const read = (object, path) => path.reduce((value, key) => value?.[key], object);

// Each animated property of an exported node, or of a material through a mesh that uses it ('material.diffuseColor'),
// sampled at every frame of the scene range. Channels without a Babylon target (modifier settings, stores) stay out.
function bakeAnimations(world, content) {
  const { fps, frameStart, frameEnd } = world.animation.time.state;
  const tracks = new Map();
  for (const { channel, start, values } of world.animation.sample()) {
    const { target, property } = channel;
    const owner = content.nodes.has(target) ? target : content.meshes.find((m) => target && m.material === target);
    if (!owner || !property) continue;
    const parts = property.split('.'), compound = parts.length > 1 && typeof read(target, parts.slice(0, -1)) === 'object';
    const base = compound ? parts.slice(0, -1) : parts;
    const path = (owner === target ? [] : ['material']).concat(base);
    const key = owner.uniqueId + ':' + path.join('.');
    if (!tracks.has(key)) tracks.set(key, { owner, path, value: read(target, base), components: [] });
    tracks.get(key).components.push({ component: compound ? parts.at(-1) : null, start, values });
  }
  const targetedAnimations = [];
  for (const { owner, path, value, components } of tracks.values()) {
    if (typeof value !== 'number' && !ANIMATION_TYPES[value?.getClassName?.()]) continue;
    const quaternion = path.join('.') === 'rotation' && owner.rotationQuaternion;
    const frames = Array.from({ length: frameEnd - frameStart + 1 }, (_, i) => {
      const frame = frameStart + i;
      let sample = typeof value === 'number' ? value : value.clone();
      for (const { component, start, values } of components) {
        const v = values[frame - start];
        if (typeof v !== 'number') continue;
        if (component) sample[component] = v; else sample = v;
      }
      return { frame, value: quaternion ? Quaternion.FromEulerVector(sample) : sample };
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

// The serialized scene. `geometry: false` leaves vertex data out, for the JS export, which reads it from the meshes.
export async function serializeScene(world, { geometry = true } = {}) {
  await world.modifiers.settled();
  const { scene } = world;
  const camera = world.sceneSettings.camera() ?? scene.activeCamera;
  const content = exportedContent(scene);
  const effects = camera ? cameraEffects(world, scene, camera) : { renderingPipelines: [], postProcesses: [] };
  const all = [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras];
  const restores = [
    setFor(all, 'doNotSerialize', (n) => !content.nodes.has(n)),
    setFor(scene.materials, 'doNotSerialize', (m) => !content.materials.has(m)),
    geometry ? () => {} : withoutGeometry(scene.getGeometries()),
    setFor(scene.textures.filter((t) => t instanceof Texture && !t.isRenderTarget), '_forceSerialize', (t) => t._forceSerialize || !portable(t.url ?? '')),
    setFor(all, 'metadata', authoredMetadata),
    setFor([scene], 'metadata', () => null),
    uniqueIds(content.nodes),
  ];
  let pending, animationGroups, activeCameraID;
  try {
    // The serializer reads the scene synchronously; only texture readbacks finish later.
    pending = SceneSerializer.SerializeAsync(scene);
    animationGroups = bakeAnimations(world, content);
    activeCameraID = camera?.id;
  } finally {
    restores.forEach((restore) => restore());
  }
  const json = await pending;
  const kept = (list, items, keep) => list.filter((_, i) => keep(items[i]));
  json.multiMaterials = kept(json.multiMaterials, scene.multiMaterials, (m) => content.materials.has(m) || content.meshes.some((mesh) => mesh.material === m));
  json.particleSystems = kept(json.particleSystems, scene.particleSystems, (p) => !p.emitter?.getClassName || content.nodes.has(p.emitter));
  for (const entry of json.cameras) aimed(entry, scene.getCameraByUniqueId(entry.uniqueId));
  Object.assign(json, { animationGroups, activeCameraID, renderingPipelines: effects.renderingPipelines, imageProcessingConfiguration: scene.imageProcessingConfiguration.serialize(), producer: { name: 'Bylonder', file: 'scene.babylon' } });
  json.postProcesses.push(...effects.postProcesses);
  await environment(json, scene);
  return json;
}
