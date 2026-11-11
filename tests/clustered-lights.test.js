// Clustered Lights: where a scene has more lights than a material takes, its point and spot lights without shadows
// are drawn by one clustered container (overrides/babylon/clustered-lights.js); a light with a Custom Distance stays out
// while there is room, and the SDK's lookups still find every light.
import assert from 'node:assert/strict';
import { ClusteredLightContainer, DirectionalLight, NullEngine, PointLight, Scene, Vector3 } from '@babylonjs/core';
import { clusterLights, nodeById, sceneLights } from '../src/overrides/babylon/clustered-lights.js';

// A Null engine has no clusters; these tests give it a batch size as WebGL 2 with float blending would.
ClusteredLightContainer._GetEngineBatchSize = () => 32;
const lights = (scene, count, make = (i) => new PointLight(`Lamp ${i}`, new Vector3(i, 2, 0), scene)) => Array.from({ length: count }, (_, i) => Object.assign(make(i), { range: 5 }));

{
  const scene = new Scene(new NullEngine()), lamps = lights(scene, 6);
  assert.equal(clusterLights(scene, lamps, 8), null, 'as many lights as a material takes need no clusters');
}
{
  const scene = new Scene(new NullEngine()), lamps = lights(scene, 12), exact = new Set([lamps[0], lamps[1]]);
  const { container, cutPerTile } = clusterLights(scene, lamps, 8, (light) => exact.has(light));
  assert.deepEqual(container.lights.map((l) => l.name), lamps.slice(2).map((l) => l.name), 'ten lamps join the cluster');
  assert.deepEqual(cutPerTile, [], 'the two with a Custom Distance stay out, as there is room');
  assert.equal(scene.lights.length, 3, 'the scene draws two lights and the container');
  assert.equal(sceneLights(scene).length, 12, 'every light is still found');
  assert.equal(nodeById(scene, lamps[5].id), lamps[5], 'a clustered light is found by id');
}
{
  const scene = new Scene(new NullEngine()), suns = lights(scene, 6, (i) => new DirectionalLight(`Sun ${i}`, new Vector3(0, -1, 0), scene));
  const lamps = lights(scene, 4), exact = new Set([lamps[0], lamps[1]]);
  const { container, cutPerTile } = clusterLights(scene, [...suns, ...lamps], 8, (light) => exact.has(light));
  assert.deepEqual(cutPerTile.map((l) => l.name), ['Lamp 1'], 'six suns and the container leave room for one Custom Distance light; the other is cut per tile');
  assert.equal(container.lights.length, 3);
  assert.equal(scene.lights.length, 8, 'six suns, one lamp and the container: what a material takes');
}
console.log('Clustered lights: point and spot lights past what a material takes are drawn in clusters, Custom Distance lights kept out while there is room, every light still found');
