// The 3D cursor overlay (overlay_cursor.hh, overlay_shape.cc cursor_circle and cursor_lines): a red and white dashed
// circle of half a widget unit in screen space and an axis crosshair one widget unit long at the cursor's distance,
// at the scene cursor's default place, the world origin.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { view_3d as theme, user_interface, colorBlendShade } from '../editors/interface/userdef-default-theme.js';
import { drawView, DRAW_VIEW_GLSL } from './draw-view.js';

const WIDGET_UNIT = 20;

const VERTEX = `precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 viewProjection;
uniform vec3 viewRight;
uniform vec3 viewUp;
uniform float pixelFac;
uniform float screenSpace;
${DRAW_VIEW_GLSL}
flat varying vec4 vColor;
void main() {
  vColor = color;
  float size = ${WIDGET_UNIT}.0 * pixelFac * drw_point_world_to_homogenous(vec3(0.0)).w;
  vec3 p = screenSpace > 0.5 ? (viewRight * position.x + viewUp * position.y) * size : position * size;
  gl_Position = drw_point_world_to_homogenous(p);
}`;
const FRAGMENT = `precision highp float;
flat varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

function cursorCircle() {
  const segments = 12, positions = [], colors = [];
  for (let i = 0; i < segments; i++) {
    for (const j of [i, i + 1]) {
      const angle = 2 * Math.PI * (j / segments);
      positions.push(0.5 * Math.cos(angle), 0.5 * Math.sin(angle), 0);
    }
    // A line strip in Blender, flat colored by each segment's first vertex: white, red, white...
    const c = i % 2 === 0 ? [1, 1, 1, 1] : [1, 0, 0, 1];
    colors.push(...c, ...c);
  }
  return { positions, colors };
}

function cursorLines() {
  const positions = [], colors = [], overlay = theme.view_overlay;
  const axisColors = [user_interface.axis_x, user_interface.axis_y, user_interface.axis_z];
  const segment = (axis, sign, from, to, c) => {
    for (const t of [from, to]) { const p = [0, 0, 0]; p[axis] = sign * t; positions.push(...p); colors.push(c[0], c[1], c[2], 1); }
  };
  for (let i = 0; i < 3; i++) {
    for (const sign of [1, -1]) {
      segment(i, sign, 1, 0.85, sign > 0 ? axisColors[i] : colorBlendShade(axisColors[i], [1, 1, 1, 1], 0.25, -60));
      segment(i, sign, 0.85, 0.25, overlay);
    }
  }
  return { positions, colors };
}

export function createCursorOverlay(scene) {
  const material = new ShaderMaterial('__overlayCursor', scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
    attributes: ['position', 'color'], uniforms: ['viewProjection', 'viewRight', 'viewUp', 'pixelFac', 'screenSpace'],
  });
  Object.assign(material, { backFaceCulling: false, disableDepthWrite: true, depthFunction: Constants.ALWAYS });
  material.onBindObservable.add((mesh) => {
    const v = drawView(scene), e = material.getEffect();
    e.setFloat3('viewRight', v.right[0], v.right[1], v.right[2]);
    e.setFloat3('viewUp', v.up[0], v.up[1], v.up[2]);
    e.setFloat('pixelFac', v.pixelFac);
    e.setFloat('screenSpace', mesh.metadata.screenSpace ? 1 : 0);
  });
  const part = (name, { positions, colors }, screenSpace) => {
    const mesh = new Mesh(name, scene);
    mesh.setVerticesData('position', new Float32Array(positions), false, 3);
    mesh.setVerticesData('color', new Float32Array(colors), false, 4);
    Object.assign(mesh, { isUnIndexed: true, isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, material, renderingGroupId: 1 });
    mesh._getRenderingFillMode = () => Material.LineListDrawMode;
    mesh.metadata = { editable: false, overlay: true, screenSpace };
    return mesh;
  };
  const meshes = [part('__cursorLines', cursorLines(), false), part('__cursorCircle', cursorCircle(), true)];
  return { meshes, dispose() { meshes.forEach((mesh) => mesh.dispose()); material.dispose(); } };
}
