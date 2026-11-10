/**
 * Every reference in a value, with where it is.
 * @param {any} value
 * @param {string} [at]
 * @returns {Generator<[Reference, string]>}
 */
export function referencesIn(value: any, at?: string): Generator<[Reference, string]>;
/**
 * The keys of `entities` so that each comes after those that write a property it reads or give an output it reads.
 * @param {Record<string, Entity>} entities
 */
export function entityOrder(entities: Record<string, Entity>): string[];
/**
 * The value at an RNA path (`fcurves[0].keyframe_points`, `modifiers["Bevel"].width`) of an ID's data: a collection's
 * item by index or by its `name`.
 * @param {IR} ir
 * @param {[string, string]} reference
 */
export function dataAt(ir: IR, [id, path]: [string, string]): Record<string, any> | null;
/**
 * Explains a schema's issues: where, what was expected and what is there.
 * @param {{ issues: any[] }} error
 * @param {string} [label]
 */
export function explain({ issues }: {
    issues: any[];
}, label?: string): string;
/**
 * An IR file's data as this runtime reads it: an older version migrated, omitted fields given their defaults, and what
 * can be solved repaired with a warning (a property's type from its default, a reference to what the IR lacks dropped,
 * an implementation this runtime does not ship left baked, `order` made whole). Throws on what cannot be read, naming
 * the path, what was expected and what is there.
 * @param {any} raw
 * @param {{ warn?: (message: string) => void, implementations?: string[] }} [options] the implementations this runtime ships
 * @returns {IR}
 */
