// Blender's node materials list every sampler their lights read: Babylon's PBR node block lists a light index's own
// textures only the first time it sees that index, so a variant of a shared material whose index holds another kind of
// light (here clustered lights, after a plain point light) would leave them on texture unit 0 beside a cube shadow
// map, and every draw of it fails (overrides/babylon/pbr-block-area-lights.js).
import assert from 'node:assert/strict';
import { ClusteredLightContainer, FreeCamera, MeshBuilder, NullEngine, PointLight, PrepareUniformsAndSamplersForLight, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import '../src/overrides/babylon/pbr-block-area-lights.js';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';

// A Null engine has no clusters; this one takes them as WebGL 2 with float blending would.
ClusteredLightContainer._GetEngineBatchSize = () => 32;
const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 0, -4), scene);
const plain = MeshBuilder.CreateSphere('Plain', {}, scene), clustered = MeshBuilder.CreateSphere('Clustered', {}, scene);
const lamp = new PointLight('Lamp', new Vector3(1, 2, -1), scene);
new ShadowGenerator(64, lamp).addShadowCaster(plain);
const bulb = new PointLight('Bulb', new Vector3(0, 1, -1), scene);
bulb.includedOnlyMeshes = [plain];
const container = new ClusteredLightContainer('Cluster', [], scene);
for (const x of [-1, 1]) container.addLight(new PointLight(`Clustered ${x}`, new Vector3(x, 1, -1), scene));
container.includedOnlyMeshes = [clustered];

const { material } = nodeMaterialFromTree('Lit', scene, { nodes: [{ idname: 'ShaderNodeBsdfPrincipled', name: 'P' }, { idname: 'ShaderNodeOutputMaterial', name: 'O' }],
  links: [['P', 'BSDF', 'O', 'Surface']] });
const engine = scene.getEngine(), createEffect = engine.createEffect.bind(engine), asked = new Map();
engine.createEffect = (name, options, ...rest) => {
  const effect = createEffect(name, options, ...rest);
  asked.set(effect, options.samplers ?? rest[1]);
  return effect;
};
async function samplersOf(mesh) {
  mesh.material = material;
  for (let i = 0; i < 100 && !material.isReadyForSubMesh(mesh, mesh.subMeshes[0]); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  const { effect, materialDefines: defines } = mesh.subMeshes[0], used = [];
  // What each lit index's light reads, as Babylon's full listing gives it (a Null engine compiles no shader to read).
  for (let i = 0; defines[`LIGHT${i}`]; i++) PrepareUniformsAndSamplersForLight(i, [], used, defines[`PROJECTEDLIGHTTEXTURE${i}`], [], false, defines[`IESLIGHTTEXTURE${i}`], defines[`CLUSTLIGHT${i}`]);
  return { listed: asked.get(effect), used };
}

await samplersOf(plain);
const { listed, used } = await samplersOf(clustered);
assert.ok(['lightDataTexture1', 'tileMaskTexture1'].every((name) => listed.includes(name)), `the clustered variant lists its cluster's textures (${listed.join(', ')})`);
assert.deepEqual(used.filter((name) => !listed.includes(name)), [], "every sampler its lights read is listed");
console.log("PBR block samplers: a node material's variants list every sampler their lights read, a cluster's after a plain light's");
