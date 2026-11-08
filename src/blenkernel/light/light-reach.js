// Which lights light which mesh. A Babylon material binds only so many lights (a uniform block each), and a mesh takes
// the first of the scene's lights in their order, so in a scene with more lights than that the last ones light nothing.
// EEVEE has no such cap: it culls each light beyond its influence radius (eevee_light.cc Light::shape_parameters_set,
// attenuation_radius_get). So each mesh keeps the lights that reach it, the strongest at it first, up to what a
// material binds; the others are its light's excluded meshes (Babylon's own way to keep a light off a mesh).
import { influenceRadius, isBlenderLight, lightRecord } from './light-home.js';

// A light's strength at a mesh's bounding sphere: its power over the squared distance to the sphere (at least half a
// meter, so a light at or inside a mesh counts fully whatever its size); 0 past its reach; a sun's or a light without a
// position everywhere.
function strengthAt(light, mesh) {
  if (!light.position) return Infinity;
  const distance = Math.max(0, Math.hypot(...light.position.map((v, i) => v - mesh.center[i])) - mesh.radius);
  if (distance > light.reach) return 0;
  return light.power / Math.max(distance, 0.5) ** 2;
}

// For each mesh ({ id, center, radius }), the ids of the lights ({ id, position, reach, power }) that light it,
// at most `budget`, the strongest at it first; and the meshes reached by more lights than that.
export function chooseLights(lights, meshes, budget) {
  const chosen = new Map(), crowded = [];
  for (const mesh of meshes) {
    const reaching = lights.map((light) => [light.id, strengthAt(light, mesh)]).filter(([, strength]) => strength > 0)
      .sort((a, b) => b[1] - a[1]);
    if (reaching.length > budget) crowded.push(mesh.id);
    chosen.set(mesh.id, new Set(reaching.slice(0, budget).map(([id]) => id)));
  }
  return { chosen, crowded };
}

// A scene light as chooseLights takes it: a Blender light by its record (a sun reaches everywhere), another light as
// reaching everywhere.
function lightReach(light) {
  const record = isBlenderLight(light) && lightRecord(light);
  if (!record || record.type === 'SUN') return { id: light.uniqueId, position: null };
  const position = light.getAbsolutePosition();
  return { id: light.uniqueId, position: [position.x, position.y, position.z], reach: influenceRadius(record).surface,
    power: Math.abs(record.energy) * Math.max(...record.color) };
}

const meshSphere = (mesh) => {
  const sphere = mesh.getBoundingInfo().boundingSphere;
  return { id: mesh.uniqueId, center: [sphere.centerWorld.x, sphere.centerWorld.y, sphere.centerWorld.z], radius: sphere.radiusWorld };
};

// Keeps each light off the meshes that do not choose it, again whenever a light or a mesh moves or the scene's lights
// or meshes change. `warn(message)` hears once of each mesh that more lights reach than its material binds.
export function createLightReach(scene, warn = () => {}) {
  let state = '';
  const warned = new Set();
  return {
    update(budget) {
      const lights = scene.lights, meshes = scene.meshes.filter((mesh) => mesh.material && mesh.getTotalVertices() > 0);
      const key = [budget, ...lights.map((l) => `${l.uniqueId}:${l.getWorldMatrix?.().updateFlag ?? ''}:${l.intensity}`),
        ...meshes.map((m) => `${m.uniqueId}:${m.getWorldMatrix().updateFlag}`)].join();
      if (key === state) return;
      state = key;
      if (lights.length <= budget) {
        for (const light of lights) if (light.excludedMeshes.length) light.excludedMeshes = [];
        return;
      }
      const { chosen, crowded } = chooseLights(lights.map(lightReach), meshes.map(meshSphere), budget);
      for (const light of lights) {
        const excluded = meshes.filter((mesh) => !chosen.get(mesh.uniqueId).has(light.uniqueId));
        const same = excluded.length === light.excludedMeshes.length && excluded.every((mesh, i) => light.excludedMeshes[i] === mesh);
        if (!same) light.excludedMeshes = excluded;
      }
      for (const id of crowded) {
        const mesh = meshes.find((m) => m.uniqueId === id);
        if (warned.has(mesh.name)) continue;
        warned.add(mesh.name);
        warn(`"${mesh.name}" is reached by more lights than its material can take (${budget}); the weakest at it are left out`);
      }
    },
  };
}
