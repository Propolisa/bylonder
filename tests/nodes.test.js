// Blender's nodes inline with Babylon's blocks: one NodeMaterial and one NodeRenderGraph holding both, linked by
// Blender's socket conversions, built, saved and loaded.
import assert from 'node:assert/strict';
import { Constants, NullEngine, Scene, NodeMaterial, ArcRotateCamera, Vector3, InputBlock, NodeMaterialBlockConnectionPointTypes as T, NodeRenderGraph } from '@babylonjs/core';
import { nodeMaterialFromTree, shaderNodeClasses, SHADER_NODES } from '../src/nodes/blender/shader-nodes.js';
import { skyTexture } from '../src/blenkernel/sky.js';
import { compositorNodeClasses } from '../src/nodes/blender/compositor-nodes.js';
import { availability, declaration } from '../src/nodes/blender/declarations.js';
import { glslFunction } from '../src/nodes/blender/glsl.js';

const engine = new NullEngine(), scene = new Scene(engine);
new ArcRotateCamera('Camera', 0, 1, 5, Vector3.Zero(), scene);

// Blender's GLSL dialect as GLSL ES.
const [[, compatible], [, modulo]] = glslFunction('math_modulo');
assert.match(modulo, /^void bl_math_modulo\(float a, float b, float c, inout float result\)/);
assert.match(compatible, /a - float\(N\) \* b/, 'int to float conversions GLSL ES lacks are made explicit');
assert.doesNotMatch(glslFunction('node_composite_color_balance').map(([, c]) => c).join('\n'), /\bfloat[234]\b|\d\.\d*f\b|&|\.xyz\(\)/);

// Sockets as Blender shows them for the node's properties and menus.
const math = declaration('shader', 'ShaderNodeMath');
assert.deepEqual([...availability(math, { operation: 'ADD' }).inputs], ['Value', 'Value_001']);
const wrap = availability(math, { operation: 'WRAP' });
assert.equal(wrap.inputs.size, 3);
assert.deepEqual([wrap.labels.Value_001, wrap.labels.Value_002], ['Max', 'Min']);
const balance = declaration('compositor', 'CompositorNodeColorBalance');
assert.ok(availability(balance, {}, { Type: 'White Point' }).inputs.has('Input Temperature'));
assert.ok(!availability(balance, {}, { Type: 'Lift/Gamma/Gain' }).inputs.has('Input Temperature'));

// A material: Babylon's color input through Blender's Mix (Multiply, its factor from a Blender Math node) into
// Babylon's fragment output, whose rgb is a Color3: the Blender Color output converts to it.
const material = new NodeMaterial('Mixed', scene);
material.setToDefault();
material.build();
const output = material.getBlockByName('FragmentOutput'), color = material.getInputBlocks().find((b) => b.name === 'color');
const mix = new shaderNodeClasses.ShaderNodeMix(), factor = new shaderNodeClasses.ShaderNodeMath();
Object.assign(mix.properties, { data_type: 'RGBA', blend_type: 'MULTIPLY' });
factor.properties.operation = 'MULTIPLY';
color.output.disconnectFrom(output.rgba);
color.output.connectTo(mix.getInputByName('A_Color'));
factor.getOutputByName('Value').connectTo(mix.getInputByName('Factor_Float'));
mix.getOutputByName('Result_Color').connectTo(output.rgb);
assert.equal(mix.getOutputByName('Result_Color').type, T.Color3, 'a Blender output takes the type of the Babylon input it feeds');
const matrix = new InputBlock('Matrix', undefined, T.Matrix);
assert.ok(!factor.getOutputByName('Value').canConnectTo(matrix.output) && !matrix.output.canConnectTo(mix.getInputByName('B_Color')),
  'Blender converts between values, vectors and colors only');
material.build();
const fragment = material._fragmentCompilationState._builtCompilationString;
assert.match(fragment, /bl_node_mix_mult\(bl_Factor_Float\w*, u_color, bl_B_Color\w*, bl_Result_Color\w*\);/);
assert.match(fragment, /vec3 bl_out_Result_Color\w* = bl_Result_Color\w*\.rgb;/);
assert.match(fragment, /uniform vec4 bl_B_Color/, 'an unlinked input is a uniform');
assert.doesNotMatch(fragment, /bl_A_Float|bl_Factor_Vector/, 'only the sockets the node links get uniforms');

// Unlinked values reach the shader each frame, without a rebuild.
const set = [];
mix.values.B_Color = [0.25, 0.5, 0.75, 1];
mix.bind({ setFloat: () => {}, setFloat3: () => {}, setFloat4: (...args) => set.push(args) });
assert.deepEqual(set[0].slice(1), [0.25, 0.5, 0.75, 1]);

