// EEVEE's irradiance atlas (eevee_lightprobe_volume.cc VolumeProbeModule::set_view and eevee_lightprobe_volume_load.bsl.hh)
// built on the CPU from the volume probes' baked caches: the grids smallest first and the world's last, each padded by a
// sample on every side and cut into bricks of 4 samples overlapping by one, every brick 5 layers deep (L0, L1 Mn1, M0,
// Mp1, then each cell's validity bits). Bricks follow each other in rows of BRICKS_X; a brick's place is its index, not a
// lookup as EEVEE's paged atlas has. All positions and directions are in Blender's axes.
import { shNew, shMul, shMadd, shAdd, shRotate, shTripleProduct, shDering, L0, MN1, M0, MP1 } from './spherical-harmonics.js';

export const BRICK = 4, BRICKS_X = 16, LAYERS = 5;
const STRIDE = BRICK - 1;
// The texels of a grid's description (volume-probe-shader.js bl_probe_grid): world_to_grid's rows, then size and brick
// offset, then the biases.
export const GRID_TEXELS = 5;

const divideCeil = (a, b) => Math.ceil(a / b);
const bricksOf = (padded) => padded.map((n) => divideCeil(n, STRIDE));
const count = (v) => v[0] * v[1] * v[2];

// A 4x4 matrix (column-major, Blender's matrix_world) as rows.
const rows = (m) => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => m[c * 4 + r]));
const multiply = (a, b) => a.map((row) => [0, 1, 2, 3].map((c) => row.reduce((s, v, k) => s + v * b[k][c], 0)));
function invert(m) {
  const a = m.map((row, r) => [...row, ...[0, 1, 2, 3].map((c) => +(r === c))]);
  for (let c = 0; c < 4; c++) {
    const p = a.reduce((best, row, r) => (r >= c && Math.abs(row[c]) > Math.abs(a[best][c]) ? r : best), c);
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    a[c] = a[c].map((v) => v / d);
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; a[r] = a[r].map((v, k) => v - f * a[c][k]); }
  }
  return a.map((row) => row.slice(4));
}
const determinant3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
  + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const transform = (m, p) => [0, 1, 2].map((r) => m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3]);
const scaleTranslate = (s, t) => [[s[0], 0, 0, t[0]], [0, s[1], 0, t[1]], [0, 0, s[2], t[2]], [0, 0, 0, 1]];

// blender-port: eevee_lightprobe_volume.bsl.hh grid_sample_position: a sample's place in the world, from its object's
// matrix (rows) and its coordinate in the unpadded grid.
export const gridSamplePosition = (objectToWorld, size, cell) => transform(objectToWorld, cell.map((c, i) => ((c + 1) / (size[i] + 1)) * 2 - 1));

// A grid's description: the probe's object matrix (column-major), its cache's size and the settings it is loaded with.
// blender-port: eevee_lightprobe_volume.cc VolumeProbeModule::set_view: grid_to_world and the order of the grids.
export function describeGrid({ matrix, size, settings }) {
  const objectToWorld = rows(matrix), padded = size.map((n) => n + 2);
  const gridToWorld = multiply(objectToWorld, multiply(scaleTranslate([1, 1, 1], [-1, -1, -1]),
    multiply(scaleTranslate(padded.map((n) => 2 / (n - 1)), [0, 0, 0]), scaleTranslate([1, 1, 1], [-0.5, -0.5, -0.5]))));
  return { objectToWorld, worldToGrid: invert(gridToWorld), padded, settings, volume: determinant3(objectToWorld), location: objectToWorld.map((row) => row[3]) };
}
export function sortGrids(grids) {
  return [...grids].sort((a, b) => a.volume - b.volume || a.location[0] - b.location[0] || a.location[1] - b.location[1] || a.location[2] - b.location[2]);
}

// The world as the last grid: one brick, identity matrix.
const worldGrid = () => ({ worldToGrid: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], padded: [1, 1, 1], settings: { normal_bias: 0, view_bias: 0, facing_bias: 0 }, world: true });

