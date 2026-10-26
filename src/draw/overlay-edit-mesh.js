// Edit Mode overlay (overlay_edit_mesh.cc): vertices, edges colored by selection and selected faces tinted, in the
// theme's colors.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';
import { SCE_SELECT_VERTEX } from '../bmesh/intern/bmesh-marking.js';

// Depth is pulled toward the eye like glPolygonOffset(slopeScale, units): enough to win against the surface it
// sits on at any angle, too little to show through anything in front.
const SHADER = {
  vertex: `precision highp float;
attribute vec3 position; attribute vec4 color;
uniform mat4 worldViewProjection; uniform float pointSize;
varying vec4 vColor;
void main() { gl_Position = worldViewProjection * vec4(position, 1.0); gl_PointSize = pointSize; vColor = color; }`,
  fragment: `precision highp float;
varying vec4 vColor; uniform float roundPoint; uniform float depthUnits; uniform float slopeScale;
void main() {
  if (roundPoint > 0.5) { vec2 c = gl_PointCoord * 2.0 - 1.0; if (dot(c, c) > 1.0) discard; }
  float slope = max(abs(dFdx(gl_FragCoord.z)), abs(dFdy(gl_FragCoord.z)));
  gl_FragDepth = gl_FragCoord.z - depthUnits - slopeScale * slope;
  gl_FragColor = vColor;
}`,
};

function overlayMaterial(scene, name, { fillMode, pointSize = 1, depthUnits, slopeScale = 1, round = 0, alpha = false }) {
  const material = new ShaderMaterial(name, scene, { vertexSource: SHADER.vertex, fragmentSource: SHADER.fragment }, {
    attributes: ['position', 'color'], uniforms: ['worldViewProjection', 'pointSize', 'depthUnits', 'slopeScale', 'roundPoint'], needAlphaBlending: alpha,
  });
  material.fillMode = fillMode;
  material.backFaceCulling = false;
  material.setFloat('pointSize', pointSize);
  material.setFloat('depthUnits', depthUnits);
  material.setFloat('slopeScale', slopeScale);
  material.setFloat('roundPoint', round);
  if (alpha) material.alphaMode = Constants.ALPHA_COMBINE;
  return material;
}

const babylon = (p, v, out, o) => { out[o] = p[v * 3]; out[o + 1] = p[v * 3 + 2]; out[o + 2] = p[v * 3 + 1]; };

export function createEditMeshOverlay(owner) {
  const scene = owner.getScene();
  const part = (name, options) => {
    const mesh = new Mesh(owner.name + ' ' + name, scene);
    mesh.parent = owner;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    // Keep points and lines in Wireframe shading, which otherwise forces every mesh to wireframe triangles.
    mesh._getRenderingFillMode = (fillMode) => fillMode;
    mesh.material = overlayMaterial(scene, owner.name + ' ' + name, options);
    return mesh;
  };
  const faces = part('edit faces', { fillMode: Material.TriangleFillMode, depthUnits: 2e-5, slopeScale: 4, alpha: true });
  const edges = part('edit edges', { fillMode: Material.LineListDrawMode, depthUnits: 4e-5, slopeScale: 4 });
  const verts = part('edit verts', { fillMode: Material.PointListDrawMode, pointSize: theme.vertex_size * 2, depthUnits: 6e-5, slopeScale: 0, round: 1 });
  // Fresh geometry each time: element counts change with every edit.
  const apply = (mesh, positions, colors, indices) => {
    mesh.geometry?.dispose();
    const data = new VertexData();
    Object.assign(data, { positions, colors, indices });
    data.applyToMesh(mesh);
    mesh.setEnabled(indices.length > 0);
  };

  return {
    // Redraws from the edited Mesh (selection and hiding in its attributes) and the active element.
    update(mesh, { selectmode, active }) {
      const p = mesh.vert_positions, attr = (name) => mesh.attribute(name);
      const selVert = attr('.select_vert'), selEdge = attr('.select_edge'), selFace = attr('.select_poly');
      const hideVert = attr('.hide_vert'), hideEdge = attr('.hide_edge'), hideFace = attr('.hide_poly');
      const vertexMode = selectmode & SCE_SELECT_VERTEX;

      const vPos = new Float32Array(mesh.verts_num * 3), vCol = new Float32Array(mesh.verts_num * 4), vIdx = [];
      for (let v = 0; v < mesh.verts_num; v++) {
        babylon(p, v, vPos, v * 3);
        vCol.set(active?.type === 'vert' && active.index === v ? [1, 1, 1, 1] : selVert?.[v] ? theme.vertex_select : theme.vertex, v * 4);
        if (vertexMode && !hideVert?.[v]) vIdx.push(v);
      }
      apply(verts, vPos, vCol, vIdx);

      const ePos = new Float32Array(mesh.edges_num * 6), eCol = new Float32Array(mesh.edges_num * 8), eIdx = [];
      for (let e = 0; e < mesh.edges_num; e++) {
        const ends = [mesh.edges[e * 2], mesh.edges[e * 2 + 1]];
        ends.forEach((v, k) => {
          babylon(p, v, ePos, e * 6 + k * 3);
          const on = vertexMode ? selVert?.[v] : selEdge?.[e];
          eCol.set(active?.type === 'edge' && active.index === e ? [1, 1, 1, 1] : on ? theme.edge_select : theme.wire_edit, e * 8 + k * 4);
        });
        if (!hideEdge?.[e]) eIdx.push(e * 2, e * 2 + 1);
      }
      apply(edges, ePos, eCol, eIdx);

      const tris = mesh.corner_tris(), cv = mesh.corner_verts, triFace = mesh.corner_tri_faces();
      const fPos = new Float32Array(tris.length * 3), fCol = new Float32Array(tris.length * 4), fIdx = [];
      for (let t = 0; t < tris.length; t++) {
        const f = triFace[Math.floor(t / 3)];
        babylon(p, cv[tris[t]], fPos, t * 3);
        if (hideFace?.[f]) continue;
        const color = active?.type === 'face' && active.index === f ? theme.editmesh_active : selFace?.[f] ? theme.face_select : null;
        if (color) { fCol.set(color, t * 4); fIdx.push(t); }
      }
      apply(faces, fPos, fCol, fIdx);
    },
    dispose() { for (const mesh of [faces, edges, verts]) { mesh.material.dispose(); mesh.dispose(); } },
  };
}
