import { fbm, noise, mix, clamp01, normalMap } from './lib/textures.js';

const SIZE = 800, CELLS = 360;
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Where the land meets the sea: a coast running along z with bays and headlands. Land is at x < coastline(z).
export const coastline = (z) => 30 * Math.sin(z / 95) + 55 * (fbm(0.3, z / SIZE + 0.5, { scale: 3, octaves: 3, seed: 2 }) - 0.5) + 20;

// The bay the village sits in, and the headland the lighthouse stands on.
export const BAY = -130, HEADLAND = 150;

// Height above sea level in meters: rolling downs that end in cliffs at the shore, a sandy bay, and a sea floor beyond.
export function heightAt(x, z) {
  const u = x / SIZE + 0.5, v = z / SIZE + 0.5;
  const inland = coastline(z) - x;
  const bay = 1 - smoothstep(30, 90, Math.abs(z - BAY)), headland = Math.exp(-(((z - HEADLAND) / 110) ** 2));
  const hills = 22 * fbm(u, v, { scale: 3, octaves: 6, seed: 7 }) + 40 * smoothstep(40, 380, inland) * fbm(u, v, { scale: 2, octaves: 3, seed: 1 }) + 22 * headland;
  const cliff = smoothstep(-14 - 20 * bay, 16 + 40 * bay, inland + 8 * (noise(u * 40, v * 40, 40, 9) - 0.5));
  const shore = 1 - 0.85 * bay * (1 - smoothstep(30, 160, inland));
  return cliff * (1.5 + hills * shore) - (1 - cliff) * (3 + 8 * smoothstep(0, 120, -inland)) + (0.4 + 1.2 * cliff) * noise(u * 90, v * 90, 90, 4);
}

// Ground colors at dusk, by height and steepness: wet sand, dune grass, heather, chalk and rock on the cliffs.
function groundColor(height, slope, u, v) {
  const patch = fbm(u, v, { scale: 24, octaves: 3, seed: 12 });
  const grass = mix([0.17, 0.2, 0.07], [0.3, 0.27, 0.1], patch);
  const heather = mix(grass, [0.25, 0.12, 0.14], clamp01((patch - 0.55) * 4) * smoothstep(12, 30, height));
  const sand = mix([0.38, 0.32, 0.22], [0.5, 0.43, 0.3], patch);
  const rock = mix([0.3, 0.28, 0.25], [0.52, 0.5, 0.45], patch);
  let color = mix(sand, heather, smoothstep(1.2, 4, height));
  color = mix(color, rock, smoothstep(0.45, 0.75, slope));
  return mix(color, [0.1, 0.12, 0.12], smoothstep(0, -3, height));
}

export function createTerrain(scene) {
  const positions = [], colors = [], uvs = [], indices = [];
  const step = SIZE / CELLS;
  for (let j = 0; j <= CELLS; j++) for (let i = 0; i <= CELLS; i++) {
    const x = -SIZE / 2 + i * step, z = -SIZE / 2 + j * step, y = heightAt(x, z);
    const slope = Math.min(1, Math.hypot(heightAt(x + 1, z) - y, heightAt(x, z + 1) - y));
    positions.push(x, y, z);
    colors.push(...groundColor(y, slope, i / CELLS, j / CELLS), 1);
    uvs.push(i / CELLS, j / CELLS);
  }
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const a = j * (CELLS + 1) + i, b = a + 1, c = a + CELLS + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const data = Object.assign(new BABYLON.VertexData(), { positions, indices, colors, uvs });
  const normals = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  const terrain = new BABYLON.Mesh('Coast', scene);
  data.applyToMesh(terrain);
  const material = new BABYLON.PBRMaterial('Ground', scene);
  material.albedoColor = BABYLON.Color3.White();
  material.metallic = 0;
  material.roughness = 0.92;
  material.bumpTexture = normalMap(scene, 'Ground Detail', 256, (u, v) => fbm(u, v, { scale: 32, octaves: 4, seed: 3 }), 4);
  material.bumpTexture.uScale = material.bumpTexture.vScale = 60;
  terrain.material = material;
  terrain.receiveShadows = true;
  return terrain;
}

// The sea: a calm swell whose small waves are a scrolling normal map, mirroring the sky and the coast.
export function createSea(scene, reflected) {
  const sea = BABYLON.MeshBuilder.CreateGround('Sea', { width: 3000, height: 3000 }, scene);
  const material = new BABYLON.PBRMaterial('Sea', scene);
  material.albedoColor = new BABYLON.Color3(0.01, 0.03, 0.045);
  material.metallic = 0;
  material.roughness = 0.12;
  const ripples = normalMap(scene, 'Ripples', 256, (u, v) => fbm(u, v, { scale: 8, octaves: 4, seed: 19 }), 5);
  ripples.uScale = ripples.vScale = 220;
  material.bumpTexture = ripples;
  const mirror = new BABYLON.MirrorTexture('Sea Reflection', 1024, scene, true);
  mirror.mirrorPlane = new BABYLON.Plane(0, -1, 0, 0);
  mirror.renderList.push(...reflected);
  material.reflectionTexture = mirror;
  material.reflectionColor = new BABYLON.Color3(0.9, 0.9, 0.9);
  sea.material = material;
  sea.receiveShadows = true;
  return { sea, ripples, mirror };
}
