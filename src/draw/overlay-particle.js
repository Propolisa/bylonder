// Particles as Blender's overlay draws them (overlay_particle.hh), by Blender's own shaders (gpu-library.js `draw`:
// overlay_particle_vert/frag.glsl for dots, overlay_particle_shape_vert/frag.glsl for circles, crosses and axes),
// each particle a thin instance whose data is the point the draw cache gives the shader (position, value, rotation:
// main-api.cc main_instances). What the shaders' create infos declare stands in front of them: the instance's point as
// the shader's vertex input or its storage buffer's one element, the shape's vertex index as gl_VertexID (a dot is
// one point, a shape the vertices it expands to), the view, and the weight ramp texture as a 2D texture one texel
// high. Selection ids, clipping and line anti-aliasing data are not drawn.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { draw } from '../nodes/blender/gpu-library.js';
import { glslShader } from '../nodes/blender/glsl.js';
import { drawView, DRAW_VIEW_GLSL } from './draw-view.js';

// overlay_shader_shared.hh.
const PART_SHAPE = { AXIS: 1, CIRCLE: 2, CROSS: 3 }, PARTICLE_SHAPE_CIRCLE_RESOLUTION = 7;
// Vertices each shape expands a particle to (overlay_particle.hh draw_expand).
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

// The weight ramp (overlay_instance.cc ensure_weight_ramp_texture, without a custom range): hue from blue to red,
// gamma corrected.
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
const sceneData = (scene) => made.get(scene) ?? made.set(scene, { shapes: new Map(), ramp: null, segment: null }).get(scene);
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

// A hair path's segment (0 to 1 along Blender's Z, Babylon's Y), which a segment's matrix places, and its unlit lines
// in the material's color.
export function hairSegmentMesh(scene) {
  const data = sceneData(scene);
  if (!data.segment) {
    data.segment = new Mesh('__shape SEGMENT', scene);
    Object.assign(new VertexData(), { positions: [0, 0, 0, 0, 1, 0], indices: [0, 1] }).applyToMesh(data.segment);
    data.segment.setEnabled(false);
  }
  return data.segment;
}
export function hairMaterial(scene, [r, g, b]) {
  const material = new StandardMaterial('__hair', scene);
  Object.assign(material, { disableLighting: true, fillMode: Material.LineListDrawMode });
  material.emissiveColor.set(r, g, b);
  material.diffuseColor.set(0, 0, 0);
  return material;
}
