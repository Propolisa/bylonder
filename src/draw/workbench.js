// Blender's Workbench engine for Solid and Wireframe shading (draw/engines/workbench): Solid lights every object with
// the "Default" studio light in view space (workbench_world_light_lib.glsl) in its material's color, never the scene's
// lights; Wireframe draws unlit edges in the theme's wire colors through everything (X-ray). Each view's camera has
// its own render pass, so a view in Solid or Wireframe gives every object a Workbench material for its pass only, and
// views in Material Preview or Rendered keep the scene's materials and lights.
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { mesh_batch_cache_wire_indices } from './mesh-batch-cache.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';

// BKE_studiolight_default (studiolight.cc): direction, diffuse color with wrap (smooth), specular color.
const STUDIO_LIGHT_DEFAULT = [
  [[-0.352546, 0.170931, -0.920051], [0.033103, 0.033103, 0.033103, 0.52662], [0.266761, 0.266761, 0.266761]],
  [[-0.408163, 0.346939, 0.844415], [0.521083, 0.538226, 0.538226, 0], [0.59903, 0.59903, 0.59903]],
  [[0.521739, 0.826087, 0.212999], [0.038403, 0.034357, 0.04953, 0.478261], [0.106102, 0.125981, 0.158523]],
  [[0.624519, -0.562067, -0.542269], [0.090838, 0.08208, 0.072255, 0.2], [0.106535, 0.084771, 0.06608]],
];
// Blender's default surface: the startup cube's material (base color 0.8, roughness 0.5, not metallic).
const DEFAULT_SURFACE = { color: [0.8, 0.8, 0.8], roughness: 0.5, metallic: 0 };

const VERTEX = `precision highp float;
attribute vec3 position;
attribute vec3 normal;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
uniform mat4 view;
uniform mat4 viewProjection;
varying vec3 vNormalView;
varying vec3 vPositionView;
void main() {
  vec3 positionUpdated = position;
  vec3 normalUpdated = normal;
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
  vec4 worldPos = finalWorld * vec4(positionUpdated, 1.0);
  mat3 normalWorld = mat3(finalWorld);
  vec3 normalW = normalUpdated / vec3(dot(normalWorld[0], normalWorld[0]), dot(normalWorld[1], normalWorld[1]), dot(normalWorld[2], normalWorld[2]));
  vNormalView = mat3(view) * normalize(normalWorld * normalW);
  vPositionView = (view * worldPos).xyz;
  gl_Position = viewProjection * worldPos;
}`;

// Babylon's view space looks down +Z; Blender's down -Z, so Z flips.
const FRAGMENT = `precision highp float;
varying vec3 vNormalView;
varying vec3 vPositionView;
uniform mat4 projection;
uniform vec3 baseColor;
uniform float roughness;
uniform float metallic;
uniform vec4 lightDirection[4];
uniform vec4 lightDiffuseWrap[4];
uniform vec4 lightSpecular[4];

vec4 fast_rcp(vec4 v) { return intBitsToFloat(0x7eef370b - floatBitsToInt(v)); }
vec3 brdf_approx(vec3 spec_color, float roughness, float NV) {
  float fresnel = exp2(-8.35 * NV) * (1.0 - roughness);
  return mix(spec_color, vec3(1.0), fresnel);
}
void prep_specular(vec3 L, vec3 I, vec3 N, vec3 R, out float NL, out float wrapped_NL, out float spec_angle) {
  wrapped_NL = dot(L, R);
  vec3 half_dir = normalize(L + I);
  spec_angle = clamp(dot(half_dir, N), 0.0, 1.0);
  NL = clamp(dot(L, N), 0.0, 1.0);
}
vec4 blinn_specular(vec4 shininess, vec4 spec_angle, vec4 NL) {
  vec4 normalization_factor = shininess * 0.125 + 1.0;
  return pow(spec_angle, shininess) * NL * normalization_factor;
}
vec4 wrapped_lighting(vec4 NL, vec4 w) {
  vec4 w_1 = w + 1.0;
  return clamp((NL + w) * fast_rcp(w_1 * w_1), 0.0, 1.0);
}
vec3 get_world_lighting(vec3 base_color, float roughness, float metallic, vec3 N, vec3 I) {
  vec3 diffuse_color = mix(base_color, vec3(0.0), metallic);
  vec3 specular_color = mix(vec3(0.05), base_color, metallic);
  vec3 specular_light = vec3(0.0);
  vec3 diffuse_light = vec3(0.0);
  vec4 wrap = vec4(lightDiffuseWrap[0].a, lightDiffuseWrap[1].a, lightDiffuseWrap[2].a, lightDiffuseWrap[3].a);
  vec3 R = -reflect(I, N);
  vec4 spec_angle, spec_NL, wrap_NL;
  for (int i = 0; i < 4; i++) {
    float a, b, c;
    prep_specular(lightDirection[i].xyz, I, N, R, a, b, c);
    spec_NL[i] = a; wrap_NL[i] = b; spec_angle[i] = c;
  }
  vec4 gloss = vec4(1.0 - roughness) * (1.0 - wrap);
  vec4 shininess = exp2(10.0 * gloss + 1.0);
  vec4 spec_light = blinn_specular(shininess, spec_angle, spec_NL);
  vec4 spec_env = wrapped_lighting(wrap_NL, mix(wrap, vec4(1.0), roughness));
  spec_light = mix(spec_light, spec_env, wrap * wrap);
  vec4 diff_NL;
  for (int i = 0; i < 4; i++) {
    specular_light += spec_light[i] * lightSpecular[i].rgb;
    diff_NL[i] = dot(lightDirection[i].xyz, N);
  }
  specular_color = brdf_approx(specular_color, roughness, clamp(dot(N, I), 0.0, 1.0));
  specular_light *= specular_color;
  vec4 diff_light = wrapped_lighting(diff_NL, wrap);
  for (int i = 0; i < 4; i++) diffuse_light += diff_light[i] * lightDiffuseWrap[i].rgb;
  diffuse_light *= diffuse_color * (1.0 - dot(specular_color, vec3(0.33333)));
  return diffuse_light + specular_light;
}
vec3 linear_to_srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 N = normalize(vec3(vNormalView.xy, -vNormalView.z));
  vec3 P = vec3(vPositionView.xy, -vPositionView.z);
  vec3 I = projection[3][3] == 0.0 ? normalize(-P) : vec3(0.0, 0.0, 1.0);
  if (dot(N, I) < 0.0) N = -N;
  gl_FragColor = vec4(linear_to_srgb(get_world_lighting(baseColor, roughness, metallic, N, I)), 1.0);
}`;

