// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Blender's Geometry Nodes kernels as units of the evaluator: each node no other unit implements runs in Blender's
// module (a GPL file of its own, built from geometry-nodes-api.cc) as a fragment of the IR graph, on IR
// geometry copied in and out. A function node runs over arrays (fn_node_eval), a field input on a domain of a
// geometry (field_input_eval), a geometry node with the field nodes feeding it (geo_node_eval).
import { AttributeField, kindOf } from './evaluator.js';
import { ATTRIBUTE_TYPES, LAYOUTS, POINT_DOMAIN, domainSize } from './geometry.js';

/**
 * The module's exports the kernels use.
 * @typedef {{ memory: WebAssembly.Memory, malloc(size: number): number, free(pointer: number): void, gn_eval(request: number): number,
 *   gn_id_define(json: number): void, gn_result_free(): void }} Exports
 * An ID a fragment reads, as `resolve` gives it: a material, an object with its world matrix (by columns), its IR
 * geometry and materials, or a collection with its objects' and child collections' keys.
 * @typedef {{ type: 'MATERIAL' } | { type: 'OBJECT', matrix: number[], geometry?: any, materials?: any[] } | { type: 'COLLECTION', objects: string[], children?: string[], instance_offset?: number[] }} ResolvedID
 */

/**
 * The kernels of a loaded module, as a unit for any node type.
 * @param {Exports} x
 * @param {(key: string) => ResolvedID | null} resolve
 */
