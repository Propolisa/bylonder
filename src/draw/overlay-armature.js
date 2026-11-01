// Armatures as Blender's overlay draws them, in Object, Edit and Pose Mode: Blender's overlay_armature.cc runs in the
// module (armature-draw.cc) and gives its buffers, which Babylon draws with Blender's own shaders (gpu-library.js
// `draw`: overlay_armature_*, overlay_extra_* for axes and relationship lines). Each buffer is a mesh of its shape
// (overlay-shape.js BONE_SHAPES, Blender's ShapeCache) drawn once per instance, the buffer's data the instance
// attributes as each shader reads data_buf[gl_InstanceID]; the shaders Blender expands from lines (outlines, custom
// shape wires) read their points from a data texture by gl_VertexID. The passes keep Blender's order, states and alpha
// (Armatures::begin_sync), opaque or transparent as the overlay chose for the view (X-ray, Wireframe); In Front
// armatures draw over the scene. Bone names are drawn as the overlay's text over each view. What the shaders' create
// infos declare stands in front of them, in Blender's axes: Babylon's view and projection as Blender's viewmat and
// winmat. Selection ids, clipping and line anti-aliasing data are not drawn.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { VertexBuffer, Buffer } from '@babylonjs/core/Buffers/buffer.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { draw } from '../nodes/blender/gpu-library.js';
import { glslShader } from '../nodes/blender/glsl.js';
import { BONE_SHAPES, SHAPES, STICK, VCLASS } from './overlay-shape.js';
import { armatureDraw, armatureShapeMesh, DRAW } from '../blenkernel/armature/armature.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';
import { drawCallbackAdd, tagRedraw } from './overlay-tool.js';

