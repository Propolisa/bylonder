// Curves as Blender's draw engines draw them (draw_curves.cc, draw_curves_lib.glsl): a curve's evaluated points
// (position and radius, main-api.cc main_curves) and Blender's indirection between the drawn segments and their
// curves as data textures (curvesData), one vertex per Blender batch vertex (curvesMesh), and Blender's own curve
// shape functions placing each vertex as a strand, a camera-facing strip or a cylinder (the scene's Hair shape), its
// normal as Workbench's hair gets it (workbench_prepass.bsl.hh vert_curves). One vertex stage for every engine:
// Workbench's curves materials (workbench.js), the overlay's hair (overlay-particle.js) and, in Material Preview and
// Rendered, the object's own material: through a plugin (CurvesPlugin) for the materials Babylon builds, through the
// geometry blocks Blender's nodes read (CurvesGeometryBlock, CurvesNormalBlock) in a node material. There a strand is
// shaded as EEVEE shades it, as a cylinder (CURVES_NORMAL_GLSL).
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { NodeMaterialBlock } from '@babylonjs/core/Materials/Node/nodeMaterialBlock.js';
import { NodeMaterialBlockConnectionPointTypes as T } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialBlockConnectionPointTypes.js';
import { NodeMaterialBlockTargets as Targets } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialBlockTargets.js';
import { RegisterClass } from '@babylonjs/core/Misc/typeStore.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { glslFunction } from '../nodes/blender/glsl.js';
import { drawView } from './draw-view.js';

// Texels per row of a data texture standing in for a buffer.
const BUFFER_WIDTH = 4096;
// blender-port: draw_curves.cc curves_bind_resources, the vertices a segment of `faces` faces draws.
const vertexPerSegment = (faces) => (faces < 2 ? faces + 1 : (faces + 1) * 2 + 1);
// GLSL as named pieces, each declared once in a shader however many users it has (a node material's blocks emit them
// by name), and as one text.
const library = (names) => names.flatMap(glslFunction);
const glsl = (pieces) => [...new Map(pieces).values()].join('\n');
const CURVES_BABYLON = ['curves_babylon', 'vec3 curves_babylon(vec3 p) { return vec3(p.x, p.z, p.y); }'];

// What draw_curves_infos declares (CURVES_DECLARATIONS), and Blender's functions after it (CURVES_VERTEX_GLSL).
export const CURVES_UNIFORMS = ['curves_object_to_world', 'curves_view_position', 'curves_view_forward', 'curves_persp'];
export const CURVES_SAMPLERS = ['curves_pos_rad_buf', 'curves_indirection_buf', 'curves_time_buf', 'curves_length_buf'];
const CURVES_DECLARATIONS = ['curves_declarations', `
uniform highp sampler2D curves_pos_rad_buf;
uniform highp isampler2D curves_indirection_buf;
uniform highp sampler2D curves_time_buf;
uniform highp sampler2D curves_length_buf;
uniform mat4 curves_object_to_world;
uniform vec3 curves_view_position;
uniform vec3 curves_view_forward;
uniform float curves_persp;`];
// A macro, not overloads on the sampler type: ANGLE's D3D11 backend passes samplers as uint, making them one function.
const CURVES_INFOS = ['curves_infos', `#define bl_buffer_fetch(buffer, i) texelFetch(buffer, ivec2((i) % ${BUFFER_WIDTH}, (i) / ${BUFFER_WIDTH}), 0)
struct DrawCurvesInfos { uint half_cylinder_face_count; uint vertex_per_segment; };
const DrawCurvesInfos drw_curves = DrawCurvesInfos(uint(CURVES_FACES), uint(CURVES_VERTEX_PER_SEGMENT));`];
const CURVES_STAGE = ['curves_vertex', `// blender-port: draw_view_lib.glsl drw_world_incident_vector.
vec3 curves_incident_vector(vec3 P) { return curves_persp == 1.0 ? normalize(curves_view_position - P) : curves_view_forward; }
// The vertex's curve point and shape point (world space), as the engines' vertex stages get them.
bl_curves_Point curves_ws_pt;
bl_curves_ShapePoint curves_shape;
// blender-port: workbench_prepass.bsl.hh vert_curves (its calls of Blender's functions): a vertex of the curves, in
// Blender's world space, its position, normal and its strand's random value.
void curves_vertex(out vec3 P, out vec3 N, out float rand) {
  curves_ws_pt = bl_curves_object_to_world(bl_curves_point_get(uint(gl_VertexID)), curves_object_to_world);
  curves_shape = bl_curves_shape_point_get(curves_ws_pt, curves_incident_vector(curves_ws_pt.P));
  P = curves_shape.P;
  rand = bl_integer_noise(curves_ws_pt.curve_id);
  N = curves_shape.N;
  if (drw_curves.half_cylinder_face_count == 1u) N = curves_shape.N + curves_shape.curve_N;
  else if (drw_curves.half_cylinder_face_count == 0u) N = bl_hair_random_normal(curves_shape.curve_T, curves_shape.curve_B, curves_shape.curve_N, rand);
}
// blender-port: eevee_geom_curves.bsl.hh vertex main, what EEVEE's curves interface carries to the fragment (after
// curves_vertex), with the point's time along its curve and its curve's length (Hair Info's Intercept and Length).
struct CurvesInterface { vec3 curve_N; vec3 binormal; vec3 tangent; float radius; float time_width; float intercept; float len; float strand_id; };
CurvesInterface curves_interface() {
  return CurvesInterface(curves_shape.curve_N, curves_shape.curve_B, curves_shape.curve_T, curves_ws_pt.radius, curves_ws_pt.azimuthal_offset * curves_ws_pt.radius,
    bl_buffer_fetch(curves_time_buf, curves_ws_pt.point_id).r, bl_buffer_fetch(curves_length_buf, curves_ws_pt.curve_id).r, float(curves_ws_pt.curve_id));
}`];
const CURVES_VERTEX_PIECES = [CURVES_DECLARATIONS, CURVES_INFOS,
  ...library(['curves_point_get', 'curves_object_to_world', 'curves_shape_point_get', 'integer_noise', 'hair_random_normal', 'hair_random_material']), CURVES_STAGE, CURVES_BABYLON];
