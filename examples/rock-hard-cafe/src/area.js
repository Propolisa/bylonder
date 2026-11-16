// The Play Area (a box empty in the .blend, around the counter, the barista's reach and the rock's spot), grown to take
// in the barista's lane behind the counter (where he stands at the start, with room around his body): what the camera
// keeps in view (Framing) and where the barista may walk (Barista). Made once per scene, at the start.
import { Matrix, Vector3 } from '@babylonjs/core';

/** Room around the barista's body, in metres. */
const BODY = 0.4;
const areas = new WeakMap();

/** The area's box in its own space (`min`, `max`) and its node, or null without one. */
export function playArea(scene) {
  if (areas.has(scene)) return areas.get(scene);
  const node = scene.getTransformNodeByName('Play Area'), barista = scene.getNodeByName('Barista');
  if (!node) return null;
  const min = new Vector3(-1, -1, -1), max = new Vector3(1, 1, 1);
  if (barista) {
    const world = node.computeWorldMatrix(true), local = Vector3.TransformCoordinates(barista.getAbsolutePosition(), Matrix.Invert(world));
    const room = new Vector3(BODY / world.getRow(0).toVector3().length(), 0, BODY / world.getRow(2).toVector3().length());
    min.minimizeInPlace(local.subtract(room));
    max.maximizeInPlace(local.add(room));
  }
  const area = { node, min, max };
  areas.set(scene, area);
  return area;
}

/** `move` (a direction on the ground, in the scene) without what would take a body of `radius` metres at `at` out of
 * the area along the ground, in place. */
export function keepIn(area, at, move, radius) {
  const world = area.node.computeWorldMatrix(true), local = Vector3.TransformCoordinates(at, Matrix.Invert(world));
  const along = Vector3.TransformNormal(move, Matrix.Invert(world));
  for (const [axis, row] of [['x', 0], ['z', 2]]) {
    const room = radius / world.getRow(row).toVector3().length();
    if ((local[axis] <= area.min[axis] + room && along[axis] < 0) || (local[axis] >= area.max[axis] - room && along[axis] > 0)) along[axis] = 0;
  }
  return move.copyFrom(Vector3.TransformNormal(along, world));
}
