// Live Modifiers in a package: an object whose modifiers are all Blender's mesh modifiers keeps its stack live, one IR
// entity per modifier (`OB:Cube/modifier/Solidify`, `modifier:SOLIDIFY`). Each setting is a property by its RNA path
// (`objects["Cube"].modifiers["Solidify"].thickness`), which the scene's animation sets through a channel of its node
// (runtime/blend-scene.js). The first modifier reads the object's base Mesh, written to scene.bin, each next one the
// mesh the one before gives, and the last one's is drawn; run in the page by modifiers.wasm
// (runtime/modifiers-evaluator.js) when a setting changes. Until then the page draws the applied geometry.
import rna from '../makesrna/rna-modifiers.json' with { type: 'json' };
import dna from '../makesrna/dna-modifiers.json' with { type: 'json' };
import { fieldLayout } from '../modifiers/dna-write.js';
import { idStruct, pointerOf } from '../python/bpy_rna.js';
import { knob, key } from './controls-export.js';
import { idKey } from './ir-export.js';
import { chosenState } from './export-options.js';

// Whether an object's modifiers read another ID (an Array's offset object, a Displace's texture), which the page's
// polyfill, given the mesh alone, lacks: such a stack stays applied.
export const readsOtherIDs = (world, node) => [...idStruct(world.mainSync.objectOf(node)).modifiers].some((modifier) =>
  [...modifier.bl_rna.properties].some(({ type, identifier }) => {
    const pointer = type === 'POINTER' && pointerOf(modifier[identifier]);
    return pointer && pointer[1] === pointer[2];
  }));

const needsOpenVDB = (modifier) => modifier.kind === 'REMESH' && modifier.values.mode === 'VOXEL';
// An object's stack as a package can keep it live (world.modifiers.live), or null: one whose modifiers are all Blender's,
// none needing OpenVDB, which modifiers.wasm lacks, and none reading another ID.
export function liveStack(world, node) {
  const stack = world.modifiers.live(node);
  return stack && !stack.modifiers.some(needsOpenVDB) && !readsOtherIDs(world, node) ? stack : null;
}

// The channel an animated setting of the stack's `index`th modifier lands in (blend-scene.js Binding.channel).
export const channelKey = (index, path) => `${index}:${path}`;

// An object's channels, with their values: its node's metadata.bylonderChannels.
export const channels = ({ modifiers }) => Object.fromEntries(modifiers.flatMap(({ values }, i) => Object.entries(values).map(([path, value]) => [channelKey(i, path), value])));

// The attribute types IR geometry carries (runtime/geometry-nodes/geometry.js LAYOUTS), by the array that holds them.
const ATTRIBUTE_ARRAYS = { FLOAT: Float32Array, INT: Int32Array, BOOLEAN: Uint8Array, INT8: Int8Array, FLOAT2: Float32Array, FLOAT_VECTOR: Float32Array,
  FLOAT_COLOR: Float32Array, BYTE_COLOR: Uint8Array, QUATERNION: Float32Array, FLOAT4X4: Float32Array, INT16_2D: Int16Array, INT32_2D: Int32Array };

// A Mesh's arrays as scene.bin buffers, an IR mesh of references; with `attributes`, its generic attributes too, which
// Geometry Nodes read, but the editor's selection.
export function baseMesh(mesh, bin, { attributes = false } = {}) {
  const uvs = mesh.attribute?.('UVMap'), buffer = (array) => ({ buffer: bin.add(array) });
  return {
    vert_positions: buffer(Float32Array.from(mesh.vert_positions)), edges: buffer(Int32Array.from(mesh.edges)), face_offsets: buffer(Int32Array.from(mesh.face_offsets)),
    corner_verts: buffer(Int32Array.from(mesh.corner_verts)), corner_edges: buffer(Int32Array.from(mesh.corner_edges)), ...(uvs && { uvs: buffer(Float32Array.from(uvs)) }),
    ...(attributes && { attributes: Object.fromEntries([...mesh.attributes].filter(([name, { type }]) => ATTRIBUTE_ARRAYS[type] && name !== 'position' && !name.startsWith('.select'))
      .map(([name, { domain, type, data }]) => [name, { domain, type, data: buffer(ATTRIBUTE_ARRAYS[type].from(data)) }])) }),
  };
}

// The attribute types Blender's modifiers read of a Mesh (bmesh/module-mesh.js ATTRIBUTE_TYPES).
const MODIFIER_ATTRIBUTES = new Set(['BOOLEAN', 'INT', 'FLOAT', 'FLOAT2']);

