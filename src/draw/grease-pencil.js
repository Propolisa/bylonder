// Grease Pencil objects drawn by Babylon from what grease-pencil-api.cc packs of them as Blender's draw cache reads them:
// each visible drawing (a layer's frame, or an onion skin of it) as its strokes in GreasedLine meshes, their points'
// radii as widths and their colors (Blender's mix of material, vertex color, opacity and onion tint) in a colors
// texture, and its fills as one mesh of Blender's fill triangles. A drawing's strokes are a base mesh and an active one:
// a change of its last strokes (a stroke being drawn) rebuilds only the active mesh, so drawing stays cheap however many
// strokes the drawing holds. Layers draw in their order over the scene, as Blender's 2D layers do.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { RenderingGroup } from '@babylonjs/core/Rendering/renderingGroup.js';
import defaultTheme from '../editors/interface/theme-default.json' with { type: 'json' };
import { overlayMaterial } from './overlay-edit-mesh.js';
import { pointSprites, setPoints } from './point-sprites.js';
import { BLEND_MODES, CURVE_INTS, POINT_FLOATS, alphaIndex, fillMesh as fillGeometry, followResolution, greasedLineMaterial, meanScale, strokeArrays, strokesMesh } from '../io_scene_babylon/runtime/grease-pencil.js';

// A drawing's last strokes that change without the rest (a stroke being drawn) stay in the active mesh up to this many.
const ACTIVE_STROKES = 8;

// GreasedLine's settings for a drawing's object (runtimes/grease-pencil.js): Blender's look (world widths, no dashes)
// unless its object's Babylon settings ask otherwise.
export const BLENDER_LOOK = { sizeAttenuation: false, screenScale: 1, useDash: false, dashCount: 1, dashRatio: 0.5, dashOffset: 0 };

// One GreasedLine mesh of strokes, rebuilt with set(); empty, it has no mesh. Its material is made again only when size
// attenuation (a define of GreasedLine's) changes.
function strokeBatch(scene, name, owner) {
  const batch = { mesh: null, material: null, plugin: null, texture: null, look: null };
  batch.configure = (look, blend) => {
    if (batch.look?.sizeAttenuation !== look.sizeAttenuation) {
      batch.material?.dispose();
      batch.material = greasedLineMaterial(scene, name, look.sizeAttenuation);
      batch.plugin = batch.material.pluginManager.getPlugin('GreasedLinePluginMaterial');
      followResolution(scene, batch.plugin);
      if (batch.texture) batch.plugin.colorsTexture = batch.texture;
      if (batch.mesh) batch.mesh.material = batch.material;
    }
    batch.look = look;
    const { screenScale, useDash, dashCount, dashRatio, dashOffset } = look;
    // Attenuated, a stroke's width is in pixels: its diameter in metres times the screen scale.
    Object.assign(batch.plugin, { width: look.sizeAttenuation ? screenScale : 1, useDash, dashCount, dashRatio, dashOffset });
    batch.material.alphaMode = blend;
  };
  batch.set = (strokes, matrix, order) => {
    batch.mesh?.dispose();
    batch.mesh = null;
    if (!strokes.lines.length) return;
    const mesh = strokesMesh(scene, name, strokes, batch.plugin, batch.texture);
    batch.texture = batch.plugin.colorsTexture;
    Object.assign(mesh, { material: batch.material, alphaIndex: order, isPickable: true, metadata: { drawOwner: owner, greasePencil: true } });
    mesh.freezeWorldMatrix(matrix);
    batch.mesh = mesh;
  };
  batch.place = (matrix) => batch.mesh?.freezeWorldMatrix(matrix);
  batch.dispose = () => { batch.mesh?.dispose(); batch.texture?.dispose(); batch.material?.dispose(); };
  return batch;
}

// A drawing's fills: its points' positions and fill colors, Blender's triangles.
function fillMesh(scene, name, owner, draw, matrix, kept) {
  const mesh = fillGeometry(scene, name, draw, kept);
  if (!mesh) return null;
  mesh.material.alphaMode = BLEND_MODES[draw.blend] ?? Constants.ALPHA_COMBINE;
  Object.assign(mesh, { alphaIndex: alphaIndex(draw, 0), isPickable: true, metadata: { drawOwner: owner, greasePencil: true } });
  mesh.freezeWorldMatrix(matrix);
  return mesh;
}

const theme = defaultTheme.view_3d;

// Edit Mode's points of a drawing (overlay_grease_pencil.hh edit points), in the theme's colors by their selection.
function editPoints(scene, name, draw, matrix, kept) {
  if (!draw.pointsShown || !draw.points.length) { kept?.dispose(); return null; }
  const mesh = kept ?? Object.assign(new Mesh(name, scene), { isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, renderingGroupId: 1 });
  if (!mesh.material) pointSprites(Object.assign(mesh, { material: overlayMaterial(scene, name, { fillMode: Material.PointListDrawMode, pointSize: theme.gp_vertex_size * 2 }) }));
  const count = draw.points.length / POINT_FLOATS, positions = new Float32Array(count * 3), colors = new Float32Array(count * 4);
  for (let p = 0; p < count; p++) {
    const o = p * POINT_FLOATS;
    positions.set(draw.points.subarray(o, o + 3), p * 3);
    colors.set([...(draw.points[o + 12] > 0 ? theme.gp_vertex_select : theme.gp_vertex), 1], p * 4);
  }
  setPoints(mesh, { point: [positions, 3], color: [colors, 4] }, count);
  mesh.freezeWorldMatrix(matrix);
  return mesh;
}