export const CURVES_VERTEX_GLSL = glsl(CURVES_VERTEX_PIECES);
// blender-port: eevee_surf_common.bsl.hh init_globals_curves, a strand shaded as a cylinder: its normal at the
// fragment's place across the strand's width (Blender's world space).
const CURVES_NORMAL_PIECES = [...library(['sin_from_cos']), ['curves_shading_normal', `vec3 curves_shading_normal(vec3 curve_N, vec3 binormal, float time_width, float radius) {
  float cos_theta = time_width / radius;
  return normalize(curve_N * bl_sin_from_cos(cos_theta) + binormal * cos_theta);
}`], CURVES_BABYLON];
const CURVES_NORMAL_GLSL = glsl(CURVES_NORMAL_PIECES);
// Emits pieces into a node material's shader, for meshes drawing curves.
const emitCurves = (state, pieces) => { for (const [key, text] of pieces) state._emitFunction(key, `#ifdef CURVES\n${text}\n#endif\n`, ''); };
// The interface the plugin's vertex stage passes the fragment, what the cylinder's normal needs.
const CURVES_VARYINGS = `varying vec3 curves_v_curve_N;
varying vec3 curves_v_binormal;
varying float curves_v_time_width;
varying float curves_v_radius;`;
const CURVES_VARYINGS_SET = 'void curves_varyings_set() { CurvesInterface c = curves_interface(); curves_v_curve_N = c.curve_N; curves_v_binormal = c.binormal; curves_v_time_width = c.time_width; curves_v_radius = c.radius; }';
export const curvesDefines = (faces) => [`#define CURVES_FACES ${faces}`, `#define CURVES_VERTEX_PER_SEGMENT ${vertexPerSegment(faces)}`];

// A curves mesh's data bound to an effect: its textures, object matrix and the view's position and direction.
export function bindCurves(effect, mesh) {
  const { pos_rad, indirection, time, length, objectToWorld } = mesh.metadata.curves.data, view = drawView(mesh.getScene());
  effect.setTexture('curves_pos_rad_buf', pos_rad);
  effect.setTexture('curves_indirection_buf', indirection);
  effect.setTexture('curves_time_buf', time);
  effect.setTexture('curves_length_buf', length);
  effect.setMatrices('curves_object_to_world', objectToWorld);
  effect.setFloat3('curves_view_position', ...view.position);
  effect.setFloat3('curves_view_forward', ...view.forward);
  effect.setFloat('curves_persp', view.persp ? 1 : 0);
}

// A data texture holding a buffer's values in rows, its last row padded.
function bufferTexture(scene, values, channels, integer) {
  const texels = values.length / channels, height = Math.max(1, Math.ceil(texels / BUFFER_WIDTH));
  const data = new (integer ? Int32Array : Float32Array)(BUFFER_WIDTH * height * channels);
  data.set(values);
  const format = channels === 4 ? (integer ? Constants.TEXTUREFORMAT_RGBA_INTEGER : Constants.TEXTUREFORMAT_RGBA) : integer ? Constants.TEXTUREFORMAT_RED_INTEGER : Constants.TEXTUREFORMAT_RED;
  return new RawTexture(data, BUFFER_WIDTH, height, format, scene, false, false, Texture.NEAREST_SAMPLINGMODE, integer ? Constants.TEXTURETYPE_INT : Constants.TEXTURETYPE_FLOAT);
}

