/**
 * The number of elements of a component's domain.
 * @param {Geometry} geometry
 * @param {Component} component
 * @param {Domain} domain
 */
export function domainSize(geometry: Geometry, component: Component, domain: Domain): number;
/** The positions of a component as [x, y, z] per point, or each instance's translation. @param {Geometry} geometry @param {Component} component */
export function positions(geometry: Geometry, component: Component): any[][];
/**
 * Values on one domain from another, mixed as Blender's attribute domains mix them: numbers and vectors averaged, a
 * boolean true where all its sources are (to a face or an edge) or any is (to a point).
 * @param {Geometry} geometry
 * @param {Component} component
 * @param {any[]} values
 * @param {Domain} from
 * @param {Domain} to
 */
export function adaptDomain(geometry: Geometry, component: Component, values: any[], from: Domain, to: Domain): any[];
/**
 * An attribute of a component by name, on a domain, or undefined.
 * @param {Geometry} geometry
 * @param {Component} component
 * @param {string} name
 * @param {Domain} domain
 */
export function readAttribute(geometry: Geometry, component: Component, name: string, domain: Domain): any;
/**
 * Writes an attribute (a copy of the component holds it), `position` into the component's positions.
 * @param {Geometry} geometry its component is replaced by the changed copy
 * @param {Component} component
 * @param {string} name
 * @param {Domain} domain
 * @param {AttributeType} type
 * @param {any[]} values one value per element
 */
export function writeAttribute(geometry: Geometry, component: Component, name: string, domain: Domain, type: AttributeType, values: any[]): void;
/** An attribute's values per element: numbers, booleans or tuples. @param {Attribute} attribute */
export function elements({ type, data }: Attribute): number[] | any[][] | boolean[];
/** An attribute of per-element values. @param {Domain} domain @param {AttributeType} type @param {any[]} values @returns {Attribute} */
export function attribute(domain: Domain, type: AttributeType, values: any[]): Attribute;
/** @typedef {'POINT' | 'EDGE' | 'FACE' | 'CORNER' | 'CURVE' | 'INSTANCE'} Domain */
/** @typedef {'FLOAT' | 'INT' | 'BOOLEAN' | 'INT8' | 'FLOAT2' | 'FLOAT_VECTOR' | 'FLOAT_COLOR' | 'BYTE_COLOR' | 'QUATERNION' | 'FLOAT4X4' | 'FLOAT4' | 'INT16_2D' | 'INT32_2D'} AttributeType */
/** An attribute's values flat, `width` numbers per element (a quaternion as w, x, y, z). @typedef {{ domain: Domain, type: AttributeType, data: ArrayLike<number> }} Attribute */
/**
 * @typedef {object} Mesh
 * @property {Float32Array | number[]} vert_positions
 * @property {Int32Array | number[]} edges
 * @property {Int32Array | number[]} face_offsets
 * @property {Int32Array | number[]} corner_verts
 * @property {Int32Array | number[]} [corner_edges]
 * @property {Record<string, Attribute>} [attributes]
 * @property {any[]} [materials]
 */
/** @typedef {{ positions: Float32Array | number[], attributes?: Record<string, Attribute>, materials?: any[] }} Points */
/** @typedef {{ references: any[], reference_indices: Int32Array | number[], transforms: Float32Array | number[], attributes?: Record<string, Attribute> }} Instances */
/** @typedef {{ mesh?: Mesh, points?: Points, curves?: any, instances?: Instances }} Geometry */
/** @typedef {'mesh' | 'points' | 'curves' | 'instances'} Component */
/** The components in the order Blender's evaluation visits them. @type {Component[]} */
export const COMPONENTS: Component[];
/** The domain a component's positions and most fields are on. @type {Record<Component, Domain>} */
export const POINT_DOMAIN: Record<Component, Domain>;
export function toTuples(flat: any[] | ArrayLike<number>, stride: number): any[][];
export function copyGeometry(geometry: Geometry): Geometry;
/** The IR attribute type of a socket type. @type {Record<string, AttributeType>} */
export const ATTRIBUTE_TYPES: Record<string, AttributeType>;
/** Each attribute type's array and numbers per element. @type {Record<AttributeType, [any, number]>} */
export const LAYOUTS: Record<AttributeType, [any, number]>;
export type Domain = "POINT" | "EDGE" | "FACE" | "CORNER" | "CURVE" | "INSTANCE";
export type AttributeType = "FLOAT" | "INT" | "BOOLEAN" | "INT8" | "FLOAT2" | "FLOAT_VECTOR" | "FLOAT_COLOR" | "BYTE_COLOR" | "QUATERNION" | "FLOAT4X4" | "FLOAT4" | "INT16_2D" | "INT32_2D";
/**
 * An attribute's values flat, `width` numbers per element (a quaternion as w, x, y, z).
 */
export type Attribute = {
    domain: Domain;
    type: AttributeType;
    data: ArrayLike<number>;
};
export type Mesh = {
    vert_positions: Float32Array | number[];
    edges: Int32Array | number[];
    face_offsets: Int32Array | number[];
    corner_verts: Int32Array | number[];
    corner_edges?: number[] | Int32Array<ArrayBufferLike> | undefined;
    attributes?: Record<string, Attribute> | undefined;
    materials?: any[] | undefined;
};
export type Points = {
    positions: Float32Array | number[];
    attributes?: Record<string, Attribute>;
    materials?: any[];
};
export type Instances = {
    references: any[];
    reference_indices: Int32Array | number[];
    transforms: Float32Array | number[];
    attributes?: Record<string, Attribute>;
};
export type Geometry = {
    mesh?: Mesh;
    points?: Points;
    curves?: any;
    instances?: Instances;
};
export type Component = "mesh" | "points" | "curves" | "instances";
