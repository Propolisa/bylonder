// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The unit of a Geometry Nodes modifier (`modifier:NODES`, docs/ir.md, Entities): its graph evaluated on the geometry
// before it, with its inputs by interface identifier. Each node runs through the registry, else through Blender's
// kernels when the page loaded them.
import { unitFor } from '../units.js';
import { createEvaluator } from './evaluator.js';

/** Attributes the kernels stored for fields crossing nodes (kernels.js), which are not the modifier's result. */
const INTERNAL = /^\.bylonder_/;

/** A geometry without the kernels' attributes, its instances' geometries too. @param {any} geometry @returns {any} */
function clean(geometry) {
  if (!geometry || typeof geometry !== 'object') return geometry;
  return Object.fromEntries(Object.entries(geometry).map(([name, component]) => [name, component && {
    ...component,
    ...(component.attributes && { attributes: Object.fromEntries(Object.entries(component.attributes).filter(([key]) => !INTERNAL.test(key))) }),
    ...(name === 'instances' && { references: component.references.map((/** @type {any} */ r) => (r?.geometry ? { geometry: clean(r.geometry) } : r)) }),
  }]));
}

/**
 * The `modifier:NODES` unit over an IR's graphs. Its entity's inputs: `graph` (the graph or its key), `geometry` and
 * each interface input by identifier; its output `geometry`.
 * @param {Record<string, import('../ir.js').Graph>} graphs
 * @param {{ kernels?: import('../units.js').Unit, resolve?: (key: string) => any }} [options]
 * @returns {import('../units.js').Unit}
 */
export function geometryNodesUnit(graphs, { kernels, resolve } = {}) {
  const evaluator = createEvaluator(graphs, { unit: (type) => unitFor(type) ?? kernels, resolve });
  return {
    async run({ graph, geometry, ...values }, { frame }) {
      const key = typeof graph === 'string' ? graph : graph?.graph ?? Object.keys(graphs).find((k) => graphs[k] === graph);
      if (!key || !graphs[key]) throw new Error('Geometry Nodes: the modifier has no graph');
      const sockets = graphs[key].interface ?? [];
      const input = sockets.find((s) => s.in_out === 'INPUT' && s.socket_type === 'NodeSocketGeometry');
      const output = sockets.find((s) => s.in_out === 'OUTPUT' && s.socket_type === 'NodeSocketGeometry');
      const outputs = await evaluator.evaluate(key, { ...values, ...(input && { [input.identifier]: geometry }) }, { frame });
      return { geometry: clean(output ? outputs[output.identifier] : {}) };
    },
  };
}