// Wireframe: each object's edges as lines sharing its positions, in its wire color; the object itself draws nothing.
const WIRE_VERTEX = `precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
void main() { gl_Position = worldViewProjection * vec4(position, 1.0); }`;
const WIRE_FRAGMENT = `precision highp float;
uniform vec4 wireColor;
void main() { gl_FragColor = wireColor; }`;
const HIDDEN_VERTEX = `precision highp float;
attribute vec3 position;
void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const HIDDEN_FRAGMENT = `precision highp float;
void main() { gl_FragColor = vec4(0.0); }`;

const UNIFORMS = ['world', 'view', 'viewProjection', 'projection', 'mBones', 'morphTargetInfluences', 'morphTargetCount', 'morphTargetTextureInfo', 'morphTargetTextureIndices', 'bakedVertexAnimationSettings', 'bakedVertexAnimationTextureSizeInverted', 'bakedVertexAnimationTime'];
const SAMPLERS = ['boneSampler', 'morphTargets', 'bakedVertexAnimationTexture'];

// A material's Solid color (its viewport display color): Babylon's base color, or Blender's default surface.
// Babylon's colors are display (sRGB) values; Workbench lights in linear.
function surface(material, out) {
  const color = material?.albedoColor ?? material?.diffuseColor;
  const source = color ? [color.r, color.g, color.b] : DEFAULT_SURFACE.color;
  for (let i = 0; i < 3; i++) out.color[i] = color ? (source[i] <= 0.04045 ? source[i] / 12.92 : ((source[i] + 0.055) / 1.055) ** 2.4) : source[i];
  out.roughness = Math.sqrt(material?.roughness ?? DEFAULT_SURFACE.roughness);
  out.metallic = material?.metallic ?? DEFAULT_SURFACE.metallic;
  return out;
}

//   wireColor(mesh) -> RGBA theme color of a mesh's wire (selected, active or not)
export function createWorkbench(scene, { wireColor = () => theme.wire } = {}) {
  const shaded = new Map(); // camera -> 'solid' | 'wire'
  const solid = new ShaderMaterial('__workbenchSolid', scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
    attributes: ['position', 'normal'], uniforms: [...UNIFORMS, 'baseColor', 'roughness', 'metallic', 'lightDirection', 'lightDiffuseWrap', 'lightSpecular'], samplers: SAMPLERS,
  });
  solid.backFaceCulling = false;
  solid.setArray4('lightDirection', STUDIO_LIGHT_DEFAULT.flatMap(([d]) => [...d, 0]));
  solid.setArray4('lightDiffuseWrap', STUDIO_LIGHT_DEFAULT.flatMap(([, c]) => c));
  solid.setArray4('lightSpecular', STUDIO_LIGHT_DEFAULT.flatMap(([, , s]) => [...s, 0]));
  const current = { color: [0, 0, 0], roughness: 0, metallic: 0 };
  solid.onBindObservable.add((mesh) => {
    const { color, roughness, metallic } = surface(mesh.material, current);
    const effect = solid.getEffect();
    effect.setFloat3('baseColor', color[0], color[1], color[2]);
    effect.setFloat('roughness', roughness);
    effect.setFloat('metallic', metallic);
  });
  const wire = new ShaderMaterial('__workbenchWire', scene, { vertexSource: WIRE_VERTEX, fragmentSource: WIRE_FRAGMENT }, {
    attributes: ['position'], uniforms: ['worldViewProjection', 'wireColor'],
  });
  // X-ray: every edge shows.
  Object.assign(wire, { backFaceCulling: false, disableDepthWrite: true, depthFunction: Constants.ALWAYS });
  wire.onBindObservable.add((mesh) => {
    const c = wireColor(mesh.metadata.wireOwner);
    wire.getEffect().setFloat4('wireColor', c[0], c[1], c[2], c[3] ?? 1);
  });
  const hidden = new ShaderMaterial('__workbenchHidden', scene, { vertexSource: HIDDEN_VERTEX, fragmentSource: HIDDEN_FRAGMENT }, { attributes: ['position'] });
  const materials = { solid, wire: hidden };
  // Overlays (grid, extras, Edit Mode) and line meshes draw themselves.
  const shadedMesh = (mesh) => !mesh.name.startsWith('__') && !mesh.metadata?.overlay && !(mesh instanceof LinesMesh) && mesh.getTotalVertices() > 0;
  const assign = (mesh, camera) => mesh.setMaterialForRenderPass(camera.renderPassId, materials[shaded.get(camera)]);
  const added = scene.onNewMeshAddedObservable.add((mesh) => {
    // Builders add vertices after construction; decide once the mesh is set up.
    scene.onBeforeRenderObservable.addOnce(() => { if (shadedMesh(mesh)) for (const camera of shaded.keys()) assign(mesh, camera); });
  });
  // Each shaded object's edges, shown only while a Wireframe view renders; rebuilt when its geometry is replaced.
  const wires = new Map(); // mesh -> lines mesh
  const edges = (mesh) => {
    let lines = wires.get(mesh);
    const positions = mesh.getVertexBuffer('position');
    if (lines && !lines.isDisposed() && lines.metadata.positions === positions) return lines;
    lines?.dispose();
    lines = new Mesh('__wire ' + mesh.name, scene);
    // A view of the object's position buffer, which it keeps owning.
    lines.setVerticesBuffer(new VertexBuffer(scene.getEngine(), positions.getWrapperBuffer(), VertexBuffer.PositionKind, {
      stride: positions.byteStride, offset: positions.byteOffset, size: positions.getSize(), type: positions.type, useBytes: true,
    }), false);
    lines.setIndices(mesh_batch_cache_wire_indices(mesh), mesh.getTotalVertices());
    Object.assign(lines, { parent: mesh, material: wire, isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true });
    lines._getRenderingFillMode = () => Material.LineListDrawMode;
    lines.metadata = { overlay: true, wireOwner: mesh, positions };
    wires.set(mesh, lines);
    return lines;
  };
  const showWires = scene.onBeforeCameraRenderObservable.add((camera) => {
    const show = shaded.get(camera) === 'wire';
    // Wireframe draws selected objects' edges in the selection colors instead of outlines.
    if (scene.getOutlineRenderer) scene.getOutlineRenderer().enabled = !show;
    if (show) for (const mesh of scene.meshes) if (shadedMesh(mesh) && !wires.has(mesh)) edges(mesh);
    for (const [mesh, lines] of wires) {
      if (mesh.isDisposed()) { lines.dispose(); wires.delete(mesh); continue; }
      edges(mesh).isVisible = show && mesh.isVisible;
    }
  });
  return {
    // Solid ('solid'), Wireframe ('wire') or the scene's materials (null) for what `camera` renders. Not per frame.
    setShading(camera, type) {
      if ((shaded.get(camera) ?? null) === type) return;
      if (type) shaded.set(camera, type); else shaded.delete(camera);
      for (const mesh of scene.meshes) if (shadedMesh(mesh)) mesh.setMaterialForRenderPass(camera.renderPassId, type ? materials[type] : undefined);
    },
    dispose() {
      scene.onNewMeshAddedObservable.remove(added);
      scene.onBeforeCameraRenderObservable.remove(showWires);
      for (const lines of wires.values()) lines.dispose();
      hidden.dispose();
      for (const camera of [...shaded.keys()]) this.setShading(camera, null);
      solid.dispose();
      wire.dispose();
    },
  };
}
