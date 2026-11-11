// A material made of a node group exports as EEVEE compiles it: its graph in the IR is the material's tree with the
// group inlined by Blender (main-view.js nodeTreeOf), the tree the app builds the material from, so the page builds it
// from the IR, not from its own code; the group's input set on its node reaches the node inside.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExample } from './open-example.js';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const TINT = [0.2, 0.9, 0.3, 1];
// The example's Brick material made a group's Emission, tinted through the group's input, saved as a .blend (one Main
// a process: made in a process of its own).
if (process.argv[2] === '--make') {
  const { sync } = openExample('shader-gallery');
  const data = blendData(), group = data.node_groups.new('Glow', 'ShaderNodeTree');
  group.interface.new_socket('Shader', '', 'OUTPUT', 'NodeSocketShader');
  group.interface.new_socket('Tint', '', 'INPUT', 'NodeSocketColor');
  const input = group.nodes.new('NodeGroupInput'), output = group.nodes.new('NodeGroupOutput'), emission = group.nodes.new('ShaderNodeEmission');
  group.links.new(input.outputs[0], emission.inputs[0]);
  group.links.new(emission.outputs[0], output.inputs[0]);
  const tree = data.materials.get('Brick').node_tree, node = tree.nodes.new('ShaderNodeGroup');
  node.node_tree = group;
  node.inputs[0].default_value = TINT;
  tree.links.new(node.outputs[0], [...tree.nodes].find((n) => n.bl_idname === 'ShaderNodeOutputMaterial').inputs[0]);
  writeFileSync(process.argv[3], sync.writeBlend('/group.blend'));
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'node-group-')), file = join(dir, 'group.blend');
try {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--make', file], { stdio: 'ignore' });
  const { world, sync } = openExample(file);
  sync.view();
  const warnings = [], warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  const files = await exportModule(world);
  console.warn = warn;
  const graph = JSON.parse(files['scene.ir.json']).graphs['MA:Brick/node_tree'];
  assert.ok(!graph.nodes.some((n) => n.type === 'node:ShaderNodeGroup'), 'no group node is left');
  const emission = graph.nodes.find((n) => n.type === 'node:ShaderNodeEmission' && graph.links.some((l) => l[0] === n.name && l[2] === 'Material Output'));
  assert.ok(emission, "the group's Emission feeds the Material Output");
  assert.deepEqual(emission.inputs.Color.map((v) => +v.toFixed(3)), TINT, "the group's input reaches the node inside");
  assert.deepEqual(warnings.filter((w) => /own code/.test(w)), [], 'the page builds the material from the IR');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Export node groups: a material's node group is inlined as EEVEE compiles it, and the page builds it from the IR");
process.exit(0);
