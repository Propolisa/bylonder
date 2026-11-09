// File > Export > JavaScript of the compositor example (Neon Night): its compositor ships as a Babylon NodeRenderGraph of
// the blocks library's one pass block (bylonder-blocks.js), which parses with @babylonjs/core and that file
// alone; each Blender node's code or plan is made at export at the render's size, and the inputs that land in one
// uniform or one uploaded value are controls set without a rebuild.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const { world, sync, scene } = openExample('compositor');
sync.view();
// Bylonder's light reach (light-reach.js) keeps a light off meshes it does not reach, as Babylon's excluded meshes.
scene.getLightByName('Door Light').excludedMeshes = [scene.getMeshByName('Road')];
const files = await exportModule(world);
const constant = (name) => JSON.parse(new RegExp(`const ${name} = (.*);`).exec(files['scene.js'])[1]);
assert.ok(files['bylonder-blocks.js'] === undefined, 'exportModule leaves the runtime files to the package');
const compositor = constant('COMPOSITOR');
assert.deepEqual([compositor.width, compositor.height], [1280, 720], "plans are recorded at the render's size");
const types = new Set(compositor.graph.blocks.map((b) => b.customType));
assert.deepEqual([...types].sort(), ['BABYLON.BylonderCompositeOutputBlock', 'BABYLON.BylonderPassBlock', 'BABYLON.NodeRenderGraphInputBlock']);
const pass = (name) => compositor.graph.blocks.find((b) => b.name === name)?.pass;
assert.ok(pass('Color Balance').fragment.uniforms.length > 10 && pass('Mix').fragment, 'pixel nodes are fragment passes with their values as uniforms');
assert.ok(pass('Lens Distortion').plan.steps.length && pass('Blur').plan.steps.length, 'operations are recorded plans');
assert.ok(!pass('Viewer'), 'a node the composite does not pass through stays out');
assert.deepEqual(constant('DISPLAY'), { exposure: 1, exponent: 1, lattice: null }, 'Standard displays as sRGB, with no lattice');

// The graph parses in a process with nothing but Babylon and the blocks library.
const written = writePackage(files);
try {
  const script = `import { NodeRenderGraph, NullEngine, Scene } from '@babylonjs/core';
import ${JSON.stringify('file:///' + join(written.dir, 'bylonder-blocks.js').replaceAll('\\', '/'))};
import { readFileSync } from 'node:fs';
const source = readFileSync(${JSON.stringify(join(written.dir, 'scene.js'))}, 'utf8');
const graph = new NodeRenderGraph('Compositing', new Scene(new NullEngine()));
graph.parseSerializedObject(JSON.parse(/const COMPOSITOR = (.*);/.exec(source)[1]).graph);
console.log(JSON.stringify(graph.attachedBlocks.map((b) => [b.name, b.getClassName(), b.inputs.filter((i) => i.connectedPoint).length])));`;
  const parsed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8' }).trim().split('\n').at(-1));
  assert.equal(parsed.length, compositor.graph.blocks.length, 'every block parses');
  assert.ok(parsed.find(([name]) => name === 'Mix')[2] === 2, "the Mix takes the graded image and the blurred mask, linked as in Blender's tree");

  // Controls: a uniform and an uploaded value set by their Blender paths, without a rebuild.
  const blend = await (await import(written.url)).load(new NullEngine());
  // Lights as the app draws them: a point light has no direction (Babylon would draw its shadow as a spot's), and each
  // light leaves out the meshes Bylonder's light reach keeps it off, resolved once the meshes exist.
  const lights = constant('LIGHTS');
  assert.ok(lights.filter((l) => l.type === 0).every((l) => !l.direction), 'point lights carry no direction');
  assert.deepEqual(blend.scene.getLightByName('Door Light').excludedMeshes.map((m) => m.name), ['Road'], 'the Door Light leaves out the mesh it does not reach');
  // A joined object's material slots: its multi-material holds each slot's material, not Babylon's default.
  const slots = blend.scene.getMeshByName('Shop Front').material;
  assert.deepEqual(slots.subMaterials.map((m) => m?.name), constant('MULTI_MATERIALS').find((m) => m.name === slots.name).materials, "the Shop Front's slots hold its materials");
  const block = (name) => blend.compositor.attachedBlocks.find((b) => b.name === name);
  const gain = 'node_groups["Compositor Nodes"].nodes["Color Balance"].inputs[8].default_value[0]';
  const { uniform, component } = constant('CONTROLS').find((c) => c.path === gain).bind;
  blend.set(gain, 1.5);
  assert.equal(block('Color Balance').pass.fragment.uniforms[uniform].value[component], 1.5, "Color Balance's Gain sets its uniform");
  const mask = 'node_groups["Compositor Nodes"].nodes["Ellipse Mask"].inputs[2].default_value';
  const { upload } = constant('CONTROLS').find((c) => c.path === mask).bind;
  blend.set(mask, 0.25);
  const data = block('Ellipse Mask')._frameGraphTask.recorder().data;
  assert.equal(new DataView(data.buffer, data.byteOffset).getFloat32(upload, true), 0.25, "the Ellipse Mask's Value sets the float its plan uploads");
} finally {
  written.remove();
}
console.log("Export compositor: Neon Night's compositor is a NodeRenderGraph of the blocks library's pass block, with its values as controls");
