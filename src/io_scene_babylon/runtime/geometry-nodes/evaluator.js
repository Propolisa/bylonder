// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Bylonder's Geometry Nodes evaluator over an IR graph (docs/ir.md, Graphs): it computes what the Group Output needs,
// each node once, through the unit registered for its type key (`node:<idname>`). Values are single values,
// geometries or fields: a field is a node's output that depends on the elements it is read on, evaluated only when a
// geometry node reads it on a domain of a geometry. Groups are evaluated in place of their group node, and a repeat
// zone runs its nodes once per iteration.
import { unitFor } from '../units.js';
import { convert } from './convert.js';
import { ATTRIBUTE_TYPES, domainSize } from './geometry.js';

/**
 * @typedef {import('../ir.js').GraphNode & { sockets?: { inputs: Record<string, string>, outputs: Record<string, string> } }} Node
 * @typedef {import('./geometry.js').Geometry} Geometry
 * @typedef {import('./geometry.js').Component} Component
 * @typedef {import('./geometry.js').Domain} Domain
 * A node of the flattened tree: its name made unique by its groups' names, and what it binds to.
 * @typedef {Node & { key: string, prefix: string, group?: string, inner?: string, multi_input?: string[] }} FlatNode
 * Where a field is read: a component of a geometry, on one of its domains.
 * @typedef {{ geometry: Geometry, component: Component, domain: Domain, size: number, cache: Map<string, Promise<any[]>> }} FieldContext
 * @typedef {{ zone: string | null, parent: Scope | null, state: Record<string, any>, memo: Map<string, Promise<Record<string, any>>>, id: number }} Scope
 * A node's implementation: a unit of the registry, given the node and what it runs on besides its inputs.
 * @typedef {{ run(inputs: Record<string, any>, context: Record<string, any>): any, kernel?: boolean }} NodeUnit
 */

/** A node's output read per element, converted from its socket type to the type of the input reading it. */
export class Field {
  /** @param {string} node @param {string} output @param {Scope} scope @param {string} from @param {string} [to] */
  constructor(node, output, scope, from, to = from) {
    this.node = node;
    this.output = output;
    this.scope = scope;
    this.from = from;
    this.to = to;
  }

  /** @param {string} type */
  as(type) { return new Field(this.node, this.output, this.scope, this.from, type); }
}

/** A field reading a named (or a kernel's anonymous) attribute of the geometry it is evaluated on. */
export class AttributeField {
  /** @param {string} name @param {string} type socket type */
  constructor(name, type) { this.name = name; this.type = type; }

  /** @param {string} type */
  as(type) { return type === this.type ? this : Object.assign(new AttributeField(this.name, this.type), { to: type }); }
}

/** @param {any} value */
export const isField = (value) => value instanceof Field || value instanceof AttributeField;

// Inputs Blender reads as a field of the geometry when nothing is linked to them, by node type and input identifier:
// the field input node standing in for them and its output.
const POSITION = ['node:GeometryNodeInputPosition', 'Position'];
const TEXTURES = ['Noise', 'Voronoi', 'Wave', 'Gradient', 'WhiteNoise', 'Brick', 'Checker', 'Magic', 'Gabor'];
/** @type {Record<string, Record<string, string[]>>} */
const IMPLICIT = {
  'node:GeometryNodeSetPosition': { Position: POSITION },
  'node:FunctionNodeRandomValue': { ID: ['node:GeometryNodeInputID', 'ID'] },
  'node:GeometryNodeSampleIndex': { Index: ['node:GeometryNodeInputIndex', 'Index'] },
  'node:GeometryNodeExtrudeMesh': { Offset: ['node:GeometryNodeInputNormal', 'Normal'] },
  ...Object.fromEntries(TEXTURES.map((name) => [`node:ShaderNodeTex${name}`, { Vector: POSITION }])),
};
// Nodes that give one value whatever they are read on, though their type key says geometry.
const CONSTANTS = /^node:(GeometryNodeInput(SceneTime|Material|Collection|Object|Image|ActiveCamera)|GeometryNodeSelfObject|GeometryNodeIsViewport|GeometryNodeTool\w+)$/;
const SWITCHES = { 'node:GeometryNodeSwitch': 'Switch', 'node:GeometryNodeIndexSwitch': 'Index', 'node:GeometryNodeMenuSwitch': 'Menu' };
/** @type {Record<string, any>} */
const DEFAULTS = { VALUE: 0, INT: 0, BOOLEAN: false, VECTOR: [0, 0, 0], RGBA: [0, 0, 0, 1], ROTATION: [1, 0, 0, 0], STRING: '', GEOMETRY: {} };

