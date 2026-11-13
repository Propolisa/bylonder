// Blender's Workbench engine for Solid and Wireframe shading (draw/engines/workbench): Solid lights every object with
// the "Default" studio light in view space (workbench_world_light_lib.glsl) in its material's color, never the scene's
// lights, and with X-ray see-through at the X-ray alpha; Wireframe draws unlit edges in the theme's wire colors through
// everything (X-ray). Each view's camera has its own render pass, so a view in Solid or Wireframe gives every object a
// Workbench material for its pass only, and views in Material Preview or Rendered keep the scene's materials and lights.
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { MultiRenderTarget } from '@babylonjs/core/Materials/Textures/multiRenderTarget.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { mesh_batch_cache_wire_indices } from './mesh-batch-cache.js';
import { createFullscreenPass } from './fullscreen-pass.js';
import { CURVES_VERTEX_GLSL, CURVES_UNIFORMS, CURVES_SAMPLERS, curvesDefines, bindCurves } from './curves.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';
import { imagePremultiplied } from '../imbuf/image-textures.js';
import { meshHidden } from '../blenkernel/scene/mesh-hiding.js';

// BKE_studiolight_default (studiolight.cc): direction, diffuse color with wrap (smooth), specular color.
const STUDIO_LIGHT_DEFAULT = [
  [[-0.352546, 0.170931, -0.920051], [0.033103, 0.033103, 0.033103, 0.52662], [0.266761, 0.266761, 0.266761]],
  [[-0.408163, 0.346939, 0.844415], [0.521083, 0.538226, 0.538226, 0], [0.59903, 0.59903, 0.59903]],
  [[0.521739, 0.826087, 0.212999], [0.038403, 0.034357, 0.04953, 0.478261], [0.106102, 0.125981, 0.158523]],
  [[0.624519, -0.562067, -0.542269], [0.090838, 0.08208, 0.072255, 0.2], [0.106535, 0.084771, 0.06608]],
];
// View3DShading.xray_alpha's default.
const XRAY_ALPHA = 0.5;
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
#ifdef TEXTURE_COLOR
attribute vec2 uv;
varying vec2 vUV;
#endif
#ifdef ATTRIBUTE_COLOR
attribute vec4 color;
varying vec4 vColor;
#endif
void main() {
#ifdef TEXTURE_COLOR
  vUV = uv;
#endif
#ifdef ATTRIBUTE_COLOR
  vColor = color;
#endif
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

// blender-port: workbench_prepass.bsl.hh vert_curves. Curves (curves.js) as Workbench's hair: Blender's strand vertex,
// and the material's values varied per strand (Blender's hair_random_material).
const CURVES_VERTEX = `precision highp float;
precision highp int;
attribute vec3 position;
uniform mat4 view;
uniform mat4 viewProjection;
uniform vec3 baseColor;
uniform float roughness;
uniform float metallic;
varying vec3 vNormalView;
varying vec3 vPositionView;
varying vec3 vColor;
varying float vRoughness;
varying float vMetallic;
${CURVES_VERTEX_GLSL}
void main() {
  vec3 P, N;
  float rand;
  curves_vertex(P, N, rand);
  vec4 worldPos = vec4(curves_babylon(P), 1.0);
  vNormalView = mat3(view) * normalize(curves_babylon(N));
  vPositionView = (view * worldPos).xyz;
  gl_Position = viewProjection * worldPos;
  vColor = baseColor;
  vRoughness = roughness;
  vMetallic = metallic;
  bl_hair_random_material(rand, vColor, vRoughness, vMetallic);
}`;

// Babylon's view space looks down +Z; Blender's down -Z, so Z flips.
const LIGHTING = `precision highp float;
varying vec3 vNormalView;
varying vec3 vPositionView;
uniform mat4 projection;
#ifdef CURVES
varying vec3 vColor;
varying float vRoughness;
varying float vMetallic;
#define baseColor vColor
#define roughness vRoughness
#define metallic vMetallic
#else
uniform vec3 baseColor;
uniform float roughness;
uniform float metallic;
#endif
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
// The color type (V3D_SHADING_*_COLOR): the material's, the paint slot's image (Texture Paint) or the active color
// attribute (Vertex Paint), as workbench_engine.cc forces them in those modes; both are linear here.
#if defined(TEXTURE_COLOR)
uniform sampler2D colorTexture;
uniform bool imagePremultiplied;
varying vec2 vUV;
// blender-port: workbench_image_lib.glsl workbench_image_color, straight alpha from a premultiplied texture.
vec3 image_color() {
  vec4 color = texture(colorTexture, vUV);
  if (imagePremultiplied && !(color.a == 0.0 || color.a == 1.0)) color.rgb /= color.a;
  return color.rgb;
}
#define BASE_COLOR image_color()
#elif defined(ATTRIBUTE_COLOR)
varying vec4 vColor;
#define BASE_COLOR vColor.rgb
#else
#define BASE_COLOR baseColor
#endif
vec3 shaded_color() {
  vec3 N = normalize(vec3(vNormalView.xy, -vNormalView.z));
  vec3 P = vec3(vPositionView.xy, -vPositionView.z);
  vec3 I = projection[3][3] == 0.0 ? normalize(-P) : vec3(0.0, 0.0, 1.0);
  if (dot(N, I) < 0.0) N = -N;
  return get_world_lighting(BASE_COLOR, roughness, metallic, N, I);
}`;
const FRAGMENT = `${LIGHTING}
void main() { gl_FragColor = vec4(linear_to_srgb(shaded_color()), 1.0); }`;

// X-ray (workbench_transparent_accum_frag.glsl, workbench_transparent_resolve_frag.glsl): every surface at the X-ray
// alpha, blended in any order by weighted blended order-independent transparency. Blender multiplies revealage into
// the accumulation's alpha by a blend mode Babylon lacks; here the alpha sums -log(1 - alpha), whose exponent is the
// same product, under the additive blend both targets share. Weights use the view-space depth.
const ACCUM_FRAGMENT = `${LIGHTING}
uniform float xray_alpha;
layout(location = 0) out vec4 out_transparent_accum;
layout(location = 1) out vec4 out_revealage_accum;
float calculate_transparent_weight() {
  /* Eq 7 of McGuire and Bavoil, Weighted Blended Order-Independent Transparency (JCGT 2013), optimized. */
  float a = abs(vPositionView.z) / 5.0;
  float b = abs(vPositionView.z) / 200.0;
  b *= b;
  float w = 10.0 / ((1e-5 + a * a) + b * (b * b));
  return clamp(w, 1e-2, 3e2);
}
void main() {
#ifdef CURVES
  /* Hairs have lots of layer and can rapidly become the most prominent surface. So we lower their alpha artificially. */
  float alpha = xray_alpha * 0.3;
#else
  float alpha = xray_alpha;
#endif
  float weight = calculate_transparent_weight() * alpha;
  out_transparent_accum = vec4(shaded_color() * weight, -log(1.0 - alpha));
  out_revealage_accum = vec4(weight);
}`;
const RESOLVE_FRAGMENT = `precision highp float;
uniform sampler2D transparent_accum;
uniform sampler2D transparent_revealage;
uniform vec4 region;
layout(location = 0) out vec4 frag_color;
vec3 linear_to_srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  ivec2 texel = clamp(ivec2(gl_FragCoord.xy), ivec2(region.xy), ivec2(region.zw));
  vec4 trans_accum = texelFetch(transparent_accum, texel, 0);
  float trans_weight = texelFetch(transparent_revealage, texel, 0).r;
  float trans_reveal = exp(-trans_accum.a);
  /* Listing 4 */
  frag_color.rgb = linear_to_srgb(trans_accum.rgb / clamp(trans_weight, 1e-4, 5e4));
  frag_color.a = 1.0 - trans_reveal;
}`;

// Wireframe: each object's edges as lines sharing its positions, in its wire color; the object itself draws nothing.
const WIRE_VERTEX = `precision highp float;
attribute vec3 position;
#include<instancesDeclaration>
uniform mat4 viewProjection;
void main() {
#include<instancesVertex>
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
}`;
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

// A material's Solid color: a Blender material's Viewport Display, a Babylon one's base color, or Blender's default surface.
// Babylon's colors are display (sRGB) values; Workbench lights in linear.
export function solidSurface(material, out) {
  // A Blender material shows its Viewport Display settings (workbench_material.cc), its color scene linear.
  const display = material?.metadata?.wbViewportDisplay;
  if (display) {
    for (let i = 0; i < 3; i++) out.color[i] = display.color[i];
    out.roughness = Math.sqrt(display.roughness);
    out.metallic = display.metallic;
    return out;
  }
  const color = material?.albedoColor ?? material?.diffuseColor;
  const source = color ? [color.r, color.g, color.b] : DEFAULT_SURFACE.color;
  for (let i = 0; i < 3; i++) out.color[i] = color ? (source[i] <= 0.04045 ? source[i] / 12.92 : ((source[i] + 0.055) / 1.055) ** 2.4) : source[i];
  out.roughness = Math.sqrt(material?.roughness ?? DEFAULT_SURFACE.roughness);
  out.metallic = material?.metallic ?? DEFAULT_SURFACE.metallic;
  return out;
}

//   wireColor(mesh) -> RGBA theme color of a mesh's wire (selected, active or not); paintTexture(mesh) -> the Babylon
//   texture of the image its active material's paint slot paints (Texture Paint, and Solid's Texture color), or null
export function createWorkbench(scene, { wireColor = () => theme.wire, paintTexture: textureOf = () => null } = {}) {
  // Looked up once per frame for each mesh, whichever views draw it.
  const textures = new WeakMap();
  const paintTexture = (mesh) => {
    const frame = scene.getFrameId(), known = textures.get(mesh);
    if (known?.frame === frame) return known.texture;
    const texture = textureOf(mesh);
    textures.set(mesh, { frame, texture });
    return texture;
  };
  const shaded = new Map(); // camera -> 'solid' | 'xray' | 'wire'
  const colorTypes = new Map(); // camera -> View3DShading.color_type
  const current = { color: [0, 0, 0], roughness: 0, metallic: 0 };
  // A lit material: of meshes, or of curves of a Hair shape (`curves`: its mesh, for its defines).
  // `colorType`: the color type's attribute ('uv' for the paint slot's image, 'color' for the color attribute), if not the
  // material's.
  const lit = (name, fragmentSource, uniforms = [], curves = null, colorType = null) => {
    const material = new ShaderMaterial(name, scene, { vertexSource: curves ? CURVES_VERTEX : VERTEX, fragmentSource }, curves
      ? { attributes: ['position'], uniforms: ['view', 'viewProjection', 'projection', 'baseColor', 'roughness', 'metallic', 'lightDirection', 'lightDiffuseWrap', 'lightSpecular', ...CURVES_UNIFORMS, ...uniforms],
        samplers: CURVES_SAMPLERS, defines: ['#define CURVES', ...curvesDefines(curves.metadata.curves.faces)] }
      : { attributes: ['position', 'normal', ...(colorType ? [colorType] : [])], uniforms: [...UNIFORMS, 'baseColor', 'roughness', 'metallic', 'lightDirection', 'lightDiffuseWrap', 'lightSpecular', ...uniforms, ...(colorType === 'uv' ? ['imagePremultiplied'] : [])],
        samplers: [...SAMPLERS, ...(colorType === 'uv' ? ['colorTexture'] : [])], defines: { uv: ['#define TEXTURE_COLOR'], color: ['#define ATTRIBUTE_COLOR'] }[colorType] ?? [] });
    material.backFaceCulling = false;
    material.setArray4('lightDirection', STUDIO_LIGHT_DEFAULT.flatMap(([d]) => [...d, 0]));
    material.setArray4('lightDiffuseWrap', STUDIO_LIGHT_DEFAULT.flatMap(([, c]) => c));
    material.setArray4('lightSpecular', STUDIO_LIGHT_DEFAULT.flatMap(([, , s]) => [...s, 0]));
    // Each material slot shows its own color (workbench_material.cc): the part being drawn's slot of a MultiMaterial.
    let part = null;
    const bindForSubMesh = material.bindForSubMesh.bind(material);
    material.bindForSubMesh = (world, mesh, subMesh) => { part = subMesh; bindForSubMesh(world, mesh, subMesh); };
    material.onBindObservable.add((mesh) => {
      const own = mesh.material instanceof MultiMaterial ? mesh.material.subMaterials[part?.materialIndex ?? 0] : mesh.material;
      const { color, roughness, metallic } = solidSurface(own, current);
      const effect = material.getEffect();
      effect.setFloat3('baseColor', color[0], color[1], color[2]);
      effect.setFloat('roughness', roughness);
      effect.setFloat('metallic', metallic);
      if (curves) bindCurves(effect, mesh);
      if (colorType === 'uv') {
        const texture = paintTexture(mesh) ?? missing();
        effect.setTexture('colorTexture', texture);
        effect.setBool('imagePremultiplied', imagePremultiplied(texture));
      }
    });
    return material;
  };
  // What an object without a paint slot shows in Texture Paint: the missing texture's magenta, as Blender's engines.
  let missingTexture = null;
  const missing = () => (missingTexture ??= new RawTexture(new Uint8Array([255, 0, 255, 255]), 1, 1, Constants.TEXTUREFORMAT_RGBA, scene));
  const solid = lit('__workbenchSolid', FRAGMENT);
  const paint = { TEXTURE_PAINT: lit('__workbenchTexture', FRAGMENT, [], null, 'uv'), VERTEX_PAINT: lit('__workbenchAttribute', FRAGMENT, [], null, 'color') };
  // Solid's Texture and Attribute colors (workbench_material.cc): the active image texture or the color attribute, the
  // material's color without one. Texture Paint and Vertex Paint show them whatever the view's color, Texture Paint
  // magenta without an image.
  const paintMaterial = (mesh, colorType) => {
    const mode = mesh.metadata?.wbMode;
    if (mode === 'TEXTURE_PAINT' || (colorType === 'TEXTURE' && paintTexture(mesh))) return paint.TEXTURE_PAINT;
    if ((mode === 'VERTEX_PAINT' || colorType === 'VERTEX') && mesh.isVerticesDataPresent?.('color')) return paint.VERTEX_PAINT;
    return null;
  };
  const accum = lit('__workbenchTransparentAccum', ACCUM_FRAGMENT, ['xray_alpha']);
  Object.assign(accum, { alphaMode: Constants.ALPHA_ONEONE_ONEONE, disableDepthWrite: true, depthFunction: Constants.ALWAYS, transparencyMode: Material.MATERIAL_ALPHABLEND });
  accum.setFloat('xray_alpha', XRAY_ALPHA);
  const wire = new ShaderMaterial('__workbenchWire', scene, { vertexSource: WIRE_VERTEX, fragmentSource: WIRE_FRAGMENT }, {
    attributes: ['position'], uniforms: ['world', 'viewProjection', 'wireColor'],
  });
  // X-ray: every edge shows.
  Object.assign(wire, { backFaceCulling: false, disableDepthWrite: true, depthFunction: Constants.ALWAYS });
  wire.onBindObservable.add((mesh) => {
    const c = wireColor(mesh.metadata.wireOwner);
    wire.getEffect().setFloat4('wireColor', c[0], c[1], c[2], c[3] ?? 1);
  });
  // An object displayed as wire in a view with surfaces: its edges hidden behind them, as Blender's wire overlay.
  const wireBehind = Object.assign(wire.clone('__workbenchWireBehind'), { depthFunction: Constants.LEQUAL });
  wireBehind.onBindObservable.add((mesh) => {
    const c = wireColor(mesh.metadata.wireOwner);
    wireBehind.getEffect().setFloat4('wireColor', c[0], c[1], c[2], c[3] ?? 1);
  });
  const hidden = new ShaderMaterial('__workbenchHidden', scene, { vertexSource: HIDDEN_VERTEX, fragmentSource: HIDDEN_FRAGMENT }, { attributes: ['position'] });
  const materials = { solid, xray: hidden, wire: hidden };
  // Curves' Solid and X-ray materials, by their Hair shape; curves Workbench does not draw (their viewport display is
  // not Path) and Wireframe draw none.
  const curvesMaterials = new Map();
  const curvesMaterial = (mesh, type) => {
    const { faces, viewport } = mesh.metadata.curves, key = type + faces;
    if (!viewport || type === 'wire') return hidden;
    if (!curvesMaterials.has(key)) {
      const material = type === 'solid' ? lit('__workbenchCurves' + faces, FRAGMENT, [], mesh) : lit('__workbenchCurvesAccum' + faces, ACCUM_FRAGMENT, ['xray_alpha'], mesh);
      if (type !== 'solid') {
        Object.assign(material, { alphaMode: Constants.ALPHA_ONEONE_ONEONE, disableDepthWrite: true, depthFunction: Constants.ALWAYS, transparencyMode: Material.MATERIAL_ALPHABLEND });
        material.setFloat('xray_alpha', XRAY_ALPHA);
      }
      curvesMaterials.set(key, material);
    }
    return curvesMaterials.get(key);
  };
  const materialOf = (mesh, type, colorType) => (mesh.metadata?.curves ? curvesMaterial(mesh, type === 'xray' ? 'accum' : type)
    : (type === 'solid' && paintMaterial(mesh, colorType)) || materials[type]);
  // Overlays (grid, extras, Edit Mode) and line meshes draw themselves; curves draw as Workbench's hair; the view's own
  // meshes (named __) draw only when Workbench shades them (instances of objects and meshes, main-view.js drawInstances).
  const shadedMesh = (mesh) => (mesh.metadata?.curves ? !mesh.metadata.overlay : (!mesh.name.startsWith('__') || mesh.metadata?.workbench) && !mesh.metadata?.overlay && !(mesh instanceof LinesMesh) && mesh.getTotalVertices() > 0);
  const assign = (mesh, camera) => mesh.setMaterialForRenderPass(camera.renderPassId, materialOf(mesh, shaded.get(camera), colorTypes.get(camera)));
  const added = scene.onNewMeshAddedObservable.add((mesh) => {
    // Builders add vertices after construction; decide once the mesh is set up.
    scene.onBeforeRenderObservable.addOnce(() => { if (shadedMesh(mesh)) for (const camera of shaded.keys()) assign(mesh, camera); });
  });
  // Each shaded object's edges, shown only while a Wireframe view renders, and those of an object displayed as wire
  // (Display As > Wire) while its surface is hidden; rebuilt when its geometry is replaced.
  const wires = new Map(); // mesh -> lines mesh
  const displayedAsWire = new Set();
  const edges = (mesh) => {
    let lines = wires.get(mesh);
    const positions = mesh.getVertexBuffer('position');
    if (lines && !lines.isDisposed() && lines.metadata.positions === positions) return instancedAs(mesh, lines);
    lines?.dispose();
    lines = new Mesh('__wire ' + mesh.name, scene);
    // A view of the object's position buffer, which it keeps owning.
    lines.setVerticesBuffer(new VertexBuffer(scene.getEngine(), positions.getWrapperBuffer(), VertexBuffer.PositionKind, {
      stride: positions.byteStride, offset: positions.byteOffset, size: positions.getSize(), type: positions.type, useBytes: true,
    }), false);
    lines.setIndices(mesh_batch_cache_wire_indices(mesh), mesh.getTotalVertices());
    Object.assign(lines, { parent: mesh, material: wire, isPickable: false, alwaysSelectAsActiveMesh: true, doNotSerialize: true });
    lines.overrideRenderingFillMode = Material.LineListDrawMode;
    lines.metadata = { overlay: true, wireOwner: mesh, positions, instances: null };
    wires.set(mesh, lines);
    return instancedAs(mesh, lines);
  };
  // An instance carrier's edges at each of its instances, thin instances on its matrices (overlay-outline.js does so too).
  const instancedAs = (mesh, lines) => {
    const instances = mesh.thinInstanceCount ? mesh._thinInstanceDataStorage.matrixData : null;
    if (instances !== lines.metadata.instances) lines.thinInstanceSetBuffer('matrix', instances, 16, false);
    else if (instances) lines.thinInstanceBufferUpdated('matrix');
    if (instances) lines.thinInstanceCount = mesh.thinInstanceCount;
    lines.metadata.instances = instances;
    return lines;
  };
  const showWires = scene.onBeforeCameraRenderObservable.add((camera) => {
    const show = shaded.get(camera) === 'wire';
    if (show) for (const mesh of scene.meshes) if (shadedMesh(mesh) && !mesh.metadata?.curves && !wires.has(mesh)) edges(mesh);
    for (const mesh of displayedAsWire) if (mesh.isDisposed()) displayedAsWire.delete(mesh); else if (!wires.has(mesh)) edges(mesh);
    for (const [mesh, lines] of wires) {
      if (mesh.isDisposed()) { lines.dispose(); wires.delete(mesh); continue; }
      const asWire = displayedAsWire.has(mesh) && mesh.isEnabled() && !mesh.isVisible && !meshHidden(mesh);
      edges(mesh).isVisible = (show && mesh.isVisible) || asWire;
      lines.material = asWire && !show ? wireBehind : wire;
    }
  });
  // X-ray: a view's surfaces accumulate into the transparent targets before it renders (TransparentPass), and the
  // resolve draws them over its background before anything else.
  const engine = scene.getEngine(), pass = createFullscreenPass(engine);
  const transparent = new MultiRenderTarget('__workbenchTransparent', pass.size, 2, scene, {
    generateMipMaps: false, generateDepthBuffer: false, types: [Constants.TEXTURETYPE_HALF_FLOAT, Constants.TEXTURETYPE_HALF_FLOAT],
    samplingModes: [Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURE_NEAREST_SAMPLINGMODE],
  });
  Object.assign(transparent, { clearColor: new Color4(0, 0, 0, 0), renderParticles: false, renderSprites: false });
  transparent.renderListPredicate = (mesh) => {
    if (!shadedMesh(mesh)) return false;
    const material = mesh.metadata?.curves ? curvesMaterial(mesh, 'accum') : accum;
    if (mesh.getMaterialForRenderPass(transparent.renderPassId) !== material) transparent.setMaterialForRendering(mesh, material);
    return true;
  };
  const fitted = transparent.onBeforeBindObservable.add(() => pass.fit([transparent]));
  const resolve = pass.effect('workbenchTransparentResolve', RESOLVE_FRAGMENT, [], ['transparent_accum', 'transparent_revealage']);
  const resolved = scene.onBeforeRenderingGroupObservable.add(({ renderingGroupId, camera }) => {
    if (renderingGroupId !== 0 || shaded.get(camera) !== 'xray' || engine.currentRenderPassId !== camera.renderPassId || !resolve.effect.isReady()) return;
    engine.setAlphaMode(Constants.ALPHA_COMBINE);
    pass.draw(resolve, camera, (effect) => {
      effect.setTexture('transparent_accum', transparent.textures[0]);
      effect.setTexture('transparent_revealage', transparent.textures[1]);
    });
    engine.setAlphaMode(Constants.ALPHA_DISABLE);
    scene.resetCachedMaterial();
  });
  return {
    // A mesh's Workbench materials again, after its mode or color data changed.
    refresh(mesh) { if (mesh.getTotalVertices && shadedMesh(mesh)) for (const camera of shaded.keys()) assign(mesh, camera); },
    // Display As > Wire for `mesh`: its edges drawn in every shading while its surface is hidden (main-view.js).
    displayAsWire(mesh, on) { if (on) displayedAsWire.add(mesh); else displayedAsWire.delete(mesh); },
    // What `camera` renders: 'solid', 'xray', 'wire', or undefined for the scene's materials.
    shading: (camera) => shaded.get(camera),
    // Solid ('solid'), Solid with X-ray ('xray'), Wireframe ('wire') or the scene's materials (null) for what `camera`
    // renders, with Solid's color type (View3DShading.color_type). Not per frame.
    setShading(camera, type, colorType = 'MATERIAL') {
      if ((shaded.get(camera) ?? null) === type && colorTypes.get(camera) === colorType) return;
      if (type) shaded.set(camera, type); else shaded.delete(camera);
      colorTypes.set(camera, colorType);
      for (const mesh of scene.meshes) if (shadedMesh(mesh)) mesh.setMaterialForRenderPass(camera.renderPassId, type ? materialOf(mesh, type, colorType) : undefined);
      const targets = camera.customRenderTargets, index = targets.indexOf(transparent);
      if (type === 'xray' && index < 0) targets.push(transparent);
      else if (type !== 'xray' && index >= 0) targets.splice(index, 1);
    },
    dispose() {
      scene.onNewMeshAddedObservable.remove(added);
      scene.onBeforeCameraRenderObservable.remove(showWires);
      scene.onBeforeRenderingGroupObservable.remove(resolved);
      transparent.onBeforeBindObservable.remove(fitted);
      for (const lines of wires.values()) lines.dispose();
      for (const camera of [...shaded.keys()]) this.setShading(camera, null);
      for (const resource of [hidden, solid, accum, wire, transparent, resolve, pass, ...curvesMaterials.values()]) resource.dispose();
    },
  };
}
