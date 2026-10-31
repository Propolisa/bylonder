// Curves as Blender's draw engines draw them (draw_curves.cc, draw_curves_lib.glsl): a curve's evaluated points
// (position and radius, main-api.cc main_curves) and Blender's indirection between the drawn segments and their
// curves as data textures (curvesData), one vertex per Blender batch vertex (curvesMesh), and Blender's own curve
// shape functions placing each vertex as a strand, a camera-facing strip or a cylinder (the scene's Hair shape), its
// normal as Workbench's hair gets it (workbench_prepass.bsl.hh vert_curves). One vertex stage for every engine:
// Workbench's curves materials (workbench.js), the overlay's hair (overlay-particle.js) and, in Material Preview and
// Rendered, the object's own material through a plugin (CurvesPlugin).
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { glslFunction } from '../nodes/blender/glsl.js';
import { drawView } from './draw-view.js';

// Texels per row of a data texture standing in for a buffer.
const BUFFER_WIDTH = 4096;
// blender-port: draw_curves.cc curves_bind_resources, the vertices a segment of `faces` faces draws.
const vertexPerSegment = (faces) => (faces < 2 ? faces + 1 : (faces + 1) * 2 + 1);
const library = (names) => [...new Map(names.flatMap(glslFunction)).values()].join('\n');

// What draw_curves_infos declares, and Blender's functions after it.
export const CURVES_VERTEX_GLSL = `
uniform highp sampler2D curves_pos_rad_buf;
uniform highp isampler2D curves_indirection_buf;
uniform mat4 curves_object_to_world;
uniform vec3 curves_view_position;
uniform vec3 curves_view_forward;
uniform float curves_persp;
vec4 bl_buffer_fetch(highp sampler2D buffer, int i) { return texelFetch(buffer, ivec2(i % ${BUFFER_WIDTH}, i / ${BUFFER_WIDTH}), 0); }
ivec4 bl_buffer_fetch(highp isampler2D buffer, int i) { return texelFetch(buffer, ivec2(i % ${BUFFER_WIDTH}, i / ${BUFFER_WIDTH}), 0); }
struct DrawCurvesInfos { uint half_cylinder_face_count; uint vertex_per_segment; };
const DrawCurvesInfos drw_curves = DrawCurvesInfos(uint(CURVES_FACES), uint(CURVES_VERTEX_PER_SEGMENT));
${library(['curves_point_get', 'curves_object_to_world', 'curves_shape_point_get', 'integer_noise', 'hair_random_normal', 'hair_random_material'])}
// blender-port: draw_view_lib.glsl drw_world_incident_vector.
vec3 curves_incident_vector(vec3 P) { return curves_persp == 1.0 ? normalize(curves_view_position - P) : curves_view_forward; }
// blender-port: workbench_prepass.bsl.hh vert_curves (its calls of Blender's functions): a vertex of the curves, in
// Blender's world space, its position, normal and its strand's random value.
void curves_vertex(out vec3 P, out vec3 N, out float rand) {
  bl_curves_Point ws_pt = bl_curves_object_to_world(bl_curves_point_get(uint(gl_VertexID)), curves_object_to_world);
  bl_curves_ShapePoint pt = bl_curves_shape_point_get(ws_pt, curves_incident_vector(ws_pt.P));
  P = pt.P;
  rand = bl_integer_noise(ws_pt.curve_id);
  N = pt.N;
  if (drw_curves.half_cylinder_face_count == 1u) N = pt.N + pt.curve_N;
  else if (drw_curves.half_cylinder_face_count == 0u) N = bl_hair_random_normal(pt.curve_T, pt.curve_B, pt.curve_N, rand);
}
vec3 curves_babylon(vec3 p) { return vec3(p.x, p.z, p.y); }
`;
export const CURVES_UNIFORMS = ['curves_object_to_world', 'curves_view_position', 'curves_view_forward', 'curves_persp'];
export const CURVES_SAMPLERS = ['curves_pos_rad_buf', 'curves_indirection_buf'];
export const curvesDefines = (faces) => [`#define CURVES_FACES ${faces}`, `#define CURVES_VERTEX_PER_SEGMENT ${vertexPerSegment(faces)}`];

// A curves mesh's data bound to an effect: its textures, object matrix and the view's position and direction.
export function bindCurves(effect, mesh) {
  const { pos_rad, indirection, objectToWorld } = mesh.metadata.curves.data, view = drawView(mesh.getScene());
  effect.setTexture('curves_pos_rad_buf', pos_rad);
  effect.setTexture('curves_indirection_buf', indirection);
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
// objectToWorld): Blender's buffers as data textures.
export const curvesData = (scene, { posRad, indirection, objectToWorld }) => ({
  pos_rad: bufferTexture(scene, posRad, 4, false), indirection: bufferTexture(scene, indirection, 1, true), segments: indirection.length, objectToWorld: Float32Array.from(objectToWorld),
});
export function disposeCurvesData(data) {
  data.pos_rad.dispose();
  data.indirection.dispose();
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
  static of(material) { return material.pluginManager?.getPlugin('BlenderCurves') ?? new CurvesPlugin(material); }
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
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef CURVES\n${CURVES_VERTEX_GLSL}\nvec3 curves_P, curves_N; float curves_rand;\n#endif`,
      CUSTOM_VERTEX_UPDATE_POSITION: '#ifdef CURVES\ncurves_vertex(curves_P, curves_N, curves_rand);\npositionUpdated = curves_babylon(curves_P);\n#endif',
      CUSTOM_VERTEX_UPDATE_NORMAL: '#ifdef CURVES\nnormalUpdated = normalize(curves_babylon(curves_N));\n#endif',
    };
  }
}