// Where GLSL ES differs from the desktop GLSL Blender targets: (text, replacement, reason).
const FIXES = [
  ['gl_Position = float4(NAN_FLT);', 'gl_Position = vec4(0.0, 0.0, -2.0, 1.0);', 'GLSL ES has no NaN literal: a vertex past the near plane is clipped the same'],
  ['const float4x4 sphere_matrix = ', 'float4x4 sphere_matrix = ', 'a GLSL ES constant takes a constant expression'],
  [/\b(emit_vertex|do_vertex)\((\d),/g, '$1($2u,', 'GLSL ES has no implicit int to uint conversion'],
  ['theme.sizes.edge * 2)', 'theme.sizes.edge * 2.0)', 'GLSL ES has no implicit int to float conversion'],
];
const fixed = (text) => FIXES.reduce((code, [from, to]) => code.replaceAll(from, to), text);

// blender-port: overlay_instance.cc Resources::update_theme_settings, the sizes these shaders read.
const SIZES = { pixel: 1, edge: Math.max(1, theme.edge_width) / 2 };
const MACROS = {
  main: 'bl_main', gl_VertexID: 'bl_vertex_id', gl_InstanceID: '0', uniform_buf: 'bl_uniform_buf()', theme: 'bl_uniform_buf()',
  select_id_set: [['x'], ''], select_id_output: [['x'], ''], view_clipping_distances: [['x'], ''], gpu_discard_fragment: [[], 'discard'],
  to_float3x3: [['m'], 'mat3(m)'], saturate: [['a'], 'clamp(a, 0.0, 1.0)'], transform_point: [['m', 'p'], '((m) * vec4(p, 1.0)).xyz'], safe_rcp: [['a'], '((a) != 0.0 ? 1.0 / (a) : 0.0)'],
  gpu_index_load: [['i'], '(i)'], gpu_attr_load_float3: [['buf', 'attr', 'i'], 'bl_point(i)'],
  WIRE_WIDTH_COMPRESSION: '16.0', LINE_SMOOTH_START: '(0.5 - 0.5641895835477563 * 1.05)', LINE_SMOOTH_END: '(0.5 + 0.5641895835477563 * 1.05)',
  StickBoneFlag: 'uint', ...Object.fromEntries(Object.entries(STICK).map(([name, bit]) => [name, `${bit}u`])),
  ...Object.fromEntries(Object.entries(VCLASS).map(([name, bit]) => [`VCLASS_${name}`, String(bit)])),
};
// blender-port: draw_view_lib.glsl, the view's matrices and the functions the shaders call.
const VIEW = `uniform mat4 viewmat;
uniform mat4 viewinv;
uniform mat4 winmat;
uniform vec2 size_viewport;
uniform float pixel_fac;
uniform float alpha;
struct DrawView { mat4 viewmat; mat4 viewinv; mat4 winmat; };
DrawView drw_view() { return DrawView(viewmat, viewinv, winmat); }
struct ThemeSizes { float pixel; float edge; };
struct ThemeColors { vec4 camera_path; };
struct UniformBuf { vec2 size_viewport; vec2 size_viewport_inv; float pixel_fac; ThemeSizes sizes; ThemeColors colors; };
UniformBuf bl_uniform_buf() { return UniformBuf(size_viewport, 1.0 / size_viewport, pixel_fac, ThemeSizes(${SIZES.pixel.toFixed(4)}, ${SIZES.edge.toFixed(4)}), ThemeColors(vec4(0.0))); }
bool flag_test(uint flag, uint bit) { return (flag & bit) != 0u; }
bool flag_test(int flag, int bit) { return (flag & bit) != 0; }
vec3 drw_normal_world_to_view(vec3 N) { return mat3(viewmat) * N; }
vec3 drw_perspective_divide(vec4 hs_P) { return hs_P.xyz / hs_P.w; }
vec4 drw_point_view_to_homogenous(vec3 vP) { return winmat * vec4(vP, 1.0); }
vec3 drw_point_world_to_view(vec3 P) { return (viewmat * vec4(P, 1.0)).xyz; }
vec4 drw_point_world_to_homogenous(vec3 P) { return winmat * (viewmat * vec4(P, 1.0)); }
vec3 drw_point_object_to_world(vec3 P) { return P; }
float drw_depth_view_to_screen(float v_depth) { vec4 h = winmat * vec4(0.0, 0.0, v_depth, 1.0); return h.z / h.w * 0.5 + 0.5; }`;

// What each instance's data is, as the shader's storage buffer element, from its instance attributes (inst0, ...).
const DATA = {
  bone: { vec4s: 4, glsl: 'mat4 data_buf[1];', fill: 'data_buf[0] = mat4(inst0, inst1, inst2, inst3);' },
  envelope: { vec4s: 5, glsl: 'struct BoneEnvelopeData { vec4 head_sphere; vec4 tail_sphere; vec4 bone_color_and_wire_width; vec4 state_color; vec4 x_axis; };\nBoneEnvelopeData data_buf[1];', fill: 'data_buf[0] = BoneEnvelopeData(inst0, inst1, inst2, inst3, inst4);' },
  stick: { vec4s: 6, glsl: 'struct BoneStickData { vec4 bone_start; vec4 bone_end; vec4 wire_color; vec4 bone_color; vec4 head_color; vec4 tail_color; };\nBoneStickData data_buf[1];', fill: 'data_buf[0] = BoneStickData(inst0, inst1, inst2, inst3, inst4, inst5);' },
  extra: { vec4s: 5, glsl: 'struct ExtraInstanceData { vec4 color_; mat4 object_to_world; };\nExtraInstanceData data_buf[1];', fill: 'data_buf[0] = ExtraInstanceData(inst0, mat4(inst1, inst2, inst3, inst4));' },
  vertex: { vec4s: 0, glsl: 'struct VertexData { vec4 pos_; vec4 color_; };\nVertexData data_buf[1];', fill: 'data_buf[0] = VertexData(vec4(position, 0.0), vcolor);' },
};
// The shaders' interfaces (overlay_armature_infos.hh, overlay_extra_infos.hh); GLSL ES has no noperspective.
const IFACE = {
  wire: 'flat varying vec4 final_color;\nflat varying vec2 edge_start;\nvarying vec2 edge_pos;',
  sphere_solid: 'flat varying vec3 final_state_color;\nflat varying vec3 final_bone_color;\nflat varying vec4 sphere_matrix0;\nflat varying vec4 sphere_matrix1;\nflat varying vec4 sphere_matrix2;\nflat varying vec4 sphere_matrix3;\nvarying vec3 view_position;',
  shape_solid: 'varying vec4 final_color;\nflat varying int inverted;',
  shape_wire: 'flat varying vec4 final_color;\nflat varying float wire_width;\nvarying float edge_coord;',
  envelope_solid: 'flat varying vec3 final_state_color;\nflat varying vec3 final_bone_color;\nvarying vec3 view_normal;',
  stick: 'varying float color_fac;\nflat varying vec4 final_wire_color;\nflat varying vec4 final_inner_color;',
  extra: 'varying vec2 edge_pos;\nflat varying vec2 edge_start;\nflat varying vec4 final_color;',
  extra_wire: 'varying vec2 stipple_coord;\nflat varying vec2 stipple_start;\nflat varying vec4 final_color;',
};
// Per shader: its files, data, interface, vertex inputs (name: size) and push constants beyond the view's.
const SHADERS = {
  shape_solid: { vertex: 'overlay_armature_shape_solid_vert.glsl', fragment: 'overlay_armature_shape_solid_frag.glsl', data: 'bone', iface: 'shape_solid', inputs: { position: 3, nor: 3 } },
  shape_outline: { vertex: 'overlay_armature_shape_outline_vert.glsl', fragment: 'overlay_armature_wire_frag.glsl', data: 'bone', iface: 'wire', inputs: { position: 1 }, points: true },
  shape_wire: { vertex: 'overlay_armature_shape_wire_vert.glsl', fragment: 'overlay_armature_shape_wire_frag.glsl', data: 'bone', iface: 'shape_wire', inputs: { position: 1 }, points: true, uniforms: ['do_smooth_wire', 'use_arrow_drawing'] },
  sphere_solid: { vertex: 'overlay_armature_sphere_solid_vert.glsl', fragment: 'overlay_armature_sphere_solid_frag.glsl', data: 'bone', iface: 'sphere_solid', inputs: { position: 2 } },
  sphere_outline: { vertex: 'overlay_armature_sphere_outline_vert.glsl', fragment: 'overlay_armature_wire_frag.glsl', data: 'bone', iface: 'wire', inputs: { position: 2 } },
  envelope_solid: { vertex: 'overlay_armature_envelope_solid_vert.glsl', fragment: 'overlay_armature_envelope_solid_frag.glsl', data: 'envelope', iface: 'envelope_solid', inputs: { position: 3 }, uniforms: ['is_distance'] },
  envelope_outline: { vertex: 'overlay_armature_envelope_outline_vert.glsl', fragment: 'overlay_armature_wire_frag.glsl', data: 'envelope', iface: 'wire', inputs: { position: 2, pos1: 2, pos2: 2 } },
  stick: { vertex: 'overlay_armature_stick_vert.glsl', fragment: 'overlay_armature_stick_frag.glsl', data: 'stick', iface: 'stick', inputs: { position: 2, vclass: 1 } },
  wire: { vertex: 'overlay_armature_wire_vert.glsl', fragment: 'overlay_armature_wire_frag.glsl', data: 'vertex', iface: 'wire', inputs: { position: 3, vcolor: 4 } },
  dof: { vertex: 'overlay_armature_dof_vert.glsl', fragment: 'overlay_armature_dof_solid_frag.glsl', data: 'extra', iface: 'wire', inputs: { position: 2 } },
  extra: { vertex: 'overlay_extra_vert.glsl', fragment: 'overlay_extra_frag.glsl', data: 'extra', iface: 'extra', inputs: { position: 3, vclass: 1 } },
  extra_wire: { vertex: 'overlay_extra_wire_vert.glsl', fragment: 'overlay_extra_wire_frag.glsl', data: 'vertex', iface: 'extra_wire', inputs: { position: 3, vcolor: 4 }, uniforms: ['colorid'] },
};
// Blender's overlay writes its linear colors into an sRGB framebuffer; Babylon's canvas takes display colors.
// blender-port: math_color.cc linearrgb_to_srgb.
const LINEAR_TO_SRGB = `vec3 linear_to_srgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}`;
// The attributes a shader's inputs are read from: Babylon draws a mesh by its `position`.
const INPUT_MACROS = { pos: 'position', pos0: 'position', vclass: 'int(vclass)', color: 'vcolor' };
const ATTRIBUTE_TYPES = { 1: 'float', 2: 'vec2', 3: 'vec3', 4: 'vec4' };

function shaderSources(name) {
  const { vertex, fragment, data, iface, inputs, points, uniforms = [] } = SHADERS[name], { vec4s, glsl, fill } = DATA[data];
  const instances = Array.from({ length: vec4s }, (_, i) => `attribute vec4 inst${i};`).join('\n');
  const attributes = Object.entries(inputs).map(([input, size]) => `attribute ${ATTRIBUTE_TYPES[size]} ${input};`).join('\n');
  const constants = uniforms.map((u) => `uniform ${u === 'colorid' ? 'int' : 'bool'} ${u};`).join('\n');
  // A line's vertices are its data, each vertex's the shader's one element.
  const macros = { ...MACROS, ...INPUT_MACROS, ...(data === 'vertex' ? { gl_VertexID: '0' } : {}) };
  const common = draw['overlay_common_lib.glsl'];
  return {
    vertex: `precision highp float;
precision highp int;
${attributes}
${instances}
${VIEW}
${constants}
${IFACE[iface]}
${glsl}
int bl_vertex_id;
${points ? 'uniform sampler2D points_tx;\nvec3 bl_point(uint i) { return texelFetch(points_tx, ivec2(int(i) % 4096, int(i) / 4096), 0).xyz; }' : ''}
${glslShader(`${common}\n${fixed(draw[vertex])}`, 'vertex', macros)}
void main() { ${fill} bl_vertex_id = ${points ? 'int(position)' : 'gl_VertexID'}; bl_main(); }`,
    fragment: `precision highp float;
precision highp int;
${VIEW}
${constants}
${IFACE[iface]}
layout(location = 0) out vec4 frag_color;
vec4 line_output;
${glslShader(`${common}\n${fixed(draw[fragment])}`, 'fragment', macros)}
${LINEAR_TO_SRGB}
void main() { bl_main(); frag_color.rgb = linear_to_srgb(frag_color.rgb); }`,
    attributes: [...Object.keys(inputs), ...Array.from({ length: vec4s }, (_, i) => `inst${i}`)],
    uniforms: ['viewmat', 'viewinv', 'winmat', 'size_viewport', 'pixel_fac', 'alpha', ...uniforms],
  };
}

// The vertices each shape draws, by its shader's inputs, and how: Blender's primitive, or for the shaders that expand
// lines, the points they read and the vertices drawn per line (2 per outline adjacency, 6 per wire line).
const LINES = Material.LineListDrawMode, STRIP = Material.LineStripDrawMode, TRIS = Material.TriangleFillMode, TRI_STRIP = Material.TriangleStripDrawMode;
const fan = (verts) => verts.slice(1, -1).flatMap((_, i) => [verts[0], verts[i + 1], verts[i + 2]]);
const SHAPE_VERTICES = {
  bone_octahedron: () => { const { positions, normals } = BONE_SHAPES.bone_octahedron(); return { mode: TRIS, inputs: { position: positions, nor: normals } }; },
  bone_box: () => { const { positions, normals } = BONE_SHAPES.bone_box(); return { mode: TRIS, inputs: { position: positions, nor: normals } }; },
  bone_octahedron_wire: () => adjacency(BONE_SHAPES.bone_octahedron()),
  bone_box_wire: () => adjacency(BONE_SHAPES.bone_box()),
  bone_sphere: () => ({ mode: TRIS, inputs: { position: fan(BONE_SHAPES.bone_sphere()).flat() } }),
  bone_sphere_wire: () => ({ mode: STRIP, inputs: { position: BONE_SHAPES.bone_sphere().flat() } }),
  bone_stick: () => { const verts = BONE_SHAPES.bone_stick(); return { mode: TRIS, inputs: { position: verts.flatMap(([x, y]) => [x, y]), vclass: verts.map((v) => v[2]) } }; },
  bone_envelope: () => ({ mode: TRI_STRIP, inputs: { position: BONE_SHAPES.bone_envelope().flat() } }),
  bone_envelope_wire: () => { const verts = BONE_SHAPES.bone_envelope_wire(); return { mode: STRIP, inputs: { position: verts.flatMap((v) => v[0]), pos1: verts.flatMap((v) => v[1]), pos2: verts.flatMap((v) => v[2]) } }; },
  bone_degrees_of_freedom: () => ({ mode: TRIS, inputs: { position: BONE_SHAPES.bone_degrees_of_freedom().flat() } }),
  bone_degrees_of_freedom_wire: () => ({ mode: STRIP, inputs: { position: BONE_SHAPES.bone_degrees_of_freedom_wire().flat() } }),
  arrows: () => { const verts = SHAPES.arrows(); return { mode: LINES, inputs: { position: verts.flatMap((v) => v.slice(0, 3)), vclass: verts.map((v) => v[3]) } }; },
};
// A solid shape's outline: each adjacency's four points, two vertices drawn per adjacency.
function adjacency({ positions, adjacency: indices }) {
  return expanded(indices.flatMap((i) => positions.slice(i * 3, i * 3 + 3)), indices.length / 4, 2, LINES);
}
// Points a shader reads by index (gpu_attr_load_float3), and the vertices it draws for `primitives` of them.
const expanded = (points, primitives, perPrimitive, mode) => ({ mode, points, inputs: { position: Array.from({ length: primitives * perPrimitive }, (_, i) => i) } });
// An empty custom shape's lines (overlay-shape.js SHAPES), for the wire shader: 6 vertices per line.
const emptyShape = (name) => { const verts = SHAPES[name](); return expanded(verts.flatMap((v) => v.slice(0, 3)), verts.length / 2, 6, TRIS); };
// A custom shape's mesh by its batch (armature-draw.cc armature_shape_mesh).
function customShape({ mesh, geometry }) {
  if (SHAPES[geometry]) return emptyShape(geometry);
  const { positions, normals, indices } = armatureShapeMesh(mesh, geometry), at = (i) => [...positions.subarray(i * 3, i * 3 + 3)];
  if (geometry === 'surface') return { mode: TRIS, inputs: { position: [...indices].flatMap(at), nor: [...indices].flatMap((i) => [...normals.subarray(i * 3, i * 3 + 3)]) } };
  if (geometry === 'edge_detection') return expanded([...indices].flatMap(at), indices.length / 4, 2, LINES);
  return expanded([...indices].flatMap(at), indices.length / 2, 6, TRIS);
}

// blender-port: overlay_armature.hh Armatures::begin_sync, the passes in their order: the buffer each draws, its
// shader and shape, and its state in the opaque and the transparent set (alpha, depth write, blending, culling).
const DEPTH = { depthWrite: true }, BLEND = { depthWrite: true, blend: Constants.ALPHA_COMBINE }, ADD = { depthWrite: false, blend: Constants.ALPHA_ADD };
const SEE_THROUGH = (alpha) => ({ depthWrite: false, blend: Constants.ALPHA_COMBINE, alpha });
const PASSES = [
  { buffer: 'envelope_distance', shader: 'envelope_solid', shape: 'bone_envelope', opaque: { ...ADD, cull: 'front', is_distance: true } },
  { buffer: 'degrees_of_freedom_fill', shader: 'dof', shape: 'bone_degrees_of_freedom', opaque: ADD },
  { buffer: 'sphere_fill', shader: 'sphere_solid', shape: 'bone_sphere', opaque: DEPTH, transparent: SEE_THROUGH(0.4) },
  { buffer: 'octahedral_fill', shader: 'shape_solid', shape: 'bone_octahedron', opaque: DEPTH, transparent: SEE_THROUGH(0.6) },
  { buffer: 'bbones_fill', shader: 'shape_solid', shape: 'bone_box', opaque: DEPTH, transparent: SEE_THROUGH(0.6) },
  { custom: 'fill', shader: 'shape_solid', opaque: DEPTH, transparent: SEE_THROUGH(0.6) },
  { buffer: 'sphere_outline', shader: 'sphere_outline', shape: 'bone_sphere_wire', opaque: DEPTH },
  { buffer: 'octahedral_outline', shader: 'shape_outline', shape: 'bone_octahedron_wire', opaque: DEPTH },
  { buffer: 'bbones_outline', shader: 'shape_outline', shape: 'bone_box_wire', opaque: DEPTH },
  { custom: 'outline', shader: 'shape_outline', opaque: DEPTH },
  { custom: 'wire', shader: 'shape_wire', opaque: BLEND },
  { buffer: 'degrees_of_freedom_wire', shader: 'dof', shape: 'bone_degrees_of_freedom_wire', opaque: BLEND },
  { buffer: 'stick', shader: 'stick', shape: 'bone_stick', opaque: BLEND },
  { buffer: 'envelope_fill', shader: 'envelope_solid', shape: 'bone_envelope', opaque: { ...DEPTH, cull: 'back' }, transparent: { ...SEE_THROUGH(0.6), cull: 'back' } },
  { buffer: 'envelope_outline', shader: 'envelope_outline', shape: 'bone_envelope_wire', opaque: { ...DEPTH, cull: 'back' } },
  { buffer: 'wire', shader: 'wire', opaque: { ...DEPTH, cull: 'back' } },
  { buffer: 'arrows', shader: 'extra', shape: 'arrows', opaque: { ...DEPTH, cull: 'back' } },
  { buffer: 'relations', shader: 'extra_wire', opaque: { ...DEPTH, cull: 'back' } },
];
const stateOf = (pass, transparent) => ({ alpha: 1, ...pass.opaque, ...(transparent ? pass.transparent : {}) });

// The view's matrices in Blender's axes: Babylon's (x, y, z) is Blender's (x, z, y) and Babylon's camera looks down its
// +Z, Blender's down -Z, so viewmat = flip * view * swap and winmat = projection * flip.
const SWAP = Matrix.FromArray([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]), FLIP = Matrix.FromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
const viewOf = new WeakMap();
function blenderView(scene) {
  const camera = scene.activeCamera, renderId = scene.getRenderId(), cached = viewOf.get(scene);
  if (cached?.camera === camera && cached.renderId === renderId) return cached;
  // Babylon multiplies row vectors: a.multiply(b) applies a, then b.
  const viewmat = SWAP.multiply(camera.getViewMatrix()).multiply(FLIP), winmat = FLIP.multiply(camera.getProjectionMatrix());
  const engine = scene.getEngine(), size = [engine.getRenderWidth() * camera.viewport.width, engine.getRenderHeight() * camera.viewport.height];
  const p = camera.getProjectionMatrix().m;
  const view = { camera, renderId, viewmat, winmat, viewinv: viewmat.clone().invert(), size, pixel_fac: 2 / (Math.min(Math.abs(p[0]), Math.abs(p[5])) * Math.max(...size)) };
  viewOf.set(scene, view);
  return view;
}

const made = new WeakMap();
const sceneData = (scene) => made.get(scene) ?? made.set(scene, { sources: new Map(), materials: new Map(), shapes: new Map() }).get(scene);
// A pass's material in the scene, made once: its shader and state.
function passMaterial(scene, pass, transparent) {
  const { sources, materials } = sceneData(scene), state = stateOf(pass, transparent), key = `${pass.buffer ?? pass.custom}:${transparent}`;
  if (materials.has(key)) return materials.get(key);
  if (!sources.has(pass.shader)) sources.set(pass.shader, shaderSources(pass.shader));
  const { vertex, fragment, attributes, uniforms } = sources.get(pass.shader);
  const material = new ShaderMaterial(`__armature ${key}`, scene, { vertexSource: vertex, fragmentSource: fragment },
    { attributes, uniforms, samplers: SHADERS[pass.shader].points ? ['points_tx'] : [], needAlphaBlending: !!state.blend });
  Object.assign(material, { backFaceCulling: !!state.cull, cullBackFaces: state.cull !== 'front', disableDepthWrite: !state.depthWrite, alphaMode: state.blend ?? Constants.ALPHA_DISABLE });
  material.setFloat('alpha', state.alpha);
  if (uniforms.includes('is_distance')) material.setInt('is_distance', state.is_distance ? 1 : 0);
  if (uniforms.includes('do_smooth_wire')) material.setInt('do_smooth_wire', 1);
  if (uniforms.includes('colorid')) material.setInt('colorid', 0);
  material.onBindObservable.add((mesh) => {
    const effect = material.getEffect(), view = blenderView(scene);
    effect.setMatrix('viewmat', view.viewmat);
    effect.setMatrix('viewinv', view.viewinv);
    effect.setMatrix('winmat', view.winmat);
    effect.setFloat2('size_viewport', view.size[0], view.size[1]);
    effect.setFloat('pixel_fac', view.pixel_fac);
    if (uniforms.includes('use_arrow_drawing')) effect.setInt('use_arrow_drawing', mesh.metadata?.arrows ? 1 : 0);
    if (mesh.metadata?.points) effect.setTexture('points_tx', mesh.metadata.points);
  });
  materials.set(key, material);
  return material;
}
// A data texture of points (4096 a row), for the shaders that read them by index.
function pointsTexture(scene, points) {
  const count = points.length / 3, width = Math.min(4096, Math.max(1, count)), height = Math.max(1, Math.ceil(count / 4096));
  const texels = new Float32Array(width * height * 4);
  for (let i = 0; i < count; i++) texels.set(points.slice(i * 3, i * 3 + 3), i * 4);
  return RawTexture.CreateRGBATexture(texels, width, height, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
}

// One pass's instances of one shape: a mesh of the shape's vertices with the buffer's data as instance attributes.
function passMesh(scene, name, shape, pass, transparent, { data, count }) {
  const engine = scene.getEngine(), mesh = new Mesh(`__armature ${name}`, scene);
  Object.assign(mesh, { isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true, metadata: { overlay: true, arrows: name === 'arrows' } });
  const inputs = SHADERS[pass.shader].inputs;
  for (const [input, values] of Object.entries(shape.inputs)) mesh.setVerticesBuffer(new VertexBuffer(engine, Float32Array.from(values), input, { size: inputs[input] }));
  const vertices = shape.inputs.position.length / inputs.position, vec4s = DATA[SHADERS[pass.shader].data].vec4s;
  if (vec4s) {
    const buffer = new Buffer(engine, data, false, vec4s * 4, false, true);
    for (let i = 0; i < vec4s; i++) mesh.setVerticesBuffer(buffer.createVertexBuffer(`inst${i}`, i * 4, 4));
    mesh.forcedInstanceCount = count;
  }
  if (shape.points) mesh.metadata.points = shape.texture;
  mesh.isUnIndexed = true;
  mesh.subMeshes = [];
  new SubMesh(0, 0, vertices, 0, vertices, mesh);
  mesh.material = passMaterial(scene, pass, transparent);
  mesh.material.fillMode = shape.mode;
  mesh._getRenderingFillMode = (fillMode) => fillMode;
  return mesh;
}
// A shape with the texture of the points it reads, if any.
const withTexture = (scene, shape) => Object.assign(shape, shape.points ? { texture: pointsTexture(scene, shape.points) } : {});
// A shape's vertices, made once per scene.
function sceneShape(scene, key, make) {
  const { shapes } = sceneData(scene);
  if (!shapes.has(key)) shapes.set(key, withTexture(scene, make()));
  return shapes.get(key);
}

// The meshes an armature's draw data makes, in the passes' order.
function drawMeshes(scene, drawn) {
  const meshes = [];
  for (const pass of PASSES) {
    if (pass.custom) {
      for (const custom of drawn.customs.filter((c) => c.pass === pass.custom && c.ids.length)) {
        const empty = !!SHAPES[custom.geometry];
        const shape = empty ? sceneShape(scene, `custom ${custom.geometry}`, () => emptyShape(custom.geometry)) : withTexture(scene, customShape(custom));
        const mesh = passMesh(scene, custom.geometry, shape, pass, drawn.transparent, { data: custom.data, count: custom.ids.length });
        if (!empty && shape.texture) mesh.onDisposeObservable.add(() => shape.texture.dispose());
        meshes.push(mesh);
      }
      continue;
    }
    const { data, ids } = drawn.buffers[pass.buffer];
    if (!ids.length) continue;
    // Lines are vertex pairs of position and color, drawn as they are.
    const shape = pass.shape ? sceneShape(scene, pass.shape, SHAPE_VERTICES[pass.shape])
      : { mode: LINES, inputs: { position: [...data].filter((_, i) => i % 8 < 3), vcolor: [...data].filter((_, i) => i % 8 >= 4) } };
    meshes.push(passMesh(scene, pass.buffer, shape, pass, drawn.transparent, { data, count: ids.length }));
  }
  return meshes;
}

// Bone names as the overlay's text cache draws them (draw_manager_text.cc DRW_text_cache_draw): at their point, 10
// pixels right, in their color over a shadow, in the interface's font at its 11 points.
const FONT = '11px "DejaVu Sans", sans-serif';
function drawNames(ctx, region, texts) {
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  for (const { co, color, name } of texts) {
    const p = region.project(co);
    if (!p) continue;
    const [x, y] = region.toRegion(p);
    ctx.fillStyle = 'rgb(0 0 0 / 0.8)';
    ctx.fillText(name, x + 11, y + 1);
    ctx.fillStyle = `rgb(${color[0]} ${color[1]} ${color[2]} / ${color[3] / 255})`;
    ctx.fillText(name, x + 10, y);
  }
}

// The overlay's own redraw of an armature: Main evaluated it (main-view.js), so its draw data is synced again.
const revisions = new WeakMap();
export const armatureChanged = (node) => revisions.set(node, (revisions.get(node) ?? 0) + 1);

// The armatures' overlay in a scene. options: sync() (the scene's Main sync, createMainSync), objects(), visible(node),
// selected(node), active(node), wake() (the views draw again). Each view calls setEnabled(value, { shading, xray })
// right before it renders.
export function createArmatureOverlay(scene, { sync, objects, visible, selected, active, wake }) {
  // Per armature: what the last sync was for, and its draw data and meshes per variant (opaque or transparent view).
  const entries = new Map();
  const flags = (transparent) => DRAW.SHOW_RELATIONS | DRAW.SHOW_OUTLINE | DRAW.SHOW_TEXT | (transparent ? DRAW.TRANSPARENT : 0);
  const clear = (entry) => { for (const variant of Object.values(entry.variants)) variant.meshes.forEach((mesh) => mesh.dispose()); entry.variants = {}; };
  function variant(entry, transparent) {
    const main = sync();
    if (!entry.variants[transparent]) {
      const drawn = armatureDraw(main.blender.C, main.objectOf(entry.node), flags(transparent));
      const meshes = drawMeshes(scene, drawn);
      meshes.forEach((mesh) => { mesh.renderingGroupId = drawn.inFront ? 1 : 0; });
      entry.variants[transparent] = { drawn, meshes };
      entry.texts = drawn.texts;
      tagRedraw();
    }
    // A view may stop drawing before new meshes' shaders are ready.
    if (entry.variants[transparent].meshes.some((mesh) => !mesh.isReady(true))) wake();
    return entry.variants[transparent];
  }
  // Once a frame: armatures Main evaluated again, or whose selection changed (pushed into Main first), sync anew.
  const frame = scene.getEngine().onBeginFrameObservable.add(() => {
    const main = sync(), present = new Set();
    let flushed = false;
    for (const node of objects()) {
      if (!node.metadata?.wbCreation?.armature || !main?.objectOf(node)) continue;
      present.add(node);
      const entry = entries.get(node) ?? entries.set(node, { node, variants: {}, key: null, chosen: null, texts: [] }).get(node);
      const chosen = `${selected(node)}:${active(node)}`;
      if (chosen !== entry.chosen && entry.chosen !== null && !flushed) { main.flush(); flushed = true; }
      const key = `${revisions.get(node) ?? 0}:${node.metadata.wbMode}:${chosen}`;
      if (key === entry.key) continue;
      Object.assign(entry, { key, chosen });
      clear(entry);
      wake();
    }
    for (const [node, entry] of entries) if (!present.has(node)) { clear(entry); entries.delete(node); }
  });
  const names = drawCallbackAdd((ctx, region) => { for (const entry of entries.values()) if (visible(entry.node)) drawNames(ctx, region, entry.texts); });
  return {
    // Called per view right before it renders, with its state (view3d.js).
    setEnabled(value, { shading, xray } = {}) {
      // Armatures::begin_sync draw_transparent: Wireframe, or X-ray in Solid.
      const transparent = shading === 'wire' || (shading === 'solid' && !!xray);
      for (const entry of entries.values()) {
        const show = value && visible(entry.node);
        if (show) variant(entry, transparent);
        for (const [key, { meshes }] of Object.entries(entry.variants)) meshes.forEach((mesh) => mesh.setEnabled(show && key === String(transparent)));
      }
    },
    dispose() {
      scene.getEngine().onBeginFrameObservable.remove(frame);
      names();
      for (const entry of entries.values()) clear(entry);
      entries.clear();
    },
  };
}
