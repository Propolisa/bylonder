// An object without a material shows Blender's default surface (material_default_surface_init): a Principled BSDF at
// its defaults on a Material at its defaults, so it is drawn and lit from both sides as Blender draws it.
import assert from 'node:assert/strict';
import { Constants, MeshBuilder, NullEngine, PBRMaterial, Scene } from '@babylonjs/core';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';

const scene = new Scene(new NullEngine());
const library = createMaterialLibrary({ scene, objects: [] });
const surface = scene.defaultMaterial;
assert.deepEqual(surface.albedoColor.asArray().map((c) => +c.toFixed(3)), [0.8, 0.8, 0.8], "the Principled BSDF's Base Color");
assert.deepEqual([surface.metallic, surface.roughness, surface.indexOfRefraction], [0, 0.5, 1.5], 'its Metallic, Roughness and IOR');
assert.equal(surface.backFaceCulling, false, 'drawn from behind (Backface Culling off)');
assert.equal(surface.twoSidedLighting, true, 'and lit from behind');
assert.equal(surface.brdf.baseDiffuseModel, Constants.MATERIAL_DIFFUSE_MODEL_LAMBERT, "EEVEE's Lambert diffuse");
console.log('default surface ok');

// An empty slot among several draws the default surface, and still reads as empty.
const mesh = MeshBuilder.CreateBox('Bench', {}, scene), wood = new PBRMaterial('Wood', scene);
library.drawSlots(mesh, [wood, null]);
assert.ok(mesh.material.subMaterials[0] === wood && mesh.material.subMaterials[1] === scene.defaultMaterial, 'the empty slot draws the default surface');
const [first, second] = library.slots(mesh);
assert.ok(first === wood && second === null, 'and reads as empty');
console.log('empty slot ok');
