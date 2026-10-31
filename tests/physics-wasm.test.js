// Blender's particle systems, force fields and rigid bodies, run by Blender's code in the module and drawn by the view
// (main-view.js) as thin instances from one packed buffer: the overlay's shapes by Blender's shaders from each
// particle's point, an instanced object's geometry, hair paths' segments; a frame jumped to shows what playing up to it shows (view-api.cc view_frame_set), and
// a cache bakes.
import assert from 'node:assert/strict';
import { Material, NullEngine, Scene } from '@babylonjs/core';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { createSelection } from '../src/editors/object/selection.js';
import { blendData, setContextPointer } from '../src/python/bpy_rna.js';
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { sceneMain } from './scene-main.js';

const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const cube = (name) => {
  const node = buildMesh(scene, name, { operator: 'mesh.primitive_cube_add', options: {} });
  node.metadata = { wbId: name, wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
  objects.push(node);
  return node;
};
const emitter = cube('Emitter'), puff = cube('Puff');
const selection = createSelection(scene, objects);
selection.replace([emitter]);
const sync = sceneMain({ scene, objects }, selection);
sync.flush();
setContextPointer(sync.blender.C);
const drawn = (prefix) => scene.meshes.filter((m) => m.name.startsWith(prefix));
const play = (to) => { for (let f = 1; f <= to; f++) sync.frameChanged(f); };

// A particle system as Blender adds it: Halo particles, which the overlay draws as dots of their display size.
const ob = blendData().objects.get('Emitter');
ob.modifiers.new('ParticleSystem', 'PARTICLE_SYSTEM');
const settings = ob.particle_systems[0].settings;
sync.view();
play(30);
const [dots] = drawn('__instances');
assert(dots.thinInstanceCount > 100, `particles born over 30 frames are dots: ${dots.thinInstanceCount}`);
assert.equal(dots.geometry, scene.getMeshByName('__shape DOT').geometry);
// Crosses are lines Blender's shape shader expands each particle into; colored by speed, each particle's point carries
// its speed as its value, which the shader colors it by.
Object.assign(settings, { display_method: 'CROSS', display_color: 'VELOCITY' });
sync.view();
sync.frameChanged(30);
const [crosses] = drawn('__instances'), points = sync.blender.instances().find((g) => g.shape === 'CROSS').data;
assert.equal(crosses.material.fillMode, Material.LineListDrawMode);
assert(points[3] >= 0, `a value: ${points[3]}`);
Object.assign(settings, { display_method: 'RENDER', display_color: 'MATERIAL' });

// Rendered as an object: thin instances of its mesh, sharing its geometry.
settings.render_type = 'OBJECT';
settings.instance_object = blendData().objects.get('Puff');
sync.view();
play(30);
const [carrier] = drawn('__instances');
assert.equal(carrier.thinInstanceCount, sync.blender.instances().find((g) => g.shape === 'OBJECT').data.length / 16);
assert.equal(carrier.geometry, puff.geometry, "the instanced object's geometry is shared, not copied");
assert.equal(drawn('__instances').length, 1, 'instanced particles draw no shapes');
// Hair renders as paths: line segments, two indices each.
Object.assign(settings, { type: 'HAIR', render_type: 'PATH', count: 50, hair_length: 0.5 });
sync.view();
sync.frameChanged(1);
const [hair] = drawn('__instances');
assert(hair.thinInstanceCount >= 50 && hair.material.fillMode === Material.LineListDrawMode, `hair as segments: ${hair.thinInstanceCount}`);

// A wind field pushes emitted particles along its direction.
Object.assign(settings, { type: 'EMITTER', render_type: 'HALO', count: 200, frame_end: 1, lifetime: 100, normal_factor: 0 });
settings.effector_weights.gravity = 0;
sync.view();
const meanX = () => { const { data } = sync.blender.instances().find((g) => g.shape === 'DOT'); let x = 0; for (let i = 0; i < data.length; i += 16) x += data[i]; return x / (data.length / 16); };
play(20);
const still = meanX();
assert.equal(sync.run(() => sync.blender.run('object.effector_add', { type: 'WIND', rotation: [0, Math.PI / 2, 0] }), { meshes: [] }).status, OPERATOR_FINISHED);
sync.view();
blendData().objects.get('Wind').field.strength = 5;
sync.view();
play(20);
assert(meanX() > still + 0.5, `the wind blows the particles along +X: ${still} to ${meanX()}`);

// A cache bakes every frame of its range.
assert.equal(sync.blender.run('ptcache.bake_all', { bake: true }).status, OPERATOR_FINISHED);
assert(ob.particle_systems[0].point_cache.is_baked, ob.particle_systems[0].point_cache.info);
sync.blender.run('ptcache.free_bake_all', {});

// A rigid body falls; a frame jumped to is the frame played to.
selection.replace([puff]);
sync.flush();
assert.equal(sync.run(() => sync.blender.run('rigidbody.object_add', {}), { meshes: [puff] }).status, OPERATOR_FINISHED);
const height = () => { puff.computeWorldMatrix(true); return puff.getAbsolutePosition().y; };
sync.frameChanged(25);
const jumped = height();
play(25);
assert(jumped < -3, `it fell: ${jumped}`);
assert(Math.abs(height() - jumped) < 1e-5, `jumping to frame 25 (${jumped}) is playing to it (${height()})`);
console.log('physics ok');
