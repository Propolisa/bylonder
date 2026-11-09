// EEVEE's volume light probe sampling (eevee_lightprobe_volume.bsl.hh LightprobeVolumeRenderData) for the materials'
// diffuse light: the grids' functions are Blender's (glsl.js), the render data's methods are ported here over the atlas
// volume-probe-atlas.js builds, a 3D texture, and its grids' descriptions, a 2D texture of GRID_TEXELS per row.
import { glslFunction } from '../nodes/blender/glsl.js';
import { BRICK, BRICKS_X, GRID_TEXELS } from './volume-probe-atlas.js';

export const ATLAS = 'blProbeAtlas', GRIDS = 'blProbeGrids', DEFINE = 'BL_VOLUME_PROBES', CAPTURE = 'BL_PROBE_CAPTURE';

const PRELUDE = `precision highp sampler3D;
#define IRRADIANCE_GRID_BRICK_SIZE ${BRICK}
struct VolumeProbeData {
  mat3x4 world_to_grid_transposed;
  ivec3 grid_size_padded;
  int brick_offset;
  float normal_bias;
  float view_bias;
  float facing_bias;
};
struct BlProbeSH { vec4 L0; vec4 Mn1; vec4 M0; vec4 Mp1; };
`;

// blender-port: eevee_lightprobe_volume.bsl.hh LightprobeVolumeRenderData (select_volume_dithered, sample_probe_with_bias,
// sample_probe, sample_atlas) and eevee_spherical_harmonics.bsl.hh evaluate_lambert. A grid's VolumeProbeData is read
// from its row of the grids texture; a brick's place in the atlas is its index (no brick buffer).
const METHODS = `VolumeProbeData bl_probe_grid(int i) {
  VolumeProbeData grid;
  grid.world_to_grid_transposed = mat3x4(texelFetch(${GRIDS}, ivec2(0, i), 0), texelFetch(${GRIDS}, ivec2(1, i), 0), texelFetch(${GRIDS}, ivec2(2, i), 0));
  vec4 size = texelFetch(${GRIDS}, ivec2(3, i), 0), bias = texelFetch(${GRIDS}, ivec2(4, i), 0);
  grid.grid_size_padded = ivec3(size.xyz);
  grid.brick_offset = int(size.w);
  grid.normal_bias = bias.x;
  grid.view_bias = bias.y;
  grid.facing_bias = bias.z;
  return grid;
}
uvec2 bl_probe_brick_atlas_coord(int brick_index) {
  return uvec2(brick_index % ${BRICKS_X}, brick_index / ${BRICKS_X}) * ${BRICK}u;
}
BlProbeSH bl_probe_sample_atlas(vec3 atlas_coord) {
  vec4 coord = vec4(atlas_coord, float(IRRADIANCE_GRID_BRICK_SIZE)) / vec3(textureSize(${ATLAS}, 0)).xyzz;
  BlProbeSH sh;
  sh.L0 = textureLod(${ATLAS}, coord.xyz, 0.0);
  coord.z += coord.w;
  sh.Mn1 = textureLod(${ATLAS}, coord.xyz, 0.0);
  coord.z += coord.w;
  sh.M0 = textureLod(${ATLAS}, coord.xyz, 0.0);
  coord.z += coord.w;
  sh.Mp1 = textureLod(${ATLAS}, coord.xyz, 0.0);
  return sh;
}
// The grid that P falls in, the world's (the last) past every grid; near a grid's border, by a random amount, the next.
int bl_probe_select(vec3 P, float random, out vec3 lP) {
  int world = textureSize(${GRIDS}, 0).y - 1;
  float threshold = 0.5 + random * random * 0.75;
  for (int i = 0; i < world; i++) {
    VolumeProbeData grid = bl_probe_grid(i);
    if (bl_grid_local_coord(grid, P, lP)) {
      vec3 border = min(lP, vec3(grid.grid_size_padded) - lP);
      if (min(min(border.x, border.y), border.z) < threshold) continue;
      return i;
    }
  }
  lP = vec3(0.5);
  return world;
}
BlProbeSH bl_probe_sample(vec3 P, vec3 V, vec3 Ng, float random) {
  vec3 lP;
  VolumeProbeData grid = bl_probe_grid(bl_probe_select(P, random, lP));
  mat3 world_to_grid_transposed = mat3(grid.world_to_grid_transposed[0].xyz, grid.world_to_grid_transposed[1].xyz, grid.world_to_grid_transposed[2].xyz);
  vec3 lNg = normalize(Ng * world_to_grid_transposed);
  vec3 lV = normalize(V * world_to_grid_transposed);
  lP += lNg * grid.normal_bias;
  lP += lV * grid.view_bias;
  ivec3 brick_coord = bl_grid_brick_coord(lP);
  int brick_index = bl_grid_brick_index_get(grid, brick_coord);
  uvec2 atlas_coord = bl_probe_brick_atlas_coord(brick_index);
  vec3 brick_lP = bl_grid_brick_local_coord(lP, brick_coord);
  brick_lP = bl_grid_bias_sample_coord(${ATLAS}, grid, atlas_coord, brick_lP, lNg);
  return bl_probe_sample_atlas(vec3(vec2(atlas_coord), 0.0) + brick_lP);
}
// blender-port: eevee_lightprobe_sphere.bsl.hh extract_low_freq_lighting, normalization_factor: a reflection probe's light
// scaled by how bright the shading point's surroundings are against the probe's own, which keeps reflections of the sky
// out of rooms.
float bl_probe_normalization(BlProbeSH sh, float probe_ambient) {
  return clamp((sh.L0.r + sh.L0.g + sh.L0.b + 1e-6) / probe_ambient, 0.0, 1.0);
}
vec4 bl_probe_lambert(BlProbeSH sh, vec3 N) {
  vec4 radiance = 0.282094792 * sh.L0 + (2.0 / 3.0) * 0.488602512 * (-N.y * sh.Mn1 + N.z * sh.M0 - N.x * sh.Mp1);
  return max(radiance, vec4(0.0));
}
`;

const FUNCTIONS = ['pcg4d', 'grid_local_coord', 'grid_brick_index_get', 'grid_brick_coord', 'grid_brick_local_coord', 'grid_bias_sample_coord'];

// The samplers' declarations, for a fragment shader (Babylon's GLSL).
export const SAMPLERS = `uniform highp sampler3D ${ATLAS};
uniform highp sampler2D ${GRIDS};
`;
// The functions as [key, GLSL] to emit in order: Blender's under their names (which other nodes' code may emit too),
// then the render data's methods, which read the samplers, under DEFINE.
export function volumeProbeFunctions() {
  const library = new Map([['bl_probe_prelude', PRELUDE]]);
  for (const name of FUNCTIONS) for (const [symbol, text] of glslFunction(name)) library.set(symbol, text);
  return [...library, ['bl_probe_methods', `#ifdef ${DEFINE}
${METHODS}#endif
`]];
}
// The harmonics the probes give at P (Babylon's world; Blender's axes inside), light in RGB and the visibility of distant
// light in A. `offset` is the sample's random offset (render/dither.js), which dithers grid borders as EEVEE's
// rng_1D_get(SAMPLING_LIGHTPROBE) does.
export const volumeProbeSample = (P, N, V, offset) => `bl_probe_sample((${P}).xzy, (${V}).xzy, (${N}).xzy, bl_pcg4d(vec4((${P}).xzy, ${offset})).x)`;
// Their Lambertian radiance toward N (Babylon's world).
export const volumeProbeLambert = (sh, N) => `bl_probe_lambert(${sh}, (${N}).xzy)`;
