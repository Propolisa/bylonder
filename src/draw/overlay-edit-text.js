// Edit Mode overlay of a text object (overlay_edit_text.cc): the selection boxes and the cursor where Blender's text
// layout (BKE_vfont_to_curve) put them, in the object's plane.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { overlayMaterial } from './overlay-edit-mesh.js';

// The overlay's text colors (G_draw.block.color_text_hi for the cursor, a translucent selection).
const CURSOR = [1, 1, 1, 1], SELECTION = [0.33, 0.47, 0.84, 0.5];

export function createEditTextOverlay(owner) {
  const scene = owner.getScene();
  const quads = new Mesh(`${owner.name} edit text`, scene);
  Object.assign(quads, { parent: owner, isPickable: false, alwaysSelectAsActiveMesh: true });
  quads.material = overlayMaterial(scene, `${owner.name} edit text`, { fillMode: Material.TriangleFillMode, depthUnits: 6e-5, slopeScale: 4, alpha: true });
  return {
    // Redraws from the text's cursor (four corners) and selection boxes ({x, y, w, h, rotate}).
    update({ cursor, selection = [] }) {
      const corners = [], colors = [];
      const quad = (points, color) => {
        for (const k of [0, 1, 2, 0, 2, 3]) { const [x, y] = points[k]; corners.push(x, 0, y); colors.push(...color); }
      };
      for (const { x, y, w, h, rotate } of selection) {
        const c = Math.cos(rotate), s = Math.sin(rotate), at = (dx, dy) => [x + dx * c - dy * s, y + dx * s + dy * c];
        quad([at(0, 0), at(w, 0), at(w, h), at(0, h)], SELECTION);
      }
      if (cursor) quad([0, 1, 2, 3].map((i) => [cursor[i * 2], cursor[i * 2 + 1]]), CURSOR);
      quads.geometry?.dispose();
      if (!corners.length) return quads.setEnabled(false);
      const data = new VertexData();
      Object.assign(data, { positions: corners, colors, indices: corners.map((_, i) => i).slice(0, corners.length / 3) });
      data.applyToMesh(quads, true);
      quads.setEnabled(true);
    },
    dispose() { quads.material.dispose(); quads.dispose(); },
  };
}