// The atlas of `grids` (describeGrid, with `cache`: { size, irradiance: 4 RGB arrays, visibility: 4 arrays or null,
// validity: bytes }) over the world's harmonics `worldSH` (spherical-harmonics.js): { width, height, depth, data
// (RGBA floats, x fastest), grids (RGBA floats, GRID_TEXELS per grid, one grid a row), count }. Without `compose`, as
// while a grid bakes, its samples (and its padding, their border's) keep their own light and visibility, not composed
// with the distant light.
export function buildAtlas(grids, worldSH, { compose = true } = {}) {
  const sorted = sortGrids(grids), all = [...sorted, worldGrid()];
  let offset = 0;
  for (const grid of all) { grid.brickOffset = offset; offset += count(bricksOf(grid.padded)); }
  const atlas = { width: BRICKS_X * BRICK, height: divideCeil(offset, BRICKS_X) * BRICK, depth: LAYERS * BRICK, grids: all };
  atlas.data = new Float32Array(atlas.width * atlas.height * atlas.depth * 4);
  loadWorld(atlas, all.length - 1, worldSH);
  // By order of dependency: each grid's distant light is what the larger grids and the world give where it is.
  for (let i = sorted.length - 1; i >= 0; i--) loadGrid(atlas, i, i + 1, compose);
  return { ...atlas, gridTexels: packGrids(all), count: all.length };
}

function packGrids(grids) {
  const data = new Float32Array(grids.length * GRID_TEXELS * 4);
  grids.forEach((grid, i) => {
    const { normal_bias = 0, view_bias = 0, facing_bias = 0 } = grid.settings;
    data.set([...grid.worldToGrid[0], ...grid.worldToGrid[1], ...grid.worldToGrid[2], ...grid.padded, grid.brickOffset, normal_bias, view_bias, facing_bias, 0], i * GRID_TEXELS * 4);
  });
  return data;
}

const brickAtlasCoord = (index) => [(index % BRICKS_X) * BRICK, Math.floor(index / BRICKS_X) * BRICK];
const texel = (atlas, x, y, z) => ((z * atlas.height + y) * atlas.width + x) * 4;
const LAYER_COEFS = [L0, MN1, M0, MP1];
function store(atlas, sh, [ax, ay], [lx, ly, lz]) {
  LAYER_COEFS.forEach((coef, layer) => atlas.data.set(sh.subarray(coef, coef + 4), texel(atlas, ax + lx, ay + ly, layer * BRICK + lz)));
}

// blender-port: eevee_lightprobe_volume_load.bsl.hh load_world: the world's harmonics in every texel of its brick.
function loadWorld(atlas, index, worldSH) {
  const sh = shDering(worldSH), at = brickAtlasCoord(atlas.grids[index].brickOffset);
  for (let z = 0; z < BRICK; z++) for (let y = 0; y < BRICK; y++) for (let x = 0; x < BRICK; x++) store(atlas, sh, at, [x, y, z]);
}

// A cache sample's harmonics (visibility in A; a uniform visibility without one, as the load's swizzles give it).
function cacheSample({ irradiance, visibility }, i) {
  const sh = shNew();
  LAYER_COEFS.forEach((coef, k) => {
    sh.set(irradiance[k].subarray(i * 3, i * 3 + 3), coef);
    sh[coef + 3] = visibility ? visibility[k][i] : +(k === 0);
  });
  return sh;
}

