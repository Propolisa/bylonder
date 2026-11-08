// More lights than a material binds: each mesh keeps the lights that reach it, the strongest at it first, as EEVEE
// culls each light beyond its influence radius (light-reach.js), so a light far down a street still lights what is
// under it.
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { chooseLights, createLightReach } from '../src/blenkernel/light/light-reach.js';
import { createLight } from '../src/blenkernel/light/light-home.js';

// The choice: the strongest reaching lights per mesh, at most the budget; a sun everywhere; a light past its reach none.
{
  const lights = [{ id: 'sun', position: null }, { id: 'near', position: [0, 0, 2], reach: 10, power: 100 },
    { id: 'far', position: [0, 0, 8], reach: 10, power: 100 }, { id: 'away', position: [50, 0, 0], reach: 10, power: 1000 }];
  const { chosen, crowded } = chooseLights(lights, [{ id: 'box', center: [0, 0, 0], radius: 1 }], 2);
  assert.deepEqual([...chosen.get('box')], ['sun', 'near'], 'the sun and the nearer light, not the farther one or the one out of reach');
  assert.deepEqual(crowded, ['box'], 'three lights reach it, one more than it takes');
}

// A street of twelve lit boxes, each with a light above it: with a budget of four, every box keeps its own light.
{
  const scene = new Scene(new NullEngine()), material = new StandardMaterial('M', scene);
  const boxes = [], lamps = [];
  for (let i = 0; i < 12; i++) {
    const box = MeshBuilder.CreateBox(`Box ${i}`, { size: 1 }, scene);
    box.position.x = i * 6;
    box.material = material;
    boxes.push(box);
    const lamp = createLight(`Lamp ${i}`, 'POINT', { energy: 50 }, scene);
    lamp.position = new Vector3(i * 6, 2, 0);
    lamps.push(lamp);
  }
  for (const mesh of [...boxes]) mesh.computeWorldMatrix(true);
  const warnings = [];
  createLightReach(scene, (message) => warnings.push(message)).update(4);
  boxes.forEach((box, i) => assert.ok(box.lightSources.includes(lamps[i]), `box ${i} is lit by the light above it`));
  assert.ok(boxes.every((box) => box.lightSources.length <= 4), 'no box takes more lights than its material binds');
  assert.deepEqual(warnings, [], 'no box is reached by more lights than it takes');
}
console.log('Light reach: a mesh keeps the lights that reach it, the strongest first, so lights past the material limit still light what is near them');