// Curves' data on the GPU, which every mesh drawing them shares (main-api.cc main_curves: posRad, indirection,
// time, length, objectToWorld): Blender's buffers as data textures.
export const curvesData = (scene, { posRad, indirection, time, length, objectToWorld }) => ({
  pos_rad: bufferTexture(scene, posRad, 4, false), indirection: bufferTexture(scene, indirection, 1, true), time: bufferTexture(scene, time, 1, false),
  length: bufferTexture(scene, length, 1, false), segments: indirection.length, objectToWorld: Float32Array.from(objectToWorld),
});
export function disposeCurvesData(data) {
  for (const texture of [data.pos_rad, data.indirection, data.time, data.length]) texture.dispose();
}

// A mesh drawing curves' data with `faces` per segment (the Hair shape's: 0 a strand, 1 a strip, more a cylinder):
// Blender's batch's vertices, each drawn segment's, as a strand's line strip or a strip's or cylinder's triangle strip,
// and their positions Blender's shape functions' (CURVES_VERTEX_GLSL). Called again with a mesh, it takes new data.
export function curvesMesh(scene, name, data, faces, mesh = null) {
  mesh ??= Object.assign(new Mesh(name, scene), { isPickable: false, alwaysSelectAsActiveMesh: true, metadata: {} });
  const count = data.segments * vertexPerSegment(faces);
  if (mesh.getTotalVertices() !== count) {
    mesh.setVerticesData('position', new Float32Array(count * 3), false);
    mesh.setVerticesData('normal', new Float32Array(count * 3), false);
  }
  mesh.isUnIndexed = true;
  mesh.subMeshes = [];
  new SubMesh(0, 0, count, 0, count, mesh);
  mesh.metadata.curves = { ...mesh.metadata.curves, data, faces };
  mesh._getRenderingFillMode = () => (faces === 0 ? Material.LineStripDrawMode : Material.TriangleStripDrawMode);
  return mesh;
}

// The vertex stage of a material Babylon builds (PBR, Standard) for curves meshes, the rest of the material its own.
export class CurvesPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'BlenderCurves', 300, { CURVES: false, CURVES_FACES: 0, CURVES_VERTEX_PER_SEGMENT: 1 });
    this._enable(true);
  }
  // GLSL only: a WGSL material draws no curves (on WebGPU Bylonder's are GLSL, gpu-engine.js materialsFromGLSL).
  static of(material) { return material.pluginManager?.getPlugin('BlenderCurves') ?? (material.shaderLanguage === 0 ? new CurvesPlugin(material) : null); }
  // Whether a material draws curves: a node material by its geometry block, the others with the plugin.
  static draws(material) { return material.getClassName() === 'NodeMaterial' ? material.attachedBlocks.some((b) => b instanceof CurvesGeometryBlock) : !!CurvesPlugin.of(material); }
  getClassName() { return 'CurvesPlugin'; }
  prepareDefines(defines, scene, mesh) {
    const curves = mesh.metadata?.curves;
    defines.CURVES = !!curves;
    defines.CURVES_FACES = curves?.faces ?? 0;
    defines.CURVES_VERTEX_PER_SEGMENT = vertexPerSegment(curves?.faces ?? 0);
  }
  getUniforms() { return { ubo: [], externalUniforms: CURVES_UNIFORMS }; }
  getSamplers(samplers) { samplers.push(...CURVES_SAMPLERS); }
  bindForSubMesh(uniformBuffer, scene, engine, subMesh) {
    if (subMesh.getMesh().metadata?.curves) bindCurves(subMesh.effect ?? subMesh._drawWrapper?.effect, subMesh.getMesh());
  }
  getCustomCode(shaderType) {
    if (shaderType === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef CURVES\n${CURVES_VERTEX_GLSL}\n${CURVES_VARYINGS}\n${CURVES_VARYINGS_SET}\nvec3 curves_P, curves_N; float curves_rand;\n#endif`,
      CUSTOM_VERTEX_UPDATE_POSITION: '#ifdef CURVES\ncurves_vertex(curves_P, curves_N, curves_rand);\npositionUpdated = curves_babylon(curves_P);\ncurves_varyings_set();\n#endif',
      CUSTOM_VERTEX_UPDATE_NORMAL: '#ifdef CURVES\nnormalUpdated = normalize(curves_babylon(curves_N));\n#endif',
    };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef CURVES\n${CURVES_VARYINGS}\n${CURVES_NORMAL_GLSL}\n#endif`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: '#ifdef CURVES\nnormalW = normalize(curves_babylon(curves_shading_normal(curves_v_curve_N, curves_v_binormal, curves_v_time_width, curves_v_radius)));\n#endif',
    };
  }
}