// blender-port: eevee_lightprobe_volume_load.bsl.hh load_grid: a grid's samples into its bricks, invalid samples dilated
// from valid neighbours, turned into the world's axes, over the distant light the grids after it give (masked by the
// sample's visibility), padding samples the distant light alone.
function loadGrid(atlas, index, start, compose) {
  const grid = atlas.grids[index], { cache, settings } = grid, size = cache.size, padded = grid.padded;
  const { validity_threshold = 0.4, dilation_threshold = 0.5, dilation_radius = 1, intensity = 1 } = settings;
  const at = (c) => (c[2] * size[1] + c[1]) * size[0] + c[0];
  const clampCoord = (c) => c.map((v, i) => Math.min(Math.max(v, 0), size[i] - 1));
  const validity = (c) => (cache.validity ? cache.validity[at(c)] / 255 : 0);
  const rotation = [0, 1, 2].map((r) => [0, 1, 2].map((c) => grid.objectToWorld[r][c]));
  const columns = [0, 1, 2].map((c) => Math.hypot(rotation[0][c], rotation[1][c], rotation[2][c]) || 1);
  const gridToWorldRotation = rotation.map((row) => row.map((v, c) => v / columns[c]));
  const bricks = bricksOf(padded);
  for (let bz = 0; bz < bricks[2]; bz++) for (let by = 0; by < bricks[1]; by++) for (let bx = 0; bx < bricks[0]; bx++) {
    const brickIndex = grid.brickOffset + bx + by * bricks[0] + bz * bricks[0] * bricks[1], output = brickAtlasCoord(brickIndex);
    for (let lz = 0; lz < BRICK; lz++) for (let ly = 0; ly < BRICK; ly++) for (let lx = 0; lx < BRICK; lx++) {
      const coord = [bx * STRIDE + lx - 1, by * STRIDE + ly - 1, bz * STRIDE + lz - 1], input = clampCoord(coord);
      const padding = coord.some((v, i) => v !== input[i]);
      let local;
      if (validity(input) > dilation_threshold) local = cacheSample(cache, at(input));
      else {
        let weights = 1e-8;
        local = shMul(cacheSample(cache, at(input)), weights);
        const radius = Math.trunc(dilation_radius);
        for (let z = -radius; z <= radius; z++) for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
          if (!x && !y && !z) continue;
          const neighbour = [input[0] + x, input[1] + y, input[2] + z];
          // texelFetch out of bounds reads zero.
          if (neighbour.some((v, i) => v < 0 || v >= size[i]) || validity(neighbour) < dilation_threshold) continue;
          const distance2 = x * x + y * y + z * z;
          if (distance2 > dilation_radius * dilation_radius) continue;
          local = shMadd(cacheSample(cache, at(neighbour)), 1 / distance2, local);
          weights += 1 / distance2;
        }
        local = shMul(local, 1 / weights);
      }
      local = shRotate(gridToWorldRotation, local);
      const visibility = shNew();
      for (const coef of LAYER_COEFS) visibility.fill(local[coef + 3], coef, coef + 4);
      // While a grid bakes, its padding repeats its border samples: the world's full visibility there would leak into
      // the bounces of every surface near the grid's border.
      if (compose) {
        const distant = sampleNoBias(atlas, gridSamplePosition(grid.objectToWorld, size, input), start);
        local = padding ? distant : shAdd(shMul(local, intensity), shTripleProduct(visibility, distant));
      }
      store(atlas, shDering(local), output, [lx, ly, lz]);
      if (lz === 0) {
        // Each cell's validity bits, four cells (z) a texel.
        const bits = [0, 1, 2, 3].map((cell) => {
          let mask = 0;
          for (let i = 0; i < 8; i++) {
            const corner = [i & 1, (i >> 1) & 1, (i >> 2) & 1];
            const sample = [coord[0] + corner[0], coord[1] + corner[1], coord[2] + cell + corner[2]], clamped = clampCoord(sample);
            if (validity(clamped) > validity_threshold || sample.some((v, k) => v !== clamped[k])) mask |= 1 << i;
          }
          return mask;
        });
        atlas.data.set(bits, texel(atlas, output[0] + lx, output[1] + ly, 4 * BRICK));
      }
    }
  }
}

// blender-port: eevee_lightprobe_volume.bsl.hh grid_local_coord.
function gridLocalCoord(grid, P) {
  const lP = [0, 1, 2].map((r) => grid.worldToGrid[r][0] * P[0] + grid.worldToGrid[r][1] * P[1] + grid.worldToGrid[r][2] * P[2] + grid.worldToGrid[r][3]);
  const clamped = lP.map((v, i) => Math.min(Math.max(v, 0.5), grid.padded[i] - 0.5));
  return { lP: clamped, inside: lP.every((v, i) => v === clamped[i]) };
}

