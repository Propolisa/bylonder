// EEVEE's volume passes (eevee_volume.bsl.hh) as fragment shaders over the froxel atlas (draw/volumes.js): WebGL 2 has no
// 3D image stores, so the froxel grid is a 2D texture of its slices side by side, slice k at tile (k % columns, k /
// columns), each tile the grid's width and height.

// The grid and the view the froxels are placed in, which every pass reads.
const GRID = `uniform vec3 volumeSize;
uniform float atlasColumns;
uniform vec3 depthParams;
uniform float perspective;
uniform vec2 coordScale;
uniform mat4 inverseProjection;
ivec3 froxelOf(ivec2 texel) {
  ivec2 size = ivec2(volumeSize.xy), tile = texel / size;
  return ivec3(texel - tile * size, tile.y * int(atlasColumns) + tile.x);
}
ivec2 texelOf(ivec3 froxel) {
  int columns = int(atlasColumns);
  return ivec2(froxel.z % columns, froxel.z / columns) * ivec2(volumeSize.xy) + froxel.xy;
}
// blender-port: eevee_volume_lib.bsl.hh volume_z_to_view_z, view_z_to_volume_z: Blender's view z (negative ahead).
float volume_z_to_view_z(float z) {
  float near = depthParams.x, far = depthParams.y, distribution = depthParams.z;
  if (perspective > 0.5) return (exp2(z / distribution) - near) / far;
  return near + (far - near) * z;
}
float view_z_to_volume_z(float depth, vec3 params) {
  float near = params.x, far = params.y, distribution = params.z;
  if (perspective > 0.5) return distribution * log2(max(1e-8, depth * far + near));
  return (depth - near) / (far - near);
}
float view_z_to_volume_z(float depth) { return view_z_to_volume_z(depth, depthParams); }
// The point of Babylon's view space seen at a volume uv (the screen's, scaled by coordScale) at Blender's view z,
// through the inverse of a projection.
vec3 volume_view_point(mat4 wininv, vec2 uv, float view_z) {
  vec2 ndc = uv / coordScale * 2.0 - 1.0;
  vec4 a = wininv * vec4(ndc, 0.0, 1.0), b = wininv * vec4(ndc, 0.5, 1.0);
  a.xyz /= a.w;
  b.xyz /= b.w;
  return mix(a.xyz, b.xyz, (-view_z - a.z) / (b.z - a.z));
}
vec3 volume_view_point(vec2 uv, float view_z) { return volume_view_point(inverseProjection, uv, view_z); }
vec3 tile_sample(sampler2D atlas, vec2 xy, float slice) {
  vec2 tile = vec2(mod(slice, atlasColumns), floor(slice / atlasColumns));
  return texture2D(atlas, (tile * volumeSize.xy + xy) / (vec2(textureSize(atlas, 0)))).rgb;
}
// A 3D texture's linear sample, clamped to its edge, of the atlas.
vec3 atlas_sample(sampler2D atlas, vec3 coord) {
  float z = clamp(coord.z * volumeSize.z - 0.5, 0.0, volumeSize.z - 1.0), k = floor(z);
  vec2 xy = clamp(coord.xy * volumeSize.xy, vec2(0.5), volumeSize.xy - 0.5);
  return mix(tile_sample(atlas, xy, k), tile_sample(atlas, xy, min(k + 1.0, volumeSize.z - 1.0)), z - k);
}
`;

const TARGETS = (count) => `#extension GL_EXT_draw_buffers : require
layout(location = 0) out highp vec4 glFragData[${count}];
precision highp float;
precision highp int;
`;

// blender-port: eevee_volume_lib.bsl.hh volume_froxel_jitter, volume_z_to_view_z, eevee_sampling_lib.bsl.hh
// interleaved_gradient_noise: where in its slice a froxel is sampled, by its noise and the sample's offset.
export const FROXEL_JITTER = `float interleaved_gradient_noise(vec2 pixel, float seed, float offset) {
  pixel += seed * (vec2(47.0, 17.0) * 0.695);
  return fract(offset + 52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));
}
float bl_volume_z_to_view_z(vec3 depth, float perspective, float z) {
  return perspective > 0.5 ? (exp2(z / depth.z) - depth.x) / depth.y : depth.x + (depth.y - depth.x) * z;
}
float bl_froxel_jitter(vec2 froxel, float offset) { return interleaved_gradient_noise(froxel, 0.0, offset); }`;

export const MAX_LIGHTS = 16;

