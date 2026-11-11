// Point clouds in a package: what a render draws of the point clouds Main's instances hold (main-api.cc
// main_pointclouds), as one IR entity each (`OB:Clouds/pointcloud/0`, `pointcloud:POINTCLOUD`) whose inputs are the
// points at export, in scene.bin. The page draws them as the app does (draw/pointcloud.js, shipped in
// bylonder-pointclouds/): a sphere at each point, in the point cloud's material, under its object's node.
import { Matrix } from '@babylonjs/core';
import { idStruct } from '../python/bpy_rna.js';
import { idKey } from './ir-export.js';

// The app draws a record as the mesh `__pointcloud <instancer>:<n>` (main-view.js drawInstances), in the material it shades it with.
const pointCloudMeshName = (instancer, n) => `__pointcloud ${instancer}:${n}`;

// Each point cloud a render draws whose object the export holds, as an entity. `nodes`: the exported nodes.
export function pointCloudEntities(world, nodes, bin) {
  const sync = world.mainSync, entities = {};
  if (!sync) return entities;
  const byOb = new Map(nodes.map((node) => [sync.objectOf(node), node])), nth = new Map();
  sync.blender.instances();
  // Copied before Main is read again, which can grow the module's memory.
  const records = sync.blender.pointClouds().map((r) => ({ instancer: r.instancer, n: nth.set(r.instancer, (nth.get(r.instancer) ?? -1) + 1).get(r.instancer),
    matrix: Matrix.FromArray(r.matrix), points: Float32Array.from(r.points) })).filter((r) => byOb.has(r.instancer) && r.points.length);
  for (const { instancer, n, matrix, points } of records) {
    const node = byOb.get(instancer), ob = idStruct(instancer);
    const material = world.scene.getMeshByName(pointCloudMeshName(instancer, n))?.material?.id ?? null;
    // In its object's space, which the page's node gives it.
    const local = matrix.multiply(node.computeWorldMatrix(true).clone().invert());
    entities[`${idKey(ob)}/pointcloud/${n}`] = { type: 'pointcloud:POINTCLOUD', id: idKey(ob), implementation: 'pointcloud',
      inputs: { points: { buffer: bin.add(points) }, matrix: Array.from(local.asArray()), material, name: String(n) }, outputs: { geometry: { draw: node.id } } };
  }
  return entities;
}