// The vertex groups of an object (pointer) as an IR mesh holds them: each one's name, its vertices and their weights.
function vertexGroups(ob) {
  const groups = [...ob.vertex_groups].map(({ name }) => ({ name, verts: [], weights: [] }));
  if (groups.length) Array.from(ob.data.vertices).forEach((vertex, v) => {
    for (const { group, weight } of vertex.groups) groups[group].verts.push(v), groups[group].weights.push(weight);
  });
  return groups;
}

// A live stack's base: the object's Mesh (`mesh`, its arrays) with what modifiers read of Main's Mesh besides the arrays,
// its attributes (creases, bevel weights, sharp edges and faces, material indices; the editors' and the arrays' own
// left out) and vertex groups.
function stackMesh(mesh, bin, sync, pointer) {
  const buffer = (array) => ({ buffer: bin.add(array) });
  const main = sync.blender.mesh(pointer), same = main.vert_positions.length === mesh.vert_positions.length && main.edges.length === mesh.edges.length;
  const groups = same ? vertexGroups(idStruct(pointer)) : [], grouped = new Set(groups.map((g) => g.name));
  const attributes = same ? [...main.attributes].filter(([name, { type }]) => !name.startsWith('.') && name !== 'UVMap' && !grouped.has(name) && MODIFIER_ATTRIBUTES.has(type)) : [];
  return {
    ...baseMesh(mesh, bin),
    attributes: Object.fromEntries(attributes.map(([name, { domain, type, data }]) => [name, { domain, type, data: buffer(ATTRIBUTE_ARRAYS[type].from(data)) }])),
    ...(groups.length && { vertex_groups: groups.map(({ name, verts, weights }) => ({ name, verts: buffer(Int32Array.from(verts)), weights: buffer(Float32Array.from(weights)) })) }),
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

// A modifier's settings, one per DNA field: a property that is another's field in other units (Bevel's `width_pct`,
// its `width`) is left out, as the page, setting the one, would have the other write its stale value back. Of such
// twins the one animated (`animated`, paths) stays, as the animation sets it (Simple Deform's `angle`, its `factor`).
function ownFields(values, layouts, animated) {
  const fields = new Set();
  return Object.entries(values).sort(([a], [b]) => animated.has(b.replace(/\[\d+\]$/, '')) - animated.has(a.replace(/\[\d+\]$/, ''))).filter(([path]) => {
    const [, prop, index] = /^(\w+)(?:\[(\d+)\])?$/.exec(path), layout = layouts[prop];
    const field = layout && `${layout.offset}:${layout.bit}:${index}`;
    return !field || (!fields.has(field) && fields.add(field));
  });
}

// A modifier's names of other data its mesh holds (`vertex_group`, a UV map's), set: their values, written into the
// ModifierData as they are, and their DNA layouts.
function nameSettings(modifier) {
  const type = rna.types[modifier.type], located = type && dna[type.struct]?.properties;
  const named = [...modifier.bl_rna.properties].filter(({ type: kind, identifier }) => kind === 'STRING' && identifier !== 'name' && located?.[identifier]?.length && modifier[identifier]);
  return {
    values: Object.fromEntries(named.map(({ identifier }) => [identifier, modifier[identifier]])),
    layouts: Object.fromEntries(named.map(({ identifier }) => [identifier, fieldLayout(located[identifier], type.properties[identifier])])),
  };
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

// A modifier's settings' UI ranges by name, as Blender's RNA gives them: what a page's slider spans and an author keeps to.
function uiRanges(modifier) {
  const finite = (p) => Number.isFinite(p.soft_min) && Number.isFinite(p.soft_max) && p.soft_max - p.soft_min < 3.4e38;
  return Object.fromEntries([...modifier.bl_rna.properties].filter((p) => p.type === 'FLOAT' || p.type === 'INT').filter(finite)
    .map((p) => [p.identifier, { soft_min: p.soft_min, soft_max: p.soft_max }]));
}

// The data paths an object's F-Curves and drivers set (`modifiers["Bend"].angle`).
function animatedPaths(ob) {
  const animation = ob.animation_data, action = animation?.action;
  const bags = action ? [...action.layers].flatMap((layer) => [...layer.strips].flatMap((strip) => [...strip.channelbags])) : [];
  return new Set([...bags.flatMap((bag) => [...bag.fcurves]), ...(animation ? animation.drivers : [])].map((fc) => fc.data_path));
}

// The `live` stacks' settings added to `properties`, and their entities.
export function modifierEntities(world, live, properties, bin) {
  const entities = {};
  for (const [node, stack] of live) {
    const ob = idStruct(world.mainSync.objectOf(node)), shown = [...ob.modifiers].filter((m) => m.show_viewport), names = shown.map((m) => m.name);
    const animated = animatedPaths(ob);
    const modifiers = stack.modifiers.map(({ kind, type, layouts, values }, i) => {
      const named = nameSettings(shown[i]), ranges = uiRanges(shown[i]), prefix = `modifiers${key(names[i])}.`;
      const own = new Set([...animated].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length)));
      return {
        name: names[i], type: kind, implementation: 'modifiers', output: 'mesh',
        inputs: { ...settingInputs(ownFields(values, layouts, own).map(([path, value]) => {
          const name = /^\w+/.exec(path)[0], float = typeof value === 'number' && layouts[name]?.kind === 'float', property = `objects${key(ob.name)}.modifiers${key(names[i])}.${path}`;
          properties.push(knob(property, value, { ...(float && { type: 'FLOAT' }), ...ranges[name] }, { node: node.id, channel: channelKey(i, path) }));
          return [path, { property }];
        })), ...named.values, kernel: { type, layouts: { ...layouts, ...named.layouts } } },
      };
    });
    Object.assign(entities, chain(ob, node.id, modifiers, stackMesh(stack.mesh, bin, world.mainSync, world.mainSync.objectOf(node))));
  }
  return entities;
}

// A Geometry Nodes modifier's inputs of a value (its interface's float, integer and boolean sockets): properties,
// suggested.
const SOCKETS = { NodeSocketFloat: 'FLOAT', NodeSocketInt: 'INT', NodeSocketBool: 'BOOLEAN' };

const valueInputs = (tree) => [...tree.interface.items_tree].filter((item) => item.item_type === 'SOCKET' && item.in_out === 'INPUT' && SOCKETS[item.socket_type]);

// Blender's Smooth by Angle (Object > Shade Auto Smooth), set by its angle alone: baked, it looks the same.
const smoothByAngle = (tree) => /^Smooth by Angle(\.\d+)?$/.test(tree.name) && valueInputs(tree).every((item) => ['Angle', 'Ignore Sharpness'].includes(item.name));

// A Geometry Nodes stack's state where File > Export's options set none: Live when something in the page drives it, an
// input of a value or a tree reading the frame (`readsFrame(tree)`), but Baked for Smooth by Angle that nothing animates.
export function geometryNodesDefault(ob, shown, readsFrame) {
  if (shown.some((m) => readsFrame(m.node_group))) return 'LIVE';
  const animated = [...animatedPaths(ob)];
  const animates = (m) => animated.some((path) => path.startsWith(`modifiers${key(m.name)}`));
  return shown.some((m) => valueInputs(m.node_group).length && (!smoothByAngle(m.node_group) || animates(m))) ? 'LIVE' : 'BAKED';
}

// An object's shown modifiers when they are all Geometry Nodes, else null.
export function geometryNodesStack(pointer) {
  const ob = pointer && idStruct(pointer), shown = ob ? [...ob.modifiers].filter((m) => m.show_viewport) : [];
  return ob?.type === 'MESH' && shown.length && shown.every((m) => m.type === 'NODES' && m.node_group) ? { ob, shown } : null;
}

// Each object whose shown modifiers are all Geometry Nodes, as entities run by Bylonder's evaluator
// (runtime/geometry-nodes-evaluator.js), each reading the geometry the one before gives, the first its base mesh with its
// attributes; its inputs added to `properties`, its graph by key from `graphOf`. A stack with other modifiers stays baked,
// and so does one the export's `states` (export-options.js chosenState) set Baked or that is Baked by default
// (geometryNodesDefault): the package then ships no Geometry Nodes kernels for it.
export function geometryNodesEntities(world, properties, bin, graphOf, readsFrame, states) {
  const sync = world.mainSync, entities = {};
  for (const node of world.objects) {
    const pointer = sync.objectOf(node), stack = geometryNodesStack(pointer);
    if (!stack) continue;
    const { ob, shown } = stack;
    if ((chosenState(states, 'geometryNodes', ob.name) ?? geometryNodesDefault(ob, shown, readsFrame)) !== 'LIVE') continue;
    const base = `objects${key(ob.name)}`;
    const modifiers = shown.map((m) => {
      const inputs = { graph: { graph: graphOf(m.node_group) } };
      for (const item of valueInputs(m.node_group)) {
        const property = `${base}.modifiers${key(m.name)}.properties.inputs.${item.identifier}.value`;
        properties.push(knob(property, m.properties.inputs[item.identifier].value,
          { type: SOCKETS[item.socket_type], ...(item.min_value !== undefined && { soft_min: item.min_value, soft_max: item.max_value }), suggested: true }));
        inputs[item.identifier] = { property };
      }
      return { name: m.name, type: 'NODES', inputs, implementation: 'geometry-nodes', output: 'geometry' };
    });
    Object.assign(entities, chain(ob, node.id, modifiers, { mesh: baseMesh(sync.blender.mesh(pointer), bin, { attributes: true }) }));
  }
  return entities;
}