export function createKernels(x, resolve) {
  const defined = new Set();
  let captured = 0;
  /** @type {number[]} */
  let allocations = [];

  /** Copies an array into module memory until the call returns. @param {ArrayLike<number>} data @param {any} Type */
  const copy = (data, Type) => {
    const array = Type.from(data), pointer = x.malloc(Math.max(array.byteLength, 1)) >>> 0;
    new Type(x.memory.buffer, pointer, array.length).set(array);
    allocations.push(pointer);
    return pointer;
  };
  /** An array of the module's result memory, copied out. @param {any} Type @param {number} pointer @param {number} length */
  const read = (Type, pointer, length) => (pointer ? new Type(x.memory.buffer, pointer >>> 0, length).slice() : new Type(length));
  const text = (/** @type {number} */ pointer) => {
    const bytes = new Uint8Array(x.memory.buffer, pointer >>> 0);
    return new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0)));
  };
  /** @param {string} value @param {(pointer: number) => any} fn */
  const withText = (value, fn) => fn(copy(new TextEncoder().encode(`${value}\0`), Uint8Array));

  /** Defines an ID by key in the module, and those it reads. @param {string} key */
  const define = (key) => {
    if (defined.has(key)) return;
    defined.add(key);
    const id = resolve(key);
    if (!id) return;
    if (id.type === 'COLLECTION') [...id.objects, ...(id.children ?? [])].forEach(define);
    if (id.type === 'OBJECT') idsIn(id.geometry).forEach(define);
    const json = id.type === 'OBJECT' ? { ...id, geometry: id.geometry && geometryIn(id.geometry) } : id;
    withText(JSON.stringify({ key, ...json }), (pointer) => x.gn_id_define(pointer));
  };
  /** The ID keys a value refers to. @param {any} value @returns {string[]} */
  const idsIn = (value) => {
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return [];
    if (typeof value.id === 'string') return [value.id];
    return Object.values(value).flatMap(idsIn);
  };

  /** @param {Record<string, any> | undefined} attributes */
  const attributesIn = (attributes = {}) => Object.entries(attributes).map(([name, { domain, type, data }]) => ({ name, domain, type, data: copy(data, LAYOUTS[/** @type {keyof typeof LAYOUTS} */ (type)][0]) }));
  /** IR geometry as the module reads it, its arrays copied in. @param {any} g @returns {any} */
  const geometryIn = (g) => ({
    ...(g.mesh && { mesh: {
      verts: g.mesh.vert_positions.length / 3, positions: copy(g.mesh.vert_positions, Float32Array), edges: g.mesh.edges.length / 2,
      edge_verts: copy(g.mesh.edges, Int32Array), faces: g.mesh.face_offsets.length - 1, face_offsets: copy(g.mesh.face_offsets, Int32Array),
      corner_verts: copy(g.mesh.corner_verts, Int32Array), corner_edges: copy(g.mesh.corner_edges, Int32Array),
      attributes: attributesIn(g.mesh.attributes), materials: g.mesh.materials ?? [],
    } }),
    ...(g.points && { points: { count: g.points.positions.length / 3, positions: copy(g.points.positions, Float32Array), attributes: attributesIn(g.points.attributes), materials: g.points.materials ?? [] } }),
    ...(g.instances && { instances: {
      count: g.instances.transforms.length / 16, transforms: copy(g.instances.transforms, Float32Array), reference_indices: copy(g.instances.reference_indices, Int32Array),
      references: g.instances.references.map((/** @type {any} */ r) => (r?.geometry ? { geometry: geometryIn(r.geometry) } : r)), attributes: attributesIn(g.instances.attributes),
    } }),
  });

  /** The module's geometry as IR geometry, copied out. @param {any} g @returns {any} */
  const geometryOut = (g) => {
    /** @type {any} */
    const out = {};
    if (g.mesh) {
      const m = g.mesh;
      out.mesh = { vert_positions: read(Float32Array, m.positions, m.verts * 3), edges: read(Int32Array, m.edge_verts, m.edges * 2),
        face_offsets: m.faces ? read(Int32Array, m.face_offsets, m.faces + 1) : new Int32Array([0]), corner_verts: read(Int32Array, m.corner_verts, m.corners),
        corner_edges: read(Int32Array, m.corner_edges, m.corners), attributes: {}, materials: m.materials };
    }
    if (g.points) out.points = { positions: read(Float32Array, g.points.positions, g.points.count * 3), attributes: {}, materials: g.points.materials };
    if (g.instances) {
      const i = g.instances;
      out.instances = { transforms: read(Float32Array, i.transforms, i.count * 16), reference_indices: read(Int32Array, i.reference_indices, i.count),
        references: i.references.map((/** @type {any} */ r) => (r?.geometry ? { geometry: geometryOut(r.geometry) } : r)), attributes: {} };
    }
    // Attribute sizes come from their component's domains, known once its topology is read.
    for (const component of /** @type {const} */ (['mesh', 'points', 'instances'])) {
      for (const { name, domain, type, data } of g[component]?.attributes ?? []) {
        const [Type, width] = LAYOUTS[/** @type {keyof typeof LAYOUTS} */ (type)];
        out[component].attributes[name] = { domain, type, data: read(Type, data, domainSize(out, component, domain) * width) };
      }
    }
    return out;
  };

  /**
   * Runs a fragment: its graph on its input values, giving one value per output (a geometry, a single value, or a
   * field output's attribute).
   * @param {{ graph: any, values: any[] }} fragment
   * @returns {any[]}
   */
  const run = ({ graph, values }) => {
    [graph.nodes.map((/** @type {any} */ n) => [n.settings, n.inputs]), values].flatMap(idsIn).forEach(define);
    try {
      const request = { graph, values: values.map((value, i) => (graph.inputs[i] === 'GEOMETRY' ? geometryIn(value ?? {}) : value)) };
      const results = withText(JSON.stringify(request), (pointer) => JSON.parse(text(x.gn_eval(pointer))));
      // A field output's attribute gets a name of its own, so another kernel's on the same geometry keeps its own.
      const names = new Map(results.filter((/** @type {any} */ value) => value?.attribute).map((/** @type {any} */ value) => [value.attribute, `.bylonder_${captured++}`]));
      const rename = (/** @type {any} */ g) => {
        for (const component of [g.mesh, g.points, g.instances]) {
          if (component) component.attributes = Object.fromEntries(Object.entries(component.attributes).map(([name, a]) => [names.get(name) ?? name, a]));
        }
        return g;
      };
      return results.map((/** @type {any} */ value, /** @type {number} */ i) => (graph.outputs[i] === 'GEOMETRY' ? rename(geometryOut(value))
        : value?.attribute ? new AttributeField(/** @type {string} */ (names.get(value.attribute)), graph.outputs[i]) : value));
    } finally {
      allocations.forEach((pointer) => x.free(pointer));
      allocations = [];
      x.gn_result_free();
    }
  };

  /** Points carrying per-element arrays as attributes `name`: a function node's inputs. @param {number} size @param {Record<string, [string, any[]]>} arrays */
  const carrier = (size, arrays) => ({ points: { positions: new Float32Array(size * 3), attributes: Object.fromEntries(Object.entries(arrays).map(([name, [type, list]]) => {
    const attributeType = ATTRIBUTE_TYPES[type] ?? 'FLOAT', [Type] = LAYOUTS[attributeType];
    return [name, { domain: 'POINT', type: attributeType, data: Type.from(list.flat(), Number) }];
  })) } });
  /** Store Named Attribute nodes after `node`, writing each of its outputs on `domain`, the last one's geometry out. */
  const stores = (/** @type {any} */ node, /** @type {string} */ domain, /** @type {string[]} */ from) => {
    const outputs = Object.entries(node.sockets?.outputs ?? {});
    const nodes = outputs.map(([id, type]) => ({ name: `\0store ${id}`, type: 'node:GeometryNodeStoreNamedAttribute', settings: { data_type: ATTRIBUTE_TYPES[type] ?? 'FLOAT', domain }, inputs: { Name: `.out_${id}` } }));
    const links = nodes.flatMap((store, i) => [[...(i ? [nodes[i - 1].name, 'Geometry'] : from), store.name, 'Geometry'], [node.key, outputs[i][0], store.name, 'Value']]);
    links.push([nodes.length ? nodes[nodes.length - 1].name : from[0], nodes.length ? 'Geometry' : from[1], 'Group Output', '0']);
    return { nodes, links, outputs };
  };
  /** The arrays of a component's `.out_<id>` attributes. @param {any} geometry @param {'mesh' | 'points' | 'instances'} component @param {[string, any][]} outputs */
  const stored = (geometry, component, outputs) => Object.fromEntries(outputs.map(([id, type]) => {
    const attribute = geometry[component]?.attributes?.[`.out_${id}`], width = attribute ? LAYOUTS[/** @type {keyof typeof LAYOUTS} */ (attribute.type)][1] : 1;
    const flat = Array.from(attribute?.data ?? []), list = width === 1 ? flat : Array.from({ length: flat.length / width }, (_, i) => flat.slice(i * width, i * width + width));
    return [id, type === 'BOOLEAN' ? list.map(Boolean) : list];
  }));

  /** @param {Record<string, any[]>} inputs @param {any} context */
  const functionNode = (inputs, { node, size }) => {
    const ids = Object.keys(node.sockets?.inputs ?? {});
    if (size === 1) {
      const { graph, values } = { graph: { nodes: [{ name: node.key, type: node.type, settings: node.settings, inputs: {} }], inputs: ids.map((id) => node.sockets.inputs[id]),
        links: ids.map((id, i) => ['Group Input', String(i), node.key, id]), outputs: Object.values(node.sockets?.outputs ?? {}) }, values: ids.map((id) => inputs[id][0]) };
      Object.keys(node.sockets?.outputs ?? {}).forEach((id, i) => graph.links.push([node.key, id, 'Group Output', String(i)]));
      const results = run({ graph, values });
      return Object.fromEntries(Object.keys(node.sockets?.outputs ?? {}).map((id, i) => [id, [results[i]]]));
    }
    const reads = ids.map((id) => ({ name: `\0read ${id}`, type: 'node:GeometryNodeInputNamedAttribute', settings: { data_type: ATTRIBUTE_TYPES[node.sockets.inputs[id]] ?? 'FLOAT' }, inputs: { Name: `.in_${id}` } }));
    const store = stores(node, 'POINT', ['Group Input', '0']);
    const graph = { nodes: [{ name: node.key, type: node.type, settings: node.settings, inputs: {} }, ...reads, ...store.nodes], inputs: ['GEOMETRY'], outputs: ['GEOMETRY'],
      links: [...ids.map((id, i) => [reads[i].name, 'Attribute', node.key, id]), ...store.links] };
    const [points] = run({ graph, values: [carrier(size, Object.fromEntries(ids.map((id) => [`.in_${id}`, [node.sockets.inputs[id], inputs[id]]])))] });
    return stored(points, 'points', store.outputs);
  };

  /** @param {Record<string, any>} inputs @param {any} context */
  const fieldInput = (inputs, { node, geometry, component, domain }) => {
    const ids = Object.keys(node.sockets?.inputs ?? {});
    const store = stores(node, domain, ['Group Input', '0']);
    const graph = { nodes: [{ name: node.key, type: node.type, settings: node.settings, inputs: {} }, ...store.nodes], inputs: ['GEOMETRY', ...ids.map((id) => node.sockets.inputs[id])],
      outputs: ['GEOMETRY'], links: [...ids.map((id, i) => ['Group Input', String(i + 1), node.key, id]), ...store.links] };
    const [result] = run({ graph, values: [geometry, ...ids.map((id) => inputs[id])] });
    return stored(result, component, store.outputs);
  };

  /** @param {Record<string, any>} inputs @param {any} context */
  const geometryNode = async (inputs, context) => {
    const fragment = await context.fragment();
    const at = fragment.graph.inputs.indexOf('GEOMETRY');
    for (const { field, name, type } of fragment.external) {
      const geometry = { ...fragment.values[at] };
      for (const component of /** @type {const} */ (['mesh', 'points', 'instances'])) {
        if (!geometry[component]) continue;
        const domain = POINT_DOMAIN[component], attributeType = ATTRIBUTE_TYPES[type] ?? 'FLOAT', [Type] = LAYOUTS[attributeType];
        const values = await context.field(field, geometry, component, domain);
        geometry[component] = { ...geometry[component], attributes: { ...geometry[component].attributes, [name]: { domain, type: attributeType, data: Type.from(values.flat(), Number) } } };
      }
      fragment.values[at] = geometry;
    }
    const results = run(fragment);
    return Object.fromEntries(fragment.outputs.map((/** @type {string} */ id, /** @type {number} */ i) => [id, results[i]]));
  };

  /** @type {import('../units.js').Unit & { kernel: true }} */
  const unit = {
    kernel: true,
    run(inputs, context) {
      const kind = kindOf(/** @type {any} */ (context).node);
      return kind === 'function' ? functionNode(inputs, context) : kind === 'field' ? fieldInput(inputs, context) : geometryNode(inputs, context);
    },
  };
  return { unit, define };
}