// blender-port: eevee_volume.bsl.hh scatter_main, LightEvalCtx::light_eval_single, volume_light,
// eevee_light_lib.bsl.hh light_attenuation_volume, light_spot_attenuation, light_influence_attenuation: each froxel's
// light toward the view, its emission plus what it scatters of the lights (each a point, Cem Yuksel's attenuation
// without singularity, through the Henyey-Greenstein phase of its mean anisotropy) and of the world (isotropic, its
// spherical harmonics' L0), clamped as the scene's volume clamps say. A light that casts shadows is hidden where its
// shadow map says (shadow_sample: a sun's cascades, a spot's map, a point's cube, each one depth comparison) and, with
// the scene's Volumes > Shadows, dimmed by the volumes' extinction toward it. Each froxel's light and extinction blend
// with the last frame's at its point (reprojected as the view moves), so its jitter's noise averages away over frames.
// `shadows`: the shadow maps' kinds ('SUN', 'SPOT', 'CUBE') in the order of the lights' shadow slots.
export const scatterShader = (shadows) => `${TARGETS(4)}${shadows.map(shadowDeclaration).join('\n')}
uniform float ndcHalfZ;
uniform sampler2D scatteringProps;
uniform sampler2D extinctionProps;
uniform sampler2D emissionProps;
uniform sampler2D phaseProps;
uniform mat4 inverseView;
uniform vec4 cameraPosition;
uniform float jitterOffset;
// The last frame's scatter result, and how much of it a froxel keeps (0: none).
uniform sampler2D scatteringHistory;
uniform sampler2D extinctionHistory;
uniform float historyOpacity;
// eevee_volume.cc set_view: this frame's projection without the film's jitter (inverted), this view to the last's, and
// the last frame's stable projection, depths and padding.
uniform mat4 stableInverseProjection;
uniform mat4 currViewToPastView;
uniform mat4 historyProjection;
uniform vec3 historyDepthParams;
uniform vec2 historyCoordScale;
uniform float lightCount;
// xyz: position (a sun's unused); w: 0 point, 1 spot, 2 sun, 3 area.
uniform vec4 lightPosition[${MAX_LIGHTS}];
// xyz: the light's z axis (toward its back, a sun's toward it); w: its shape radius.
uniform vec4 lightAxis[${MAX_LIGHTS}];
// rgb: color times its volume power; a: its volume influence radius' inverse square.
uniform vec4 lightColor[${MAX_LIGHTS}];
// spot_mul, spot_bias, whether it casts shadows, its shadow map's slot (-1: none).
uniform vec4 lightSpot[${MAX_LIGHTS}];
uniform mat4 viewMatrix;
uniform mat4 projection;
// The scene's Volumes > Shadows steps (0: off), and how far a sun's are marched (across the volumes).
uniform float shadowSteps;
uniform float shadowReach;
uniform vec3 worldRadiance;
uniform vec2 volumeClamp;
${GRID}${FROXEL_JITTER}
const float M_PI = 3.14159265358979323846;
float square(float x) { return x * x; }
float reduce_max(vec3 v) { return max(v.x, max(v.y, v.z)); }
float volume_phase_function(vec3 V, vec3 L, float g) {
  float cos_theta = dot(V, L);
  g = clamp(g, -1.0 + 1e-3, 1.0 - 1e-3);
  float sqr_g = g * g;
  return (1.0 - sqr_g) / max(1e-8, 4.0 * M_PI * pow(1.0 + sqr_g - 2.0 * g * cos_theta, 3.0 / 2.0));
}
float light_influence_attenuation(float dist, float inv_sqr_influence) {
  float factor = square(dist) * inv_sqr_influence;
  float fac = clamp(1.0 - square(factor), 0.0, 1.0);
  return square(fac);
}
vec3 brightness_clamp_max(vec3 color, float limit) {
  return limit > 0.0 ? color * clamp(limit / max(1e-8, reduce_max(abs(color))), 0.0, 1.0) : color;
}
// blender-port: eevee_volume_lib.bsl.hh volume_view_to_jitter: a world point's volume coordinates.
vec3 volume_world_to_uvw(vec3 P) {
  vec3 v = (viewMatrix * vec4(P, 1.0)).xyz;
  vec4 clip = projection * vec4(v, 1.0);
  return vec3((clip.xy / clip.w * 0.5 + 0.5) * coordScale, view_z_to_volume_z(-v.z));
}
// blender-port: eevee_volume_lib.bsl.hh volume_history_uvw_get: a froxel's center in the last frame's grid, or -1
// outside it (volumeHistoryUvw in volumes.js).
vec3 volume_history_uvw_get(ivec3 froxel) {
  vec3 uvw = (vec3(froxel) + 0.5) / volumeSize;
  vec3 vs_P = volume_view_point(stableInverseProjection, uvw.xy, volume_z_to_view_z(uvw.z));
  vec3 vs_P_history = (currViewToPastView * vec4(vs_P, 1.0)).xyz;
  vec4 hs_P_history = historyProjection * vec4(vs_P_history, 1.0);
  vec3 uvw_history = vec3((hs_P_history.xy / hs_P_history.w * 0.5 + 0.5) * historyCoordScale, view_z_to_volume_z(-vs_P_history.z, historyDepthParams));
  if (hs_P_history.w < 0.0 || any(lessThan(uvw_history, vec3(0.0))) || any(greaterThan(uvw_history, vec3(1.0)))) return vec3(-1.0);
  return uvw_history;
}
// blender-port: eevee_volume.bsl.hh volume_shadow: the volumes' extinction marched toward the light, clamped to the
// grid's edge. port-override: a sun's march spans the volumes (shadowReach) where EEVEE's spans the view's frustum;
// beyond them the grid holds no extinction.
vec3 volume_shadow(vec3 P, vec3 L, float dist) {
  float dd = dist / shadowSteps;
  vec3 shadow = vec3(1.0);
  for (float t = 1.0; t < 128.0; t += 1.0) {
    if (t > shadowSteps) break;
    shadow *= exp(-atlas_sample(extinctionProps, volume_world_to_uvw(P + L * dd * t)) * dd);
  }
  return shadow;
}
// A shadow map's depth coordinates of a point, or nothing (z < 0) outside it.
vec3 shadow_uvz(mat4 matrix, vec3 P) {
  vec4 clip = matrix * vec4(P, 1.0);
  vec3 ndc = clip.xyz / clip.w, uvz = vec3(ndc.xy * 0.5 + 0.5, ndcHalfZ > 0.5 ? ndc.z : ndc.z * 0.5 + 0.5);
  return clip.w > 0.0 && all(greaterThanEqual(uvz, vec3(0.0))) && all(lessThanEqual(uvz, vec3(1.0))) ? vec3(uvz.xy, min(uvz.z, 0.99999994)) : vec3(-1.0);
}
float shadow_spot(highp sampler2DShadow map, mat4 matrix, vec3 P) {
  vec3 uvz = shadow_uvz(matrix, P);
  return uvz.z < 0.0 ? 1.0 : texture(map, uvz);
}
// A sun's cascade picked by the point's view depth as Babylon's shadowsFragmentFunctions picks it (its splits,
// viewFrustumZ), its depth clamped to the cascade's range as computeShadowWithCSMPCF1 clamps it.
float shadow_sun(highp sampler2DArrayShadow map, mat4 cascades[4], vec4 splits, float count, vec3 P) {
  float depth = (viewMatrix * vec4(P, 1.0)).z;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= count) break;
    if (depth > splits[i] && float(i) < count - 1.0) continue;
    vec4 clip = cascades[i] * vec4(P, 1.0);
    vec3 ndc = clip.xyz / clip.w, uvz = vec3(ndc.xy * 0.5 + 0.5, ndcHalfZ > 0.5 ? ndc.z : ndc.z * 0.5 + 0.5);
    if (all(greaterThanEqual(uvz.xy, vec2(0.0))) && all(lessThanEqual(uvz.xy, vec2(1.0)))) return texture(map, vec4(uvz.xy, float(i), clamp(uvz.z, 0.0, 0.99999994)));
  }
  return 1.0;
}
// Babylon's computeShadowCube: the distance to the light against the cube's, both over its depth range.
float shadow_cube(samplerCube map, vec2 depthValues, vec3 P, vec3 lightP) {
  vec3 d = P - lightP;
  float depth = clamp((length(d) + depthValues.x) / depthValues.y, 0.0, 1.0);
  d = normalize(d);
  d.y = -d.y;
  return depth > texture(map, d).x ? 0.0 : 1.0;
}
float light_shadow(float slot, vec3 P, vec3 lightP) {
${shadows.map((kind, j) => `  if (slot == ${j}.0) return ${shadowCall(kind, j)};`).join('\n')}
  return 1.0;
}
vec3 light_eval(int i, vec3 P, vec3 V, float anisotropy) {
  float type = lightPosition[i].w;
  vec3 L = lightAxis[i].xyz;
  float dist = 1.0, attenuation = 1.0, power = 1.0;
  if (type != 2.0) {
    L = lightPosition[i].xyz - P;
    dist = length(L);
    L /= max(dist, 1e-8);
    if (type == 1.0) {
      float z = dot(L, lightAxis[i].xyz);
      attenuation = z > 0.0 ? smoothstep(0.0, 1.0, z * lightSpot[i].x + lightSpot[i].y) : 0.0;
    }
    attenuation *= light_influence_attenuation(dist, lightColor[i].a);
    float r_sqr = square(lightAxis[i].w), d_sqr = square(dist);
    power = 2.0 / (d_sqr + r_sqr + dist * sqrt(d_sqr + r_sqr));
  }
  float visibility = attenuation;
  if (visibility < 1e-6 || light_shadow(lightSpot[i].w, P, lightPosition[i].xyz) < 0.5) return vec3(0.0);
  visibility *= volume_phase_function(-V, L, anisotropy);
  if (visibility < 1e-6) return vec3(0.0);
  vec3 Li = lightColor[i].rgb * power * visibility;
  if (shadowSteps > 0.0 && lightSpot[i].z > 0.5) Li *= volume_shadow(P, L, type == 2.0 ? shadowReach : dist);
  return Li;
}
void main(void) {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  ivec3 froxel = froxelOf(texel);
  vec3 scattering = texelFetch(emissionProps, texel, 0).rgb;
  vec3 extinction = texelFetch(extinctionProps, texel, 0).rgb;
  vec3 s_scattering = texelFetch(scatteringProps, texel, 0).rgb;
  vec2 phase = texelFetch(phaseProps, texel, 0).rg;
  float s_anisotropy = phase.x / max(1.0, phase.y);
  vec3 uvw = (vec3(froxel) + vec3(0.5, 0.5, 0.5 - bl_froxel_jitter(vec2(froxel.xy), jitterOffset))) / volumeSize;
  vec3 P = (inverseView * vec4(volume_view_point(uvw.xy, volume_z_to_view_z(uvw.z)), 1.0)).xyz;
  vec3 V = cameraPosition.w > 0.5 ? normalize(cameraPosition.xyz - P) : -cameraPosition.xyz;
  vec3 direct = vec3(0.0);
  if (reduce_max(s_scattering) > 0.0) {
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (float(i) >= lightCount) break;
      direct += light_eval(i, P, V, s_anisotropy);
    }
  }
  vec3 indirect = worldRadiance;
  direct = brightness_clamp_max(direct * s_scattering, volumeClamp.x);
  indirect = brightness_clamp_max(indirect * s_scattering, volumeClamp.y);
  scattering += direct + indirect;
  // eevee_volume.bsl.hh scatter_main's temporal reprojection.
  if (historyOpacity > 0.0) {
    vec3 last = volume_history_uvw_get(froxel);
    if (last.x != -1.0) {
      scattering = mix(scattering, atlas_sample(scatteringHistory, last), historyOpacity);
      extinction = mix(extinction, atlas_sample(extinctionHistory, last), historyOpacity);
    }
  }
  if (any(isnan(scattering)) || any(isnan(extinction))) { scattering = vec3(0.0); extinction = vec3(0.0); }
  glFragData[0] = vec4(scattering, 1.0);
  glFragData[1] = vec4(extinction, 1.0);
  // The same as the next frame's history, in half floats.
  glFragData[2] = glFragData[0];
  glFragData[3] = glFragData[1];
}
`;

