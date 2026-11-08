// A material's shadow drawn with its own shader compiles one depth program for every submesh that draws with that
// shader, not one per submesh (Babylon's ShadowDepthWrapper gives each a token of its own: gaku compiled hundreds).
import assert from 'node:assert/strict';
import { DirectionalLight, FreeCamera, MeshBuilder, NullEngine, Scene, ShadowGenerator, StandardMaterial, Vector3 } from '@babylonjs/core';
import { SharedShadowDepthWrapper } from '../src/draw/shadow-depth-wrapper.js';

const engine = new NullEngine(), scene = new Scene(engine);
new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const generator = new ShadowGenerator(256, new DirectionalLight('Sun', new Vector3(0, -1, 0), scene));
const material = new StandardMaterial('Shared', scene);
material.shadowDepthWrapper = new SharedShadowDepthWrapper(material, scene);
const meshes = [0, 1, 2].map((i) => Object.assign(MeshBuilder.CreateBox(`Box ${i}`, {}, scene), { material, position: new Vector3(i * 2, 0, 0) }));
for (const mesh of meshes) generator.addShadowCaster(mesh);
const map = generator.getShadowMap();
for (let i = 0; i < 20; i++) {
  scene.render();
  map.render();
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const programs = new Set(meshes.map((mesh) => material.shadowDepthWrapper.getEffect(mesh.subMeshes[0], generator, map.renderPassId)?.effect));
assert.ok(!programs.has(undefined), 'every caster has its depth program');
assert.equal(programs.size, 1, 'three boxes of one material share one depth program');
console.log('Shadow depth wrapper: casters of one material share its depth program passed');
