// The scene's compositor as the blocks library runs it (runtime/blocks.js): Main's compositing node group as a Babylon
// NodeRenderGraph whose Blender nodes are each a BylonderPassBlock, its code made here by Blender's GPU node functions
// (a fragment shader with the node's values as uniforms) or its operation recorded here as Blender's GPU compositor
// runs it at the render's size (a plan of passes). An input whose value lands in one uniform, or in one uploaded float of
// a plan, is a control set without a rebuild; any other value changes the code or the plan, which only Blender's
// evaluator can make again.
import { compositorGraph } from '../compositor/compositor-tree.js';
import { BlenderCompositorBlock } from '../nodes/blender/compositor-nodes.js';
import { BlenderGroupOutputBlock, BlenderRenderLayersBlock } from '../nodes/blender/compositor-io.js';
import { nodeGraph } from '../nodes/blender/gpu-graph.js';
import { nodeRecording } from '../compositor/compositor-replay.js';
import { specializeSamplers } from '../overrides/webgpu/samplers.js';
import { socketType } from '../nodes/blender/sockets.js';
import { idStruct } from '../python/bpy_rna.js';

const key = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
const near = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));

// The blocks the composite passes through, from the output back.
function reached(output) {
  const seen = new Set(), visit = (block) => {
    if (!block || seen.has(block)) return;
    seen.add(block);
    for (const input of block.inputs) visit(input.connectedPoint?.ownerBlock);
  };
  visit(output);
  return seen;
}

// A node's values with one component (or the value) of an input changed by `delta`.
function nudged(values, id, component, delta) {
  const value = values[id];
  return { ...values, [id]: Array.isArray(value) ? value.map((v, i) => (i === component ? v + delta : v)) : value + delta };
}

// The numeric components of a node's unlinked inputs: [identifier, input index, component or undefined, socket].
function numericInputs(block) {
  const linked = new Set(block.linked.keys());
  return block.declaration.inputs.flatMap((socket, index) => {
    const value = block.values[socket.identifier];
    if (linked.has(socket.identifier) || !socketType(socket.type) || socket.type === 'MENU' || socket.type === 'BOOLEAN') return [];
    if (typeof value === 'number') return [[socket.identifier, index, undefined, socket]];
    return Array.isArray(value) ? value.map((_, c) => [socket.identifier, index, c, socket]) : [];
  });
}

// The uniforms of the node's fragment for its values, flattened.
const uniformValues = (block, values) => (nodeGraph('CompositorNodeTree', block.idname, { properties: block.properties, values, linked: [...block.linked.keys()] })?.nodes ?? [])
  .flatMap((n) => n.inputs.filter((i) => i.source === 'uniform').map((i) => i.value));

// Where an input's component lands in a fragment pass: the one uniform and component that follow it alone, or null.
function uniformBinding(block, id, component) {
  const delta = 0.125, before = uniformValues(block, block.values), after = uniformValues(block, nudged(block.values, id, component, delta));
  if (before.length !== after.length) return null;
  const changed = before.flatMap((u, i) => u.map((v, c) => [i, c, v, after[i][c]])).filter(([, , v, w]) => !near(v, w));
  if (changed.length !== 1) return null;
  const [[uniform, at, v, w]] = changed;
  return near(w - v, delta) ? { uniform, component: at } : null;
}

// Where an input's component lands in a plan: the one float of its uploads that follows it alone, or null.
function uploadBinding(block, id, component, size, recording) {
  const delta = 0.125, linked = [...block.linked.keys()];
  const after = nodeRecording(block.idname, { properties: block.properties, values: nudged(block.values, id, component, delta), linked }, size[0], size[1]);
  if (!after?.plan.steps || JSON.stringify(after.plan) !== JSON.stringify(recording.plan) || after.data.length !== recording.data.length) return null;
  const a = new DataView(recording.data.buffer), b = new DataView(after.data.buffer), changed = [];
  for (let offset = 0; offset < recording.data.length; offset += 4) if (a.getUint32(offset, true) !== b.getUint32(offset, true)) changed.push(offset);
  return changed.length === 1 && near(b.getFloat32(changed[0], true) - a.getFloat32(changed[0], true), delta) ? { upload: changed[0] } : null;
}

