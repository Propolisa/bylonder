// Blender's lights cast shadows as Babylon's shadow generators: one for each light whose Cast Shadow is on (an area
// light none), objects casting as their Visibility > Shadow says, drawn only for views that show the scene's lights.
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, PBRMaterial, Scene, Vector3, FreeCamera } from '@babylonjs/core';
import { createLight } from '../src/blenkernel/light/light-home.js';
import { createLightShadows } from '../src/blenkernel/light/light-shadows.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 5, -5), scene);
const sun = createLight('Sun', 'SUN', { use_shadow: true }, scene);
createLight('Lamp', 'POINT', { use_shadow: false }, scene);
createLight('Panel', 'AREA', { use_shadow: true }, scene);
const floor = MeshBuilder.CreateGround('Floor', { width: 4, height: 4 }, scene);
const ball = MeshBuilder.CreateSphere('Ball', {}, scene);
const hidden = Object.assign(MeshBuilder.CreateBox('Hidden', {}, scene), { metadata: { wbVisibleShadow: false } });
MeshBuilder.CreateBox('__helper', {}, scene);
const shadows = createLightShadows(scene);
shadows.setActive(true);
assert.equal(shadows.generators.length, 1, 'a shadow generator for the sun only');
const [generator] = shadows.generators;
assert.equal(generator.getLight(), sun);
const map = generator.getShadowMap();
const casters = () => scene.meshes.filter((mesh) => map.renderListPredicate(mesh)).map((mesh) => mesh.name);
assert.deepEqual(casters(), ['Floor', 'Ball'], "objects cast but those whose Visibility > Shadow is off and Bylonder's helpers");
assert.ok(floor.receiveShadows && ball.receiveShadows && hidden.receiveShadows, 'objects receive');
shadows.setActive(false);
assert.deepEqual(casters(), [], 'a view without the scene lights draws no shadow map');
sun.metadata.wbLight.use_shadow = false;
shadows.setActive(true);
assert.equal(shadows.generators.length, 0, 'turning Cast Shadow off removes the generator');
// Every light lights every material, past Babylon's default of 4.
floor.material = new PBRMaterial('Stone', scene);
for (let i = 0; i < 4; i++) createLight(`Bulb ${i}`, 'POINT', {}, scene);
shadows.setActive(true);
assert.equal(floor.material.maxSimultaneousLights, scene.lights.length, 'a material takes all the lights');
for (let i = 4; i < 12; i++) createLight(`Bulb ${i}`, 'POINT', {}, scene);
shadows.setActive(true);
assert.equal(floor.material.maxSimultaneousLights, 8, "as many as a vertex shader's uniform blocks hold");
console.log('Light shadows: a generator for each light that casts, casters by their shadow visibility passed');
