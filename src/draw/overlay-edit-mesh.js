// Edit Mode overlay (overlay_edit_mesh.cc): vertices, edges colored by selection and selected faces tinted, in the
// theme's colors.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
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

export function overlayMaterial(scene, name, { fillMode, pointSize = 1, depthUnits, slopeScale = 1, round = 0, alpha = false }) {
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

const ACTIVE = [1, 1, 1, 1];
const color = (c, out, o) => { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3]; };
const babylon = (p, v, out, o) => { out[o] = p[v * 3]; out[o + 1] = p[v * 3 + 2]; out[o + 2] = p[v * 3 + 1]; };

export function createEditMeshOverlay(owner) {
  const scene = owner.getScene();
  const part = (name, options) => {
    const mesh = new Mesh(owner.name + ' ' + name, scene);
    mesh.parent = owner;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.metadata = { overlay: true };
    // Keep points and lines in Wireframe shading, which otherwise forces every mesh to wireframe triangles.
    mesh._getRenderingFillMode = (fillMode) => fillMode;
    mesh.material = overlayMaterial(scene, owner.name + ' ' + name, options);
    return mesh;
  };
  const faces = part('edit faces', { fillMode: Material.TriangleFillMode, depthUnits: 2e-5, slopeScale: 4, alpha: true });
  const edges = part('edit edges', { fillMode: Material.LineListDrawMode, depthUnits: 4e-5, slopeScale: 4 });
  const verts = part('edit verts', { fillMode: Material.PointListDrawMode, pointSize: theme.vertex_size * 2, depthUnits: 6e-5, slopeScale: 0, round: 1 });
  // Positions, colors and drawn indices per part, kept while the topology stays, as Blender keeps its edit mode
  // buffers and refills the ones out of date.
  let buffers = null;

  function fillPositions(mesh) {
    const p = mesh.vert_positions, edgeVerts = mesh.edges, cv = mesh.corner_verts, tris = mesh.corner_tris();
    for (let v = 0; v < mesh.verts_num; v++) babylon(p, v, buffers.verts.positions, v * 3);
    for (let i = 0; i < edgeVerts.length; i++) babylon(p, edgeVerts[i], buffers.edges.positions, i * 3);
    for (let t = 0; t < tris.length; t++) babylon(p, cv[tris[t]], buffers.faces.positions, t * 3);
  }

  function fillColors(mesh, selectmode, active) {
    const attr = (name) => mesh.attribute(name), edgeVerts = mesh.edges, triFace = mesh.corner_tri_faces();
    const selVert = attr('.select_vert'), selEdge = attr('.select_edge'), selFace = attr('.select_poly');
    const hideVert = attr('.hide_vert'), hideEdge = attr('.hide_edge'), hideFace = attr('.hide_poly');
    const vertexMode = selectmode & SCE_SELECT_VERTEX;
    const isActive = (type, index) => active?.type === type && active.index === index;
    const { verts: vb, edges: eb, faces: fb } = buffers;
    let n = 0;
    for (let v = 0; v < mesh.verts_num; v++) {
      color(isActive('vert', v) ? ACTIVE : selVert[v] ? theme.vertex_select : theme.vertex, vb.colors, v * 4);
      if (vertexMode && !hideVert[v]) vb.indices[n++] = v;
    }
    vb.count = n;
    n = 0;
    for (let e = 0; e < mesh.edges_num; e++) {
      for (let k = 0; k < 2; k++) {
        const on = vertexMode ? selVert[edgeVerts[e * 2 + k]] : selEdge[e];
        color(isActive('edge', e) ? ACTIVE : on ? theme.edge_select : theme.wire_edit, eb.colors, e * 8 + k * 4);
      }
      if (!hideEdge[e]) { eb.indices[n++] = e * 2; eb.indices[n++] = e * 2 + 1; }
    }
    eb.count = n;
    n = 0;
    for (let t = 0; t < triFace.length; t++) {
      const f = triFace[t];
      if (hideFace[f]) continue;
      const tint = isActive('face', f) ? theme.editmesh_active : selFace[f] ? theme.face_select : null;
      if (!tint) continue;
      for (let k = t * 3; k < t * 3 + 3; k++) { color(tint, fb.colors, k * 4); fb.indices[n++] = k; }
    }
    fb.count = n;
  }

  const buffer = (elements, perElement) => ({ positions: new Float32Array(elements * perElement * 3), colors: new Float32Array(elements * perElement * 4), indices: new Uint32Array(elements * perElement), count: 0 });
  const drawn = (b) => b.indices.subarray(0, b.count);

  return {
    // Redraws from the edit mesh's Mesh (selection and hiding in its attributes) and the active element, refilling
    // what changed: `topology`, `positions` or `flags` (selection, hiding, the select mode and the active element).
    update(mesh, { selectmode, active, topology = true, positions = true, flags = true }) {
      topology ||= !buffers;
      if (topology) buffers = { verts: buffer(mesh.verts_num, 1), edges: buffer(mesh.edges_num, 2), faces: buffer(mesh.corner_tris().length / 3, 3) };
      if (topology || positions) fillPositions(mesh);
      if (topology || flags) fillColors(mesh, selectmode, active);
      for (const [target, b] of [[verts, buffers.verts], [edges, buffers.edges], [faces, buffers.faces]]) {
        if (topology) {
          target.geometry?.dispose();
          const data = new VertexData();
          Object.assign(data, { positions: b.positions, colors: b.colors, indices: drawn(b) });
          data.applyToMesh(target, true);
        } else {
          if (positions) target.updateVerticesData(VertexBuffer.PositionKind, b.positions);
          if (flags) {
            target.updateVerticesData(VertexBuffer.ColorKind, b.colors);
            target.setIndices(drawn(b));
          }
        }
        target.setEnabled(b.count > 0);
      }
    },
    dispose() { for (const mesh of [faces, edges, verts]) { mesh.material.dispose(); mesh.dispose(); } },
  };
}
