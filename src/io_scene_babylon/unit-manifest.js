// A package's units (units.json, docs/escaping-the-gpl.md): each type key its scene computes with, its licence, the
// files it uses, what uses it (entities or graph nodes, their IDs and the properties they read) and its interface as
// the IR gives it. A unit the export replaces (File > Export's `replace`) ships none of its code: its entities name no
// implementation, its shader pieces are left out, and a GPL file ships only while a unit not replaced uses it
// (runtime-files.js gplFiles).
import { EVALUATOR_FILES, NODE_KERNELS } from './runtime-files.js';
import { kindOf, unitNodes } from './runtime/geometry-nodes/evaluator.js';
import { isReference, referencesIn } from './runtime/ir.js';
import { blendData } from '../python/bpy_rna.js';

/** The type key of EEVEE's light specular on the page's PBR materials, a unit `{ apply(material) }`. */
export const AREA_SPECULAR_UNIT = 'block:area_specular';
const GPL = 'GPL-3.0-or-later', CLEAN = 'MIT OR Apache-2.0';
/** What a unit cannot take the place of yet: curves draw by Blender's shape functions whatever computes them. */
const FIXED = new Set(['curves']);
/** Blender's code an implementation ships beside its folder's files, at export. */
const MADE = { curves: ['bylonder-curves/glsl.js'] };
/** The implementations whose code is Blender's. */
const GPL_IMPLEMENTATIONS = new Set(['modifiers', 'curves']);

/** Whether `replace` (type keys, a key ending in * a prefix, as the registry matches them) covers a type. */
export const replaces = (replace, type) => replace.some((key) => key === type || (key.endsWith('*') && type.startsWith(key.slice(0, -1))));

const folderFiles = (name) => {
  const { folder, files } = EVALUATOR_FILES[name] ?? {};
  return folder ? Object.keys(files).map((file) => `${folder}/${file}`) : [];
};
// An input's form: the reference it is, else its JSON type.
const form = (value) => (isReference(value) ? Object.keys(value).find((key) => key !== 'output')
  : Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value);
const propertiesOf = (value) => [...new Set([...referencesIn(value)].filter(([ref]) => 'property' in ref).map(([ref]) => ref.property))];

// The Geometry Nodes graphs the IR's entities run, with the groups they nest: a baked stack's tree ships no units.
function runGraphs({ entities, graphs }) {
  const run = {};
  const add = (key) => {
    if (run[key] || !graphs[key]) return;
    run[key] = graphs[key];
    for (const node of graphs[key].nodes) if (node.settings?.node_tree?.id) add(node.settings.node_tree.id);
  };
  for (const entity of Object.values(entities)) if (entity.implementation === 'geometry-nodes') add(entity.inputs.graph.graph);
  return run;
}

/**
 * The manifest of an IR's units, before `replace` strips them.
 * @param {any} ir
 * @param {{ kernels?: any, blocks?: Record<string, { files: string[], interface?: any, swappable?: false, use: any }>, replace?: string[] }} [options]
 * `kernels`: the shader pieces (runtime/materials.js Kernels); `blocks`: Blender's code the package carries outside
 * entities and graphs, by type key (`swappable: false` where no unit can take its place yet)
 */
export function unitManifest(ir, { kernels, blocks = {}, replace = [] } = {}) {
  const units = {};
  const add = (type, unit, use) => {
    units[type] ??= { ...unit, replaced: unit.swappable !== false && replaces(replace, type), uses: [] };
    // A type key in shader and Geometry Nodes graphs alike (Math) uses the files of both.
    units[type].files = [...new Set([...units[type].files, ...unit.files])];
    units[type].uses.push(use);
  };
  for (const [key, entity] of Object.entries(ir.entities)) {
    const { implementation } = entity;
    if (!implementation || implementation === 'native') continue;
    const gpl = GPL_IMPLEMENTATIONS.has(implementation);
    const unit = { kind: 'entity', implementation, licence: gpl ? GPL : CLEAN, files: gpl ? [...folderFiles(implementation), ...(MADE[implementation] ?? [])] : [],
      ...(FIXED.has(implementation) && { swappable: false }),
      interface: { inputs: Object.fromEntries(Object.entries(entity.inputs).map(([name, value]) => [name, form(value)])), outputs: Object.keys(entity.outputs) } };
    add(entity.type, unit, { entity: key, id: entity.id, properties: propertiesOf(entity.inputs) });
  }
  const graphIds = (graph) => Object.values(ir.entities).filter((e) => e.inputs?.graph?.graph === graph).map((e) => e.id);
  for (const [type, nodes] of unitNodes(runGraphs(ir))) for (const [graph, name] of nodes) {
    const node = ir.graphs[graph].nodes.find((n) => n.name === name), own = node.type === type;
    const sockets = own ? node.sockets : undefined;
    add(type, { kind: 'geometry-node', licence: GPL, files: folderFiles('geometry-nodes'),
      interface: { kind: kindOf(own ? node : { type }), inputs: sockets?.inputs ?? {}, outputs: sockets?.outputs ?? {} } },
    { graph, node: name, ids: graphIds(graph), properties: own ? propertiesOf(node.inputs) : [] });
  }
  for (const [kernel, { nodes }] of Object.entries(kernels?.graphs ?? {})) {
    const graph = kernel.replace(/\/volume$/, '');
    for (const [name, { piece }] of Object.entries(nodes)) {
      const node = ir.graphs[graph]?.nodes.find((n) => n.name === name);
      if (!node) continue;
      add(node.type, { kind: 'shader-node', licence: GPL, files: [NODE_KERNELS],
        interface: { inputs: node.sockets?.inputs ?? {}, outputs: node.sockets?.outputs ?? {}, params: kernels.pieces[piece]?.params ?? [] } },
      { graph, node: name, id: graph.split('/')[0], properties: propertiesOf(node.inputs) });
    }
  }
  for (const [type, { use, ...block }] of Object.entries(blocks)) add(type, { kind: 'block', licence: GPL, ...block }, use);
  return { about: 'The units this package computes with, by type key (docs/escaping-the-gpl.md). A unit registered for a type key (bylonder/units.js register) runs in place of what the package ships; a replaced unit ships nothing and its entities stay baked until one is registered.', units };
}

