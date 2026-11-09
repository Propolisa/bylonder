// EEVEE's volumes in the app, a render extension (Volumes): each camera's volume passes (volume-passes.js) over the
// meshes whose material's tree has a Volume and the world's box (world-babylon.js) when the world's has, each drawn
// with a volume material made from its tree, lit by Blender's lights. A scene without volumes draws none of it. The
// scene's Volumes settings (Properties > Render > Volumes) drive it.
import { renderExtension } from './render-extension.js';
import { nodeMaterialFromTree, ShaderNodeOutputVolume } from '../nodes/blender/shader-nodes.js';
import { isBlenderLight, lightRecord } from '../blenkernel/light/light-home.js';
import { filmSample } from '../render/film.js';
import { cameraVolumes as volumePasses, drawable, packLights as packVolumeLights, VOLUME_DEFAULTS } from './volume-passes.js';

export { depthParams, froxelGrid, historyOpacity, viewPoint, viewZToVolumeZ, volumeCoordinate, volumeHistoryUvw, volumeJitterOffset, volumeLight, volumeZToViewZ,
  VOLUME_DEFAULTS } from './volume-passes.js';

const settings = new WeakMap();
export const volumeSettings = (scene) => settings.get(scene) ?? VOLUME_DEFAULTS;
// The scene's Volumes settings as its RNA reads them (scene.eevee).
export function readVolumeSettings(eevee) {
  const read = (name, fallback) => { try { return eevee?.[name] ?? fallback; } catch { return fallback; } };
  const d = VOLUME_DEFAULTS;
  return {
    start: Number(read('volumetric_start', d.start)), end: Number(read('volumetric_end', d.end)), tileSize: Number(read('volumetric_tile_size', d.tileSize)),
    samples: Number(read('volumetric_samples', d.samples)), distribution: Number(read('volumetric_sample_distribution', d.distribution)),
    customRange: !!read('use_volume_custom_range', d.customRange), clampDirect: Number(read('clamp_volume_direct', d.clampDirect)),
    clampIndirect: Number(read('clamp_volume_indirect', d.clampIndirect)), shadows: !!read('use_volumetric_shadows', d.shadows),
    shadowSteps: Number(read('volumetric_shadow_samples', d.shadowSteps)),
  };
}

export const volumes = renderExtension({
  id: 'bylonder_volumes', label: 'Volumes',
  description: 'Draw object volumes (a material\'s Volume) as EEVEE does, in a froxel grid lit by the scene\'s lights and world. Off, they are not drawn, as in plain Babylon',
  // The presets: the scene's own Volumes settings trade speed for detail, as in EEVEE.
  detail: 'Volumes > Resolution 1:16, Steps 32 for speed; 1:4, 128 for detail (1:8, 64 by default)',
  pull: (scene, struct) => settings.set(scene, readVolumeSettings(struct.eevee)),
});

// A mesh drawn as a volume: its material's tree has a Volume.
export const isVolumeDomain = (mesh, camera) => !!mesh.material?.blenderVolume && drawable(mesh, camera);
const isWorldVolume = (mesh) => !!mesh.material?.blenderWorld;
const blenderLight = (light) => (isBlenderLight(light) ? lightRecord(light) : null);

// The lights that light the domains.
export const packLights = (scene, camera, domains) => packVolumeLights(scene, camera, domains, blenderLight);

// The volume material of a domain: its material's tree drawn with its Volume (ShaderNodeOutputVolume), made again when
// the material or its tree changes. The surface material's values (edited in the node editor) are the volume's.
function volumeMaterials(scene) {
  const made = new Map();
  const release = (domain) => { made.get(domain)?.material.dispose(); made.delete(domain); };
  return {
    release,
    material(domain) {
      const source = domain.material;
      let entry = made.get(domain);
      if (entry && (entry.source !== source || entry.tree !== source.blenderTree)) { release(domain); entry = null; }
      if (!entry) {
        const { material } = nodeMaterialFromTree(`__volume ${source.name}`, scene, source.blenderTree, ShaderNodeOutputVolume);
        made.set(domain, entry = { source, tree: source.blenderTree, material });
      }
      const sources = new Map(source.attachedBlocks.filter((b) => b.values).map((b) => [b.name, b]));
      for (const block of entry.material.attachedBlocks) if (block.values && sources.has(block.name)) Object.assign(block.values, sources.get(block.name).values);
      return entry.material;
    },
  };
}

// The volumes of `camera`'s views, while it draws through `film` (render-babylon.js).
export const cameraVolumes = (scene, camera, film = null) => volumePasses(scene, camera, {
  film, ...volumeMaterials(scene), isWorld: isWorldVolume, settings: () => volumeSettings(scene), sample: () => filmSample(scene), lightRecord: blenderLight,
  domains: (view) => (volumes.enabled(scene) ? scene.meshes.filter((mesh) => isVolumeDomain(mesh, view)) : []),
});
