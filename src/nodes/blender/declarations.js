// Blender's node declarations (node-types.json, dumped from Blender by tools/blender-reference/nodes.py): per tree
// type ('shader', 'compositor') and node idname, its sockets and properties, and which sockets each value of an enum
// property, or each item of a menu socket (gpu-library.js), makes available.
import types from './node-types.json' with { type: 'json' };
import { menus } from './gpu-library.js';

for (const [idname, sockets] of Object.entries(menus)) {
  for (const tree of ['shader', 'compositor']) {
    for (const socket of types[tree][idname]?.inputs ?? []) Object.assign(socket, sockets[socket.identifier]);
  }
}

export const nodeTheme = types.theme;
export const declaration = (tree, idname) => types[tree]?.[idname];
export const declarations = (tree) => types[tree] ?? {};

const clone = (v) => (Array.isArray(v) ? [...v] : v);

// A new node's properties and socket values, as Blender initializes them.
export function defaults(decl) {
  const properties = Object.fromEntries(Object.entries(decl.properties).filter(([, p]) => 'default' in p).map(([k, p]) => [k, clone(p.default)]));
  const values = Object.fromEntries(decl.inputs.filter((s) => 'default' in s).map((s) => [s.identifier, clone(s.default)]));
  return { properties, values };
}

// Which sockets the node shows with these properties and values, their labels and the node's color tag (its
// ui_class): a socket whose availability an enum property or a menu changes follows its value, the others are as
// declared.
export function availability(decl, properties, values = {}) {
  let tag = decl.color_tag;
  const inputs = new Set(decl.inputs.filter((s) => s.enabled !== false).map((s) => s.identifier));
  const outputs = new Set(decl.outputs.filter((s) => s.enabled !== false).map((s) => s.identifier));
  const labels = Object.fromEntries(decl.inputs.map((s) => [s.identifier, s.label || s.name]));
  for (const [key, prop] of Object.entries(decl.properties)) {
    const variants = Object.values(prop.variants ?? {}), chosen = prop.variants?.[properties[key]];
    if (!chosen || variants.length < 2) continue;
    for (const [side, set] of [['inputs', inputs], ['outputs', outputs]]) {
      const varying = new Set(variants.flatMap((v) => v[side]).filter((id) => !variants.every((v) => v[side].includes(id))));
      for (const id of varying) chosen[side].includes(id) ? set.add(id) : set.delete(id);
    }
    Object.assign(labels, chosen.labels);
    if (variants.some((v) => v.color_tag !== chosen.color_tag)) tag = chosen.color_tag;
  }
  for (const menu of decl.inputs.filter((s) => s.usage)) {
    const item = menu.items.indexOf(values[menu.identifier] ?? menu.default);
    for (const [id, used] of Object.entries(menu.usage)) used === item ? inputs.add(id) : inputs.delete(id);
  }
  return { inputs, outputs, labels, tag };
}