/** Leaves the replaced units' entities without an implementation: a registered unit runs them, else they stay baked. */
export function stripEntities(ir, replace) {
  for (const entity of Object.values(ir.entities)) if (entity.implementation && !FIXED.has(entity.implementation) && replaces(replace, entity.type)) delete entity.implementation;
}

/**
 * The shader pieces without the replaced units' (and the helper functions only they use), `replaced` naming their node
 * types, which the page draws with a registered unit, else with zero outputs.
 */
export function stripPieces(ir, kernels, replace) {
  if (!replace.length || !kernels) return kernels;
  const types = new Set(), kept = new Set();
  for (const [kernel, { nodes }] of Object.entries(kernels.graphs)) for (const [name, { piece }] of Object.entries(nodes)) {
    const type = ir.graphs[kernel.replace(/\/volume$/, '')]?.nodes.find((n) => n.name === name)?.type;
    if (type && replaces(replace, type)) types.add(type);
    else kept.add(piece);
  }
  const pieces = Object.fromEntries(Object.entries(kernels.pieces).filter(([name]) => kept.has(name)));
  const used = new Set(Object.values(pieces).flatMap((p) => p.functions));
  return { ...kernels, functions: Object.fromEntries(Object.entries(kernels.functions).filter(([name]) => used.has(name))), pieces, replaced: [...types] };
}

// Nodes that are layout or a tree's own interface, not units.
const LAYOUT = /^(NodeFrame|NodeReroute|NodeGroupInput|NodeGroupOutput)$/;
const sorted = (keys) => [...new Set(keys)].sort();
// A node tree as the IR's graph holds what unitNodes reads of it.
const graphOf = (tree) => ({ type: 'GEOMETRY', nodes: [...tree.nodes].filter((n) => !LAYOUT.test(n.bl_idname)).map((n) => ({ name: n.name, type: `node:${n.bl_idname}` })),
  links: [...tree.links].map((l) => [l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier]) });

// A type key's name where no node gives it: `modifier:SIMPLE_DEFORM` as Simple Deform, `node:GeometryNodeInputPosition`
// as Input Position.
const nameOf = (key) => {
  const name = key.slice(key.indexOf(':') + 1);
  return /^[A-Z_]+$/.test(name) ? name.toLowerCase().split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
    : name.replace(/^(ShaderNode|GeometryNode|FunctionNode)/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
};
const BLOCK_NAMES = { [AREA_SPECULAR_UNIT]: 'Area Light Specular' };

/**
 * The units a scene's JavaScript package may ship, by category, before it is exported (File > Export's Units): its
 * objects' modifiers, the nodes of its shader trees and of its Geometry Nodes groups, and the blocks; each
 * `{ key, label }`, the label Blender's name of the node.
 */
export function sceneUnits(data = blendData()) {
  const groups = [...data.node_groups];
  const shaderTrees = [...[...data.materials, ...data.worlds].map((id) => id.node_tree).filter(Boolean), ...groups.filter((g) => g.bl_idname === 'ShaderNodeTree')];
  const geometryTrees = groups.filter((g) => g.bl_idname === 'GeometryNodeTree');
  const labels = new Map([...shaderTrees, ...geometryTrees].flatMap((tree) => [...tree.nodes].map((n) => [`node:${n.bl_idname}`, n.bl_label])));
  const named = (keys) => sorted(keys).map((key) => ({ key, label: labels.get(key) ?? BLOCK_NAMES[key] ?? nameOf(key) }));
  return {
    modifiers: named([...data.objects].flatMap((ob) => [...ob.modifiers].map((m) => m.type)).filter((type) => type !== 'NODES').map((type) => `modifier:${type}`)),
    shader: named(shaderTrees.flatMap((tree) => [...tree.nodes].map((n) => n.bl_idname)).filter((type) => !LAYOUT.test(type)).map((type) => `node:${type}`)),
    geometry: named(unitNodes(Object.fromEntries(geometryTrees.map((g) => [g.name, graphOf(g)]))).keys()),
    blocks: named([AREA_SPECULAR_UNIT]),
  };
}
