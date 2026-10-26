import assert from 'node:assert/strict';
import { NullEngine, Scene, Color4, Color3, FreeCamera, Vector3 } from '@babylonjs/core';
import { createAnimationModel, address } from '../src/blenkernel/animation/model.js';
import { unitSettings as units, format, parse } from '../src/blenkernel/unit.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';

assert.equal(format(1.25, 'length'), '1.25 m');
assert.equal(format(1500, 'length'), '1.5 km');
assert.equal(format(Math.PI / 4, 'angle'), '45°');
assert.equal(parse('1 m 25 cm', 'length'), 1.25, 'separate units add up');
assert.equal(parse('90', 'angle'), Math.PI / 2);

const engine = new NullEngine(), scene = new Scene(engine);
scene.clearColor = new Color4(0.2, 0.3, 0.4, 1);
scene.fogMode = Scene.FOGMODE_LINEAR; scene.fogStart = 5; scene.fogEnd = 50;
const a = new FreeCamera('A', Vector3.Zero(), scene), b = new FreeCamera('B', Vector3.Zero(), scene);
let current = a;
const world = { scene, animation: createAnimationModel(), objects: [] };
let commits = 0;
const settings = createSceneSettings(world, { commit: () => commits++, cameras: { list: () => [a, b], get: () => current, set: c => { current = c; } } });
assert.equal(settings.capture(), undefined, 'untouched scene saves nothing');
settings.set('unitSettings.system', 'IMPERIAL');
assert.equal(units.length, 'FEET', 'changing the system resets the length unit like Blender');
assert.equal(format(0.3048, 'length'), '1 ft');
settings.set('camera', b);
settings.set('useGravity', false);
assert.equal(scene.gravity.length(), 0);
const savedScene = settings.capture();
assert.deepEqual(Object.keys(savedScene).sort(), ['camera', 'unitSettings', 'useGravity']);
settings.apply(undefined);
assert.equal(units.system, 'METRIC'); assert.equal(scene.gravity.y, -9.807);
settings.apply(savedScene);
assert.equal(current, b); assert.equal(units.system, 'IMPERIAL');
settings.apply(undefined);

const worlds = createWorlds(world, { commit: () => commits++ });
const authored = worlds.active();
assert.equal(authored.name, 'World');
assert.deepEqual(authored.background.color, [0.2, 0.3, 0.4], 'code-built clear color becomes the world color');
assert.equal(authored.volume.type, 'LINEAR');
assert.equal(worlds.capture(), undefined);
worlds.setViewportActive(true);
assert.equal(scene.fogEnabled, true);
worlds.setViewportActive(false);
assert.equal(scene.fogEnabled, false, 'Solid shading hides the world volume');
worlds.set(authored, 'background.strength', 2);
assert.ok(Math.abs(scene.clearColor.g - 0.6) < 1e-6, 'Background strength scales the color');
const ref = address('world:world', 'volume.end');
world.animation.channels.get(ref).set(80);
assert.equal(scene.fogEnd, 80, 'world channels drive Babylon fog');
const copy = worlds.create();
assert.equal(copy.name, 'World.001', 'New copies the active world with a unique name');
assert.equal(worlds.active(), copy);
worlds.unlink();
assert.deepEqual(scene.clearColor.asArray(), [0, 0, 0, 1], 'no world renders black');
assert.equal(worlds.capture({ save: true }).worlds.length, 1, 'orphan created worlds are dropped on save');
assert.equal(worlds.capture().worlds.length, 2, 'undo keeps orphan worlds');
const saved = worlds.capture();
assert.deepEqual(Object.keys(saved.worlds[0]).sort(), ['background', 'id', 'volume'], 'the code world is stored as a diff');
worlds.apply(undefined);
assert.equal(worlds.active().name, 'World'); assert.equal(scene.fogEnd, 50);
worlds.apply(saved);
assert.equal(worlds.active(), null); assert.equal(worlds.all().length, 2);
console.log('Scene: units, scene settings, world datablocks and Babylon mapping passed');

// Playback sync, like Blender's scene.sync_mode: Frame Dropping follows real time, Play Every Frame steps.
{
  const { createSceneTime } = await import('../src/blenkernel/scene/time.js');
  const drop = createSceneTime({ fps: 24 });
  drop.play(); drop.tick(0); drop.tick(500);
  assert.equal(drop.frame, 13, 'half a second at 24 fps drops to frame 13');
  const every = createSceneTime({ fps: 24, syncMode: 'NONE' });
  every.play(); every.tick(0); every.tick(500);
  assert.equal(every.frame, 2, 'a slow tick still advances one frame');
  assert.throws(() => createSceneTime({ syncMode: 'AUDIO' }), /syncMode/);
}
console.log('Scene time: playback sync modes passed');
