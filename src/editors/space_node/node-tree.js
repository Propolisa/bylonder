// A Babylon graph (NodeMaterial or NodeRenderGraph) as Blender's node editor sees a node tree: its blocks are nodes,
// Babylon's and Blender's alike, its connections links, and its editorData (locations, collapsed state, frames) the
// layout, kept in Babylon's format so the graph opens the same in Babylon's own editors. Every edit goes through
// here and ends in `changed(rebuild)`.
import { InputBlock, NodeMaterial, NodeMaterialBlockConnectionPointTypes as M, NodeRenderGraphBlockConnectionPointTypes as R } from '@babylonjs/core';
import { isBlenderShader, shaderNodeClasses } from '../../nodes/blender/shader-nodes.js';
import { BlenderCompositorBlock, compositorNodeClasses } from '../../nodes/blender/compositor-nodes.js';
import { availability } from '../../nodes/blender/declarations.js';
import { categoryOf } from './block-categories.js';
import { nodeLayout, U } from './node-layout.js';
import * as materialCatalog from './babylon/material-blocks.js';
import * as renderGraphCatalog from './babylon/render-graph-blocks.js';

// A Babylon connection point type as the Blender socket type drawn for it; a type Babylon decides on linking is
// drawn as a value, or in the compositor as an image, which most such sockets take.
const MATERIAL_SOCKETS = {
  [M.Float]: 'VALUE', [M.Int]: 'INT', [M.Vector2]: 'VECTOR', [M.Vector3]: 'VECTOR', [M.Vector4]: 'VECTOR',
  [M.Color3]: 'RGBA', [M.Color4]: 'RGBA', [M.Matrix]: 'MATRIX', [M.Object]: 'OBJECT',
};
const materialSocket = (type) => MATERIAL_SOCKETS[type] ?? 'VALUE';
const renderGraphSocket = (type) => (type & (R.TextureAll | R.AutoDetect | R.BasedOnInput) ? 'RGBA' : type & (R.Camera | R.ShadowLight) ? 'OBJECT' : type & R.ObjectList ? 'COLLECTION' : 'CUSTOM');
// Babylon's block categories (editor-theme.js) as Blender's node classes.
const BABYLON_TAGS = { input: 'INPUT', output: 'OUTPUT', shader: 'SHADER', texture: 'TEXTURE', filter: 'FILTER', geometry: 'GEOMETRY', particle: 'CONVERTER', color: 'COLOR', vector: 'VECTOR', converter: 'CONVERTER', layout: 'LAYOUT' };
// Babylon's PropertyTypeForEdition as Blender's property types.
const PROPERTY_TYPES = { 0: 'BOOLEAN', 1: 'FLOAT', 2: 'INT', 5: 'ENUM' };
const ELBOWS = new Set(['ElbowBlock', 'NodeRenderGraphElbowBlock']), REROUTE = 'ElbowBlock';
// Babylon's port names (worldPosition, rgba) as Blender labels (World Position, RGBA).
const ACRONYMS = /^(rgba?|xyz|xy|uv|ior)$/i;
const titleCase = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').map((w) => (ACRONYMS.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
export const isBlender = (block) => isBlenderShader(block) || block instanceof BlenderCompositorBlock;
// Bylonder's helper blocks, which link Blender nodes to Babylon's geometry and outputs: named `blender:`, or feeding
// only what is hidden (a Blender node's own inputs Bylonder links, other helpers). Not drawn.
const internalInput = (input) => isBlender(input.ownerBlock) && input.ownerBlock.declared?.(input.name) === false;
const isHelper = (block, seen = new Set()) => {
  if (block.name?.startsWith('blender:')) return true;
  if (seen.has(block)) return false;
  seen.add(block);
  const ends = block.outputs.flatMap((output) => output.endpoints);
  return ends.length > 0 && ends.every((end) => internalInput(end) || isHelper(end.ownerBlock, seen));
};
// A link Bylonder's editor draws: between drawn blocks, into a Blender node's own socket.
const drawnLink = (input) => !isHelper(input.connectedPoint.ownerBlock) && !internalInput(input);

// Babylon's editable block properties (@editableInPropertyPage) along the block's class chain.
export function babylonProperties(block) {
  const names = new Set(), entries = [];
  for (let proto = Object.getPrototypeOf(block); proto?.getClassName; proto = Object.getPrototypeOf(proto)) {
    names.add(proto.getClassName.call(proto));
    if (Object.hasOwn(proto, '_propStore')) entries.push(...proto._propStore);
  }
  return entries.filter((p, i) => names.has(p.className) && entries.findIndex((q) => q.propertyName === p.propertyName) === i);
}