// A Blender node's pass and the controls of its values that bind to it.
function nodePass(block, size, inputsPath) {
  const pass = { inputs: block.inputs.filter((i) => i.name !== 'dependencies').map((i) => i.name), outputs: block.outputs.map((o) => o.name),
    ...(block.image && { image: block.image.identifier }), ...(block.result && { result: block.result.identifier }) };
  let bindingOf = () => null;
  if (block.replays) {
    const recording = !block.mute && block._recording(size);
    if (recording?.plan.steps) {
      const steps = recording.plan.steps.map((step) => (step.code ? { ...step, code: specializeSamplers(step.code) } : step));
      pass.plan = { ...recording.plan, steps, data: base64(recording.data) };
      bindingOf = (id, component) => uploadBinding(block, id, component, size, recording);
    }
  } else {
    const { code, uniforms, samplers, bands } = block._fragment(), values = block._uniformValues();
    pass.fragment = { code: specializeSamplers(code), uniforms: uniforms.map(([name, kind], i) => ({ name, kind, value: [...values[i]] })), samplers,
      bands: bands.map(([name, pixels]) => ({ name, pixels: [...pixels] })) };
    if (!block.mute) bindingOf = (id, component) => uniformBinding(block, id, component);
  }
  const knobs = numericInputs(block).flatMap(([id, index, component, socket]) => {
    const bind = bindingOf(id, component);
    if (!bind) return [];
    const value = block.values[id], path = `${inputsPath}[${index}].default_value${component === undefined ? '' : `[${component}]`}`;
    return [{ path, type: 'FLOAT', default: component === undefined ? value : value[component], ...(socket.subtype && { subtype: socket.subtype }),
      ...(socket.min !== undefined && { soft_min: socket.min }), ...(socket.max !== undefined && { soft_max: socket.max }), bind: { compositor: block.name, ...bind } }];
  });
  return { pass, knobs };
}

// Main's compositing tree as a graph at the render's size, or null when the scene does not composite.
function compositing(world) {
  const sync = world.mainSync, tree = sync?.compositingTree();
  const scene = sync && idStruct(sync.blender.scene);
  if (!tree || !scene.render.use_compositing) return null;
  const { render } = scene, percent = render.resolution_percentage / 100;
  const size = [Math.round(render.resolution_x * percent), Math.round(render.resolution_y * percent)];
  return { scene, size, graph: compositorGraph(tree, world.scene, tree.name).graph };
}

// What a page's composite leaves out: each node the composite passes through that it cannot run (a recording the
// page cannot replay, as Fog Glow's read back for its FFT), whose image the page passes through as muted.
export function compositorLosses(world) {
  const made = compositing(world);
  if (!made) return [];
  try {
    const dropped = (block) => (block.replays ? (block._recording(made.size)?.plan.reasons ?? (block._recording(made.size) ? null : ['not recorded'])) : !block._graph() && ['no GPU code']);
    return [...reached(made.graph.outputBlock)].filter((block) => block instanceof BlenderCompositorBlock && !block.mute && dropped(block))
      .map((block) => `Compositor: ${block.name} is not exported (${dropped(block).join(', ')}); the page passes its image through`);
  } finally {
    made.graph.dispose();
  }
}

// The scene's compositor for the page, or null when it does not composite: { compositor: { graph, width, height },
// knobs }. Its plans are recorded at the scene's render size (`width` by `height`).
export function exportCompositor(world) {
  const made = compositing(world);
  if (!made) return null;
  const { scene, size, graph } = made;
  const nodesPath = `node_groups${key(scene.compositing_node_group.name)}.nodes`;
  try {
    const used = reached(graph.outputBlock), json = graph.serialize(), knobs = [];
    const byId = new Map(graph.attachedBlocks.map((b) => [b.uniqueId, b]));
    json.blocks = json.blocks.filter((entry) => used.has(byId.get(entry.id))).map((entry) => {
      const block = byId.get(entry.id);
      if (block instanceof BlenderRenderLayersBlock) return { ...entry, customType: 'BABYLON.NodeRenderGraphInputBlock' };
      if (block instanceof BlenderGroupOutputBlock) return { ...entry, customType: 'BABYLON.BylonderCompositeOutputBlock' };
      if (!(block instanceof BlenderCompositorBlock)) throw Error(`the compositor's ${entry.customType} is not exported`);
      const { blender, ...rest } = entry, made = nodePass(block, size, `${nodesPath}${key(block.name)}.inputs`);
      knobs.push(...made.knobs);
      return { ...rest, customType: 'BABYLON.BylonderPassBlock', pass: made.pass };
    });
    delete json.editorData;
    return { compositor: { graph: json, width: size[0], height: size[1] }, knobs };
  } finally {
    graph.dispose();
  }
}