// Muted, Mix passes its first color input through.
mix.mute = true;
material.build();
assert.doesNotMatch(material._fragmentCompilationState._builtCompilationString, /bl_node_mix_mult\(/);
assert.match(material._fragmentCompilationState._builtCompilationString, /vec3 bl_out_Result_Color\w* = u_color\.rgb;/);

// Saved and loaded, as Babylon serializes blocks, with Blender's properties, values and mute.
const loaded = new NodeMaterial('Loaded', scene);
loaded.parseSerializedObject(JSON.parse(JSON.stringify(material.serialize())));
loaded.build();
const mixAgain = loaded.attachedBlocks.find((b) => b.getClassName() === 'ShaderNodeMix');
assert.deepEqual([mixAgain.properties.blend_type, mixAgain.values.B_Color, mixAgain.mute], ['MULTIPLY', [0.25, 0.5, 0.75, 1], true]);
assert.equal(mixAgain.getInputByName('Factor_Float').connectedPoint.ownerBlock.getClassName(), 'ShaderNodeMath');

// The compositor: Babylon's post processes and Blender's Color Balance in one render graph.
const graph = new NodeRenderGraph('Compositing', scene);
graph.setToDefault();
const balanceBlock = new compositorNodeClasses.CompositorNodeColorBalance('Color Balance', graph.frameGraph, scene);
const source = graph.outputBlock.texture.connectedPoint;
source.disconnectFrom(graph.outputBlock.texture);
source.connectTo(balanceBlock.getInputByName('Image'));
balanceBlock.getOutputByName('Image').connectTo(graph.outputBlock.texture);
graph.build(true);
const saved = JSON.parse(JSON.stringify(graph.serialize()));
const reloaded = new NodeRenderGraph('Reloaded', scene);
reloaded.parseSerializedObject(saved);
const balanceAgain = reloaded.attachedBlocks.find((b) => b.getClassName() === 'CompositorNodeColorBalance');
assert.ok(balanceAgain, 'a Blender compositor node loads from Babylon serialization');
assert.equal(reloaded.outputBlock.texture.connectedPoint.ownerBlock, balanceAgain);
assert.match(balanceAgain._fragment().code, /bl_node_composite_color_balance\(texture2D\(textureSampler, vUV\), bl_Fac/);

// Image Texture's Color alpha as node_shader_gpu_tex_image gives it from Blender's texture: a float buffer's texture
// holds premultiplied alpha (straight in Blender's for a straight image), a byte buffer's straight.
const imageAlpha = (is_float, alpha_mode, alphaLinked) => SHADER_NODES.ShaderNodeTexImage({ interpolation: 'Linear' }, null, {
  connected: () => false, linked: (name) => name === 'Color' || (name === 'Alpha' && alphaLinked),
  image: () => ({ is_float, alpha_mode, colorspace_settings: { is_data: false } }),
}).slice(1).map(([name]) => name);
assert.deepEqual(imageAlpha(false, 'STRAIGHT', false), ['color_alpha_premultiply']);
assert.deepEqual(imageAlpha(false, 'STRAIGHT', true), ['color_alpha_clear']);
assert.deepEqual(imageAlpha(true, 'STRAIGHT', false), [], 'a premultiplied texture is the premultiplied color');
assert.deepEqual(imageAlpha(true, 'STRAIGHT', true), ['color_alpha_unpremultiply', 'color_alpha_clear']);
assert.deepEqual(imageAlpha(true, 'PREMUL', false), ['color_alpha_clear']);
assert.deepEqual(imageAlpha(true, 'PREMUL', true), ['color_alpha_unpremultiply']);
assert.deepEqual(imageAlpha(true, 'CHANNEL_PACKED', true), ['color_alpha_clear']);

// Reflections lit as EEVEE's closure bins: a Diffuse with a Glossy, and two Glossy BSDFs, each lobe by a surface of its
// own, the second in a scope of its own over the first's radiance.
const lobes = async (nodes) => {
  const tree = { nodes: [...nodes.map((idname, i) => ({ idname, name: 'BSDF ' + i })), { idname: 'ShaderNodeMixShader', name: 'Mix' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
    links: [['BSDF 0', 'BSDF', 'Mix', 'Shader'], ['BSDF 1', 'BSDF', 'Mix', 'Shader_001'], ['Mix', 'Shader', 'Material Output', 'Surface']] };
  const built = nodeMaterialFromTree('Lobes', scene, tree).material;
  if (built._buildIsInProgress) await new Promise((resolve) => built.onBuildObservable.addOnce(resolve));
  return { surfaces: built.attachedBlocks.filter((b) => b.getClassName() === 'BlenderSurfaceBlock').map((b) => b.lobe), code: built._fragmentCompilationState._builtCompilationString };
};
const mixed = await lobes(['ShaderNodeBsdfDiffuse', 'ShaderNodeBsdfAnisotropic']);
assert.deepEqual(mixed.surfaces, [0, 1], 'a Glossy over a Diffuse is a lobe of its own');
assert.match(mixed.code, /bl_node_bsdf_glossy\([^;]*, 1\.0, /);
assert.match(mixed.code, /\n\{\n[\s\S]*lobeLit\w* = finalColor\.rgb;\n\}\n/, "the lobe's PBR code runs in a scope of its own");
const two = await lobes(['ShaderNodeBsdfAnisotropic', 'ShaderNodeBsdfAnisotropic']);
assert.deepEqual(two.surfaces, [0, 1], 'two Glossy BSDFs take the base and a lobe');
assert.deepEqual((await lobes(['ShaderNodeBsdfDiffuse', 'ShaderNodeBsdfDiffuse'])).surfaces, [0], 'diffuse closures share the base');

// Data linked to a shader input is an Emission of it, and a shader linked to a data input is dropped, as Blender's
// shader tree makes them (ntree_shader_implicit_closure_cast).
const implicit = nodeMaterialFromTree('Implicit', scene, { nodes: [{ idname: 'ShaderNodeRGB', name: 'RGB' }, { idname: 'ShaderNodeBsdfDiffuse', name: 'Diffuse' },
  { idname: 'ShaderNodeMath', name: 'Math' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['RGB', 'Color', 'Material Output', 'Surface'], ['Diffuse', 'BSDF', 'Math', 'Value']] }).material;
const emission = implicit.attachedBlocks.find((b) => b.idname === 'ShaderNodeEmission');
assert.equal(emission?.getInputByName('Color').connectedPoint?.ownerBlock.name, 'RGB');
assert.equal(implicit.attachedBlocks.find((b) => b.name === 'Material Output').getInputByName('Surface').connectedPoint?.ownerBlock, emission);
assert.ok(!implicit.attachedBlocks.find((b) => b.name === 'Math').getInputByName('Value').isConnected);

// Of several Material Outputs, the one EEVEE uses drives the material (ntreeShaderOutputNode): one for EEVEE before
// one for all renderers, the active one among equals; one for Cycles never.
const outputs = (specs) => nodeMaterialFromTree('Outputs', scene, { nodes: [{ idname: 'ShaderNodeEmission', name: 'Emission' },
  ...specs.map(([name, target, active]) => ({ idname: 'ShaderNodeOutputMaterial', name, properties: { target, is_active_output: active } }))],
  links: specs.map(([name]) => ['Emission', 'Emission', name, 'Surface']) }).material._fragmentOutputNodes.filter((b) => b.idname === 'ShaderNodeOutputMaterial').map((b) => b.name);
assert.deepEqual(outputs([['Cycles', 'CYCLES', true], ['EEVEE', 'EEVEE', false]]), ['EEVEE']);
assert.deepEqual(outputs([['All', 'ALL', true], ['EEVEE', 'EEVEE', false]]), ['EEVEE']);
assert.deepEqual(outputs([['First', 'ALL', false], ['Active', 'ALL', true]]), ['Active']);

// Links through a reroute link what links into it (node_tree_reroute_link).
const rerouted = nodeMaterialFromTree('Rerouted', scene, { nodes: [{ idname: 'ShaderNodeRGB', name: 'RGB' }, { idname: 'NodeReroute', name: 'Reroute' },
  { idname: 'NodeReroute', name: 'Reroute.001' }, { idname: 'ShaderNodeBsdfDiffuse', name: 'Diffuse' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['RGB', 'Color', 'Reroute', 'Input'], ['Reroute', 'Output', 'Reroute.001', 'Input'], ['Reroute.001', 'Output', 'Diffuse', 'Color'], ['Diffuse', 'BSDF', 'Material Output', 'Surface']] }).material;
assert.equal(rerouted.attachedBlocks.find((b) => b.name === 'Diffuse').getInputByName('Color').connectedPoint?.ownerBlock.name, 'RGB', 'a reroute passes its link on');

// A world's tree as EEVEE draws it (eevee_surf_world.bsl.hh): its Background's emission, opaque, at the far plane; its
// coordinates the direction it is seen in; its Light Path telling the view's rays from the world probe's.
const sky = nodeMaterialFromTree('__world Sky', scene, { nodes: [{ idname: 'ShaderNodeTexCoord', name: 'Coordinates' }, { idname: 'ShaderNodeTexGradient', name: 'Gradient' },
  { idname: 'ShaderNodeLightPath', name: 'Light Path' }, { idname: 'ShaderNodeMath', name: 'Math', properties: { operation: 'MULTIPLY' } },
  { idname: 'ShaderNodeBackground', name: 'Background' }, { idname: 'ShaderNodeOutputWorld', name: 'World Output' }],
  links: [['Coordinates', 'Generated', 'Gradient', 'Vector'], ['Gradient', 'Fac', 'Math', 'Value'], ['Light Path', 'Is Camera Ray', 'Math', 'Value_001'],
    ['Gradient', 'Color', 'Background', 'Color'], ['Math', 'Value', 'Background', 'Strength'], ['Background', 'Background', 'World Output', 'Surface']] }).material;
if (sky._buildIsInProgress) await new Promise((resolve) => sky.onBuildObservable.addOnce(resolve));
assert.ok(sky.blenderWorld && sky.disableDepthWrite && sky.alphaMode === Constants.ALPHA_DISABLE, 'a world draws opaque, behind all');
const skyCode = sky._fragmentCompilationState._builtCompilationString;
assert.match(skyCode, /vec3 bl_P = normalize\(\w+\.xzy\);/, "a world's point is its direction from the eye");
assert.match(skyCode, /bl_tex_coord\(bl_P, /, 'its Generated coordinates are that direction');
assert.match(skyCode, /bl_set_ray_type\(\w+\);[\s\S]*bl_node_light_path\(/, 'its Light Path reads the ray type it is drawn for');
assert.match(skyCode, /bl_node_emission\(/, 'a Background is an emission');
assert.match(skyCode, /bl_brightness_clamp_max\(bl_brightness_clamp_max\(/, "the world probe clamps the world's light as EEVEE's sphere probe bake");
assert.match(sky._vertexCompilationState._builtCompilationString, /\.w \* 0\.99999, /, 'at the far plane');

// A Sky Texture's Multiple Scattering sky is the one Blender precomputes (the module's SKY_multiple_scattering_precompute_texture),
// sampled by node_tex_sky_nishita as one layer of a texture array.
const skyNode = { idname: 'ShaderNodeTexSky', name: 'Sky', properties: { sky_type: 'MULTIPLE_SCATTERING', sun_elevation: 0.3, sun_rotation: 1, altitude: 100, air_density: 1, aerosol_density: 1, ozone_density: 1 } };
const skyWorld = nodeMaterialFromTree('__world Sky Texture', scene, { nodes: [skyNode, { idname: 'ShaderNodeBackground', name: 'Background' }, { idname: 'ShaderNodeOutputWorld', name: 'World Output' }],
  links: [['Sky', 'Color', 'Background', 'Color'], ['Background', 'Background', 'World Output', 'Surface']] }).material;
if (skyWorld._buildIsInProgress) await new Promise((resolve) => skyWorld.onBuildObservable.addOnce(resolve));
assert.match(skyWorld._fragmentCompilationState._builtCompilationString, /uniform \w* ?sampler2DArray bl_sky\w*;[\s\S]*node_tex_sky_nishita\(bl_P, 1\.0, /, 'the sky texture, sampled at the view direction');
const precomputed = skyTexture(skyNode.properties);
assert.ok(precomputed.width > 1 && precomputed.height > 1 && precomputed.pixels.some((v) => v > 0), 'a sky of light');

// Node outputs are variables of names of their own: two UV outputs never make a UV1, which Babylon defines.
const uvs = nodeMaterialFromTree('UVs', scene, { nodes: [{ idname: 'ShaderNodeTexCoord', name: 'A' }, { idname: 'ShaderNodeTexCoord', name: 'B' },
  { idname: 'ShaderNodeVectorMath', name: 'Add' }, { idname: 'ShaderNodeBsdfDiffuse', name: 'Diffuse' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['A', 'UV', 'Add', 'Vector'], ['B', 'UV', 'Add', 'Vector_001'], ['Add', 'Vector', 'Diffuse', 'Color'], ['Diffuse', 'BSDF', 'Material Output', 'Surface']] }).material;
if (uvs._buildIsInProgress) await new Promise((resolve) => uvs.onBuildObservable.addOnce(resolve));
assert.doesNotMatch(uvs._fragmentCompilationState._builtCompilationString, /\bvec\d UV\d* = /, "no output variable takes a name Babylon defines");

console.log('nodes: ok');
