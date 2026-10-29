// A frame change (main-sync.js frameChanged): Blender's animation system evaluates Main for the frame (view-api.cc
// view_frame_set) and the view draws the evaluated values by kind: an object's transform, a light's data. (Material
// paths wait for the module's RNA to resolve them.)
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3, PointLight, PBRMaterial, Color3 } from '@babylonjs/core';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { asObject } from '../src/runtime/object-transform.js';
import { BlenderAnimation } from '../src/blenkernel/animation/anim-blender.js';
import { sceneMain } from './scene-main.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';

const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const cube = buildMesh(scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
cube.material = Object.assign(new PBRMaterial('Paint', scene), { albedoColor: new Color3(0.8, 0.8, 0.8), metallic: 0, roughness: 0.5 });
const lamp = asObject(new PointLight('Lamp', new Vector3(0, 4, 0), scene));
lamp.metadata = { wbId: 'lamp' };
objects.push(cube, lamp);
const world = { scene, objects, animation: createAnimationModel() };
world.materials = createMaterialLibrary(world);
const sync = sceneMain(world);
sync.flush();
const { blender } = sync, anim = new BlenderAnimation(blender);
const keys = (id, path, index, values) => {
  const fcurve = anim.fcurve(id, path, index);
  for (const [frame, value] of values) anim.insert(fcurve, frame, value);
};
keys(sync.objectOf(cube), 'location', 0, [[1, 0], [11, 4]]);
keys(blender.data(sync.objectOf(lamp)), 'energy', 0, [[1, 10], [11, 30]]);

sync.frameChanged(6);
assert(Math.abs(cube.position.x - 2) < 1e-4, `the cube's location at frame 6: ${cube.position.x}`);
const energy = blender.data(sync.objectOf(lamp));
assert(lamp.intensity > 0 && Math.abs(lamp.intensity * 4 * Math.PI - 20) < 1e-3, `the light's energy at frame 6 is 20 W: ${lamp.intensity * 4 * Math.PI} (${energy})`);
sync.frameChanged(11);
assert(Math.abs(cube.position.x - 4) < 1e-4);
assert.deepEqual(sync.check(), []);
console.log("Frame change: Main evaluated by Blender's animation system, its values drawn by kind");
