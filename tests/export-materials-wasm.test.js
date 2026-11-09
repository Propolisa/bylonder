// Node materials in the JavaScript package (docs/lava-material.md's Lava): each unlinked node input is a control at its
// Blender RNA path, which names the same value in Main, and setting it changes the material's InputBlock without a new
// shader.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('lava');
sync.view();
const written = writePackage(await exportModule(world));
const blend = await (await import(written.url)).load(new NullEngine());

// A path of materials[...].node_tree.nodes[...].inputs[i].default_value[c] read in Main.
function mainValue(path) {
  const [, material, node, input, component] = /^materials\["(.+?)"\]\.node_tree\.nodes\["(.+?)"\]\.inputs\[(\d+)\]\.default_value(?:\[(\d)\])?$/.exec(path);
  const value = blendData().materials.get(material).node_tree.nodes.get(node).inputs[+input].default_value;
  return component === undefined ? value : value[+component];
}
const inputs = blend.controls().filter((c) => c.path.startsWith('materials['));
assert.ok(inputs.length > 5, `${inputs.length} node inputs are controls`);
for (const control of inputs) assert.ok(Math.abs(mainValue(control.path) - control.default) < 1e-6, `${control.path}: ${control.default}, Main ${mainValue(control.path)}`);

const material = blend.scene.materials.find((m) => m.getClassName() === 'NodeMaterial');
const control = inputs.find((c) => !/\[\d\]$/.test(c.path)) ?? inputs[0], name = control.path.replace(/^materials\[".+?"\]\./, '').replace(/\[\d\]$/, '');
const block = material.getBlockByName(name);
assert.ok(block, `the material has the InputBlock ${name}`);
const buildId = material.buildId;
assert.ok(material.attachedBlocks.length > 1 && buildId, 'the material built from its blocks');
blend.set(control.path, 7.5);
const value = typeof block.value === 'number' ? block.value : block.value.x;
assert.equal(value, 7.5, 'set reaches the InputBlock');
assert.equal(material.buildId, buildId, 'without building the material again');
blend.dispose();
written.remove();
console.log(`Export materials: ${inputs.length} node inputs of the Lava material are controls at their RNA paths, set without a new shader`);