/**
 * The tree of graph `key` with its groups' nodes in place, named `<group node>/<node>`.
 * @param {Record<string, import('../ir.js').Graph>} graphs
 * @param {string} key
 */
function flatten(graphs, key) {
  /** @type {Map<string, FlatNode>} */
  const nodes = new Map();
  /** @type {Map<string, [string, string][]>} links into each input, `<node>\0<input>` */
  const links = new Map();
  /** @param {string} graphKey @param {string} prefix @param {string} [group] */
  const add = (graphKey, prefix, group) => {
    const graph = graphs[graphKey];
    if (!graph) throw new Error(`Geometry Nodes: no graph ${graphKey}`);
    for (const node of /** @type {Node[]} */ (graph.nodes)) {
      const name = prefix + node.name, flat = /** @type {FlatNode} */ ({ ...node, key: name, prefix });
      if (node.type === 'node:NodeGroupInput' && group) flat.group = group;
      if (node.type === 'node:GeometryNodeGroup') {
        flat.inner = `${name}/`;
        add(node.settings?.node_tree?.graph, flat.inner, name);
      }
      const pair = node.settings?.paired_output?.node;
      if (pair) flat.settings = { ...node.settings, paired_output: { node: prefix + pair } };
      nodes.set(name, flat);
      for (const [input, implicit] of Object.entries(IMPLICIT[node.type] ?? {})) {
        if (graph.links.some(([, , to, at]) => to === node.name && at === input)) continue;
        const [type, output] = implicit, stand = `${name}\0${input}`;
        nodes.set(stand, { name: stand, key: stand, prefix, type, settings: {}, inputs: {}, sockets: { inputs: {}, outputs: { [output]: /** @type {any} */ (node.sockets)?.inputs[input] ?? 'VECTOR' } } });
        links.set(`${name}\0${input}`, [[stand, output]]);
      }
    }
    for (const [from, output, to, input] of graph.links) {
      const at = `${prefix + to}\0${input}`;
      links.set(at, [...(links.get(at) ?? []), [prefix + from, output]]);
    }
  };
  add(key, '');
  return { nodes, links };
}

/**
 * The repeat zones of a flattened tree: each node inside one (downstream of its Repeat Input, upstream of its Repeat
 * Output) by the innermost zone's Repeat Input.
 * @param {Map<string, FlatNode>} nodes
 * @param {Map<string, [string, string][]>} links
 */
function zones(nodes, links) {
  /** @type {Map<string, Set<string>>} */
  const readers = new Map();
  for (const [at, list] of links) for (const [from] of list) readers.set(from, new Set([...(readers.get(from) ?? []), at.split('\0')[0]]));
  /** @param {string} start @param {(name: string) => Iterable<string>} next */
  const reach = (start, next) => {
    const seen = new Set([start]), stack = [start];
    while (stack.length) for (const n of next(/** @type {string} */ (stack.pop()))) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    return seen;
  };
  const sources = (/** @type {string} */ name) => [...links].filter(([at]) => at.startsWith(`${name}\0`)).flatMap(([, list]) => list.map(([from]) => from));
  /** @type {Map<string, Set<string>>} */
  const members = new Map();
  for (const node of nodes.values()) {
    if (node.type !== 'node:GeometryNodeRepeatInput') continue;
    const output = node.settings?.paired_output?.node, down = reach(node.key, (n) => readers.get(n) ?? []), up = reach(output, sources);
    members.set(node.key, new Set([...down].filter((n) => up.has(n) && n !== output)));
  }
  /** @type {Map<string, string>} */
  const zoneOf = new Map();
  for (const [zone, set] of [...members].sort((a, b) => b[1].size - a[1].size)) for (const n of set) zoneOf.set(n, zone);
  return zoneOf;
}

/**
 * An evaluator of the IR graphs `graphs` (a Geometry Nodes tree and the groups it uses).
 * @param {Record<string, import('../ir.js').Graph>} graphs
 * @param {{ unit?: (type: string) => NodeUnit | undefined, resolve?: (id: string) => any }} [options] `unit` finds a node's
 *   implementation (the registry by default), `resolve` an ID a node reads (an object's geometry, a collection's objects)
 */
