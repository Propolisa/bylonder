import { createMesh, createPrimitive, addModifier, shadeSmooth } from '@workbench/sdk';

// Everything round on the table is turned like on a potter's wheel: a profile of edges, in Blender's axes as
// [radius, 0, height], turned by Blender's Screw modifier, given wall thickness by Solidify and smoothed by Subdivision.
function turned(name, profile, scene, { wall = 0, steps = 48, levels = 1 } = {}) {
  const mesh = createMesh(name, { vertices: profile.map(([r, z]) => [r, 0, z]), edges: profile.slice(1).map((_, i) => [i, i + 1]) }, scene);
  addModifier(mesh, 'SCREW', { steps, render_steps: steps, use_merge_vertices: true, use_normal_calculate: true });
  if (wall) addModifier(mesh, 'SOLIDIFY', { thickness: wall, use_even_offset: true, use_quality_normals: true });
  addModifier(mesh, 'SUBSURF', { levels, render_levels: levels + 1 });
  return mesh;
}

// A box of width x depth x height (Babylon's x, z, y) standing on its base, with Blender's Bevel rounding its edges.
function slab(name, [width, height, depth], scene, { bevel = 0.004, segments = 3 } = {}) {
  const x = width / 2, y = depth / 2, corners = [];
  for (const z of [0, height]) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) corners.push([sx * x, sy * y, z]);
  const box = createMesh(name, { vertices: corners, faces: [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] }, scene);
  addModifier(box, 'BEVEL', { width: bevel, segments, limit_method: 'NONE', harden_normals: true });
  return box;
}

export const carafe = (scene) => turned('Carafe', [[0, 0.002], [0.05, 0], [0.072, 0.012], [0.083, 0.06], [0.074, 0.12], [0.034, 0.19], [0.024, 0.25], [0.026, 0.3], [0.033, 0.312]], scene, { wall: 0.003, steps: 64 });
export const wine = (scene) => turned('Wine', [[0, 0.006], [0.066, 0.008], [0.077, 0.06], [0.069, 0.12], [0.05, 0.148], [0, 0.148]], scene, { steps: 48 });
export const wineGlass = (scene) => turned('Wine Glass', [[0, 0], [0.038, 0.001], [0.036, 0.005], [0.006, 0.012], [0.004, 0.06], [0.006, 0.085], [0.03, 0.105], [0.042, 0.14], [0.04, 0.17], [0.034, 0.195]], scene, { wall: 0.0018, steps: 64 });
export const bowl = (scene) => turned('Bowl', [[0, 0.004], [0.045, 0.004], [0.048, 0], [0.055, 0.004], [0.085, 0.03], [0.108, 0.062], [0.116, 0.074]], scene, { wall: 0.007, steps: 64 });
export const candlestick = (scene) => turned('Candlestick', [[0, 0], [0.06, 0], [0.062, 0.008], [0.05, 0.016], [0.022, 0.03], [0.014, 0.06], [0.024, 0.075], [0.011, 0.09], [0.011, 0.16], [0.03, 0.175], [0.03, 0.182], [0.012, 0.186], [0.012, 0.21], [0, 0.21]], scene, { steps: 48 });
export const candle = (scene) => turned('Candle', [[0, 0.21], [0.0105, 0.21], [0.0105, 0.29], [0.009, 0.296], [0, 0.293]], scene, { steps: 32 });

// A lemon: an ellipse with a nipple at each end, lying on its side.
export function lemonShape(scene, name) {
  const profile = [];
  for (let i = 0; i <= 16; i++) {
    const t = -1 + (2 * i) / 16, tip = Math.exp(-Math.pow((1 - Math.abs(t)) * 9, 2));
    profile.push([0.028 * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.15 * tip), 0.04 * t * (1 + 0.12 * tip)]);
  }
  const mesh = turned(name, profile, scene, { steps: 32 });
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

// A pear: the classic bell, with a stalk bent by Blender's Simple Deform.
export function pearShape(scene, name) {
  const profile = [[0, 0], [0.025, 0.003], [0.038, 0.02], [0.039, 0.04], [0.03, 0.062], [0.021, 0.08], [0.017, 0.098], [0.012, 0.11], [0, 0.114]];
  const body = turned(name, profile, scene, { steps: 32 });
  const stalk = createPrimitive(name + ' Stalk', 'mesh.primitive_cylinder_add', { vertices: 8, radius: 0.0025, depth: 0.035 }, scene);
  shadeSmooth(stalk);
  addModifier(stalk, 'SIMPLE_DEFORM', { deform_method: 'BEND', deform_axis: 'X', angle: 0.9 });
  stalk.position.y = 0.128;
  stalk.parent = body;
  return body;
}

// A bunch of grapes: one berry, drawn many times along a narrowing spiral.
export function grapes(scene, material) {
  const berry = createPrimitive('Grapes', 'mesh.primitive_uv_sphere_add', { radius: 0.011, segments: 20, ring_count: 12 }, scene);
  shadeSmooth(berry);
  berry.material = material;
  const matrices = [];
  for (let i = 0; i < 34; i++) {
    const t = i / 34, angle = i * 2.4, radius = 0.032 * (1 - t * 0.7);
    const scale = 0.9 + ((i * 37) % 10) / 40;
    matrices.push(BABYLON.Matrix.Compose(new BABYLON.Vector3(scale, scale * 1.1, scale), BABYLON.Quaternion.Identity(), new BABYLON.Vector3(Math.cos(angle) * radius, 0.012 + t * 0.03 * Math.sin(t * 3), Math.sin(angle) * radius - t * 0.09)));
  }
  berry.thinInstanceAdd(matrices);
  return berry;
}

// A linen cloth thrown on the table: Blender's Wave modifier ripples a grid, Solidify gives it a hem.
export function cloth(scene) {
  const cloth = createPrimitive('Cloth', 'mesh.primitive_grid_add', { x_subdivisions: 40, y_subdivisions: 40, size: 0.46 }, scene);
  shadeSmooth(cloth);
  addModifier(cloth, 'WAVE', { use_x: true, use_y: true, height: 0.025, width: 0.09, narrowness: 16, start_position_x: -0.4 });
  addModifier(cloth, 'SOLIDIFY', { thickness: 0.002 });
  addModifier(cloth, 'SUBSURF', { levels: 1 });
  return cloth;
}

export const table = (scene) => slab('Table', [1.6, 0.04, 0.8], scene, { bevel: 0.006 });
export const wall = (scene) => slab('Wall', [3, 1.6, 0.05], scene, { bevel: 0.002, segments: 1 });
