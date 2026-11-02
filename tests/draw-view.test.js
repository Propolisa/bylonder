// Babylon's lighting takes the view's incoming direction as Blender's (draw-view.js viewEye): an orthographic camera's
// forward axis, in Babylon's PBR material through its plugin and in a Blender node material through its surface block.
import assert from 'node:assert/strict';
import { Camera, FreeCamera, MeshBuilder, NullEngine, PBRMaterial, Scene, ShaderStore, Vector3 } from '@babylonjs/core';
import { REFLECTION_EYE, VIEW_FORWARD, viewForward } from '../src/draw/draw-view.js';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';

const engine = new NullEngine(), scene = new Scene(engine);
const camera = Object.assign(new FreeCamera('Camera', new Vector3(0, 0, -5), scene), { mode: Camera.ORTHOGRAPHIC_CAMERA });
camera.setTarget(Vector3.Zero());
assert.deepEqual(viewForward(camera).asArray().map((v) => Math.round(v * 1e6) / 1e6), [0, 0, 1, 1], 'an orthographic view looks along its axis');

const pbr = Object.assign(MeshBuilder.CreateSphere('PBR', {}, scene), { material: new PBRMaterial('PBR', scene) });
const tree = { nodes: [{ idname: 'ShaderNodeBsdfGlossy', name: 'Glossy' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['Glossy', 'BSDF', 'Material Output', 'Surface']] };
const glossy = Object.assign(MeshBuilder.CreateSphere('Glossy', {}, scene), { material: nodeMaterialFromTree('Glossy', scene, tree).material });
for (let i = 0; i < 50 && ![pbr, glossy].every((mesh) => mesh.subMeshes[0].effect?.isReady()); i++) {
  scene.render();
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const fragment = (mesh) => mesh.subMeshes[0].effect._fragmentSourceCode;
assert.ok(fragment(pbr).includes(`viewDirectionW = normalize((${VIEW_FORWARD}.w > 0.5`), "the PBR material's view direction is the view's");
assert.match(ShaderStore.IncludesShadersStore.reflectionFunction, REFLECTION_EYE, "Babylon's reflection reads the eye where the plugin sets it");
assert.ok(fragment(glossy).includes(`${VIEW_FORWARD}`) && /viewDirectionW = normalize\(\w+ - /.test(fragment(glossy)), 'the node material shades from its own eye');
assert.ok(glossy.material._sharedData.bindableBlocks.some((block) => block.getClassName() === 'BlenderViewEyeBlock'), "the node material's eye is bound each frame");
console.log('Draw view: an orthographic view lights along its axis passed');