export function createEvaluator(graphs, { unit = unitFor, resolve = () => null } = {}) {
  /**
   * Evaluates graph `key` on its Group Input's values by interface identifier (the modifier's geometry and inputs),
   * giving the Group Output's by identifier.
   * @param {string} key
   * @param {Record<string, any>} args
   * @param {{ frame?: number }} [context]
   */
  async function evaluate(key, args, { frame = 0 } = {}) {
    const { nodes, links } = flatten(graphs, key), zoneOf = zones(nodes, links);
    let scopes = 0;
    /** @type {Scope} */
    const root = { zone: null, parent: null, state: {}, memo: new Map(), id: scopes++ };
    const node = (/** @type {string} */ name) => /** @type {FlatNode} */ (nodes.get(name));
    const implementation = (/** @type {FlatNode} */ n) => {
      const found = unit(n.type);
      if (!found) throw new Error(`Geometry Nodes: nothing implements ${n.type} (${n.key})`);
      return found;
    };

    /** The scope a node's values live in: the iteration of its zone that `scope` is in. @param {string} name @param {Scope} scope */
    const scopeOf = (name, scope) => {
      const zone = zoneOf.get(name) ?? null;
      /** @type {Scope | null} */
      let s = scope;
      while (s && s.zone !== zone) s = s.parent;
      if (!s) throw new Error(`Geometry Nodes: ${name} is read outside its zone`);
      return s;
    };

    /** What an input reads: its link's value (converted to its type), else its own value, else its type's default. @param {FlatNode} n @param {string} input @param {Scope} scope */
    const input = async (n, input, scope) => {
      const type = n.sockets?.inputs[input] ?? 'VALUE', list = links.get(`${n.key}\0${input}`);
      if (!list?.length) return input in (n.inputs ?? {}) ? /** @type {any} */ (n.inputs)[input] : structuredClone(DEFAULTS[type] ?? null);
      const values = await Promise.all(list.map(async ([from, output]) => {
        const value = await outputOf(from, output, scope);
        return isField(value) ? value.as(type) : convert(value, node(from).sockets?.outputs[output] ?? type, type);
      }));
      return n.multi_input?.includes(input) ? values : values[0];
    };

    /** @param {FlatNode} n @param {Scope} scope @param {string[]} [only] */
    const inputs = async (n, scope, only = Object.keys(n.sockets?.inputs ?? {})) =>
      Object.fromEntries(await Promise.all(only.map(async (id) => [id, await input(n, id, scope)])));

    /** An output's value: a single value, a geometry or a field. @param {string} name @param {string} output @param {Scope} scope @returns {Promise<any>} */
    const outputOf = async (name, output, scope) => {
      const n = node(name);
      if (n.type === 'node:NodeGroupInput') return n.group ? input(node(n.group), output, scope) : output in args ? args[output] : groupDefault(output);
      if (n.inner) {
        return input(groupOutput(n.inner), output, scope);
      }
      const s = scopeOf(name, scope);
      if (!s.memo.has(name)) s.memo.set(name, run(n, s));
      return (await s.memo.get(name))?.[output];
    };

    /** The active Group Output of the group whose nodes' names start with `prefix`. @param {string} prefix */
    const groupOutput = (prefix) => {
      const found = [...nodes.values()].find((m) => m.type === 'node:NodeGroupOutput' && m.prefix === prefix && m.settings?.is_active_output !== false);
      if (!found) throw new Error(`Geometry Nodes: ${prefix || key} has no Group Output`);
      return found;
    };

    const groupDefault = (/** @type {string} */ identifier) => graphs[key].interface?.find((item) => item.identifier === identifier)?.default;

    /** A node's outputs by identifier. @param {FlatNode} n @param {Scope} scope @returns {Promise<Record<string, any>>} */
    const run = async (n, scope) => {
      const outputs = Object.keys(n.sockets?.outputs ?? {}), settings = n.settings ?? {};
      if (n.type === 'node:GeometryNodeRepeatInput') return scope.state;
      if (n.type === 'node:GeometryNodeRepeatOutput') return repeat(n, scope);
      if (n.type in SWITCHES) {
        const selector = /** @type {keyof typeof SWITCHES} */ (n.type), at = SWITCHES[selector], pick = await input(n, at, scope);
        if (!isField(pick)) {
          const chosen = selector === 'node:GeometryNodeSwitch' ? (pick ? 'True' : 'False')
            : selector === 'node:GeometryNodeIndexSwitch' ? `Item_${pick}` : Object.keys(n.sockets?.inputs ?? {}).find((id) => id !== at && settings.enum_items?.find((/** @type {any} */ e) => e.name === pick && id.endsWith(`_${e.identifier}`)));
          return { [outputs[0]]: chosen && chosen in (n.sockets?.inputs ?? {}) ? await input(n, chosen, scope) : DEFAULTS[n.sockets?.outputs[outputs[0]] ?? ''] };
        }
      }
      const kind = kindOf(n), values = await inputs(n, scope);
      if (kind === 'field' || kind === 'function' && Object.values(values).some(isField)) {
        return Object.fromEntries(outputs.map((id) => [id, new Field(n.key, id, scope, n.sockets?.outputs[id] ?? 'VALUE')]));
      }
      if (kind === 'function') {
        const result = await implementation(n).run(Object.fromEntries(Object.entries(values).map(([id, v]) => [id, [v]])), { frame, settings, node: n, size: 1 });
        return Object.fromEntries(Object.entries(result).map(([id, list]) => [id, list[0]]));
      }
      return implementation(n).run(values, {
        frame, settings, resolve, node: n,
        /** The fragment a kernel runs for this node: it, the field nodes feeding it, and its other inputs as inputs. */
        fragment: () => fragment(n, scope),
        /** A value read per element on a domain of a geometry: a field evaluated there, a single value repeated. */
        field: (/** @type {any} */ value, /** @type {Geometry} */ geometry, /** @type {Component} */ component, /** @type {Domain} */ domain) =>
          evaluateField(value, { geometry, component, domain, size: domainSize(geometry, component, domain), cache: new Map() }),
      });
    };

    /** A field's values on the elements of a context. @param {any} value @param {FieldContext} context @returns {Promise<any[]>} */
    const evaluateField = async (value, context) => {
      if (value instanceof AttributeField) {
        const field = implementation(/** @type {any} */ ({ type: 'node:GeometryNodeInputNamedAttribute', key: value.name }));
        const named = /** @type {FlatNode} */ ({ name: value.name, key: value.name, prefix: '', type: 'node:GeometryNodeInputNamedAttribute',
          settings: { data_type: ATTRIBUTE_TYPES[value.type] }, inputs: { Name: value.name }, sockets: { inputs: { Name: 'STRING' }, outputs: { Attribute: value.type, Exists: 'BOOLEAN' } } });
        const { Attribute } = await field.run({ Name: value.name }, { frame, settings: named.settings, node: named, ...context });
        return Attribute.map((/** @type {any} */ v) => convert(v, value.type, /** @type {any} */ (value).to ?? value.type));
      }
      if (!(value instanceof Field)) return Array(context.size).fill(value);
      const cacheKey = `${value.scope.id}\0${value.node}`;
      if (!context.cache.has(cacheKey)) context.cache.set(cacheKey, /** @type {Promise<any>} */ (fieldOutputs(node(value.node), value.scope, context)));
      const list = /** @type {any} */ (await context.cache.get(cacheKey))[value.output];
      return value.from === value.to ? list : list.map((/** @type {any} */ v) => convert(v, value.from, value.to));
    };

    /** A field node's outputs on a context's elements. @param {FlatNode} n @param {Scope} scope @param {FieldContext} context */
    const fieldOutputs = async (n, scope, context) => {
      const values = await inputs(n, scope), settings = n.settings ?? {};
      if (kindOf(n) === 'field') return implementation(n).run(values, { frame, settings, node: n, ...context });
      const arrays = Object.fromEntries(await Promise.all(Object.entries(values).map(async ([id, v]) => [id, await evaluateField(v, context)])));
      return implementation(n).run(arrays, { frame, settings, node: n, size: context.size });
    };

    /**
     * A geometry node as a kernel runs it (docs/licence-free-live.md, geo_node_eval): the node with the field nodes
     * feeding it, each other input a fragment input (`Group Input`, output `<i>`), each output a fragment output. A field
     * node implemented in JS rather than by a kernel is read from an attribute the caller stores (`external`).
     * @param {FlatNode} n
     * @param {Scope} scope
     */
    const fragment = async (n, scope) => {
      /** @type {Map<string, any>} */
      const parts = new Map();
      /** @type {string[][]} */
      const edges = [];
      /** @type {{ type: string, value: any }[]} */
      const given = [];
      /** @type {{ field: Field, name: string, type: string }[]} */
      const external = [];
      const named = (/** @type {string} */ name, /** @type {string} */ type) => {
        const key = `bylonder:named ${name}`;
        parts.set(key, { name: key, type: 'node:GeometryNodeInputNamedAttribute', settings: { data_type: ATTRIBUTE_TYPES[type] ?? 'FLOAT' }, inputs: { Name: name } });
        return [key, 'Attribute'];
      };
      /** Where a value comes from in the fragment. @param {any} value @param {string} type @returns {Promise<string[]>} */
      const source = async (value, type) => {
        if (value instanceof Field) {
          const from = node(value.node);
          if (!implementation(from).kernel) {
            const name = `.bylonder_in_${external.length}`;
            external.push({ field: value, name, type: value.to });
            return named(name, value.to);
          }
          await add(from, value.scope);
          return [from.key, value.output];
        }
        if (value instanceof AttributeField) return named(value.name, /** @type {any} */ (value).to ?? value.type);
        given.push({ type, value });
        return ['Group Input', String(given.length - 1)];
      };
      /** @param {FlatNode} m @param {Scope} at */
      const add = async (m, at) => {
        if (parts.has(m.key)) return;
        const part = { name: m.key, type: m.type, settings: m.settings ?? {}, inputs: { ...m.inputs }, sockets: m.sockets };
        parts.set(m.key, part);
        for (const [id, type] of Object.entries(m.sockets?.inputs ?? {})) {
          const list = links.get(`${m.key}\0${id}`);
          // Unlinked, or read implicitly (a Set Position's Position): the node's own value or Blender's default.
          if (!list?.length || list[0][0].includes('\0')) continue;
          delete /** @type {any} */ (part.inputs)[id];
          const value = await input(m, id, at);
          for (const each of m.multi_input?.includes(id) ? value : [value]) edges.push([...await source(each, type), m.key, id]);
        }
      };
      await add(n, scope);
      // Blender stays atomic: one geometry node per kernel call, the walk, groups and zones are the evaluator's.
      if ([...parts.values()].filter((part) => part.type.startsWith('node:') && kindOf(part) === 'geometry').length !== 1) {
        throw new Error(`Geometry Nodes: a kernel fragment for ${n.key} holds more than one geometry node`);
      }
      const outputs = Object.entries(n.sockets?.outputs ?? {});
      outputs.forEach(([id], i) => edges.push([n.key, id, 'Group Output', String(i)]));
      return {
        graph: { nodes: [...parts.values()], links: edges, inputs: given.map((g) => g.type), outputs: outputs.map(([, type]) => type) },
        values: given.map((g) => g.value), outputs: outputs.map(([id]) => id), external,
      };
    };

    /** A repeat zone's outputs: its items after its iterations. @param {FlatNode} output @param {Scope} scope */
    const repeat = async (output, scope) => {
      const start = [...nodes.values()].find((m) => m.settings?.paired_output?.node === output.key);
      if (!start) throw new Error(`Geometry Nodes: ${output.key} has no Repeat Input`);
      const items = Object.keys(output.sockets?.inputs ?? {});
      let state = await inputs(start, scope, items);
      const count = await input(start, 'Iterations', scope);
      for (let i = 0; i < count; i++) {
        /** @type {Scope} */
        const inner = { zone: start.key, parent: scope, state: { ...state, Iteration: i }, memo: new Map(), id: scopes++ };
        state = await inputs(output, inner, items);
      }
      return state;
    };

    return inputs(groupOutput(''), root);
  }

  return { evaluate };
}

/**
 * How a node evaluates: `function` (per element on fields, once on single values), `field` (reads the geometry it is
 * evaluated on) or `geometry` (runs on geometries). The type key says which, as Blender's node families do.
 * @param {Node} node
 */
export function kindOf(node) {
  const sockets = Object.values(node.sockets?.inputs ?? {}).concat(Object.values(node.sockets?.outputs ?? {}));
  if (sockets.includes('GEOMETRY')) return 'geometry';
  if (/^node:(FunctionNode|ShaderNode)/.test(node.type) || CONSTANTS.test(node.type)) return 'function';
  return 'field';
}
