// File > Export > JavaScript of the compositor example (Akari Noodle House): its compositor ships as a Babylon NodeRenderGraph of
// the blocks library's one pass block (bylonder-blocks.js), which parses with @babylonjs/core and that file
// alone; each Blender node's code or plan is made at export at the render's size, and the inputs that land in one
// uniform or one uploaded value are controls set without a rebuild.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ClusteredLightContainer, MeshBuilder, NullEngine, PointLight, Vector3 } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { compositorLosses } from '../src/io_scene_babylon/compositor-export.js';
import { fogGlowOnGPU } from '../src/compositor/compositor-replay.js';
import { fogGlowFieldOfView } from '../src/compositor/fog-glow.js';
import { writePackage } from './export-package.js';

const { world, sync, scene } = openExample('compositor');
sync.view();
// Nothing here depends on the frames sampled: three keep the export to seconds.
world.animation.time.configure({ frameStart: 1, frameEnd: 3 });
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
// Glare's Fog Glow, which Blender's GPU compositor reads back to convolve on the CPU, replays as a convolution step with
// Blender's normalization, its kernel the unit block:fog_glow (Blender's, in bylonder-fog-glow/) unless replaced.
const fog = pass('Glare').plan.steps.find((s) => s.op === 'fogGlow');
assert.deepEqual(fog.size, [1280, 720], "the glow convolves the highlights at the render's size");
assert.ok(fog.normalization > 0 && Math.abs(fog.fieldOfView - fogGlowFieldOfView(0.85)) < 1e-9, "with Blender's normalization and field of view");
assert.ok(JSON.parse(files['units.json']).units['block:fog_glow'], 'the kernel is a unit');
assert.deepEqual(compositorLosses(world), [], 'nothing of the composite is left out');
fogGlowOnGPU.set(scene, false);
assert.deepEqual(compositorLosses(world), ["Compositor: Glare's Fog Glow adds no glow on the page: Properties > Render > Fog Glow is off"]);
fogGlowOnGPU.set(scene, true);
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
  // Lights as the app draws them: a point light has no direction (Babylon would draw its shadow as a spot's).
  const lights = constant('LIGHTS');
  assert.ok(lights.filter((l) => l.type === 0).every((l) => !l.direction), 'point lights carry no direction');
  // Its 16 lights as EEVEE draws them, with no cap per material: each material takes as many as a shader holds (8 here)
  // and each mesh the lights that reach it, the strongest at it first (overrides/babylon/light-reach.js), not the first 4.
  const page = blend.scene, lit = page.meshes.filter((m) => m.material && m.getTotalVertices() > 0);
  assert.equal(page.lights.length, 16);
  assert.ok(page.materials.filter((m) => 'maxSimultaneousLights' in m).every((m) => m.maxSimultaneousLights === 8), 'every material takes 8 lights');
  const active = (mesh) => Math.min(mesh.lightSources.length, mesh.material.maxSimultaneousLights ?? 4);
  assert.ok(lit.every((m) => m.lightSources.length <= 8), 'no mesh has more lights than its material binds');
  assert.ok(lit.filter((m) => active(m) > 4).length > lit.length / 2, `most meshes take more than 4 lights (${lit.map(active).join(' ')})`);
  const door = page.getLightByName('Door Light'), nearest = lit.reduce((a, b) => (Vector3.Distance(a.getBoundingInfo().boundingSphere.centerWorld, door.position)
    <= Vector3.Distance(b.getBoundingInfo().boundingSphere.centerWorld, door.position) ? a : b));
  assert.ok(nearest.lightSources.includes(door), `the Door Light lights "${nearest.name}", the mesh nearest it, though 15 lights come before it`);
  // A game's lights: one of its own lights every mesh, one bound to a mesh lights it alone, both before the scene's.
  const lantern = new PointLight('Lantern', new Vector3(0, 1, 0), page), rim = new PointLight('Rim', new Vector3(0, 2, 0), page);
  const hero = MeshBuilder.CreateBox('Hero', { size: 1 }, page);
  hero.material = page.materials.find((m) => m.getClassName() === 'NodeMaterial');
  rim.includedOnlyMeshes = [hero];
  page.render();
  assert.ok(lit.every((m) => m.lightSources.slice(0, m.material.maxSimultaneousLights).includes(lantern)), "the page's own light lights every mesh");
  assert.ok(hero.lightSources.slice(0, 8).includes(rim) && hero.lightSources.slice(0, 8).includes(lantern), 'a light bound to a mesh lights it, with the scene full of lights');
  assert.ok(!lit.some((m) => m.lightSources.includes(rim)), 'and no other mesh');
  // Clustered Lights, as an engine with clusters (here a batch size as WebGL 2 gives) draws them: the point lights
  // without shadows in one container, none left out, and a light control still sets its light.
  ClusteredLightContainer._GetEngineBatchSize = () => 32;
  const clustered = await (await import(written.url)).load(new NullEngine());
  const container = clustered.scene.lights.find((l) => l instanceof ClusteredLightContainer);
  const own = clustered.scene.lights.filter((l) => l !== container), shadowless = (l) => !l.getShadowGenerator();
  assert.ok(container?.lights.length && !own.some((l) => l.getClassName() === 'PointLight' && shadowless(l)), `every point light without a shadow is clustered (${container?.lights.length}), ${own.length} lights besides`);
  const lamp = container.lights[0], [power, { bind }] = Object.entries(JSON.parse(files['scene.ir.json']).properties).find(([, p]) => p.bind?.node === lamp.name && p.bind.property === 'intensity');
  clustered.set(power, 200);
  assert.equal(lamp.intensity, 200 * bind.factor, `${power} sets the clustered ${lamp.name}`);
  assert.equal(clustered.nodeOf(`OB:${lamp.name}`), lamp, 'nodeOf finds a clustered light');
  // A joined object's material slots: its multi-material holds each slot's material, not Babylon's default.
  const slots = blend.scene.getMeshByName('Shop Front').material;
  assert.deepEqual(slots.subMaterials.map((m) => m?.name), constant('MULTI_MATERIALS').find((m) => m.name === slots.name).materials, "the Shop Front's slots hold its materials");
  const block = (name) => blend.compositor.attachedBlocks.find((b) => b.name === name);
  const gain = 'node_groups["Compositor Nodes"].nodes["Color Balance"].inputs[8].default_value[0]';
  const { uniform, component } = JSON.parse(files['scene.ir.json']).properties[gain].bind;
  blend.set(gain, 1.5);
  assert.equal(block('Color Balance').pass.fragment.uniforms[uniform].value[component], 1.5, "Color Balance's Gain sets its uniform");
  const mask = 'node_groups["Compositor Nodes"].nodes["Ellipse Mask"].inputs[2].default_value';
  const { upload } = JSON.parse(files['scene.ir.json']).properties[mask].bind;
  blend.set(mask, 0.25);
  const data = block('Ellipse Mask')._frameGraphTask.recorder().data;
  assert.equal(new DataView(data.buffer, data.byteOffset).getFloat32(upload, true), 0.25, "the Ellipse Mask's Value sets the float its plan uploads");
} finally {
  written.remove();
}
console.log("Export compositor: Akari Noodle House's compositor is a NodeRenderGraph of the blocks library's pass block, with its values as controls");
