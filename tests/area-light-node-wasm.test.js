// Blender's node materials lit by an area light beside a light that casts shadows: Babylon's PBR block lists the area
// lights' LTC tables among its samplers (else they share texture unit 0 with a cube shadow map and every draw fails)
// and keeps area light support through a rebuild (else the lights' code calls functions its includes leave out). So
// does the material as File > Export > JavaScript writes it for plain Babylon.js.
import assert from 'node:assert/strict';
import { MeshBuilder, NodeMaterial, NullEngine, PointLight, RectAreaLight, Scene, ShadowGenerator, Vector3, FreeCamera } from '@babylonjs/core';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';
import { exportNodeMaterial } from '../src/io_scene_babylon/node-material-export.js';

// A ball lit by an area light and a point light casting its shadow, and the samplers its material's effect asks for
// (a NullEngine's effects keep none).
function litBall() {
  const scene = new Scene(new NullEngine());
  new FreeCamera('Camera', new Vector3(0, 0, -4), scene);
  const ball = MeshBuilder.CreateSphere('Ball', {}, scene);
  new RectAreaLight('Panel', new Vector3(-1, 2, -1), 1, 1, scene);
  const lamp = new PointLight('Lamp', new Vector3(1, 2, -1), scene);
  new ShadowGenerator(64, lamp).addShadowCaster(ball);
  ball.receiveShadows = true;
  const engine = scene.getEngine(), createEffect = engine.createEffect.bind(engine), asked = { samplers: [] };
  engine.createEffect = (name, options, ...rest) => { asked.samplers = options.samplers ?? rest[1]; return createEffect(name, options, ...rest); };
  return { scene, ball, asked };
}
const ready = async (ball) => {
  for (let i = 0; i < 50 && !ball.material.isReadyForSubMesh(ball, ball.subMeshes[0]); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  return ball.subMeshes[0];
};
const bindsLTC = (samplers) => ['areaLightsLTC1Sampler', 'areaLightsLTC2Sampler', 'shadowTexture1'].every((name) => samplers.includes(name));

const app = litBall();
const { material } = nodeMaterialFromTree('Lit', app.scene, { nodes: [{ idname: 'ShaderNodeBsdfPrincipled', name: 'P' }, { idname: 'ShaderNodeOutputMaterial', name: 'O' }],
  links: [['P', 'BSDF', 'O', 'Surface']] });
app.ball.material = material;
let subMesh = await ready(app.ball);
assert.ok(bindsLTC(app.asked.samplers), "the area lights' LTC tables are samplers beside the shadow map");
material.build();
subMesh = await ready(app.ball);
assert.match(subMesh.materialDefines.toString(), /#define AREALIGHTSUPPORTED/, 'area light support survives a rebuild of the material');

const page = litBall();
page.ball.material = NodeMaterial.Parse(await exportNodeMaterial(material), page.scene, '');
await ready(page.ball);
assert.ok(bindsLTC(page.asked.samplers), "the exported material binds the LTC tables beside the shadow map too");
console.log('Area lights: node materials, in the app and exported, bind their LTC tables beside shadow maps and keep area light support through a rebuild');
