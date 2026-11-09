// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Bylonder's IR (docs/ir.md, ir.schema.json): an exported scene as data, which the scheduler walks.

/**
 * A reference an entity's input may hold, resolved before a unit runs.
 * @typedef {{ property: string } | { entity: string, output: string } | { buffer: number } | { data: [string, string] } | { graph: string }} Reference
 */

/**
 * @typedef {object} ID
 * @property {string} type RNA's struct name in capitals (`OBJECT`, `MESH`, `SHADERNODETREE`)
 * @property {string} name
 * @property {string | null} path from bpy.data, null for an ID outside its collections
 * @property {string} [node] the Babylon node or material it draws as
 * @property {Record<string, any> | null} data its RNA properties that differ from their defaults; an ID pointer as `{ id }`
 */

/** @typedef {{ from: string, path: string, to: string }} IDReference */

/**
 * A value a page sets and reads, by RNA path.
 * @typedef {object} Property
 * @property {string | null} id
 * @property {'FLOAT' | 'INT' | 'BOOLEAN' | 'STRING'} type
 * @property {number | boolean | string} default
 * @property {number} [soft_min]
 * @property {number} [soft_max]
 * @property {string} [subtype]
 * @property {string} [unit]
 * @property {boolean} [suggested]
 * @property {import('./blend-scene.js').Binding} [bind]
 */

/**
 * @typedef {object} GraphNode
 * @property {string} name
 * @property {string} type `node:<idname>`
 * @property {Record<string, any>} [settings]
 * @property {Record<string, any>} [inputs]
 */

/**
 * @typedef {object} Graph
 * @property {'SHADER' | 'GEOMETRY' | 'COMPOSITOR'} type
 * @property {GraphNode[]} nodes
 * @property {[string, string, string, string][]} links
 * @property {any[]} [interface]
 */

/**
 * A computed entity: its type key, the ID it belongs to, its inputs, where its outputs land, and the implementation the
 * package ships for it (none: only its baked result).
 * @typedef {object} Entity
 * @property {string} type
 * @property {string} id
 * @property {Record<string, any>} inputs
 * @property {Record<string, { property: string } | { draw: string } | null>} outputs
 * @property {string} [implementation]
 */

/**
 * @typedef {object} IR
 * @property {'bylonder-ir'} schema
 * @property {1} version
 * @property {Record<string, ID>} ids
 * @property {IDReference[]} references
 * @property {Record<string, Property>} properties
 * @property {Record<string, Graph>} graphs
 * @property {Record<string, Entity>} entities
 * @property {string[]} order
 */

export const IR_SCHEMA = 'bylonder-ir', IR_VERSION = 1;

/**
 * The IR, checked to be one this runtime reads.
 * @param {any} ir
 * @returns {IR}
 */
export function readIR(ir) {
  if (ir?.schema !== IR_SCHEMA || ir.version !== IR_VERSION) throw new Error(`Not a Bylonder IR of version ${IR_VERSION}`);
  return ir;
}
