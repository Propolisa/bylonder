// Blender's lights cast shadows as Babylon's shadow generators: one for each light whose Cast Shadow is on (an area
// light's a cube from its center while Area Light Shadows is on), objects casting as their Visibility > Shadow says,
// drawn only for views that show the scene's lights.
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, PBRMaterial, Scene, Vector3, FreeCamera } from '@babylonjs/core';
import { createLight } from '../src/blenkernel/light/light-home.js';
import { createLightShadows, shadowJitter, shadowRange } from '../src/blenkernel/light/light-shadows.js';
import { createFilm, filmJitter } from '../src/render/film.js';
import { evaluatedMatrix, setEvaluatedMatrix } from '../src/runtime/object-transform.js';
import { Matrix } from '@babylonjs/core';
import { areaLightShadows } from '../src/blenkernel/light/area-light.js';

const engine = new NullEngine();
// The app's WebGL 2 engine has cascades (texture arrays with a depth texture); a NullEngine stands in for them.
Object.assign(engine, { createDepthStencilTexture: () => null });
engine._features.supportCSM = true;
const scene = new Scene(engine);
new FreeCamera('Camera', new Vector3(0, 5, -5), scene);
const sun = createLight('Sun', 'SUN', { use_shadow: true }, scene);
createLight('Lamp', 'POINT', { use_shadow: false }, scene);
const panel = createLight('Panel', 'AREA', { use_shadow: true }, scene);
const floor = MeshBuilder.CreateGround('Floor', { width: 4, height: 4 }, scene);
const ball = MeshBuilder.CreateSphere('Ball', {}, scene);
const hidden = Object.assign(MeshBuilder.CreateBox('Hidden', {}, scene), { metadata: { wbVisibleShadow: false } });
MeshBuilder.CreateBox('__helper', {}, scene);
const shadows = createLightShadows(scene);
shadows.setActive(true);
assert.deepEqual(shadows.generators.map((g) => g.getLight().name), ['Sun', 'Panel'], 'a shadow generator for the sun and the area light');
assert.ok(panel.needCube(), "an area light's shadow is a cube from its center");
areaLightShadows.set(scene, false);
shadows.setActive(true);
assert.deepEqual(shadows.generators.map((g) => g.getLight().name), ['Sun'], 'none for the area light with Area Light Shadows off');
const [generator] = shadows.generators;
assert.equal(generator.getLight(), sun);
assert.equal(generator.getClassName(), 'CascadedShadowGenerator', "a sun's shadow spans the view in cascades, fine near the eye, as EEVEE's clipmaps");
const map = generator.getShadowMap();
const casters = () => scene.meshes.filter((mesh) => map.renderListPredicate(mesh)).map((mesh) => mesh.name);
assert.deepEqual(casters(), ['Floor', 'Ball'], "objects cast but those whose Visibility > Shadow is off and Bylonder's helpers");
const fog = Object.assign(MeshBuilder.CreateBox('Fog', {}, scene), { material: Object.assign(new PBRMaterial('Volume', scene), { blenderNoSurface: true }) });
assert.ok(!casters().includes('Fog'), 'a material without a surface (a Volume alone) casts no surface shadow');
fog.dispose();
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
// A point light's shadow spans its influence as EEVEE's does (eevee_light.cc), not the camera's clip range: Neon Night's
// 120 W orange Door Light reaches 120^0.5 m, its near clip 1/4000 of that, its bias a few millimeters there, so a sign's
// tube 0.2 m off the wall shadows it.
const door = createLight('Door Light', 'POINT', { use_shadow: true, energy: 120, color: [1, 0.5, 0.2], shadow_soft_size: 0.1 }, scene);
assert.deepEqual(shadowRange(door.metadata.wbLight), { near: Math.sqrt(120) / 4000, far: Math.sqrt(120) });
assert.equal(shadowRange({ ...door.metadata.wbLight, use_custom_distance: true, cutoff_distance: 5 }).far, 5, 'a Custom Distance bounds it');
shadows.setActive(true);
const doorShadow = shadows.generators.find((g) => g.getLight() === door);
assert.equal(door.shadowMaxZ, Math.sqrt(120));
const biasMeters = doorShadow.bias * (door.shadowMinZ + door.shadowMaxZ);
assert.ok(biasMeters > 0.001 && biasMeters < 0.02, `the depth bias is ${biasMeters} m`);
// Soft shadows: a film's samples after the first see the light from points within its radius (EEVEE's sphere light),
// the first (all a moving view shows) from its center.
assert.equal(shadowJitter(0, 0.1), null, 'the first sample keeps the light still');
assert.equal(shadowJitter(3, 0), null, 'a light of no radius stays still');
const offsets = Array.from({ length: 63 }, (_, i) => shadowJitter(i + 1, 0.1));
assert.ok(offsets.every((o) => o.length() <= 0.1 + 1e-9), 'within the radius');
const mean = offsets.reduce((sum, o) => sum.addInPlace(o), Vector3.Zero()).scale(1 / offsets.length);
assert.ok(mean.length() < 0.02, 'around the center');
{
  const home = new Vector3(3.6, 0.4, -0.8), at = (v) => v.equalsWithEpsilon(home, 1e-6);
  setEvaluatedMatrix(door, Matrix.Translation(home.x, home.y, home.z));
  const camera = scene.activeCamera, film = createFilm(scene, camera), map = doorShadow.getShadowMap();
  const drawnAt = (index) => {
    film.sample(filmJitter(index), index);
    map.onBeforeBindObservable.notifyObservers(map);
    const at = evaluatedMatrix(door).getTranslation();
    scene.onAfterCameraRenderObservable.notifyObservers(camera);
    return at;
  };
  assert.ok(at(drawnAt(0)), 'the first sample draws the light where it is');
  const moved = drawnAt(5);
  assert.ok(!at(moved) && Vector3.Distance(moved, home) <= 0.1 + 1e-6, 'a later one within its radius');
  assert.ok(at(evaluatedMatrix(door).getTranslation()), 'and back after the view draws');
  // A frame graph draws without the camera's observables: the light is back after the frame.
  film.sample(filmJitter(3), 3);
  map.onBeforeBindObservable.notifyObservers(map);
  scene.onAfterRenderObservable.notifyObservers(scene);
  assert.ok(at(evaluatedMatrix(door).getTranslation()), 'and back after a frame a frame graph draws');
  film.sample(null);
  map.onBeforeBindObservable.notifyObservers(map);
  assert.ok(at(evaluatedMatrix(door).getTranslation()), 'a complete film keeps it still');
  film.dispose();
}
console.log('Light shadows: a generator for each light that casts, casters by their shadow visibility passed');