const shadowDeclaration = (kind, j) => ({
  SPOT: `uniform highp sampler2DShadow volumeShadow${j};
uniform mat4 volumeShadowMatrix${j};`,
  SUN: `uniform highp sampler2DArrayShadow volumeShadow${j};
uniform mat4 volumeShadowCascades${j}[4];
uniform vec4 volumeShadowSplits${j};
uniform float volumeShadowCascadeCount${j};`,
  CUBE: `uniform samplerCube volumeShadow${j};
uniform vec2 volumeShadowDepth${j};`,
})[kind];
const shadowCall = (kind, j) => ({
  SPOT: `shadow_spot(volumeShadow${j}, volumeShadowMatrix${j}, P)`,
  SUN: `shadow_sun(volumeShadow${j}, volumeShadowCascades${j}, volumeShadowSplits${j}, volumeShadowCascadeCount${j}, P)`,
  CUBE: `shadow_cube(volumeShadow${j}, volumeShadowDepth${j}, P, lightP)`,
})[kind];
// The uniforms and samplers of a layout's shadow maps.
export const shadowUniforms = (shadows) => shadows.flatMap((kind, j) => ({ SPOT: [`volumeShadowMatrix${j}`], SUN: [`volumeShadowCascades${j}`, `volumeShadowSplits${j}`, `volumeShadowCascadeCount${j}`],
  CUBE: [`volumeShadowDepth${j}`] })[kind]);
