// Display As > Bounds (Object.display_type 'BOUNDS'): the object drawn in the viewport as its bounding box's edges in
// the theme's wire color (overlay_extra.cc's bounds), its surfaces only in renders.
import { Color3, Matrix, MeshBuilder, Vector3 } from '@babylonjs/core';
import theme from '../editors/interface/theme-default.json' with { type: 'json' };

const EDGES = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const WIRE = Color3.FromArray(theme.view_3d.wire);
const corners = ({ minimum: a, maximum: b }) => Array.from({ length: 8 }, (_, i) => new Vector3(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z));

// The edges of `box` (a BoundingBox's local minimum and maximum) at each of `matrices`, replacing `kept`.
export function boundsLines(scene, name, box, matrices = [Matrix.Identity()], kept = null) {
  kept?.dispose();
  const local = corners(box);
  const lines = matrices.flatMap((m) => {
    const at = local.map((p) => Vector3.TransformCoordinates(p, m));
    return EDGES.map(([a, b]) => [at[a], at[b]]);
  });
  return Object.assign(MeshBuilder.CreateLineSystem(name, { lines }, scene), { color: WIRE, isPickable: false, metadata: { overlay: true } });
}
