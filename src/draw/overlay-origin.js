// Object origins (overlay_origin.hh, overlay_extra_point_vert.glsl, overlay_point_varying_color_varying_outline_aa_frag.glsl):
// a round point at the active and each selected object's origin, in the active or selected color with a thin wire outline, drawn over
// everything.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { POINT_SPRITE_FRAGMENT, POINT_SPRITE_OPTIONS, POINT_SPRITE_VERTEX, pointSprites, setPoints } from './point-sprites.js';
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
attribute vec3 point;
${POINT_SPRITE_VERTEX}
void main() {
  gl_Position = bl_point_sprite(viewProjection * vec4(point, 1.0), ${OBJECT_CENTER}.0);
  float radius = 0.5 * ${OBJECT_CENTER}.0;
  radii = vec4(radius, radius - 1.0, radius - ${PIXEL}.0, radius - ${PIXEL}.0 - 1.0) / ${OBJECT_CENTER}.0;
  fillColor = color;
}`;
const FRAGMENT = `precision highp float;
varying vec4 fillColor;
varying vec4 radii;
${POINT_SPRITE_FRAGMENT}
const vec4 outlineColor = vec4(${OUTLINE.join(', ')});
void main() {
  float dist = length(bl_point_coord - vec2(0.5));
  float midStroke = 0.5 * (radii[1] + radii[2]);
  if (dist > midStroke) gl_FragColor = vec4(outlineColor.rgb, mix(outlineColor.a, 0.0, smoothstep(radii[1], radii[0], dist)));
  else gl_FragColor = mix(fillColor, outlineColor, smoothstep(radii[3], radii[2], dist));
}`;

// blender-port: overlay_origin.hh object_sync: the active object's origin in the active color, selected or not, and a
// selected object's in the selected color; null for the rest.
export const originColor = (node, { selected, active }) => (node === active ? theme.object_active : selected.has(node) ? theme.object_selected : null);

//   objects() -> the scene's objects, color(node) -> its origin's color, or null when it shows none
export function createOriginOverlay(scene, { objects, color }) {
  const material = new ShaderMaterial('__overlayOrigin', scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
    attributes: ['position', 'color', ...POINT_SPRITE_OPTIONS.attributes], uniforms: ['viewProjection', ...POINT_SPRITE_OPTIONS.uniforms], needAlphaBlending: true,
  });
  Object.assign(material, { disableDepthWrite: true, depthFunction: Constants.ALWAYS });
  const mesh = new Mesh('__origins', scene);
  pointSprites(Object.assign(mesh, { isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, material, renderingGroupId: 1 }));
  mesh.metadata = { editable: false, overlay: true };
  let positions = new Float32Array(0), colors = new Float32Array(0);
  return {
    mesh,
    // Fills the points from the objects and shows them, or hides them; called per view before it renders.
    update(shown) {
      const list = shown ? objects() : NONE;
      if (positions.length < list.length * 3) {
        positions = new Float32Array(list.length * 6);
        colors = new Float32Array(list.length * 8);
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
      setPoints(mesh, { point: [positions, 3], color: [colors, 4] }, n);
    },
    dispose() { mesh.dispose(); material.dispose(); },
  };
}