export const shadowSamplers = (shadows) => shadows.map((kind, j) => `volumeShadow${j}`);

// blender-port: eevee_volume.bsl.hh integration_main: each froxel the light scattered toward the view and the
// transmittance from the grid's start to its far side, each slice's segment integrated analytically.
export const INTEGRATION = `${TARGETS(2)}uniform sampler2D scatteringTexture;
uniform sampler2D extinctionTexture;
${GRID}
void main(void) {
  ivec3 froxel = froxelOf(ivec2(gl_FragCoord.xy));
  vec3 scattering = vec3(0.0), transmittance = vec3(1.0);
  vec3 view_cell = volume_view_point((vec2(froxel.xy) + 0.5) / volumeSize.xy, volume_z_to_view_z(0.0));
  view_cell.z = -view_cell.z;
  float prev_ray_len, orig_ray_len;
  if (perspective > 0.5) {
    prev_ray_len = length(view_cell);
    orig_ray_len = prev_ray_len / view_cell.z;
  } else {
    prev_ray_len = view_cell.z;
    orig_ray_len = 1.0;
  }
  for (int i = 0; i <= froxel.z; i++) {
    ivec2 texel = texelOf(ivec3(froxel.xy, i));
    vec3 froxel_scattering = texelFetch(scatteringTexture, texel, 0).rgb;
    vec3 extinction = texelFetch(extinctionTexture, texel, 0).rgb;
    float cell_depth = volume_z_to_view_z((float(i) + 1.0) / volumeSize.z);
    float ray_len = orig_ray_len * cell_depth;
    float step_len = abs(ray_len - prev_ray_len);
    prev_ray_len = ray_len;
    vec3 froxel_transmittance = exp(-extinction * step_len);
    vec3 froxel_opacity = 1.0 - froxel_transmittance;
    // EEVEE's limit of the step's opacity over extinction as extinction goes to 0 (the step's length), taken below where
    // the division loses its precision.
    vec3 froxel_step_opacity = mix(froxel_opacity / max(extinction, vec3(1e-30)), vec3(step_len), vec3(lessThan(extinction * step_len, vec3(1e-4))));
    scattering += transmittance * froxel_scattering * froxel_step_opacity;
    transmittance *= froxel_transmittance;
  }
  glFragData[0] = vec4(scattering, 1.0);
  glFragData[1] = vec4(transmittance, 1.0);
}
`;