// blender-port: eevee_lightprobe_volume.bsl.hh sample_probe_no_dithered_no_biases: the harmonics at P of the first grid
// from `start` that holds it, else the world's.
export function sampleNoBias(atlas, P, start) {
  let index = atlas.grids.length - 1, lP = [0.5, 0.5, 0.5];
  for (let i = start; i < atlas.grids.length - 1; i++) {
    const local = gridLocalCoord(atlas.grids[i], P);
    if (local.inside) { index = i; lP = local.lP; break; }
  }
  return sampleGrid(atlas, atlas.grids[index], lP);
}

// blender-port: eevee_lightprobe_volume.bsl.hh sample_probe, grid_brick_coord, grid_brick_local_coord and
// grid_bias_sample_coord with no normal, then sample_atlas's trilinear filtering.
function sampleGrid(atlas, grid, lP) {
  const bricks = bricksOf(grid.padded);
  const brick = lP.map((v) => Math.max(Math.trunc((v - 0.5) / STRIDE), 0));
  const [ax, ay] = brickAtlasCoord(grid.brickOffset + brick[0] + brick[1] * bricks[0] + brick[2] * bricks[0] * bricks[1]);
  const brickLP = lP.map((v, i) => Math.max(v, 0.5) - brick[i] * STRIDE);
  const cellStart = brickLP.map((v) => Math.floor(v - 0.5)), cellFract = brickLP.map((v, i) => v - 0.5 - cellStart[i]);
  const bits = atlas.data[texel(atlas, ax + cellStart[0], ay + cellStart[1], 4 * BRICK) + cellStart[2]];
  const weights = [];
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const corner = [i & 1, (i >> 1) & 1, (i >> 2) & 1];
    const positional = corner.reduce((w, c, k) => w * (c ? cellFract[k] : 1 - cellFract[k]), 1) + 0.001;
    // No normal: cos_theta 0 off the corner.
    const vector = corner.map((c, k) => c - cellFract[k]), cos = Math.hypot(...vector) > 1e-8 ? 0 : 1;
    const geometry = Math.min(Math.max(cos * 0.5 + 0.5, 0), 1) ** 2 + 0.2 + (grid.settings.facing_bias ?? 0);
    weights[i] = Math.min(Math.max(positional * geometry * ((bits >> i) & 1), 0), 1);
    total += weights[i];
  }
  const coord = [0.5, 0.5, 0.5].map((v, k) => v + cellStart[k] + (total ? weights.reduce((s, w, i) => s + ((i >> k) & 1) * w, 0) / total : 0));
  return sampleAtlas(atlas, [ax + coord[0], ay + coord[1], coord[2]]);
}

// A trilinear sample of the atlas's four harmonics layers at a texel coordinate (texel centres at .5), as textureLod.
function sampleAtlas(atlas, [x, y, z]) {
  const sh = shNew();
  const fetch = (layer, X, Y, Z) => {
    const cx = Math.min(Math.max(X, 0), atlas.width - 1), cy = Math.min(Math.max(Y, 0), atlas.height - 1), cz = Math.min(Math.max(Z, 0), BRICK - 1);
    return texel(atlas, cx, cy, layer * BRICK + cz);
  };
  const [x0, y0, z0] = [x, y, z].map((v) => Math.floor(v - 0.5)), [fx, fy, fz] = [x - 0.5 - x0, y - 0.5 - y0, z - 0.5 - z0];
  LAYER_COEFS.forEach((coef, layer) => {
    for (let i = 0; i < 8; i++) {
      const w = (i & 1 ? fx : 1 - fx) * ((i >> 1) & 1 ? fy : 1 - fy) * ((i >> 2) & 1 ? fz : 1 - fz);
      if (!w) continue;
      const t = fetch(layer, x0 + (i & 1), y0 + ((i >> 1) & 1), z0 + ((i >> 2) & 1));
      for (let c = 0; c < 4; c++) sh[coef + c] += w * atlas.data[t + c];
    }
  });
  return sh;
}
