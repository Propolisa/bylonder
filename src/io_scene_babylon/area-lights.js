// Babylon's RectAreaLight turns only by its parent's world matrix (its width along the parent's X, its height along its
// Y), where Bylonder draws it from Main's matrix_world (object-transform.js: width along the object's X, height along its
// -Z). The export gives each area light a parent node of its own, its rig, placed as the object (and animated as it
// moves): Main's world matrix turned a quarter about X first, so the rig's Y is the object's -Z.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';

export const AREA_LIGHT = 4;
// The turn, as a quaternion after the object's rotation (blend-scene.js Transform offset) and as a matrix before it.
export const AREA_OFFSET = Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2).asArray();
const TURN = Matrix.RotationX(-Math.PI / 2);

export const rigId = (lightId) => `${lightId} rig`;

// The rig's transform from the light's evaluated world matrix and its parent's inverse world matrix (or none).
export function rigTransform(world, toParent) {
  let matrix = TURN.multiply(world);
  if (toParent) matrix = matrix.multiply(toParent);
  const position = new Vector3(), rotationQuaternion = new Quaternion(), scaling = new Vector3();
  matrix.decompose(scaling, rotationQuaternion, position);
  return { position, rotationQuaternion, scaling };
}

// The serialized area lights `rigged` (by uniqueId, with their rig's transform) put under rigs of their own: each rig a
// transform node in the light's place, the light at its origin.
export function rigAreaLights(json, rigged) {
  let next = Math.max(0, ...[...json.meshes, ...(json.transformNodes ?? []), ...json.lights, ...json.cameras].map((e) => e.uniqueId ?? 0)) + 1;
  for (const light of json.lights) {
    const transform = rigged.get(light.uniqueId);
    if (light.type !== AREA_LIGHT || !transform) continue;
    const rig = { name: rigId(light.id), id: rigId(light.id), uniqueId: next++, isEnabled: true, rotation: [0, 0, 0], animations: [],
      ...Object.fromEntries(Object.entries(transform).map(([key, value]) => [key, value.asArray()])), ...(light.parentId !== undefined && { parentId: light.parentId }) };
    (json.transformNodes ??= []).push(rig);
    Object.assign(light, { parentId: rig.uniqueId, position: [0, 0, 0] });
    delete light.direction;
  }
}
