// Object origins (overlay_origin.hh, overlay_extra_point_vert.glsl, overlay_point_varying_color_varying_outline_aa_frag.glsl):
// a round point at each selected object's origin, in the active or selected color with a thin wire outline, drawn over
// everything.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';

const NONE = [];
const OBJECT_CENTER = theme.object_origin_size + 1, PIXEL = 1;
// TH_WIRE with its alpha lowered by 30.
const OUTLINE = [...theme.wire.slice(0, 3), (255 - 30) / 255];

const VERTEX = `precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 viewProjection;
varying vec4 fillColor;
varying vec4 radii;
void main() {
  gl_Position = viewProjection * vec4(position, 1.0);
  gl_PointSize = ${OBJECT_CENTER}.0;
  float radius = 0.5 * ${OBJECT_CENTER}.0;
  radii = vec4(radius, radius - 1.0, radius - ${PIXEL}.0, radius - ${PIXEL}.0 - 1.0) / ${OBJECT_CENTER}.0;
  fillColor = color;
}`;
const FRAGMENT = `precision highp float;
varying vec4 fillColor;
varying vec4 radii;
const vec4 outlineColor = vec4(${OUTLINE.join(', ')});
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  float midStroke = 0.5 * (radii[1] + radii[2]);
  if (dist > midStroke) gl_FragColor = vec4(outlineColor.rgb, mix(outlineColor.a, 0.0, smoothstep(radii[1], radii[0], dist)));
  else gl_FragColor = mix(fillColor, outlineColor, smoothstep(radii[3], radii[2], dist));
}`;

//   objects() -> the scene's objects, color(node) -> its origin's color, or null when it shows none
export function createOriginOverlay(scene, { objects, color }) {
  const material = new ShaderMaterial('__overlayOrigin', scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
    attributes: ['position', 'color'], uniforms: ['viewProjection'], needAlphaBlending: true,
  });
  Object.assign(material, { disableDepthWrite: true, depthFunction: Constants.ALWAYS });
  const mesh = new Mesh('__origins', scene);
  Object.assign(mesh, { isUnIndexed: true, isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, material, renderingGroupId: 1 });
  mesh._getRenderingFillMode = () => Material.PointListDrawMode;
  mesh.metadata = { editable: false, overlay: true };
  let positions = new Float32Array(0), colors = new Float32Array(0), count = -1;
  return {
    mesh,
    // Fills the points from the objects and shows them, or hides them; called per view before it renders.
    update(shown) {
      const list = shown ? objects() : NONE;
      if (positions.length < list.length * 3) {
        positions = new Float32Array(list.length * 6);
        colors = new Float32Array(list.length * 8);
        mesh.setVerticesData('position', positions, true, 3);
        mesh.setVerticesData('color', colors, true, 4);
        count = -1;
      }
      let n = 0;
      for (const node of list) {
        const c = color(node);
        if (!c) continue;
        const p = node.getAbsolutePosition();
        positions[n * 3] = p.x; positions[n * 3 + 1] = p.y; positions[n * 3 + 2] = p.z;
        colors.set(c, n * 4);
        n++;
      }
      mesh.isVisible = n > 0;
      if (!n) return;
      mesh.updateVerticesData('position', positions);
      mesh.updateVerticesData('color', colors);
      if (n !== count) { count = n; mesh.subMeshes[0].verticesCount = n; }
    },
    dispose() { mesh.dispose(); material.dispose(); },
  };
}
