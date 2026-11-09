/**
 * The IR, checked to be one this runtime reads.
 * @param {any} ir
 * @returns {IR}
 */
export function readIR(ir: any): IR;
export const IR_SCHEMA: "bylonder-ir";
export const IR_VERSION: 1;
/**
 * A reference an entity's input may hold, resolved before a unit runs.
 */
export type Reference = {
    property: string;
} | {
    entity: string;
    output: string;
} | {
    buffer: number;
} | {
    data: [string, string];
} | {
    graph: string;
};
export type ID = {
    /**
     * RNA's struct name in capitals (`OBJECT`, `MESH`, `SHADERNODETREE`)
     */
    type: string;
    name: string;
    /**
     * from bpy.data, null for an ID outside its collections
     */
    path: string | null;
    /**
     * the Babylon node or material it draws as
     */
    node?: string | undefined;
    /**
     * its RNA properties that differ from their defaults; an ID pointer as `{ id }`
     */
    data: Record<string, any> | null;
};
export type IDReference = {
    from: string;
    path: string;
    to: string;
};
/**
 * A value a page sets and reads, by RNA path.
 */
export type Property = {
    id: string | null;
    type: "FLOAT" | "INT" | "BOOLEAN" | "STRING";
    default: number | boolean | string;
    soft_min?: number | undefined;
    soft_max?: number | undefined;
    subtype?: string | undefined;
    unit?: string | undefined;
    suggested?: boolean | undefined;
    bind?: import("./blend-scene.js").Binding | undefined;
};
export type GraphNode = {
    name: string;
    /**
     * `node:<idname>`
     */
    type: string;
    settings?: Record<string, any> | undefined;
    inputs?: Record<string, any> | undefined;
};
export type Graph = {
    type: "SHADER" | "GEOMETRY" | "COMPOSITOR";
    nodes: GraphNode[];
    links: [string, string, string, string][];
    interface?: any[] | undefined;
};
/**
 * A computed entity: its type key, the ID it belongs to, its inputs, where its outputs land, and the implementation the
 * package ships for it (none: only its baked result).
 */
export type Entity = {
    type: string;
    id: string;
    inputs: Record<string, any>;
    outputs: Record<string, {
        property: string;
    } | {
        draw: string;
    } | null>;
    implementation?: string | undefined;
};
export type IR = {
    schema: "bylonder-ir";
    version: 1;
    ids: Record<string, ID>;
    references: IDReference[];
    properties: Record<string, Property>;
    graphs: Record<string, Graph>;
    entities: Record<string, Entity>;
    order: string[];
};
