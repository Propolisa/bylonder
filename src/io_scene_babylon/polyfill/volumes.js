// SPDX-License-Identifier: GPL-3.0-or-later
// The volumes of an exported page, drawn as the app draws them: EEVEE's volume passes and the blocks of the volume
// materials (draw/volume-passes.js, draw/volume-blocks.js), over the domains the export lists. Bundled into
// volumes.bundle.js by scripts/modifiers-polyfill.mjs, a package's bylonder-volumes/volumes.js; importing it registers
// the blocks, so the volume materials parse.
import { NullEngine } from '@babylonjs/core';
import { cameraVolumes, drawable } from '../../draw/volume-passes.js';
import '../../draw/volume-blocks.js';

// The volumes of `cameras` (the scene's, by default), from the export's `config` (volumes-export.js): the scene's
// Volumes settings, the domains (a mesh's id, or null for the world's box `worldBox`, and the unique id of its volume
// material in `materials`) and the lights' Blender Light settings by light id. None without a GPU (a NullEngine, in
// Node), which cannot draw them.
export function sceneVolumes(scene, { settings, domains, lights }, materials, worldBox = null, cameras = scene.cameras) {
  if (scene.getEngine() instanceof NullEngine) return [];
  const volumes = new Map(domains.map(([id, material]) => [id === null ? worldBox : scene.getMeshById(id), materials[material]]).filter(([mesh, material]) => mesh && material));
  const host = {
    settings: () => settings, isWorld: (mesh) => mesh === worldBox, material: (mesh) => volumes.get(mesh), lightRecord: (light) => lights[light.id] ?? null,
    domains: (camera) => [...volumes.keys()].filter((mesh) => drawable(mesh, camera)),
  };
  return cameras.map((camera) => cameraVolumes(scene, camera, host));
}