// Curves in a node material, which has no plugins: the geometry Blender's nodes read (shader-nodes.js geometryBlock),
// the mesh's own position and normal or, for a mesh drawing curves (CURVES defined for it), the curves vertex stage's
// position and normal and EEVEE's curves interface (Hair Info's values: none for a mesh).
const CURVES_OUTPUTS = [['position', T.Vector3], ['normal', T.Vector3], ['curveN', T.Vector3], ['binormal', T.Vector3], ['radius', T.Float],
  ['timeWidth', T.Float], ['intercept', T.Float], ['length', T.Float], ['strandId', T.Float], ['isStrand', T.Float]];
const OF_CURVES = { curveN: 'c.curve_N', binormal: 'c.binormal', radius: 'c.radius', timeWidth: 'c.time_width', intercept: 'c.intercept', length: 'c.len', strandId: 'c.strand_id', isStrand: '1.0' };
const curvesFaces = (mesh) => mesh?.metadata?.curves?.faces ?? 0;
export class CurvesGeometryBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Vertex);
    this.registerInput('meshPosition', T.Vector3);
    this.registerInput('meshNormal', T.Vector3);
    for (const [output, type] of CURVES_OUTPUTS) this.registerOutput(output, type);
  }
  getClassName() { return 'CurvesGeometryBlock'; }
  prepareDefines(defines, nodeMaterial, mesh) {
    defines.setValue('CURVES', !!mesh.metadata?.curves, true);
    defines.setValue('CURVES_FACES', curvesFaces(mesh), true);
    defines.setValue('CURVES_VERTEX_PER_SEGMENT', vertexPerSegment(curvesFaces(mesh)), true);
  }
  bind(effect, nodeMaterial, mesh) { if (mesh?.metadata?.curves) bindCurves(effect, mesh); }
  _buildBlock(state) {
    super._buildBlock(state);
    state.sharedData.blocksWithDefines.push(this);
    state.sharedData.bindableBlocks.push(this);
    for (const name of CURVES_UNIFORMS) if (!state.uniforms.includes(name)) state.uniforms.push(name);
    for (const name of CURVES_SAMPLERS) if (!state.samplers.includes(name)) state.samplers.push(name);
    emitCurves(state, CURVES_VERTEX_PIECES);
    const [position, normal] = this._inputs.map((input) => input.associatedVariableName), out = (name) => this._outputs.find((o) => o.name === name);
    const used = this._outputs.filter((o) => o.hasEndpoints);
    let code = used.map((o) => `${state._declareOutput(o)};\n`).join('') + '#ifdef CURVES\n{\nvec3 P, N; float rand;\ncurves_vertex(P, N, rand);\nCurvesInterface c = curves_interface();\n';
    const curves = { position: 'curves_babylon(P)', normal: 'normalize(curves_babylon(N))', ...OF_CURVES };
    const mesh = { position, normal, curveN: 'vec3(0.0)', binormal: 'vec3(0.0)' };
    code += used.map((o) => `${o.associatedVariableName} = ${curves[o.name]};\n`).join('') + '}\n#else\n';
    code += used.map((o) => `${o.associatedVariableName} = ${mesh[o.name] ?? '0.0'};\n`).join('') + '#endif\n';
    state.compilationString += code;
    return this;
  }
}
RegisterClass('BABYLON.CurvesGeometryBlock', CurvesGeometryBlock);

// The normal Blender's nodes shade with: the geometry's, or for curves EEVEE's cylinder normal (Babylon's axes).
export class CurvesNormalBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment);
    for (const input of ['normal', 'curveN', 'binormal']) this.registerInput(input, T.Vector3);
    for (const input of ['timeWidth', 'radius']) this.registerInput(input, T.Float);
    this.registerOutput('output', T.Vector3);
  }
  getClassName() { return 'CurvesNormalBlock'; }
  get output() { return this._outputs[0]; }
  _buildBlock(state) {
    super._buildBlock(state);
    emitCurves(state, CURVES_NORMAL_PIECES);
    const [normal, curveN, binormal, timeWidth, radius] = this._inputs.map((input) => input.associatedVariableName);
    state.compilationString += `${state._declareOutput(this.output)} = ${normal};\n#ifdef CURVES\n${this.output.associatedVariableName} = curves_babylon(curves_shading_normal(${curveN}, ${binormal}, ${timeWidth}, ${radius}));\n#endif\n`;
    return this;
  }
}
RegisterClass('BABYLON.CurvesNormalBlock', CurvesNormalBlock);
