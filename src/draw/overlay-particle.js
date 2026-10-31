// Particles as Blender's overlay draws them (overlay_particle.hh), by Blender's own shaders (gpu-library.js `draw`:
// overlay_particle_vert/frag.glsl for dots, overlay_particle_shape_vert/frag.glsl for circles, crosses and axes,
// overlay_particle_hair_vert.glsl for hair), each particle a thin instance whose data is the point the draw cache gives
// the shader (position, value, rotation: main-api.cc main_instances), hair a curves mesh (curves.js) whose strand
// points are the shader's vertex input. What the shaders' create infos declare stands in front of them: the instance's point as
// the shader's vertex input or its storage buffer's one element, the shape's vertex index as gl_VertexID (a dot is
// one point, a shape the vertices it expands to), the view, and the weight ramp texture as a 2D texture one texel
// high. Selection ids, clipping and line anti-aliasing data are not drawn.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { draw } from '../nodes/blender/gpu-library.js';
import { glslShader } from '../nodes/blender/glsl.js';
import { drawView, DRAW_VIEW_GLSL } from './draw-view.js';
import { CURVES_VERTEX_GLSL, CURVES_UNIFORMS, CURVES_SAMPLERS, curvesDefines, bindCurves } from './curves.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';

// blender-port: overlay_shader_shared.hh.
const PART_SHAPE = { AXIS: 1, CIRCLE: 2, CROSS: 3 }, PARTICLE_SHAPE_CIRCLE_RESOLUTION = 7;
// blender-port: overlay_particle.hh draw_expand, the vertices each shape expands a particle to.
const VERTICES = { DOT: 1, AXIS: 6, CROSS: 6, CIRCLE: PARTICLE_SHAPE_CIRCLE_RESOLUTION * 2 };

// Where GLSL ES differs from the desktop GLSL Blender targets: (text, replacement, reason).
const FIXES = [['vec3(axis_id == 0, axis_id == 1, axis_id == 2)', 'vec3(axis_id == 0u, axis_id == 1u, axis_id == 2u)', 'GLSL ES has no implicit int to uint conversion']];
const fixed = (text) => FIXES.reduce((code, [from, to, reason]) => {
  if (!code.includes(from) && text.includes('axis_id')) throw Error(`overlay-particle.js: the fix (${reason}) no longer applies`);
  return code.split(from).join(to);
}, text);

const MACROS = {
  main: 'bl_main', gl_VertexID: 'bl_vertex_id', uniform_buf: 'bl_uniform_buf()',
  M_TAU: '6.283185307179586', PARTICLE_SHAPE_CIRCLE_RESOLUTION: String(PARTICLE_SHAPE_CIRCLE_RESOLUTION),
  PART_SHAPE_AXIS: String(PART_SHAPE.AXIS), PART_SHAPE_CIRCLE: String(PART_SHAPE.CIRCLE), PART_SHAPE_CROSS: String(PART_SHAPE.CROSS),
  OVERLAY_ParticleShape: [['x'], 'x'], select_id_set: [['x'], ''], select_id_output: [['x'], ''], drw_custom_id: [[], '0'],
  view_clipping_distances: [['x'], ''], pack_line_data: [['a', 'b', 'c'], 'vec4(0.0)'], texture: [['t', 'x'], 'texture(t, vec2(x, 0.5))'],
};
const INTERFACE = `flat varying vec4 final_color;
varying vec2 edge_start;
varying vec2 edge_pos;
uniform vec4 ucolor;
uniform int shape_type;
uniform sampler2D weight_tx;`;
const VIEW = `uniform mat4 viewProjection;
uniform mat4 viewinv;
uniform mat4 winmat;
uniform vec2 size_viewport;
${DRAW_VIEW_GLSL}
struct DrawView { mat4 viewinv; mat4 winmat; };
DrawView drw_view() { return DrawView(viewinv, winmat); }
struct UniformBuf { vec2 size_viewport; };
UniformBuf bl_uniform_buf() { return UniformBuf(size_viewport); }
vec3 transform_direction(mat4 m, vec3 v) { return mat3(m) * v; }`;
// The instance's data: its point (position and value, then its rotation).
const VERTEX_PRELUDE = `precision highp float;
precision highp int;
attribute vec3 position;
#include<instancesDeclaration>
${INTERFACE}
${VIEW}
int bl_vertex_id;`;
const FRAGMENT_PRELUDE = `precision highp float;
precision highp int;
${INTERFACE}
layout(location = 0) out vec4 frag_color;
vec4 line_output;`;
const SOURCES = {
  dot: {
    vertex: `${VERTEX_PRELUDE}
vec3 part_pos;
vec4 part_rot;
float part_val;
${fixed(glslShader(draw['overlay_particle_vert.glsl'], 'vertex', MACROS))}
void main() { part_pos = world0.xyz; part_val = world0.w; part_rot = world1; bl_main(); }`,
    fragment: `${FRAGMENT_PRELUDE}\n${glslShader(draw['overlay_particle_frag.glsl'], 'fragment', MACROS)}\nvoid main() { bl_main(); }`,
  },
  shape: {
    vertex: `${VERTEX_PRELUDE}
struct ParticlePointData { vec3 position; float value; vec4 rotation; };
ParticlePointData part_pos[1];
${fixed(glslShader(draw['overlay_particle_shape_vert.glsl'], 'vertex', MACROS))}
void main() { part_pos[0] = ParticlePointData(world0.xyz, world0.w, world1); bl_vertex_id = int(position.x); bl_main(); }`,
    fragment: `${FRAGMENT_PRELUDE}\n${glslShader(draw['overlay_particle_shape_frag.glsl'], 'fragment', MACROS)}\nvoid main() { bl_main(); }`,
  },
};