export function createNodeTree(graph, { changed = () => {} } = {}) {
  const kind = graph instanceof NodeMaterial ? 'shader' : 'compositor';
  const catalog = kind === 'shader' ? materialCatalog : renderGraphCatalog;
  const blenderClasses = kind === 'shader' ? shaderNodeClasses : compositorNodeClasses;

  const outputs = () => (kind === 'shader' ? [...graph._vertexOutputNodes, ...graph._fragmentOutputNodes] : [graph.outputBlock].filter(Boolean));
  // All blocks: the attached ones and whatever links to the outputs (attachedBlocks fills on build).
  const blocks = () => {
    const found = new Set(graph.attachedBlocks);
    const visit = (block) => {
      if (!block || found.has(block)) return;
      found.add(block);
      for (const input of block.inputs) visit(input.connectedPoint?.ownerBlock);
    };
    outputs().forEach((b) => { found.delete(b); visit(b); });
    graph.attachedBlocks.forEach((b) => b.inputs.forEach((i) => visit(i.connectedPoint?.ownerBlock)));
    for (const block of found) if (!graph.attachedBlocks.includes(block)) graph.attachedBlocks.push(block);
    return [...found].filter((block) => !isHelper(block));
  };
  const byId = (id) => blocks().find((b) => b.uniqueId === id);

  // editorData in Babylon's format, its frames' block ids made current (Babylon remaps only locations on load).
  const editor = () => {
    const data = (graph.editorData ??= { locations: [] });
    data.locations ??= [];
    if (data.map) {
      for (const frame of data.frames ?? []) frame.blocks = frame.blocks.map((id) => data.map[id] ?? id);
      delete data.map;
    }
    data.frames ??= [];
    return data;
  };
  const location = (block) => {
    const data = editor(), placed = (b) => data.locations.some((l) => l.blockId === b.uniqueId);
    if (!placed(block)) arrange(blocks().filter((b) => !placed(b)));
    return data.locations.find((l) => l.blockId === block.uniqueId);
  };
  // Blocks without a location (a graph Babylon made, or saved without its editor) in columns by their distance from
  // the outputs, each column stacked in the order of the graph.
  const arrange = (list) => {
    const depth = new Map();
    const visit = (block, d) => {
      if ((depth.get(block) ?? -1) >= d) return;
      depth.set(block, d);
      for (const input of block.inputs) if (input.connectedPoint) visit(input.connectedPoint.ownerBlock, d + 1);
    };
    blocks().filter((b) => b.outputs.every((o) => !o.hasEndpoints)).forEach((b) => visit(b, 0));
    const entries = list.map((block) => ({ blockId: block.uniqueId, x: -(depth.get(block) ?? 0) * 260, y: 0, isCollapsed: false }));
    editor().locations.push(...entries);
    for (const column of Map.groupBy(list.map((block, i) => [block, entries[i]]), ([, entry]) => entry.x).values()) {
      let y = 0;
      for (const [block, entry] of column) {
        entry.y = y;
        y += nodeLayout(node(block)).height + U * 2;
      }
    }
  };

  // A connection point as a socket: its Blender type, label and whether it shows.
  const socket = (point, declared) => {
    const type = declared?.type ?? (kind === 'shader' ? materialSocket(point.type) : renderGraphSocket(point.type));
    return { point, id: point.name, type, shape: declared?.shape ?? 'CIRCLE', label: declared ? declared.name : point.displayName || titleCase(point.name), align: declared?.align, linked: point.isConnected ?? !!point.connectedPoint };
  };

  // What the node draws, Blender's way: header, outputs, buttons, inputs (node_draw.cc).
  function node(block) {
    const at = location(block), blender = isBlender(block) ? block.declaration : null;
    if (ELBOWS.has(block.getClassName())) return { id: block.uniqueId, block, reroute: true, x: at.x, y: at.y, inputs: block.inputs.map((p) => socket(p)), outputs: block.outputs.map((p) => socket(p)) };
    let inputs, outs, buttons, tag, label, ramp = null;
    if (blender) {
      const shown = availability(blender, block.properties, block.values);
      outs = blender.outputs.filter((s) => shown.outputs.has(s.identifier)).map((s) => ({ ...socket(block.getOutputByName(s.identifier) ?? { name: s.identifier }, s) }));
      inputs = blender.inputs.filter((s) => shown.inputs.has(s.identifier)).map((s) => {
        const point = block.getInputByName(s.identifier) ?? { name: s.identifier, isConnected: false };
        return { ...socket(point, s), label: shown.labels[s.identifier] ?? s.name, value: s.hide_value ? null : { socket: s, get: () => block.values[s.identifier], set: (v) => { block.values[s.identifier] = v; changed(s.type === 'MENU'); } } };
      });
      buttons = Object.entries(blender.properties).filter(([key, p]) => (p.type === 'ENUM' || p.type === 'BOOLEAN') && drawn(block.idname, key, block.properties)).map(([key, p]) => ({
        key, label: p.name, type: p.type, items: p.items, get: () => block.properties[key], set: (v) => { block.properties[key] = v; changed(true); },
      }));
      // A Color Ramp's ramp (template_color_ramp): its stops' edits rebuild, choosing the active one does not.
      if (block.properties.color_ramp) ramp = { get: () => block.properties.color_ramp, changed };
      tag = shown.tag;
      label = LABELS[block.idname]?.(block.properties, blender) ?? blender.name;
    } else {
      outs = block.outputs.filter((p) => !p.isHidden).map((p) => socket(p));
      inputs = block.inputs.filter((p) => !p.isHidden && p.name !== 'dependencies').map((p) => socket(p));
      // Babylon's lists (its operations) and the properties its editor embeds in the node, as Blender's buttons.
      buttons = babylonProperties(block).filter((p) => PROPERTY_TYPES[p.type] && (p.type === 5 || p.options.embedded)).map((p) => ({
        key: p.propertyName, label: p.displayName, type: PROPERTY_TYPES[p.type], items: p.options.options?.map((o) => [o.value, o.label, '']),
        min: p.options.min, max: p.options.max, get: () => block[p.propertyName], set: (v) => { block[p.propertyName] = v; changed(true); },
      }));
      if (block instanceof InputBlock && !block.isSystemValue && !block.isAttribute && block.value != null) outs[0].value = inputValue(block);
      tag = BABYLON_TAGS[categoryOf(block.getClassName())];
      label = block.name;
    }
    const shown = (list) => (at.hideSockets ? list.filter((s) => s.linked) : list);
    return {
      id: block.uniqueId, block, blender: blender ? block.idname : null, label, tag, x: at.x, y: at.y,
      width: blender?.width ?? Math.max(140, ...[...inputs, ...outs].map((s) => s.label.length * 7 + 50)),
      hidden: !!at.isCollapsed, socketsHidden: !!at.hideSockets, muted: !!(block.mute ?? block.disabled),
      outputs: shown(outs), inputs: shown(inputs), buttons, ramp,
    };
  }
  // A Babylon input block's value, as Blender's Value and RGB nodes show theirs.
  const inputValue = (block) => {
    const v = block.value;
    const type = typeof v === 'number' ? 'VALUE' : 'r' in v ? 'RGBA' : 'VECTOR';
    return {
      socket: { type, subtype: type === 'RGBA' ? 'COLOR' : undefined, name: block.name, min: block.min || undefined, max: block.max || undefined },
      get: () => (typeof block.value === 'number' ? block.value : block.value.asArray()),
      set: (x) => { block.value = typeof block.value === 'number' ? x : block.value.constructor.FromArray(x); changed(false); },
    };
  };

  const make = (name) => {
    const Blender = blenderClasses[name];
    if (Blender) return kind === 'shader' ? new Blender() : new Blender(undefined, graph.frameGraph, graph.getScene());
    const block = kind === 'shader' ? catalog.BlockTools.GetBlockFromString(name, graph.getScene(), graph) : catalog.BlockTools.GetBlockFromString(name, graph.frameGraph, graph.getScene());
    const type = !block && kind === 'shader' && catalog.BlockTools.GetConnectionNodeTypeFromString(name);
    return block ?? (type && type !== M.AutoDetect ? new InputBlock(name, undefined, type) : null);
  };

  const links = () => blocks().flatMap((block) => block.inputs.filter((i) => i.connectedPoint && drawnLink(i)).map((input) => ({ from: input.connectedPoint, to: input })));

  const tree = {
    kind, graph, catalog, blenderClasses,
    blocks, byId, node, links,
    nodes: () => blocks().map(node),
    frames: () => editor().frames,
    location,
    setLocation(block, x, y) { Object.assign(location(block), { x, y }); },
    moved: () => changed(false),
    canLink: (from, to) => from !== to && from.ownerBlock !== to.ownerBlock && from.checkCompatibilityState(to) === 0,
    // node.link: a link to an input replaces the one it has, as Blender's single inputs take one link.
    link(from, to) {
      const previous = to.connectedPoint;
      previous?.disconnectFrom(to);
      if (!tree.canLink(from, to)) { if (previous) previous.connectTo(to); return false; }
      from.connectTo(to);
      changed(true);
      return true;
    },
    unlink(to) { to.connectedPoint?.disconnectFrom(to); changed(true); },
    // A block from Blender's idname or Babylon's menu name, as Babylon's editor makes it; a Blender node with the
    // settings its Add menu entry gives (node.add_node's settings: properties, and inputs' default values).
    add(name, x, y, settings = {}) {
      if (name === 'NodeFrame') return tree.join([]) && null;
      const block = make(name === 'NodeReroute' ? REROUTE : name);
      if (!block) return null;
      for (const [key, value] of Object.entries(settings)) {
        const input = /^inputs\["(.+)"\]\.default_value$/.exec(key);
        if (input) block.values[input[1]] = value; else if (block.properties) block.properties[key] = value;
      }
      graph.attachedBlocks.push(block);
      block.attach?.(graph);
      editor().locations.push({ blockId: block.uniqueId, x, y, isCollapsed: false });
      changed(true);
      return block;
    },
    // node.duplicate: copies offset by (dx, dy), with the links between the originals.
    duplicate(list, dx, dy) {
      const copies = new Map(list.map((block) => [block, block.clone(graph.getScene())]));
      for (const [block, copy] of copies) {
        graph.attachedBlocks.push(copy);
        const at = location(block);
        editor().locations.push({ blockId: copy.uniqueId, x: at.x + dx, y: at.y + dy, isCollapsed: at.isCollapsed });
        block.inputs.forEach((input, i) => {
          const from = input.connectedPoint, source = from && copies.get(from.ownerBlock);
          if (source) source.outputs[from.ownerBlock.outputs.indexOf(from)].connectTo(copy.inputs[i]);
        });
      }
      changed(true);
      return [...copies.values()];
    },
    // node.add_reroute: a reroute on the link, at (x, y).
    insertReroute(from, to, x, y) {
      const reroute = make(REROUTE);
      graph.attachedBlocks.push(reroute);
      editor().locations.push({ blockId: reroute.uniqueId, x, y, isCollapsed: false });
      from.disconnectFrom(to);
      from.connectTo(reroute.inputs[0]);
      reroute.outputs[0].connectTo(to);
      changed(true);
      return reroute;
    },
    remove(list) {
      for (const block of list) {
        for (const input of block.inputs) input.connectedPoint?.disconnectFrom(input);
        for (const output of block.outputs) for (const end of [...output.endpoints]) output.disconnectFrom(end);
        if (kind === 'shader') graph.removeBlock(block);
        else { graph.attachedBlocks.splice(graph.attachedBlocks.indexOf(block), 1); block.dispose(); }
        const data = editor();
        data.locations = data.locations.filter((l) => l.blockId !== block.uniqueId);
        for (const frame of data.frames) frame.blocks = frame.blocks.filter((id) => id !== block.uniqueId);
      }
      changed(true);
    },
    // node.mute_toggle: Blender nodes pass inputs through; Babylon's render graph tasks copy their source.
    setMuted(block, value) {
      if ('mute' in block) block.mute = value; else if ('disabled' in block) block.disabled = value; else return;
      changed(true);
    },
    setHidden(block, value) { location(block).isCollapsed = value; changed(false); },
    setSocketsHidden(block, value) { location(block).hideSockets = value; changed(false); },
    // node.join: a frame around the blocks, in Babylon's frame format.
    join(list, name = 'Frame') {
      const data = editor();
      for (const frame of data.frames) frame.blocks = frame.blocks.filter((id) => !list.some((b) => b.uniqueId === id));
      const frame = { x: 0, y: 0, width: 0, height: 0, color: [0.0588, 0.0588, 0.0588], name, isCollapsed: false, blocks: list.map((b) => b.uniqueId), comments: '' };
      data.frames.push(frame);
      changed(false);
      return frame;
    },
    frameOf: (block) => editor().frames.find((f) => f.blocks.includes(block.uniqueId)),
    removeFrame(frame) { const data = editor(); data.frames.splice(data.frames.indexOf(frame), 1); changed(false); },
  };
  return tree;
}

// A node's header label where its type draws one from its properties (node_math_label, node_mix_label).
const itemName = (decl, key, value) => decl.properties[key].items.find(([id]) => id === value)?.[1];
const LABELS = {
  ShaderNodeMath: (p, decl) => itemName(decl, 'operation', p.operation),
  ShaderNodeMix: (p, decl) => (p.data_type === 'RGBA' ? itemName(decl, 'blend_type', p.blend_type) : undefined),
};

// The enum and boolean properties a node draws in its body, as its draw_buttons does; the rest are in the sidebar.
const BUTTONS = {
  // node_shader_mix.cc, sh_node_mix_layout
  ShaderNodeMix: (key, p) => key === 'data_type' || key === 'clamp_factor' || (key === 'factor_mode' && p.data_type === 'VECTOR') || ((key === 'blend_type' || key === 'clamp_result') && p.data_type === 'RGBA'),
};
const drawn = (idname, key, properties) => BUTTONS[idname]?.(key, properties) ?? true;

