// Node trees as the IR's graphs (docs/ir.md, Graphs): shader, world, Geometry Nodes and compositor trees alike, with
// their nodes' settings, unlinked socket values, links, interface, the groups they use (each its own graph) and zones.
// Frames are layout, and reroutes and muted nodes pass their links on: none is written, a link through them joins its
// ends, or gives the input it reaches the value where the chain starts unlinked.
import { isCollection, pointerOf } from '../python/bpy_rna.js';

const GRAPH_TYPES = { ShaderNodeTree: 'SHADER', GeometryNodeTree: 'GEOMETRY', CompositorNodeTree: 'COMPOSITOR' };
// The ID codes of what a node or a socket points to.
const ID_CODES = { Object: 'OB', Collection: 'GR', Material: 'MA', Image: 'IM', Texture: 'TE', Mesh: 'ME', Scene: 'SC', World: 'WO',
  MovieClip: 'MC', Mask: 'MSK', VectorFont: 'VF', Text: 'TX' };
// Node properties every node has (bpy.types.Node) and what only the editor reads.
const SKIP = /^(rna_type|type|location|location_absolute|width|height|dimensions|name|label|inputs|outputs|panel_states|internal_links|parent|warning_propagation|use_custom_color|color|color_tag|select|show_options|show_preview|hide|mute|show_texture|bl_\w+|active_\w+|.*_index)$/;
const SKIP_IN_STRUCT = /^(rna_type|bl_\w+|select\w*|show_\w+|ui_\w+|.*_expanded)$/;
const LAYOUT_NODES = new Set(['NodeFrame', 'NodeReroute']);

const isID = (value) => { const p = pointerOf(value); return !!p && p[1] === p[2]; };
const idCode = (id) => {
  const type = id.rna_type.identifier;
  return /NodeTree$/.test(type) ? 'NT' : ID_CODES[type] ?? (/Texture$/.test(type) ? 'TE' : type.slice(0, 2).toUpperCase());
};
/** The IR's key of an ID (`OB:Cube`, `NT:Planet`, a linked one's `@library`). */
export const idKey = (id) => `${idCode(id)}:${id.name}${id.library ? '@' + id.library.name : ''}`;
const safe = (fn) => { try { return fn(); } catch { return undefined; } };

// An RNA value as graph data: a node tree as `{ graph }` (written too), another ID as `{ id }`, a node as `{ node }`,
// a struct by its properties, a collection as an array. A struct met again (a cycle of pointers) is `{ struct: path }`,
// the path where it was first written. `walk` holds the group writer and the structs met, `path` names `v`.
function valueOf(v, walk, path, item = false) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (v instanceof Set) return [...v];
  if (isCollection(v)) return [...v].map((each, i) => valueOf(each, walk, `${path}[${i}]`, true));
  if (isID(v)) return idCode(v) === 'NT' ? { graph: walk.graph(v) } : { id: idKey(v) };
  if (v.bl_rna && safe(() => v.internal_links) !== undefined && v.inputs && v.outputs) return { node: v.name };
  if (v.bl_rna) {
    const pointer = pointerOf(v), at = pointer && `${v.bl_rna.identifier}:${pointer[2]}`;
    if (at && walk.seen.has(at)) return { struct: walk.seen.get(at) };
    if (at) walk.seen.set(at, path);
    return structOf(v, walk, path, SKIP_IN_STRUCT, !item);
  }
  const items = safe(() => [...v]);
  return items ? items.map((each, i) => valueOf(each, walk, `${path}[${i}]`)) : null;
}

// A struct's properties; a nested one's (a node's texture mapping) without those at their RNA default, a collection's
// items (a color ramp's stops) whole.
function structOf(s, walk, path, skip, nested = false) {
  const out = {};
  for (const prop of s.bl_rna.properties) {
    const name = prop.identifier;
    if (skip.test(name)) continue;
    const v = safe(() => s[name]);
    if (v !== undefined && !(nested && isDefault(prop, v))) out[name] = valueOf(v, walk, path ? `${path}.${name}` : name);
  }
  return out;
}

function isDefault(prop, v) {
  if (prop.type === 'POINTER' || prop.type === 'COLLECTION') return false;
  const fallback = safe(() => (prop.array_length > 0 ? [...prop.default_array] : prop.default));
  const same = (a, b) => a === b || (typeof a === 'number' && Math.fround(a) === Math.fround(b));
  if (Array.isArray(fallback)) return safe(() => [...v].every((x, i) => same(x, fallback[i]))) ?? false;
  return same(v, fallback) || (v instanceof Set && !v.size);
}

