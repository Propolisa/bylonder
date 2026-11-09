// SPDX-License-Identifier: GPL-2.0-or-later
// Curves as Blender's draw engines draw them, the part an exported page ships with them (bylonder-curves/, its GLSL
// pieces made at export from Blender's): Blender's buffers of a curves draw (main-api.cc main_curves) as data textures,
// a mesh of Blender's batch vertices drawing them, and the node material blocks whose vertex stage places each vertex
// with Blender's curve shape functions (CURVES_GLSL, set by draw/curves.js in the app).
import { Constants, Material, Mesh, NodeMaterialBlock, NodeMaterialBlockConnectionPointTypes as T, NodeMaterialBlockTargets as Targets, RawTexture,
  RegisterClass, SubMesh, Texture } from '@babylonjs/core';

// Texels per row of a data texture standing in for a buffer.
export const BUFFER_WIDTH = 4096;
// blender-port: draw_curves.cc curves_bind_resources, the vertices a segment of `faces` faces draws.
export const vertexPerSegment = (faces) => (faces < 2 ? faces + 1 : (faces + 1) * 2 + 1);
// What draw_curves_infos declares.
export const CURVES_UNIFORMS = ['curves_object_to_world', 'curves_view_position', 'curves_view_forward', 'curves_persp'];
export const CURVES_SAMPLERS = ['curves_pos_rad_buf', 'curves_indirection_buf', 'curves_time_buf', 'curves_length_buf'];
// The GLSL the blocks emit, as named pieces: the vertex stage's and the shading normal's.
export const CURVES_GLSL = { vertex: [], normal: [] };
// Emits pieces into a node material's shader, for meshes drawing curves.
const emitCurves = (state, pieces) => { for (const [key, text] of pieces) state._emitFunction(key, `#ifdef CURVES\n${text}\n#endif\n`, ''); };

// The view in Blender's terms (draw-view.js drawView): its position and forward axis in Blender's axes, perspective or not.
function curvesView(scene) {
  const camera = scene.activeCamera, m = camera.getWorldMatrix().m;
  return { position: [m[12], m[14], m[13]], forward: [-m[8], -m[10], -m[9]], persp: camera.getProjectionMatrix().m[15] === 0 };
}

// A curves mesh's data bound to an effect: its textures, object matrix and the view's position and direction.
export function bindCurves(effect, mesh) {
  const { pos_rad, indirection, time, length, objectToWorld } = mesh.metadata.curves.data, view = curvesView(mesh.getScene());
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
  mesh.overrideRenderingFillMode = faces === 0 ? Material.LineStripDrawMode : Material.TriangleStripDrawMode;
  return mesh;
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
    emitCurves(state, CURVES_GLSL.vertex);
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
    emitCurves(state, CURVES_GLSL.normal);
    const [normal, curveN, binormal, timeWidth, radius] = this._inputs.map((input) => input.associatedVariableName);
    state.compilationString += `${state._declareOutput(this.output)} = ${normal};\n#ifdef CURVES\n${this.output.associatedVariableName} = curves_babylon(curves_shading_normal(${curveN}, ${binormal}, ${timeWidth}, ${radius}));\n#endif\n`;
    return this;
  }
}
RegisterClass('BABYLON.CurvesNormalBlock', CurvesNormalBlock);
