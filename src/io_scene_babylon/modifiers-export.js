// Live Modifiers in a package: an object whose modifiers are all Blender's mesh modifiers keeps its stack live, one IR
// entity per modifier (`OB:Cube/modifier/Solidify`, `modifier:SOLIDIFY`). Each setting is a property by its RNA path
// (`objects["Cube"].modifiers["Solidify"].thickness`), which the scene's animation sets through a channel of its node
// (runtime/blend-scene.js). The first modifier reads the object's base Mesh, written to scene.bin, each next one the
// mesh the one before gives, and the last one's is drawn; run in the page by modifiers.wasm
// (runtime/modifiers-evaluator.js) when a setting changes. Until then the page draws the applied geometry.
import { idStruct, pointerOf } from '../python/bpy_rna.js';
import { knob, key } from './controls-export.js';
import { idKey } from './ir-export.js';

// Whether an object's modifiers read another ID (an Array's offset object, a Displace's texture), which the page's
// polyfill, given the mesh alone, lacks: such a stack stays applied.
export const readsOtherIDs = (world, node) => [...idStruct(world.mainSync.objectOf(node)).modifiers].some((modifier) =>
  [...modifier.bl_rna.properties].some(({ type, identifier }) => {
    const pointer = type === 'POINTER' && pointerOf(modifier[identifier]);
    return pointer && pointer[1] === pointer[2];
  }));

// The channel an animated setting of the stack's `index`th modifier lands in (blend-scene.js Binding.channel).
export const channelKey = (index, path) => `${index}:${path}`;

// An object's channels, with their values: its node's metadata.bylonderChannels.
export const channels = ({ modifiers }) => Object.fromEntries(modifiers.flatMap(({ values }, i) => Object.entries(values).map(([path, value]) => [channelKey(i, path), value])));

// A Mesh's arrays as scene.bin buffers, an IR mesh of references.
function baseMesh(mesh, bin) {
  const uvs = mesh.attribute('UVMap'), buffer = (array) => ({ buffer: bin.add(array) });
  return {
    vert_positions: buffer(Float32Array.from(mesh.vert_positions)), edges: buffer(Int32Array.from(mesh.edges)), face_offsets: buffer(Int32Array.from(mesh.face_offsets)),
    corner_verts: buffer(Int32Array.from(mesh.corner_verts)), corner_edges: buffer(Int32Array.from(mesh.corner_edges)), ...(uvs && { uvs: buffer(Float32Array.from(uvs)) }),
  };
}

// Settings by path as inputs: a vector's components (`relative_offset_displace[0]`) as one array.
function settingInputs(paths) {
  const inputs = {};
  for (const [path, property] of paths) {
    const [, name, index] = /^(\w+)\[(\d+)\]$/.exec(path) ?? [];
    if (name) (inputs[name] ??= [])[+index] = property;
    else inputs[path] = property;
  }
  return inputs;
}

// A stack's entities by key, each modifier reading the mesh the one before gives, the last one's drawn on `node`.
function chain(ob, node, modifiers, base) {
  const entities = {};
  let mesh = base;
  modifiers.forEach(({ name, type, inputs, implementation, output }, i) => {
    const entityKey = `${idKey(ob)}/modifier/${name}`, last = i === modifiers.length - 1;
    entities[entityKey] = { type: `modifier:${type}`, id: idKey(ob), inputs: { [output === 'geometry' ? 'geometry' : 'mesh']: mesh, ...inputs },
      outputs: { [output]: last ? { draw: node } : null }, ...(implementation && { implementation }) };
    mesh = { entity: entityKey, output };
  });
  return entities;
}

// The `live` stacks' settings added to `properties`, and their entities.
export function modifierEntities(world, live, properties, bin) {
  const entities = {};
  for (const [node, stack] of live) {
    const ob = idStruct(world.mainSync.objectOf(node)), names = [...ob.modifiers].filter((m) => m.show_viewport).map((m) => m.name);
    const modifiers = stack.modifiers.map(({ kind, type, layouts, values }, i) => ({
      name: names[i], type: kind, implementation: 'modifiers', output: 'mesh',
      inputs: { ...settingInputs(Object.entries(values).map(([path, value]) => {
        const float = typeof value === 'number' && layouts[/^\w+/.exec(path)[0]]?.kind === 'float', property = `objects${key(ob.name)}.modifiers${key(names[i])}.${path}`;
        properties.push(knob(property, value, float ? { type: 'FLOAT' } : {}, { node: node.id, channel: channelKey(i, path) }));
        return [path, { property }];
      })), kernel: { type, layouts } },
    }));
    Object.assign(entities, chain(ob, node.id, modifiers, baseMesh(stack.mesh, bin)));
  }
  return entities;
}

// A Geometry Nodes modifier's inputs of a value (its interface's float, integer and boolean sockets): properties,
// suggested, which the interim `blender` implementation sets in Main (runtime/blender-evaluator.js).
const SOCKETS = { NodeSocketFloat: 'FLOAT', NodeSocketInt: 'INT', NodeSocketBool: 'BOOLEAN' };

// Each stack with a Geometry Nodes modifier, its properties added to `properties`, as entities on Blender (the
// whole stack, as Main evaluates it), its graph by key from `graphOf`.
export function geometryNodesEntities(world, properties, bin, graphOf) {
  const sync = world.mainSync, entities = {};
  for (const node of world.objects) {
    const pointer = sync.objectOf(node), ob = pointer && idStruct(pointer);
    if (!ob || ![...ob.modifiers].some((m) => m.type === 'NODES' && m.node_group)) continue;
    const base = `objects${key(ob.name)}`, mesh = ob.type === 'MESH' && sync.blender.mesh(pointer);
    const modifiers = [...ob.modifiers].filter((m) => m.show_viewport).map((m) => {
      if (m.type !== 'NODES' || !m.node_group) return { name: m.name, type: m.type, inputs: {}, implementation: 'blender', output: 'mesh' };
      const inputs = { graph: { graph: graphOf(m.node_group) } };
      for (const item of m.node_group.interface.items_tree) {
        if (item.item_type !== 'SOCKET' || item.in_out !== 'INPUT' || !SOCKETS[item.socket_type]) continue;
        const property = `${base}.modifiers${key(m.name)}.properties.inputs.${item.identifier}.value`;
        properties.push(knob(property, m.properties.inputs[item.identifier].value,
          { type: SOCKETS[item.socket_type], ...(item.min_value !== undefined && { soft_min: item.min_value, soft_max: item.max_value }), suggested: true }));
        inputs[item.identifier] = { property };
      }
      return { name: m.name, type: 'NODES', inputs, implementation: 'blender', output: 'geometry' };
    });
    Object.assign(entities, chain(ob, node.id, modifiers, mesh ? { mesh: baseMesh(mesh, bin) } : {}));
  }
  return entities;
}