const socketValue = (socket, graph) => {
  const v = safe(() => socket.default_value);
  return v === undefined ? undefined : valueOf(v, { graph, seen: new Map() }, 'default_value');
};

/**
 * Writes `tree` (an RNA node tree) under `key`, and every group it uses under its ID's key, into `graphs`.
 * @param {any} tree
 * @param {string} key
 * @param {Record<string, any>} [graphs]
 * @param {{ value?(socket: any, node: any, tree: any): any }} [options] `value` may give an unlinked input's value as a
 *   reference (`{ property }`) instead of the value itself
 * @returns {Record<string, any>} graphs
 */
export function writeGraph(tree, key, graphs = {}, options = {}) {
  if (graphs[key]) return graphs;
  const graph = { type: GRAPH_TYPES[tree.bl_idname] ?? tree.bl_idname, nodes: [], links: [], interface: [] };
  graphs[key] = graph;
  const group = (nested) => {
    const nestedKey = idKey(nested);
    writeGraph(nested, nestedKey, graphs, options);
    return nestedKey;
  };

  for (const item of tree.interface?.items_tree ?? []) {
    if (item.item_type === 'PANEL') { graph.interface.push({ item: 'PANEL', name: item.name }); continue; }
    graph.interface.push(Object.fromEntries(Object.entries({
      identifier: item.identifier, name: item.name, in_out: item.in_out, socket_type: item.socket_type, subtype: safe(() => item.subtype),
      default: socketValue(item, group), min: safe(() => item.min_value), max: safe(() => item.max_value),
      panel: item.parent?.name || undefined, hide_value: item.hide_value || undefined,
    }).filter(([, v]) => v !== undefined && v !== 'NONE')));
  }

  // Reroutes and muted nodes pass their links on (a muted node by its internal links): neither is written.
  const passes = (node) => node.bl_idname === 'NodeReroute' || node.mute;
  const linksTo = (socket) => [...tree.links].filter((l) => l.to_socket.identifier === socket.identifier && l.to_node.name === socket.node.name && l.is_valid && !l.is_muted);
  // What feeds a link, past what passes it on: another node's output, or a value where the chain starts unlinked.
  const source = (link) => {
    for (;;) {
      const node = link.from_node;
      if (!passes(node)) return { from: [node.name, link.from_socket.identifier] };
      const input = node.bl_idname === 'NodeReroute' ? node.inputs[0]
        : [...node.internal_links].find((l) => l.to_socket.identifier === link.from_socket.identifier)?.from_socket;
      const next = input && linksTo(input)[0];
      if (!next) return { value: socketValue(input ?? link.from_socket, group) };
      link = next;
    }
  };

  const nodes = [...tree.nodes].filter((node) => !LAYOUT_NODES.has(node.bl_idname) && !passes(node));
  const enabled = (sockets) => [...sockets].filter((s) => s.enabled && s.bl_idname !== 'NodeSocketVirtual');
  for (const node of nodes) {
    const inputs = {}, sockets = { inputs: {}, outputs: {} }, multi = [];
    for (const socket of enabled(node.inputs)) {
      sockets.inputs[socket.identifier] = socket.type;
      if (socket.is_multi_input) multi.push(socket.identifier);
      if (socket.is_linked) continue;
      const value = options.value?.(socket, node, tree) ?? socketValue(socket, group);
      if (value !== undefined) inputs[socket.identifier] = value;
    }
    for (const socket of enabled(node.outputs)) sockets.outputs[socket.identifier] = socket.type;
    graph.nodes.push({ name: node.name, type: `node:${node.bl_idname}`, settings: structOf(node, { graph: group, seen: new Map() }, '', SKIP), inputs, sockets, ...(multi.length && { multi_input: multi }) });
  }

  // A multi-input socket (Join Geometry) takes its links in their sort order, the highest first, as Blender does.
  const all = [...tree.links], target = (link) => `${link.to_node.name}\0${link.to_socket.identifier}`;
  const first = new Map(all.map((link, i) => [target(link), i]).reverse());
  const links = all.sort((a, b) => first.get(target(a)) - first.get(target(b)) || b.multi_input_sort_id - a.multi_input_sort_id);
  const kept = new Set(nodes.map((node) => node.name));
  for (const link of links) {
    if (!link.is_valid || link.is_muted || !kept.has(link.to_node.name) || !link.to_socket.enabled || !link.from_socket.enabled) continue;
    const { from, value } = source(link), to = graph.nodes.find((n) => n.name === link.to_node.name);
    if (from) graph.links.push([...from, link.to_node.name, link.to_socket.identifier]);
    else if (value !== undefined) to.inputs[link.to_socket.identifier] = value;
  }
  return graphs;
}