// blender-port: overlay_instance.cc ensure_weight_ramp_texture (without a custom range): the weight ramp, hue from
// blue to red, gamma corrected.
function weightRamp(scene) {
  const pixels = new Uint8Array(256 * 4), gamma = 1.5;
  for (let i = 0; i < 256; i++) {
    const weight = i / 255, h = (2 / 3) * (1 - weight), v = Math.pow(0.5 + 0.5 * weight, gamma);
    const rgb = [5, 3, 1].map((n) => { const k = (n + h * 6) % 6; return v - v * Math.max(0, Math.min(k, 4 - k, 1)); });
    pixels.set([...rgb.map((c) => Math.round(Math.pow(c, 1 / gamma) * 255)), 255], i * 4);
  }
  return RawTexture.CreateRGBATexture(pixels, 256, 1, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
}

const made = new WeakMap();
const sceneData = (scene) => made.get(scene) ?? made.set(scene, { shapes: new Map(), ramp: null }).get(scene);
// A scene's mesh of a shape's vertices (their indices as positions' x), made once and never drawn itself.
export function particleShapeMesh(scene, shape) {
  const { shapes } = sceneData(scene);
  if (!shapes.has(shape)) {
    const mesh = new Mesh('__shape ' + shape, scene), count = VERTICES[shape];
    Object.assign(new VertexData(), { positions: Array.from({ length: count }, (_, i) => [i, 0, 0]).flat(), indices: Array.from({ length: count }, (_, i) => i) }).applyToMesh(mesh);
    mesh.setEnabled(false);
    shapes.set(shape, mesh);
  }
  return shapes.get(shape);
}
export const isParticleShape = (shape) => shape in VERTICES;

// The overlay's material for a particle system's shape, in its color and display size (ucolor).
export function particleShapeMaterial(scene, shape, color, drawSize) {
  const data = sceneData(scene), kind = shape === 'DOT' ? 'dot' : 'shape';
  const material = new ShaderMaterial('__particle ' + shape, scene, { vertexSource: SOURCES[kind].vertex, fragmentSource: SOURCES[kind].fragment }, {
    attributes: ['position'], uniforms: ['viewProjection', 'viewinv', 'winmat', 'size_viewport', 'ucolor', 'shape_type'], samplers: ['weight_tx'],
  });
  material.fillMode = shape === 'DOT' ? Material.PointListDrawMode : Material.LineListDrawMode;
  material.backFaceCulling = false;
  material.setTexture('weight_tx', (data.ramp ??= weightRamp(scene)));
  material.setVector4('ucolor', { x: color[0], y: color[1], z: color[2], w: drawSize });
  material.setInt('shape_type', PART_SHAPE[shape] ?? 0);
  const viewinv = new Float32Array(16), winmat = new Float32Array(16);
  material.onBindObservable.add(() => {
    const v = drawView(scene), e = material.getEffect();
    viewinv.set([...v.right, 0, ...v.up, 0, ...v.forward, 0, ...v.position, 1]);
    winmat[5] = v.winmat[1];
    e.setMatrices('viewinv', viewinv);
    e.setMatrices('winmat', winmat);
    e.setFloat2('size_viewport', v.size[0], v.size[1]);
  });
  return material;
}

// The overlay's hair: Blender's hair shader over a curves mesh of strands (curvesMesh with no faces), each vertex's
// position and tangent its strand point's (curves_point_get). It shows in Wireframe views, and in every view where the
// system's viewport display is Path (`explicit()`), in the emitter's wire colors as selected (`selected()`, `active()`).
// blender-port: draw_shader_shared.hh eObjectInfoFlag.
const OBJECT = { SELECTED: 1, FROM_SET: 4, ACTIVE: 8 }, THEME = ['wire', 'transform', 'object_active', 'object_selected', 'background'];
const HAIR_VERTEX = `${VERTEX_PRELUDE}
${CURVES_VERTEX_GLSL}
uniform int object_flag;
uniform vec4 theme_colors[${THEME.length}];
const int color_type = 0;
const bool is_transform = false;
const bool use_coloring = true;
struct ObjectInfos { uint flag; vec4 ob_color; float random; };
ObjectInfos drw_object_infos() { return ObjectInfos(uint(object_flag), vec4(1.0), 0.0); }
struct ThemeColors { vec4 wire, transform, active_object, object_select, background; };
struct Theme { ThemeColors colors; };
Theme theme;
bool flag_test(uint flag, uint bit) { return (flag & bit) != 0u; }
vec3 square(vec3 v) { return v * v; }
vec3 drw_point_object_to_world(vec3 p) { return (curves_object_to_world * vec4(p, 1.0)).xyz; }
vec3 drw_normal_object_to_world(vec3 n) { return transpose(inverse(mat3(curves_object_to_world))) * n; }
vec3 drw_world_incident_vector(vec3 P) { return curves_incident_vector(P); }
vec3 pos;
vec3 nor;
${glslShader(draw['overlay_particle_hair_vert.glsl'], 'vertex', { ...MACROS, eObjectInfoFlag: 'uint', OBJECT_SELECTED: `${OBJECT.SELECTED}u`, OBJECT_FROM_SET: `${OBJECT.FROM_SET}u`, OBJECT_ACTIVE: `${OBJECT.ACTIVE}u`, V3D_SHADING_OBJECT_COLOR: '1', V3D_SHADING_RANDOM_COLOR: '3' })}
void main() {
  theme = Theme(ThemeColors(theme_colors[0], theme_colors[1], theme_colors[2], theme_colors[3], theme_colors[4]));
  bl_curves_Point pt = bl_curves_point_get(uint(gl_VertexID));
  pos = pt.P;
  nor = pt.T;
  bl_main();
}`;
export function hairOverlay(scene, mesh, { workbench, explicit, selected, active }) {
  const material = new ShaderMaterial('__particle hair', scene, { vertexSource: HAIR_VERTEX, fragmentSource: SOURCES.shape.fragment }, {
    attributes: ['position'], uniforms: ['viewProjection', 'viewinv', 'winmat', 'size_viewport', 'object_flag', 'theme_colors', ...CURVES_UNIFORMS], samplers: CURVES_SAMPLERS, defines: curvesDefines(0),
  });
  material.setArray4('theme_colors', THEME.flatMap((name) => [...theme[name], 1].slice(0, 4)));
  material.onBindObservable.add(() => {
    const e = material.getEffect(), v = drawView(scene);
    e.setInt('object_flag', (selected() ? OBJECT.SELECTED : 0) | (active() ? OBJECT.ACTIVE : 0));
    e.setFloat2('size_viewport', v.size[0], v.size[1]);
    bindCurves(e, mesh);
  });
  mesh.material = material;
  const shown = scene.onBeforeCameraRenderObservable.add((camera) => { mesh.isVisible = explicit() || workbench?.shading(camera) === 'wire'; });
  mesh.onDisposeObservable.add(() => { scene.onBeforeCameraRenderObservable.remove(shown); material.dispose(); });
}
