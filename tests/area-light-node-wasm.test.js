// Blender's node materials lit by an area light beside a light that casts shadows: Babylon's PBR block lists the area
// lights' LTC tables among its samplers (else they share texture unit 0 with a cube shadow map and every draw fails)
// and keeps area light support through a rebuild (else the lights' code calls functions its includes leave out).
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, PointLight, RectAreaLight, Scene, ShadowGenerator, Vector3, FreeCamera } from '@babylonjs/core';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 0, -4), scene);
const ball = MeshBuilder.CreateSphere('Ball', {}, scene);
new RectAreaLight('Panel', new Vector3(-1, 2, -1), 1, 1, scene);
const lamp = new PointLight('Lamp', new Vector3(1, 2, -1), scene);
new ShadowGenerator(64, lamp).addShadowCaster(ball);
ball.receiveShadows = true;
const { material } = nodeMaterialFromTree('Lit', scene, { nodes: [{ idname: 'ShaderNodeBsdfPrincipled', name: 'P' }, { idname: 'ShaderNodeOutputMaterial', name: 'O' }],
  links: [['P', 'BSDF', 'O', 'Surface']] });
ball.material = material;
// The samplers the material asks its effect for (a NullEngine's effects keep none).
const engine = scene.getEngine(), createEffect = engine.createEffect.bind(engine);
let samplers = [];
engine.createEffect = (name, options, ...rest) => { samplers = options.samplers ?? rest[1]; return createEffect(name, options, ...rest); };
const ready = async () => {
  for (let i = 0; i < 50 && !material.isReadyForSubMesh(ball, ball.subMeshes[0]); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  return ball.subMeshes[0];
};
let subMesh = await ready();
assert.ok(samplers.includes('areaLightsLTC1Sampler') && samplers.includes('areaLightsLTC2Sampler') && samplers.includes('shadowTexture1'), "the area lights' LTC tables are samplers beside the shadow map");
material.build();
subMesh = await ready();
assert.match(subMesh.materialDefines.toString(), /#define AREALIGHTSUPPORTED/, 'area light support survives a rebuild of the material');
console.log('Area lights: node materials bind their LTC tables beside shadow maps and keep area light support through a rebuild');
