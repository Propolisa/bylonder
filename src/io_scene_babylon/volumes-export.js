// EEVEE's volumes in a package: the domains the app draws volumes in (draw/volumes.js), the world and the
// exported meshes whose material has a Volume, each with its volume material as the app makes it (its tree drawn with
// ShaderNodeOutputVolume, its nodes made from the IR's graph by the kernels' `<graph>/volume`), the scene's Volumes
// settings and the Blender Light settings the passes read. The page draws them with the app's volume passes, shipped
// in bylonder-volumes/ (polyfill/volumes.js).
import { nodeMaterialFromTree, ShaderNodeOutputVolume } from '../nodes/blender/shader-nodes.js';
import { isVolumeDomain, volumes, volumeSettings } from '../draw/volumes.js';
import { isBlenderLight, lightRecord } from '../blenkernel/light/light-home.js';
import { worldNodes } from '../blenkernel/scene/world-babylon.js';
import { exportNodeMaterial } from './node-material-export.js';

export const VOLUMES_FILE = 'bylonder-volumes/volumes.js';

// What draw/volume-passes.js reads of a light (volumeLight, packLights).
const LIGHT_FIELDS = ['type', 'energy', 'exposure', 'color', 'volume_factor', 'shadow_soft_size', 'size', 'size_y', 'shape', 'spot_size', 'spot_blend',
  'use_custom_distance', 'cutoff_distance', 'diffuse_factor', 'specular_factor', 'use_shadow'];
const plain = (value) => (value && typeof value === 'object' ? [...value] : value);

// The scene's volume domains seen by `camera`, of the `meshes` exported (ids; all when unset): [mesh, material], the
// world's as [null, world]. The world's box is shown only in rendered views: the world's volume is its material's.
function volumeDomains(scene, camera, meshes) {
  const world = worldNodes.get(scene);
  return scene.meshes.filter((mesh) => isVolumeDomain(mesh, camera) && !mesh.material.blenderWorld && (!meshes || meshes.has(mesh.id)))
    .map((mesh) => [mesh, mesh.material]).concat(world?.blenderVolume ? [[null, world]] : []);
}
/** Whether a package of the scene has volumes to draw. */
export const hasVolumes = (scene) => !!scene.activeCamera && volumes.enabled(scene) && volumeDomains(scene, scene.activeCamera).length > 0;

// The volumes of the scene as its camera draws them: { config, materials } (the volume materials' serializations, and
// `dispose` once the export no longer reads them), or null when it draws none. `meshes`: the exported meshes' ids;
// `lights`: the exported lights' ids; `graphOf(material, volume)`: the IR graph of a material's tree (js-export.js
// materialGraphs).
export async function exportVolumes(scene, { parity, graphOf, meshes, lights }) {
  const camera = scene.activeCamera;
  if (!camera || !volumes.enabled(scene)) return null;
  const domains = volumeDomains(scene, camera, meshes);
  if (!domains.length) return null;
  const made = [], config = { settings: volumeSettings(scene), domains: [], lights: {} };
  for (const [domain, source] of domains) {
    const { material } = nodeMaterialFromTree(`__volume ${source.name}`, scene, source.blenderTree, ShaderNodeOutputVolume);
    made.push(material);
    const graph = graphOf(source, { material, mesh: domain });
    const entry = await exportNodeMaterial(material, { parity, graph, kernel: graph && `${graph}/volume`, mesh: domain });
    if (!entry) continue;
    material.entry = entry;
    config.domains.push([domain?.id ?? null, entry.uniqueId]);
  }
  for (const light of scene.lights) {
    if (!isBlenderLight(light) || !lights.has(light.id)) continue;
    const record = lightRecord(light);
    config.lights[light.id] = Object.fromEntries(LIGHT_FIELDS.filter((key) => record[key] !== undefined).map((key) => [key, plain(record[key])]));
  }
  return { config, materials: made.map((m) => m.entry).filter(Boolean), dispose: () => made.forEach((m) => m.dispose()) };
}
