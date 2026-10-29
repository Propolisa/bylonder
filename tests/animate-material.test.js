// A material's color keyed on Blender's RNA paths (the Principled BSDF's Base Color input and Material.diffuse_color),
// as the Properties editor's I keys it: Blender's animation evaluates Main at a frame (main-sync.js frameChanged) and
// the view draws the evaluated color as the Babylon material's albedo.
import assert from 'node:assert/strict';
import { NullEngine, Scene, PBRMaterial, Color3 } from '@babylonjs/core';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { sceneMain } from './scene-main.js';

const close = (a, b, label) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-3), `${label}: ${a} != ${b}`);
const scene = new Scene(new NullEngine()), objects = [];
objects.scene = scene;
const cube = buildMesh(scene, 'Cube', { operator: 'mesh.primitive_cube_add', options: {} });
cube.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
const paint = Object.assign(new PBRMaterial('Paint', scene), { albedoColor: new Color3(1, 0, 0), metallic: 0, roughness: 0.5 });
cube.material = paint;
objects.push(cube);
const animation = createAnimationModel(), world = { scene, objects, animation };
world.materials = createMaterialLibrary(world);
world.materials.sync();
const sync = sceneMain(world);
animation.evaluateMain = (frame) => sync.frameChanged(frame);
const { blender } = sync, { anim } = animation;
sync.flush();
const ma = sync.materialOf(paint), baseColor = 'node_tree.nodes["Principled BSDF"].inputs[0].default_value';

// Keyed at frames 1 and 21 as the Properties editor keys the color under the pointer: the value Main holds then.
const keyAt = (frame, color) => {
  sync.frameChanged(frame);
  paint.albedoColor = color;
  sync.flush();
  assert.equal(anim.keyInsert(ma, baseColor), 4, `Base Color keyed at frame ${frame}`);
  assert.equal(anim.keyInsert(ma, 'diffuse_color'), 4, `diffuse_color keyed at frame ${frame}`);
};
keyAt(1, new Color3(1, 0, 0));
keyAt(21, new Color3(0, 0, 1));
assert.deepEqual([...new Set(anim.fcurves(ma).map((f) => f.rna_path))], [baseColor, 'diffuse_color']);

// The frame between: Blender's animation evaluates Main, the view draws the albedo.
animation.seek(11);
close(paint.albedoColor.asArray(), [0.5, 0, 0.5], 'the albedo at frame 11');
animation.seek(21);
close(paint.albedoColor.asArray(), [0, 0, 1], 'the albedo at frame 21');
assert.deepEqual(sync.check(), []);
console.log("Material color: keyed on Blender's RNA paths, evaluated by Blender's animation, drawn as the albedo");
