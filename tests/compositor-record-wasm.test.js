// Blender's GPU compositor runs in the module on its recording GPU backend (tools/blender-port/wasm/gpu-record.cc): a
// node's operation, evaluated alone by Blender's own code (compositor-api.cc compositor_record_node), comes out as the
// textures, uploads and compute dispatches Blender's GPU compositor makes, each dispatch naming its create info from
// Blender's registry with its push constants and bound textures.
import assert from 'node:assert/strict';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { withScratchNode } from '../src/nodes/blender/gpu-graph.js';

const { exports: x, withString, cString } = blenderModule;
const blender = blenderMain();
const record = (idname, values = {}) => withScratchNode('CompositorNodeTree', idname, { values }, (group, node) => {
  const text = withString('Image', (linked) => x.compositor_record_node(blender.bmain, blender.scene, group.as_pointer(), node.as_pointer(), linked, 64, 48));
  return text ? JSON.parse(cString(text)) : null;
});

// Glare's streaks: Blender's highlights, streak filter and accumulate, and mix shaders, by their create infos.
const glare = record('CompositorNodeGlare', { Type: 'Streaks' });
const dispatched = new Set(glare.commands.filter((c) => c.op === 'dispatch').map((c) => c.shader));
for (const name of ['compositor_glare_highlights', 'compositor_glare_streaks_filter', 'compositor_glare_streaks_accumulate', 'compositor_glare_mix']) {
  assert.ok(dispatched.has(name), `Glare dispatches ${name}`);
}
const highlights = glare.shaders.compositor_glare_highlights;
assert.deepEqual(highlights.group, [16, 16, 1], "its create info's work group");
assert.deepEqual(highlights.push_constants.map((c) => c.name), ['threshold', 'highlights_smoothness', 'max_brightness', 'quality']);
assert.deepEqual(highlights.samplers.map((s) => s.name), ['input_tx']);
assert.equal(highlights.images[0].access, 'write');
assert.deepEqual(glare.unsupported, []);
const input = glare.inputs.Image;
assert.equal(glare.textures.find((t) => t.id === input).size.slice(0, 2).join('x'), '64x48', 'the linked image at the size asked');
const first = glare.commands.find((c) => c.shader === 'compositor_glare_highlights');
assert.equal(first.samplers[0].texture, input, 'the highlights read the image');
assert.ok(glare.outputs.Image.texture !== undefined && glare.outputs.Glare.texture !== undefined, 'its outputs are textures');

// The Ellipse Mask's create info carries its compilation constant (node_type).
const mask = record('CompositorNodeEllipseMask');
assert.ok(Object.values(mask.shaders).some((s) => s.constants.some((c) => c.name === 'node_type')), 'compilation constants are recorded');

// Fog Glow reads its highlights back to transform them on the CPU: listed as unsupported, not replayed.
assert.deepEqual(record('CompositorNodeGlare', { Type: 'Fog Glow' }).unsupported, ['texture read']);
// A pixel node has GPU code of its own, not an operation.
assert.equal(record('CompositorNodeInvert'), null);
console.log("Compositor record: Blender's GPU compositor runs a node's passes on the module's recording backend");