export function readIR(raw: any, { warn, implementations }?: {
    warn?: (message: string) => void;
    implementations?: string[];
}): IR;
export const IDSchema: import("zod/mini").ZodMiniObject<{
    type: import("zod/mini").ZodMiniString<string>;
    name: import("zod/mini").ZodMiniString<string>;
    path: import("zod/mini").ZodMiniDefault<import("zod/mini").ZodMiniNullable<import("zod/mini").ZodMiniString<string>>>;
    node: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    data: import("zod/mini").ZodMiniDefault<import("zod/mini").ZodMiniNullable<import("zod/mini").ZodMiniRecord<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniAny>>>;
    evaluated: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniObject<{
        matrix_world: import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniNumber<number>>;
        geometry: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniRecord<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniAny>>;
    }, import("zod/v4/core").$strip>>;
}, import("zod/v4/core").$strip>;
/** `from` reads `to`: by the ID pointer at `path` in it, or by a depsgraph `relation` (`to` being `time` for the scene's time). */
export const IDReferenceSchema: import("zod/mini").ZodMiniObject<{
    from: import("zod/mini").ZodMiniString<string>;
    path: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    to: import("zod/mini").ZodMiniString<string>;
    relation: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
}, import("zod/v4/core").$strip>;
export const PROPERTY_TYPES: readonly ["FLOAT", "INT", "BOOLEAN", "STRING"];
/** A value a page sets and reads, by RNA path; `bind` is where it lands in Babylon (blend-scene.js Binding). */
export const PropertySchema: import("zod/mini").ZodMiniObject<{
    id: import("zod/mini").ZodMiniDefault<import("zod/mini").ZodMiniNullable<import("zod/mini").ZodMiniString<string>>>;
    type: import("zod/mini").ZodMiniEnum<{
        FLOAT: "FLOAT";
        INT: "INT";
        BOOLEAN: "BOOLEAN";
        STRING: "STRING";
    }>;
    default: import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniNumber<number>, import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniString<string>]>;
    soft_min: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
    soft_max: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
    subtype: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    unit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    suggested: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniBoolean<boolean>>;
    name: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    blender_default: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniNumber<number>, import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniString<string>]>>;
    hard_min: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
    hard_max: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
    step: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
    precision: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
    bind: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniRecord<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniAny>>;
}, import("zod/v4/core").$strip>;
export const GraphNodeSchema: import("zod/mini").ZodMiniObject<{
    name: import("zod/mini").ZodMiniString<string>;
    type: import("zod/mini").ZodMiniString<string>;
    settings: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, any>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, any>, any>>>;
    inputs: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, any>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, any>, any>>>;
}, import("zod/v4/core").$loose>;
export const GraphSchema: import("zod/mini").ZodMiniObject<{
    type: import("zod/mini").ZodMiniEnum<{
        SHADER: "SHADER";
        GEOMETRY: "GEOMETRY";
        COMPOSITOR: "COMPOSITOR";
    }>;
    nodes: import("zod/mini").ZodMiniDefault<z.ZodMiniType<{
        [x: string]: unknown;
        name: string;
        type: string;
        settings: Record<string, any>;
        inputs: Record<string, any>;
    }[], any, import("zod/v4/core").$ZodTypeInternals<{
        [x: string]: unknown;
        name: string;
        type: string;
        settings: Record<string, any>;
        inputs: Record<string, any>;
    }[], any>>>;
    links: import("zod/mini").ZodMiniDefault<z.ZodMiniType<[string, string, string, string][], any, import("zod/v4/core").$ZodTypeInternals<[string, string, string, string][], any>>>;
    interface: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, any>[], any, import("zod/v4/core").$ZodTypeInternals<Record<string, any>[], any>>>;
}, import("zod/v4/core").$strip>;
/** A computed entity: its type key, the ID it belongs to, its inputs, where its outputs land, and what the package ships for it (none: baked). */
export const EntitySchema: import("zod/mini").ZodMiniObject<{
    type: import("zod/mini").ZodMiniString<string>;
    id: import("zod/mini").ZodMiniString<string>;
    inputs: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, any>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, any>, any>>>;
    outputs: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        property: string;
    } | {
        draw: string;
    } | null>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        property: string;
    } | {
        draw: string;
    } | null>, any>>>;
    implementation: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
}, import("zod/v4/core").$strip>;
export const IR_SCHEMA: "bylonder-ir";
export const IR_VERSION: 1;
export const IRSchema: import("zod/mini").ZodMiniObject<{
    schema: import("zod/mini").ZodMiniLiteral<"bylonder-ir">;
    version: import("zod/mini").ZodMiniLiteral<1>;
    ids: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        type: string;
        name: string;
        path: string | null;
        data: Record<string, any> | null;
        node?: string | undefined;
        evaluated?: {
            matrix_world: number[];
            geometry?: Record<string, any> | undefined;
        } | undefined;
    }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        type: string;
        name: string;
        path: string | null;
        data: Record<string, any> | null;
        node?: string | undefined;
        evaluated?: {
            matrix_world: number[];
            geometry?: Record<string, any> | undefined;
        } | undefined;
    }>, any>>>;
    references: import("zod/mini").ZodMiniDefault<z.ZodMiniType<{
        from: string;
        to: string;
        path?: string | undefined;
        relation?: string | undefined;
    }[], any, import("zod/v4/core").$ZodTypeInternals<{
        from: string;
        to: string;
        path?: string | undefined;
        relation?: string | undefined;
    }[], any>>>;
    properties: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        id: string | null;
        type: "FLOAT" | "INT" | "BOOLEAN" | "STRING";
        default: string | number | boolean;
        soft_min?: number | undefined;
        soft_max?: number | undefined;
        subtype?: string | undefined;
        unit?: string | undefined;
        suggested?: boolean | undefined;
        name?: string | undefined;
        blender_default?: string | number | boolean | undefined;
        hard_min?: number | undefined;
        hard_max?: number | undefined;
        step?: number | undefined;
        precision?: number | undefined;
        bind?: Record<string, any> | undefined;
    }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        id: string | null;
        type: "FLOAT" | "INT" | "BOOLEAN" | "STRING";
        default: string | number | boolean;
        soft_min?: number | undefined;
        soft_max?: number | undefined;
        subtype?: string | undefined;
        unit?: string | undefined;
        suggested?: boolean | undefined;
        name?: string | undefined;
        blender_default?: string | number | boolean | undefined;
        hard_min?: number | undefined;
        hard_max?: number | undefined;
        step?: number | undefined;
        precision?: number | undefined;
        bind?: Record<string, any> | undefined;
    }>, any>>>;
    graphs: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        type: "SHADER" | "GEOMETRY" | "COMPOSITOR";
        nodes: {
            [x: string]: unknown;
            name: string;
            type: string;
            settings: Record<string, any>;
            inputs: Record<string, any>;
        }[];
        links: [string, string, string, string][];
        interface: Record<string, any>[];
    }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        type: "SHADER" | "GEOMETRY" | "COMPOSITOR";
        nodes: {
            [x: string]: unknown;
            name: string;
            type: string;
            settings: Record<string, any>;
            inputs: Record<string, any>;
        }[];
        links: [string, string, string, string][];
        interface: Record<string, any>[];
    }>, any>>>;
    entities: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        type: string;
        id: string;
        inputs: Record<string, any>;
        outputs: Record<string, {
            property: string;
        } | {
            draw: string;
        } | null>;
        implementation?: string | undefined;
    }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        type: string;
        id: string;
        inputs: Record<string, any>;
        outputs: Record<string, {
            property: string;
        } | {
            draw: string;
        } | null>;
        implementation?: string | undefined;
    }>, any>>>;
    order: import("zod/mini").ZodMiniDefault<z.ZodMiniType<string[], any, import("zod/v4/core").$ZodTypeInternals<string[], any>>>;
}, import("zod/v4/core").$strip>;
export const AttributesSchema: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
    domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
    type: string;
    data: any;
}>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
    domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
    type: string;
    data: any;
}>, any>>>;
/** A vertex group: its name, and its vertices with their weights. */
export const VertexGroupSchema: import("zod/mini").ZodMiniObject<{
    name: import("zod/mini").ZodMiniString<string>;
    verts: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
    weights: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
}, import("zod/v4/core").$strip>;
export const MeshSchema: import("zod/mini").ZodMiniObject<{
    vert_positions: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
    edges: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
    face_offsets: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
    corner_verts: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
    corner_edges: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
    uvs: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>>;
    attributes: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
        type: string;
        data: any;
    }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
        type: string;
        data: any;
    }>, any>>>;
    vertex_groups: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
        name: import("zod/mini").ZodMiniString<string>;
        verts: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
        weights: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
    }, import("zod/v4/core").$strip>>>;
}, import("zod/v4/core").$strip>;
/** Points; a radius is the attribute `radius`. */
export const PointsSchema: import("zod/mini").ZodMiniObject<{
    positions: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
    attributes: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
        type: string;
        data: any;
    }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
        type: string;
        data: any;
    }>, any>>>;
}, import("zod/v4/core").$strip>;
/**
 * Instances: each of `references` an ID (`{ id: 'OB:Tree' }`) or a geometry; per instance its reference's index and its
 * transform, 4x4 by columns.
 */
