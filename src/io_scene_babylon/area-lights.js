// Babylon's RectAreaLight turns only by its parent's world matrix (its width along the parent's X, its height along its
// Y), where Bylonder draws it from Main's matrix_world (object-transform.js: width along the object's X, height along its
// -Z). The JavaScript export gives each area light a parent node of its own, its rig, placed as the object: Main's world
// matrix turned a quarter about X first, so the rig's Y is the object's -Z.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { babylonMatrix } from '../blenkernel/main-view.js';

const AREA_LIGHT = 4;
// The turn, as a quaternion after the object's rotation (blend-scene.js Transform offset) and as a matrix before it.
export const AREA_OFFSET = Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2).asArray();
const TURN = Matrix.RotationX(-Math.PI / 2);

export const rigId = (lightId) => `${lightId} rig`;

// The rigs of the serialized scene's area lights: { id, light (its uniqueId), matrix (local to the light's parent) }.
export function areaRigs(world, data) {
  const sync = world.mainSync;
  if (!sync) return [];
  const { scene } = world;
  const worldMatrix = (node) => babylonMatrix(sync.blender.transform(sync.objectOf(node)).matrix_world);
  return data.lights.filter((entry) => entry.type === AREA_LIGHT).flatMap((entry) => {
    const light = scene.lights.find((l) => l.uniqueId === entry.uniqueId);
    if (!light || !sync.objectOf(light)) return [];
    const parent = entry.parentId !== undefined ? [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras].find((n) => n.uniqueId === entry.parentId) : null;
    let matrix = TURN.multiply(worldMatrix(light));
    if (parent && sync.objectOf(parent)) matrix = matrix.multiply(Matrix.Invert(worldMatrix(parent)));
    return [{ id: rigId(entry.id), light: entry.uniqueId, matrix: matrix.asArray() }];
  });
}
