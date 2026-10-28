// Blender's nodes inline with Babylon's blocks: one NodeMaterial and one NodeRenderGraph holding both, linked by
// Blender's socket conversions, built, saved and loaded.
import assert from 'node:assert/strict';
import { NullEngine, Scene, NodeMaterial, ArcRotateCamera, Vector3, InputBlock, NodeMaterialBlockConnectionPointTypes as T, NodeRenderGraph } from '@babylonjs/core';
import { shaderNodeClasses } from '../src/nodes/blender/shader-nodes.js';
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
assert.match(fragment, /vec3 Result_Color\w* = bl_Result_Color\w*\.rgb;/);
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
assert.match(material._fragmentCompilationState._builtCompilationString, /vec3 Result_Color\w* = u_color\.rgb;/);

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

console.log('nodes: ok');