// blender-port: eevee_volume.bsl.hh resolve_frag, eevee_volume_lib.bsl.hh UnifiedVolumeData::resolve: the view's color
// seen through the volumes before its depth: its transmittance, plus their light. Its coverage (alpha) takes their
// opacity, so a view's own background shows through them as through the scene. A pixel's point is found with the
// matrices the view rendered it with (camera view's zoom and offset, the film's jitter) and placed in the grid by the
// grid's own, so the two need not frame alike.
export const RESOLVE = `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform sampler2D scatteringTexture;
uniform sampler2D transmittanceTexture;
uniform vec4 viewport;
uniform float ndcHalfZ;
// Whether this frame's integration ran (its shaders compiled).
uniform float integrated;
// The inverses of the view and projection the view rendered with; the grid's view and projection.
uniform mat4 renderInverseView;
uniform mat4 renderInverseProjection;
uniform mat4 gridView;
uniform mat4 gridProjection;
${GRID}
void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  vec2 uv = (vUV - viewport.xy) / viewport.zw;
  if (integrated < 0.5 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { gl_FragColor = color; return; }
  // The scene's own depth, through the projection it was drawn with; where nothing was drawn (or an infinite
  // projection's far plane), just in front of the far plane.
  float depth = texture2D(depthSampler, vUV).r, ndc_z = min(ndcHalfZ > 0.5 ? depth : depth * 2.0 - 1.0, 0.99999);
  vec4 viewP = renderInverseProjection * vec4(uv * 2.0 - 1.0, ndc_z, 1.0);
  vec3 P = (renderInverseView * vec4(viewP.xyz / viewP.w, 1.0)).xyz;
  vec3 vP = (gridView * vec4(P, 1.0)).xyz;
  vec4 clip = gridProjection * vec4(vP, 1.0);
  vec3 coord = vec3((clip.xy / clip.w * 0.5 + 0.5) * coordScale, view_z_to_volume_z(-vP.z) - 1.0 / volumeSize.z);
  vec3 scattering = atlas_sample(scatteringTexture, coord), transmittance = atlas_sample(transmittanceTexture, coord);
  float opacity = 1.0 - clamp(dot(transmittance, vec3(1.0 / 3.0)), 0.0, 1.0);
  gl_FragColor = vec4(color.rgb * transmittance + scattering, color.a + (1.0 - color.a) * opacity);
}
`;
