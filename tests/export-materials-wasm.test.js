// Node materials in the JavaScript package: each unlinked node input is a control at its Blender RNA path, which names
// the same value in Main, and setting it changes the material's InputBlock without building it again (the Lava,
// docs/lava-material.md); an Image Texture's image is a control too, a URL that swaps the texture (the Framed Print).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

async function load(id) {
  const { world, sync } = openExample(id);
  sync.view();
  const written = writePackage(await exportModule(world));
  const blend = await (await import(written.url)).load(new NullEngine());
  return { blend, written, inputs: blend.controls().filter((c) => c.path.startsWith('materials[')) };
}
const nodeMaterial = (blend, path) => blend.scene.getMaterialByName(/^materials\["(.+?)"\]/.exec(path)[1]);
const blockName = (path) => path.replace(/^materials\[".+?"\]\./, '').replace(/\[\d\]$/, '');

const SCENARIOS = {
  async lava() {
    const { blend, written, inputs } = await load('lava');
    // A path of materials[...].node_tree.nodes[...].inputs[i].default_value[c] read in Main.
    const mainValue = (path) => {
      const [, material, node, input, component] = /^materials\["(.+?)"\]\.node_tree\.nodes\["(.+?)"\]\.inputs\[(\d+)\]\.default_value(?:\[(\d)\])?$/.exec(path);
      const value = blendData().materials.get(material).node_tree.nodes.get(node).inputs[+input].default_value;
      return component === undefined ? value : value[+component];
    };
    assert.ok(inputs.length > 5, `${inputs.length} node inputs are controls`);
    for (const control of inputs) assert.ok(Math.abs(mainValue(control.path) - control.default) < 1e-6, `${control.path}: ${control.default}, Main ${mainValue(control.path)}`);
    const control = inputs.find((c) => !/\[\d\]$/.test(c.path)) ?? inputs[0], material = nodeMaterial(blend, control.path), block = material.getBlockByName(blockName(control.path));
    assert.ok(block, `the material has the InputBlock ${blockName(control.path)}`);
    const buildId = material.buildId;
    assert.ok(material.attachedBlocks.length > 1 && buildId, 'the material built from its blocks');
    blend.set(control.path, 7.5);
    assert.equal(typeof block.value === 'number' ? block.value : block.value.x, 7.5, 'set reaches the InputBlock');
    assert.equal(material.buildId, buildId, 'without building the material again');
    console.log(`lava: ${inputs.length} node inputs are controls at their RNA paths, set without building again`);
    blend.dispose();
    written.remove();
  },
  async 'framed-print'() {
    const { blend, written, inputs } = await load('framed-print');
    const image = inputs.find((c) => c.path.endsWith('.image'));
    // Its default is the package's file of the image (images/<n>), or the image's name where Node has no pixels for it.
    assert.ok(image && image.type === 'STRING' && typeof image.default === 'string', `an image is a control: ${JSON.stringify(image)}`);
    assert.equal(blendData().materials.get(/^materials\["(.+?)"\]/.exec(image.path)[1]).node_tree.nodes.get(/nodes\["(.+?)"\]/.exec(image.path)[1]).bl_idname, 'ShaderNodeTexImage', 'its path names the Image Texture node');
    const block = nodeMaterial(blend, image.path).getBlockByName(blockName(image.path)), before = block.texture;
    blend.set(image.path, 'https://example.com/poster.png');
    assert.notEqual(block.texture, before, 'set swaps the texture');
    assert.equal(block.texture.url, 'https://example.com/poster.png');
    assert.equal(blend.get(image.path), 'https://example.com/poster.png');
    console.log(`framed-print: ${inputs.filter((c) => c.path.endsWith('.image')).length} images are controls, swapped by URL`);
    blend.dispose();
    written.remove();
  },
};

const scenario = process.argv[2];
if (scenario) await SCENARIOS[scenario]();
else {
  for (const name of Object.keys(SCENARIOS)) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
  console.log('Export materials: node inputs and images are controls at their Blender paths, set without building the material again');
}
