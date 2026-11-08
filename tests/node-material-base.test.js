// A Blender node material is built on Babylon's own material graph, as Babylon's PBR material recreated as a node
// material has it: morph targets, bones and instances on the vertex side, clip planes, Babylon's PBR lighting with its
// lights, shadows and reflection, fog, and image processing; its compiled shaders keep each of Babylon's paths.
import assert from 'node:assert/strict';
import { FreeCamera, MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { meshValue, nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const tree = { nodes: [{ idname: 'ShaderNodeBsdfPrincipled', name: 'Principled BSDF' }, { idname: 'ShaderNodeBsdfDiffuse', name: 'Diffuse' }, { idname: 'ShaderNodeMixShader', name: 'Mix' },
  { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
links: [['Principled BSDF', 'BSDF', 'Mix', 'Shader'], ['Diffuse', 'BSDF', 'Mix', 'Shader_001'], ['Mix', 'Shader', 'Material Output', 'Surface']] };
const { material } = nodeMaterialFromTree('Base', scene, tree);
const mesh = Object.assign(MeshBuilder.CreateSphere('Sphere', {}, scene), { material });
for (let i = 0; i < 50 && !mesh.subMeshes[0].effect?.isReady(); i++) {
  scene.render();
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const built = new Set();
const visit = (block) => {
  if (!block || built.has(block)) return;
  built.add(block);
  for (const input of block.inputs) visit(input.connectedPoint?.ownerBlock);
};
[...material._vertexOutputNodes, ...material._fragmentOutputNodes].forEach(visit);
const classes = new Set([...built].map((block) => block.getClassName()));
for (const name of ['MorphTargetsBlock', 'BonesBlock', 'InstancesBlock', 'ClipPlanesBlock', 'FogBlock', 'ReflectionBlock', 'BlenderSurfaceBlock', 'BlenderDisplayBlock'])
  assert.ok(classes.has(name), `the graph has Babylon's ${name}`);
const { _vertexSourceCode: vertex, _fragmentSourceCode: fragment } = mesh.subMeshes[0].effect;
for (const define of ['MORPHTARGETS', 'NUM_BONE_INFLUENCERS', 'INSTANCES', 'CLIPPLANE']) assert.match(vertex, new RegExp(`#if(def|) ?\\(?(defined\\()?${define}`), `the vertex shader keeps Babylon's ${define} path`);
assert.match(fragment, /#ifdef FOG/, "the fragment shader keeps Babylon's fog");
assert.match(mesh.subMeshes[0].effect.defines, /#define BASE_DIFFUSE_MODEL 2\n/, "diffuse is Lambert's, as EEVEE's");
assert.match(fragment, /#ifdef SHADOW\{?X?\}?|SHADOW0|computeShadow/, "the fragment shader keeps Babylon's shadows");
// Blender's FrontFacing holds in Babylon's separate culling pass, which draws the back faces first with the front
// winding reversed: the material tells its shader which pass draws (a glass's inner walls take the back face's IOR).
{
  const tree = { nodes: [{ idname: 'ShaderNodeLayerWeight', name: 'Layer Weight' }, { idname: 'ShaderNodeBsdfGlass', name: 'Glass' }, { idname: 'ShaderNodeBsdfTransparent', name: 'Clear' },
    { idname: 'ShaderNodeMixShader', name: 'Mix' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['Layer Weight', 'Fresnel', 'Mix', 'Fac'], ['Clear', 'BSDF', 'Mix', 'Shader'], ['Glass', 'BSDF', 'Mix', 'Shader_001'], ['Mix', 'Shader', 'Material Output', 'Surface']] };
  const { material } = nodeMaterialFromTree('Glass', scene, tree);
  // Backface Culling off, as Blender's materials have it.
  material.backFaceCulling = false;
  const glass = Object.assign(MeshBuilder.CreateSphere('Glass', {}, scene), { material });
  for (let i = 0; i < 50 && !glass.subMeshes[0].effect?.isReady(); i++) {
    scene.render();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(material.separateCullingPass, 'a blended surface draws its back faces in a pass of their own');
  const effect = glass.subMeshes[0].effect, set = [];
  assert.match(effect._fragmentSourceCode, /#define FrontFacing \(gl_FrontFacing != \(bl_reversed_faces > 0\.5\)\)/);
  const setFloat = effect.setFloat.bind(effect);
  effect.setFloat = (name, value) => { if (name === 'bl_reversed_faces') set.push(value); return setFloat(name, value); };
  scene.render();
  assert.deepEqual(set, [1, 0], 'the pass of back faces reverses FrontFacing, the pass of front faces does not');
}
// EEVEE's render methods: a Dithered surface (the default) is hashed in the opaque pass, kept where its coverage passes
// the sample's noise; a Blended one is sorted, blended and keeps no depth.
{
  const tree = { nodes: [{ idname: 'ShaderNodeBsdfTransparent', name: 'Clear' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
    links: [['Clear', 'BSDF', 'Material Output', 'Surface']] };
  const { material } = nodeMaterialFromTree('Clear', scene, tree);
  const clear = Object.assign(MeshBuilder.CreateBox('Clear', {}, scene), { material });
  const effect = async () => {
    for (let i = 0; i < 50 && !clear.subMeshes[0].effect?.isReady(); i++) {
      scene.render();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return clear.subMeshes[0].effect;
  };
  const dithered = await effect();
  assert.match(dithered.defines, /#define BL_DITHERED/, 'Dithered discards what is fully transparent');
  assert.match(dithered._fragmentSourceCode, /if \(\w+\.a <= bl_dither\(gl_FragCoord\.xy, bl_dither_offset\)\) discard;/, 'hashed by its coverage');
  assert.ok(!material.needAlphaBlending() && material.needAlphaTesting(), 'in the opaque pass, depth-tested, as EEVEE draws Dithered surfaces');
  assert.equal(material.shadowDepthWrapper?.baseMaterial, material, "its shadow is drawn with its own shader, hashed as it is (EEVEE's transparent shadows)");
  // whose world position Babylon's shadow includes (a point or spot light's distance) read by its own name
  const [from, to] = material.shadowDepthWrapper._options.remappedVariables ?? [];
  assert.equal(from, 'worldPos');
  assert.match(dithered._vertexSourceCode, new RegExp(`vec4 ${to}\\s*=`), `the shadow reads the world position as ${to}`);
  material.transparencyMode = 2;
  scene.render();
  assert.doesNotMatch((await effect()).defines, /#define BL_DITHERED/, 'Blended blends it');
  assert.ok(material.needAlphaBlending(), 'sorted and blended');
}
// A draw's matrices in Blender's axes are made again only when their source changes, not at every draw.
{
  const mesh = MeshBuilder.CreateBox('Bound', {}, scene), [, model] = meshValue('$model'), [, view] = meshValue('$viewmat');
  mesh.computeWorldMatrix(true);
  assert.equal(model(mesh, scene), model(mesh, scene), 'the same model matrix while the mesh stays');
  assert.equal(view(mesh, scene), view(mesh, scene), 'the same view matrix while the view stays');
  const before = model(mesh, scene).m[12];
  mesh.position.x += 1;
  mesh.computeWorldMatrix(true);
  assert.equal(model(mesh, scene).m[12], before + 1, 'and a new one once it moved');
}
console.log("Node material base: Babylon's morph targets, bones, instances, clip planes, lights with shadows, fog and image processing passed");
