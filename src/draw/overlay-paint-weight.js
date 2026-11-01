// Weight Paint Mode's overlay (overlay_paint.hh, its weight pass): the object's evaluated mesh drawn in its place by
// Blender's own shaders (gpu-library.js `draw`: overlay_paint_weight_vert/frag.glsl, with FAKE_SHADING as the Solid
// view draws it), each vertex's weight in the active vertex group (main-api.cc mesh_paint_weights, as extract_weights
// gives the draw cache) mapped through Blender's weight ramp, the zero weight alert and the contour lines its overlay
// settings ask for. The shaders' create info stands in front of them: the vertex's position, normal and weight, the
// object's and view's matrices, the theme's alert colors.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { draw } from '../nodes/blender/gpu-library.js';
import { glslShader } from '../nodes/blender/glsl.js';
import { weightRampTexture } from './overlay-particle.js';
import theme from '../editors/interface/theme-default.json' with { type: 'json' };

const MACROS = { main: 'bl_main', FAKE_SHADING: '1', view_clipping_distances: [['x'], ''], texture: [['t', 'x'], 'texture(t, vec2(x, 0.5))'] };
// Where GLSL ES differs from the desktop GLSL Blender targets.
const FIX = ['weight_color * (1 - grid.a)', 'weight_color * (1.0 - grid.a)', 'GLSL ES has no implicit int to float conversion'];
const fixed = (code) => {
  if (!code.includes(FIX[0])) throw Error(`overlay-paint-weight.js: the fix (${FIX[2]}) no longer applies`);
  return code.replace(FIX[0], FIX[1]);
};
const INTERFACE = `varying vec2 weight_interp;
varying float color_fac;`;
const VERTEX = `precision highp float;
precision highp int;
attribute vec3 position;
attribute vec3 normal;
attribute float weight;
uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;
uniform vec3 light_dir;
${INTERFACE}
vec3 pos;
vec3 nor;
vec3 drw_point_object_to_world(vec3 p) { return (world * vec4(p, 1.0)).xyz; }
vec4 drw_point_world_to_homogenous(vec3 p) { return viewProjection * vec4(p, 1.0); }
// Babylon's view space looks down its +Z, Blender's down -Z.
vec3 drw_normal_object_to_view(vec3 n) { vec3 v = mat3(view) * mat3(world) * n; return vec3(v.xy, -v.z); }
${glslShader(draw['overlay_paint_weight_vert.glsl'], 'vertex', MACROS)}
void main() { pos = position; nor = normal; bl_main(); }`;
const FRAGMENT = `precision highp float;
precision highp int;
${INTERFACE}
uniform sampler2D colorramp;
uniform float opacity;
uniform bool draw_contours;
uniform vec4 vert_missing_data;
uniform vec4 vert_unreferenced;
struct ThemeColors { vec4 vert_missing_data; vec4 vert_unreferenced; };
struct Theme { ThemeColors colors; };
Theme theme;
layout(location = 0) out vec4 frag_color;
vec4 line_output;
${fixed(glslShader(draw['overlay_paint_weight_frag.glsl'], 'fragment', MACROS))}
void main() { theme = Theme(ThemeColors(vert_missing_data, vert_unreferenced)); bl_main(); }`;

// overlay_instance.cc: the missing data alert, and the theme's unreferenced vertex color.
const MISSING_DATA = [0xb0 / 255, 0, 0xb0 / 255, 1];
// The View3D overlay's default Weight Paint opacity (weight_paint_mode_opacity), without contour lines.
const OPACITY = 1;
// overlay_paint.hh: an arbitrary light to give a hint of the geometry behind the weights.
const LIGHT = (() => { const l = [0, 0.5, 0.86602]; const n = Math.hypot(...l); return l.map((c) => c / n); })();

function material(scene) {
  const m = new ShaderMaterial('__paint weight', scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
    attributes: ['position', 'normal', 'weight'], uniforms: ['world', 'view', 'viewProjection', 'light_dir', 'opacity', 'draw_contours', 'vert_missing_data', 'vert_unreferenced'],
    samplers: ['colorramp'],
  });
  m.backFaceCulling = false;
  m.setTexture('colorramp', weightRampTexture(scene));
  m.setFloat('opacity', OPACITY);
  m.setInt('draw_contours', 0);
  m.setVector3('light_dir', { x: LIGHT[0], y: LIGHT[1], z: LIGHT[2] });
  m.setVector4('vert_missing_data', { x: MISSING_DATA[0], y: MISSING_DATA[1], z: MISSING_DATA[2], w: MISSING_DATA[3] });
  const [r, g, b] = theme.view_3d.vertex_unreferenced;
  m.setVector4('vert_unreferenced', { x: r, y: g, z: b, w: 1 });
  return m;
}

// The overlay of a mesh object drawn in Weight Paint Mode: `node` as its evaluated `mesh` drew it (each face corner a
// vertex, mesh-batch-buffers.js), `weights` a weight per mesh vertex, or null outside the mode, which disposes `overlay`.
// Returns the overlay, made on first use and updated in place.
export function paintWeightOverlay(node, mesh, weights, overlay) {
  if (!weights) {
    overlay?.dispose();
    return null;
  }
  // At the overlay's full opacity the weights are all the mesh shows (overlay_paint.hh's opaque pass): it is drawn in
  // the mesh's place.
  node.isVisible = false;
  if (!overlay || overlay.isDisposed()) {
    overlay = Object.assign(new Mesh('__paint weights ' + node.name, node.getScene()), { isPickable: false, parent: node, metadata: { overlay: true } });
    overlay.material = material(node.getScene());
    overlay.onDisposeObservable.add(() => { overlay.material.dispose(); node.isVisible = true; });
  }
  Object.assign(new VertexData(), {
    positions: node.getVerticesData('position'), normals: node.getVerticesData('normal'), indices: node.getIndices(),
  }).applyToMesh(overlay, true);
  overlay.setVerticesData('weight', Float32Array.from(mesh.corner_verts, (v) => weights[v]), true, 1);
  return overlay;
}
