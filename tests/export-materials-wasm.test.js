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
import { writePackage, sceneTable } from './export-package.js';
import { nodeWorld } from './node-world.js';

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
    // Its default is the package's file of the image, by its version.
    assert.ok(image && image.type === 'STRING' && /^images\/\d+\.png\?v=[\d.]+$/.test(image.default), `an image is a control: ${JSON.stringify(image)}`);
    assert.equal(blendData().materials.get(/^materials\["(.+?)"\]/.exec(image.path)[1]).node_tree.nodes.get(/nodes\["(.+?)"\]/.exec(image.path)[1]).bl_idname, 'ShaderNodeTexImage', 'its path names the Image Texture node');
    const block = nodeMaterial(blend, image.path).getBlockByName(blockName(image.path)), before = block.texture;
    blend.set(image.path, 'https://example.com/poster.png');
    assert.notEqual(block.texture, before, 'set swaps the texture');
    assert.equal(block.texture.url, 'https://example.com/poster.png');
    assert.equal(blend.get(image.path), 'https://example.com/poster.png');
    // Its world of one color lights the page as in the app (a cube of the color, with its spherical harmonics), and its
    // Background node's Color and Strength are controls.
    const environment = blend.scene.environmentTexture, [, wo] = /^worlds\["(.+?)"\]/.exec(blend.controls().find((c) => c.path.startsWith('worlds[')).path);
    const background = [...blendData().worlds.get(wo).node_tree.nodes].find((n) => n.bl_idname === 'ShaderNodeBackground');
    // NullEngine makes no GPU texture to hold the spherical harmonics: the world's cube is the scene's environment.
    assert.equal(environment?.name, 'world', 'the world lights the scene');
    const base = `worlds["${wo}"].node_tree.nodes["${background.name}"].inputs`, color = [...background.inputs[0].default_value];
    // The package writes Blender's floats at their float32 value (ir-export.js float32).
    assert.deepEqual([0, 1, 2].map((i) => Math.fround(blend.get(`${base}[0].default_value[${i}]`))), color.slice(0, 3), 'the Background color is a control');
    blend.set(`${base}[1].default_value`, 2);
    assert.ok(Math.abs(environment.clearColor.r - 2 * color[0]) < 1e-6, 'its Strength relights the scene');
    console.log(`framed-print: ${inputs.filter((c) => c.path.endsWith('.image')).length} images are controls, swapped by URL; the world's Background lights and is tunable`);
    blend.dispose();
    written.remove();
  },
  // A world of nodes (node-world.js): exported as a material of Babylon's blocks, drawn on the page's world box, which
  // bakes it into the scene's light once its shader is ready, and its inputs are controls at the World's paths.
  async 'node-world'() {
    const { world, sync, scene } = openExample('lava');
    sync.view();
    nodeWorld(scene);
    const files = await exportModule(world), written = writePackage(files);
    const materials = sceneTable(files, 'MATERIALS'), entry = materials.find((m) => m.name === '__world World');
    assert.ok(entry && entry.blocks.every((b) => !/^BABYLON\.(Blender|ShaderNode)/.test(b.customType)), "the world is a material of Babylon's blocks");
    const blend = await (await import(written.url)).load(new NullEngine());
    assert.ok(entry.blocks.some((b) => b.name === 'world:probe') && entry.blocks.some((b) => b.customType === 'BABYLON.ClampBlock'), "its probe clamp (Sun Threshold) is Babylon's math blocks");
    const box = blend.scene.getMeshByName('world');
    assert.ok(box?.infiniteDistance && box.material?.name === '__world World', 'the world draws on a box around the eye');
    const strength = blend.controls().find((c) => c.path === 'worlds["World"].node_tree.nodes["Background"].inputs[1].default_value');
    assert.equal(strength?.default, 1.5, 'its Strength is a control');
    console.log("node-world: drawn on the world box with Babylon's blocks, its inputs controls at the World's paths");
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
