// Blender's compositor on its CPU path in the module (compositor-cpu.js) composites as Blender does: each case of
// tests/fixtures/blender-compositor.json (Blender's own CPU compositor on a synthetic image, from
// tools/blender-reference/compositor-fixtures.py) is the node between Render Layers, given the same image as the
// render, and the Group Output (a mask only before the Group Output), in the scene's compositing node group in Main.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { kw } from '../src/windowmanager/wm-operators.js';
import { blendData, idStruct } from '../src/python/bpy_rna.js';
import { compositeOnCPU } from '../src/compositor/compositor-cpu.js';

const { width, height, cases } = JSON.parse(readFileSync(new URL('./fixtures/blender-compositor.json', import.meta.url)));
// blender-reference/compositor-fixtures.py pixel.
const SPOTS = ['12,10', '30,20', '40,6'];
const image = Float32Array.from(Array.from({ length: width * height }, (_, i) => [i % width, Math.floor(i / width)]).flatMap(([x, y]) =>
  (SPOTS.includes(`${x},${y}`) ? [8, 6, 4, 1] : [x / width, y / height, 0.5 + 0.25 * ((x + y) % 2), 1])));

const blender = blenderMain(), scene = idStruct(blender.scene);
const tree = blendData().node_groups.new('Compositor Nodes', 'CompositorNodeTree');
tree.interface.new_socket(kw({ name: 'Image', in_out: 'OUTPUT', socket_type: 'NodeSocketColor' }));
scene.compositing_node_group = tree;

const failures = [];
for (const { node: idname, inputs, result } of cases) {
  tree.nodes.clear();
  const node = tree.nodes.new(idname), layers = tree.nodes.new('CompositorNodeRLayers'), output = tree.nodes.new('NodeGroupOutput');
  for (const [id, value] of Object.entries(inputs)) [...node.inputs].find((s) => s.identifier === id).default_value = value;
  const imageInput = [...node.inputs].find((s) => s.type === 'RGBA');
  if (imageInput) tree.links.new(layers.outputs.get('Image'), imageInput);
  tree.links.new([...node.outputs].find((s) => s.type === 'RGBA') ?? node.outputs[0], output.inputs[0]);
  const started = performance.now(), got = compositeOnCPU(blender, image, width, height), ms = performance.now() - started;
  const worst = result.reduce((m, v, i) => Math.max(m, Math.abs(v - got[i]) / Math.max(1, Math.abs(v))), 0);
  if (!(worst < 2e-3)) failures.push(`${idname} ${JSON.stringify(inputs)}: off by ${worst}`);
  else console.log(`  ${idname} ${inputs.Type}: ${ms.toFixed(0)} ms`);
}
assert.deepEqual(failures, []);
console.log(`Compositor CPU: ${cases.length} multi-pass nodes composite as Blender's CPU compositor`);