export const InstancesSchema: import("zod/mini").ZodMiniObject<{
    references: import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniObject<{
        id: import("zod/mini").ZodMiniString<string>;
    }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
        geometry: import("zod/mini").ZodMiniAny;
    }, import("zod/v4/core").$strip>]>>;
    reference_indices: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
    transforms: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
    attributes: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
        domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
        type: string;
        data: any;
    }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
        domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
        type: string;
        data: any;
    }>, any>>>;
}, import("zod/v4/core").$strip>;
export const GeometrySchema: import("zod/mini").ZodMiniObject<{
    mesh: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniObject<{
        vert_positions: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
        edges: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
        face_offsets: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
        corner_verts: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
        corner_edges: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
        uvs: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>>;
        attributes: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
            domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
            type: string;
            data: any;
        }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
            domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
            type: string;
            data: any;
        }>, any>>>;
        vertex_groups: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
            name: import("zod/mini").ZodMiniString<string>;
            verts: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
            weights: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
        }, import("zod/v4/core").$strip>>>;
    }, import("zod/v4/core").$strip>>;
    points: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniObject<{
        positions: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
        attributes: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
            domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
            type: string;
            data: any;
        }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
            domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
            type: string;
            data: any;
        }>, any>>>;
    }, import("zod/v4/core").$strip>>;
    instances: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniObject<{
        references: import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniObject<{
            id: import("zod/mini").ZodMiniString<string>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
            geometry: import("zod/mini").ZodMiniAny;
        }, import("zod/v4/core").$strip>]>>;
        reference_indices: import("zod/mini").ZodMiniCustom<Int32Array<ArrayBuffer>, Int32Array<ArrayBuffer>>;
        transforms: import("zod/mini").ZodMiniCustom<Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>>;
        attributes: import("zod/mini").ZodMiniDefault<z.ZodMiniType<Record<string, {
            domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
            type: string;
            data: any;
        }>, any, import("zod/v4/core").$ZodTypeInternals<Record<string, {
            domain: "POINT" | "EDGE" | "FACE" | "CORNER" | "INSTANCE";
            type: string;
            data: any;
        }>, any>>>;
    }, import("zod/v4/core").$strip>>;
}, import("zod/v4/core").$strip>;
export function isReference(value: any): value is Reference;
/** Steps from each older version to the next: `MIGRATIONS[n]` takes an IR of version n to n + 1. @type {Record<number, (ir: any) => any>} */
export const MIGRATIONS: Record<number, (ir: any) => any>;
export type IR = z.infer<typeof IRSchema>;
export type ID = z.infer<typeof IDSchema>;
export type IDReference = z.infer<typeof IDReferenceSchema>;
export type Property = z.infer<typeof PropertySchema>;
export type Graph = z.infer<typeof GraphSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Mesh = z.infer<typeof MeshSchema>;
export type Points = z.infer<typeof PointsSchema>;
export type Instances = z.infer<typeof InstancesSchema>;
/**
 * A reference an entity's input may hold, resolved before a unit runs.
 */
export type Geometry = z.infer<typeof GeometrySchema>;
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
import * as z from './zod.js';
