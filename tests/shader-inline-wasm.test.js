// A material whose node tree has a node group and a repeat zone opens as EEVEE compiles it: Blender's
// inline_shader_node_tree (main-api.cc node_tree_inlined) inlines the group and keeps the zone, which builds as a GLSL
// loop (tests/fixtures/shader-inline.blend, made by tools/blender-reference/shader-inline-fixtures.py). A long chain
// of shared values builds in time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NodeMaterial, NullEngine, Scene } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { nodeMaterialFromTree } from '../src/nodes/blender/shader-nodes.js';

// The fragment shader's main() once the material built.
const built = async (material) => {
  for (let i = 0; i < 100 && !material._buildWasSuccessful; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(material._buildWasSuccessful, `${material.name} builds`);
  return material._fragmentCompilationState.compilationString.split('void main').at(-1);
};

// Opened as a project's code opens a .blend, into a world with its material library.
const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
const world = { scene, objects: [], animation };
world.materials = createMaterialLibrary(world);
const sync = createMainSync({ rna: createRNA({ world }), ids: animation.ids });
const { warnings } = sync.readBlend(readFileSync(new URL('./fixtures/shader-inline.blend', import.meta.url)), scene);
assert.deepEqual(warnings.filter((w) => w.includes('Inlined')), [], 'every node of the inlined tree opens');

const material = scene.materials.find((m) => m.name === 'Inlined');
assert.ok(material instanceof NodeMaterial, 'a node material');
const blocks = material.attachedBlocks.map((b) => b.getClassName()).sort();
assert.ok(!blocks.includes('ShaderNodeGroup'), `the group inlined: ${blocks}`);
assert.deepEqual(blocks.filter((name) => name.startsWith('BlenderRepeat')), ['BlenderRepeatWriteBlock', 'BlenderRepeatZoneBlock'], 'the zone kept');
// The object's random value, plus 0.25 forty times ((x + x) * 0.5 + 0.25), then doubled by the group.
const code = await built(material), loop = code.indexOf('for (int'), close = code.indexOf('}\n', loop);
assert.match(code.slice(loop), /^for \(int \w+ = 0; \w+ < int\(40(\.0)?\); \w+\+\+\) \{/, 'forty iterations');
assert.equal(code.slice(loop, close).match(/bl_math_add\(|bl_math_multiply_add\(/g)?.length, 2, 'the zone\'s two nodes inside the loop');
assert.ok(code.slice(close).includes('bl_math_multiply('), "the group's Multiply after it");

// Forty steps that each read the last one twice: Babylon would prepare a block once for each of its 2^40 paths.
const chain = { nodes: [{ idname: 'ShaderNodeValue', name: 'Start', values: { '=Value': 0.5 } }], links: [] };
for (let i = 0; i < 40; i++) {
  const from = i ? `Step ${i - 1}` : 'Start', socket = 'Value';
  chain.nodes.push({ idname: 'ShaderNodeMath', name: `Step ${i}`, properties: { operation: 'ADD' } });
  chain.links.push([from, socket, `Step ${i}`, 'Value'], [from, socket, `Step ${i}`, 'Value_001']);
}
chain.nodes.push({ idname: 'ShaderNodeEmission', name: 'Emission' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' });
chain.links.push(['Step 39', 'Value', 'Emission', 'Strength'], ['Emission', 'Emission', 'Material Output', 'Surface']);
assert.equal((await built(nodeMaterialFromTree('Chain', scene, chain).material)).match(/bl_math_add\(/g)?.length, 40, 'the chain builds');
console.log('Shader inlining: a node group inlined, a repeat zone kept as a loop, and a long shared chain build passed');
