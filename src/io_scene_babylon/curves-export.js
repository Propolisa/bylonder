// Curves in a package: what a render draws of a Curves object's evaluated curves or a particle system's hair, as one IR
// entity each (`OB:Hill/curves/Grass`, `curves:CURVES`) whose inputs are Main's curves draw (main-api.cc main_curves) at
// export, in scene.bin. The page draws them as the app does (draw/curves-blocks.js, shipped in bylonder-curves/): in
// their material, whose curves blocks place each vertex with Blender's curve shape functions (CURVES_GLSL_FILE).
import { idStruct } from '../python/bpy_rna.js';
import { CURVES_GLSL } from '../draw/curves.js';
import { idKey } from './ir-export.js';

export const CURVES_GLSL_FILE = 'bylonder-curves/glsl.js';

// The app draws a record as the mesh `__curves <ob>:<system>` (main-view.js drawCurves), in the material it shades it with.
const curvesMeshName = (ob, system) => `__curves ${ob}:${system}`;

// Each record a render draws whose object the export holds, as an entity. `nodes`: the exported nodes.
export function curvesEntities(world, nodes, bin) {
  const sync = world.mainSync, entities = {};
  if (!sync) return entities;
  const byOb = new Map(nodes.map((node) => [sync.objectOf(node), node]));
  // Copied before Main is read again, which can grow the module's memory.
  const records = sync.blender.curves().filter((r) => byOb.has(r.ob) && r.render && r.indirection.length).map((r) => ({ ob: r.ob, system: r.system, faces: r.faces,
    pos_rad: { buffer: bin.add(Float32Array.from(r.posRad)) }, indirection: { buffer: bin.add(Int32Array.from(r.indirection)) },
    time: { buffer: bin.add(Float32Array.from(r.time)) }, length: { buffer: bin.add(Float32Array.from(r.length)) }, object_to_world: Array.from(r.objectToWorld) }));
  for (const { ob: pointer, system, ...draw } of records) {
    const ob = idStruct(pointer), name = system < 0 ? 'curves' : ob.particle_systems[system].name;
    const material = world.scene.getMeshByName(curvesMeshName(pointer, system))?.material?.id ?? null;
    entities[`${idKey(ob)}/curves/${name}`] = { type: 'curves:CURVES', id: idKey(ob), implementation: 'curves',
      inputs: { ...draw, material, name }, outputs: { geometry: { draw: byOb.get(pointer).id } } };
  }
  return entities;
}

// The curves blocks' GLSL, the package's file beside them: Blender's, so GPL.
export const curvesGlslFile = () => `// SPDX-License-Identifier: GPL-3.0-or-later
// Blender's curves shader code (draw_curves_lib.glsl and what it calls) as the curves blocks emit it, made by
// Bylonder's export (LICENSE.md).
import { CURVES_GLSL } from './curves.js';
Object.assign(CURVES_GLSL, ${JSON.stringify(CURVES_GLSL)});
`;