// The view's Grease Pencil drawings. `matrix(layerToWorld)`: Blender's matrix as Babylon's; `look(ob)`: GreasedLine's
// settings for an object (BLENDER_LOOK's keys).
// A mesh's origin's depth in the view (its frozen world matrix is its object's).
const viewDepth = (view, mesh) => { const w = mesh.getWorldMatrix().m, v = view.m; return v[2] * w[12] + v[6] * w[13] + v[10] * w[14] + v[14]; };
// blender-port: gpencil_cache_utils.cc gpencil_object_cache_sort (gpencil_tobject_dist_sort): Grease Pencil objects drawn
// back to front by their origin's depth in the view, objects at one depth in the order they were made (Blender keeps
// its object order there), each one's drawings in its layer order (their alphaIndex). Each object's drawings stay
// together, so overlapping objects never trade places. Other transparent meshes sort as Babylon sorts them, and against
// the Grease Pencil drawings as one block at alphaIndex 0, so the order stays total.
export function greasePencilSortCompare(scene) {
  const ownerOf = (subMesh) => subMesh.getMesh().metadata?.greasePencil && subMesh.getMesh().metadata.drawOwner;
  return (a, b) => {
    const oa = ownerOf(a), ob = ownerOf(b);
    if (oa && ob && oa !== ob) {
      const view = scene.getViewMatrix();
      return viewDepth(view, b.getMesh()) - viewDepth(view, a.getMesh()) || oa.uniqueId - ob.uniqueId;
    }
    if (oa && !ob) return b._alphaIndex < 0 ? 1 : -1;
    if (ob && !oa) return a._alphaIndex < 0 ? -1 : 1;
    return RenderingGroup.defaultTransparentSortCompare(a, b);
  };
}

export function createGreasePencilDraw(scene, { matrix: babylonMatrix, look = () => BLENDER_LOOK }) {
  const drawings = new Map();
  scene.setRenderingOrder(0, null, null, greasePencilSortCompare(scene));
  // Draws `draws` (BlenderMain.greasePencil) for the objects `nodeOf` gives; returns whether a drawing packed anew had no
  // object to draw it for yet, so the next update repacks.
  function update(draws, nodeOf) {
    const seen = new Set();
    let missed = false;
    for (const draw of draws) {
      const owner = nodeOf(draw.ob);
      if (!owner) { missed ||= draw.changed; continue; }
      const key = `${draw.ob}:${draw.layer}:${draw.onion}`, name = `__grease_pencil ${owner.name} ${draw.layer} ${draw.onion}`;
      seen.add(key);
      const matrix = babylonMatrix(draw.layerToWorld), scale = meanScale(draw.layerToWorld);
      let drawn = drawings.get(key);
      if (!drawn) drawings.set(key, drawn = { base: strokeBatch(scene, name, owner), active: strokeBatch(scene, name + ' active', owner), hashes: [], split: 0, fill: null });
      const blend = BLEND_MODES[draw.blend] ?? Constants.ALPHA_COMBINE, settings = look(draw.ob);
      drawn.base.configure(settings, blend);
      drawn.active.configure(settings, blend);
      if (drawn.fill) drawn.fill.material.alphaMode = blend;
      if (!draw.changed) {
        drawn.base.place(matrix);
        drawn.active.place(matrix);
        drawn.fill?.freezeWorldMatrix(matrix);
        drawn.points?.freezeWorldMatrix(matrix);
        continue;
      }
      const hashes = Array.from({ length: draw.curves.length / CURVE_INTS }, (_, c) => draw.curves[c * CURVE_INTS + 4]);
      let changed = 0;
      while (changed < hashes.length && hashes[changed] === drawn.hashes[changed]) changed++;
      const total = hashes.length;
      if (changed < drawn.split || total - drawn.split > ACTIVE_STROKES) {
        drawn.split = total - changed <= ACTIVE_STROKES ? changed : total;
        drawn.base.set(strokeArrays(draw, 0, drawn.split, scale), matrix, alphaIndex(draw, 1));
      }
      drawn.active.set(strokeArrays(draw, drawn.split, total, scale), matrix, alphaIndex(draw, 2));
      drawn.hashes = hashes;
      drawn.fill = fillMesh(scene, name + ' fill', owner, draw, matrix, drawn.fill);
      drawn.points = editPoints(scene, name + ' points', draw, matrix, drawn.points);
    }
    for (const [key, drawn] of drawings) if (!seen.has(key)) dispose(key, drawn);
    return missed;
  }
  function dispose(key, drawn) {
    drawn.base.dispose();
    drawn.active.dispose();
    drawn.fill?.dispose();
    drawn.points?.dispose();
    drawings.delete(key);
  }
  return {
    update,
    meshes: () => [...drawings.values()].flatMap((d) => [d.base.mesh, d.active.mesh, d.fill]).filter(Boolean),
  };
}
