/**
 * An evaluator of the IR graphs `graphs` (a Geometry Nodes tree and the groups it uses).
 * @param {Record<string, import('../ir.js').Graph>} graphs
 * @param {{ unit?: (type: string) => NodeUnit | undefined, resolve?: (id: string) => any }} [options] `unit` finds a node's
 *   implementation (the registry by default), `resolve` an ID a node reads (an object's geometry, a collection's objects)
 */
export function createEvaluator(graphs: Record<string, import("../ir.js").Graph>, { unit, resolve }?: {
    unit?: (type: string) => NodeUnit | undefined;
    resolve?: (id: string) => any;
}): {
    evaluate: (key: string, args: Record<string, any>, { frame }?: {
        frame?: number;
    }) => Promise<any>;
};
/**
 * How a node evaluates: `function` (per element on fields, once on single values), `field` (reads the geometry it is
 * evaluated on) or `geometry` (runs on geometries). The type key says which, as Blender's node families do.
 * @param {Node} node
 */
export function kindOf(node: Node): "function" | "geometry" | "field";
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
    constructor(node: string, output: string, scope: Scope, from: string, to?: string);
    node: string;
    output: string;
    scope: Scope;
    from: string;
    to: string;
    /** @param {string} type */
    as(type: string): Field;
}
/** A field reading a named (or a kernel's anonymous) attribute of the geometry it is evaluated on. */
export class AttributeField {
    /** @param {string} name @param {string} type socket type */
    constructor(name: string, type: string);
    name: string;
    type: string;
    /** @param {string} type */
    as(type: string): this | (AttributeField & {
        to: string;
    });
}
export function isField(value: any): value is Field | AttributeField;
export type Node = import("../ir.js").GraphNode & {
    sockets?: {
        inputs: Record<string, string>;
        outputs: Record<string, string>;
    };
};
export type Geometry = import("./geometry.js").Geometry;
export type Component = import("./geometry.js").Component;
/**
 * A node of the flattened tree: its name made unique by its groups' names, and what it binds to.
 */
export type Domain = import("./geometry.js").Domain;
/**
 * Where a field is read: a component of a geometry, on one of its domains.
 */
export type FlatNode = Node & {
    key: string;
    prefix: string;
    group?: string;
    inner?: string;
    multi_input?: string[];
};
export type FieldContext = {
    geometry: Geometry;
    component: Component;
    domain: Domain;
    size: number;
    cache: Map<string, Promise<any[]>>;
};
/**
 * A node's implementation: a unit of the registry, given the node and what it runs on besides its inputs.
 */
export type Scope = {
    zone: string | null;
    parent: Scope | null;
    state: Record<string, any>;
    memo: Map<string, Promise<Record<string, any>>>;
    id: number;
};
export type NodeUnit = {
    run(inputs: Record<string, any>, context: Record<string, any>): any;
    kernel?: boolean;
};
