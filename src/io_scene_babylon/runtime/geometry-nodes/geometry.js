// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// IR geometry (docs/ir.md, Geometry) as the Geometry Nodes evaluator reads and writes it: its components, the size of
// each attribute domain, attributes read on any domain and written on one.

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
export const COMPONENTS = ['mesh', 'points', 'curves', 'instances'];
/** The domain a component's positions and most fields are on. @type {Record<Component, Domain>} */
export const POINT_DOMAIN = { mesh: 'POINT', points: 'POINT', curves: 'POINT', instances: 'INSTANCE' };

/**
 * The number of elements of a component's domain.
 * @param {Geometry} geometry
 * @param {Component} component
 * @param {Domain} domain
 */
export function domainSize(geometry, component, domain) {
  if (component === 'mesh') {
    const mesh = /** @type {Mesh} */ (geometry.mesh);
    /** @type {Partial<Record<Domain, number>>} */
    const sizes = { POINT: mesh.vert_positions.length / 3, EDGE: mesh.edges.length / 2, FACE: mesh.face_offsets.length - 1, CORNER: mesh.corner_verts.length };
    return sizes[domain] ?? 0;
  }
  if (component === 'points') return domain === 'POINT' ? /** @type {Points} */ (geometry.points).positions.length / 3 : 0;
  if (component === 'instances') return domain === 'INSTANCE' ? /** @type {Instances} */ (geometry.instances).transforms.length / 16 : 0;
  return 0;
}

/** @param {any[] | ArrayLike<number>} flat @param {number} stride */
export const toTuples = (flat, stride) => Array.from({ length: flat.length / stride }, (_, i) => Array.from({ length: stride }, (_, k) => flat[i * stride + k]));

/** The positions of a component as [x, y, z] per point, or each instance's translation. @param {Geometry} geometry @param {Component} component */
export function positions(geometry, component) {
  if (component === 'mesh') return toTuples(/** @type {Mesh} */ (geometry.mesh).vert_positions, 3);
  if (component === 'points') return toTuples(/** @type {Points} */ (geometry.points).positions, 3);
  if (component === 'instances') return toTuples(/** @type {Instances} */ (geometry.instances).transforms, 16).map((m) => [m[12], m[13], m[14]]);
  return [];
}

/** A copy of a geometry whose components can be changed without changing it (their arrays are shared). @param {Geometry} geometry @returns {Geometry} */
export const copyGeometry = (geometry) => Object.fromEntries(Object.entries(geometry).map(([name, component]) =>
  [name, component && { ...component, attributes: { ...component.attributes } }]));

// A domain's elements from another's, per element: the indices of the source elements each one gathers.
/** @param {Mesh} mesh @param {Domain} from @param {Domain} to @returns {number[][] | null} */
function meshAdjacency(mesh, from, to) {
  const faces = mesh.face_offsets.length - 1, corners = mesh.corner_verts.length, verts = mesh.vert_positions.length / 3;
  const faceOf = new Int32Array(corners);
  for (let f = 0; f < faces; f++) for (let c = mesh.face_offsets[f]; c < mesh.face_offsets[f + 1]; c++) faceOf[c] = f;
  const range = (/** @type {number} */ f) => Array.from({ length: mesh.face_offsets[f + 1] - mesh.face_offsets[f] }, (_, k) => mesh.face_offsets[f] + k);
  const around = (/** @type {number} */ count, /** @type {(push: (at: number, value: number) => void) => void} */ fill) => {
    /** @type {number[][]} */
    const lists = Array.from({ length: count }, () => []);
    fill((at, value) => lists[at].push(value));
    return lists;
  };
  const key = `${from}>${to}`;
  if (key === 'POINT>CORNER') return Array.from(mesh.corner_verts, (v) => [v]);
  if (key === 'FACE>CORNER') return Array.from(faceOf, (f) => [f]);
  if (key === 'CORNER>FACE') return Array.from({ length: faces }, (_, f) => range(f));
  if (key === 'POINT>FACE') return Array.from({ length: faces }, (_, f) => range(f).map((c) => mesh.corner_verts[c]));
  if (key === 'CORNER>POINT') return around(verts, (push) => Array.from(mesh.corner_verts).forEach((v, c) => push(v, c)));
  if (key === 'FACE>POINT') return around(verts, (push) => Array.from(mesh.corner_verts).forEach((v, c) => push(v, faceOf[c])));
  if (key === 'POINT>EDGE') return toTuples(mesh.edges, 2);
  if (key === 'EDGE>POINT') return around(verts, (push) => toTuples(mesh.edges, 2).forEach(([a, b], e) => { push(a, e); push(b, e); }));
  return null;
}

/**
 * Values on one domain from another, mixed as Blender's attribute domains mix them: numbers and vectors averaged, a
 * boolean true where all its sources are (to a face or an edge) or any is (to a point).
 * @param {Geometry} geometry
 * @param {Component} component
 * @param {any[]} values
 * @param {Domain} from
 * @param {Domain} to
 */
export function adaptDomain(geometry, component, values, from, to) {
  if (from === to) return values;
  const sources = component === 'mesh' ? meshAdjacency(/** @type {Mesh} */ (geometry.mesh), from, to) : null;
  if (!sources) throw new Error(`Geometry Nodes: no mix from ${from} to ${to} on ${component}`);
  return sources.map((list) => mix(list.map((i) => values[i]), to));
}

/** @param {any[]} list @param {Domain} to */
function mix(list, to) {
  if (list.length === 1) return list[0];
  if (!list.length) return 0;
  if (typeof list[0] === 'boolean') return to === 'POINT' ? list.some(Boolean) : list.every(Boolean);
  if (Array.isArray(list[0])) return list[0].map((_, k) => list.reduce((sum, v) => sum + v[k], 0) / list.length);
  return list.reduce((sum, v) => sum + v, 0) / list.length;
}

/**
 * An attribute of a component by name, on a domain, or undefined.
 * @param {Geometry} geometry
 * @param {Component} component
 * @param {string} name
 * @param {Domain} domain
 */
export function readAttribute(geometry, component, name, domain) {
  if (name === 'position' && (component === 'mesh' || component === 'points')) return adaptDomain(geometry, component, positions(geometry, component), 'POINT', domain);
  const attribute = geometry[component]?.attributes?.[name];
  return attribute && adaptDomain(geometry, component, elements(attribute), attribute.domain, domain);
}

/**
 * Writes an attribute (a copy of the component holds it), `position` into the component's positions.
 * @param {Geometry} geometry its component is replaced by the changed copy
 * @param {Component} component
 * @param {string} name
 * @param {Domain} domain
 * @param {AttributeType} type
 * @param {any[]} values one value per element
 */
export function writeAttribute(geometry, component, name, domain, type, values) {
  const target = /** @type {any} */ ({ ...geometry[component] });
  if (name === 'position' && component !== 'instances') {
    target[component === 'mesh' ? 'vert_positions' : 'positions'] = new Float32Array(values.flat());
  } else target.attributes = { ...target.attributes, [name]: attribute(domain, type, values) };
  geometry[component] = target;
}

/** The IR attribute type of a socket type. @type {Record<string, AttributeType>} */
export const ATTRIBUTE_TYPES = { VALUE: 'FLOAT', INT: 'INT', BOOLEAN: 'BOOLEAN', VECTOR: 'FLOAT_VECTOR', RGBA: 'FLOAT_COLOR', ROTATION: 'QUATERNION', MATRIX: 'FLOAT4X4' };

/** Each attribute type's array and numbers per element. @type {Record<AttributeType, [any, number]>} */
export const LAYOUTS = {
  FLOAT: [Float32Array, 1], INT: [Int32Array, 1], BOOLEAN: [Uint8Array, 1], INT8: [Int8Array, 1], FLOAT2: [Float32Array, 2],
  FLOAT_VECTOR: [Float32Array, 3], FLOAT_COLOR: [Float32Array, 4], BYTE_COLOR: [Uint8Array, 4], QUATERNION: [Float32Array, 4],
  FLOAT4X4: [Float32Array, 16], FLOAT4: [Float32Array, 4], INT16_2D: [Int16Array, 2], INT32_2D: [Int32Array, 2],
};

/** An attribute's values per element: numbers, booleans or tuples. @param {Attribute} attribute */
export function elements({ type, data }) {
  const width = LAYOUTS[type][1];
  if (type === 'BOOLEAN') return Array.from(data, Boolean);
  return width === 1 ? Array.from(data) : toTuples(data, width);
}

/** An attribute of per-element values. @param {Domain} domain @param {AttributeType} type @param {any[]} values @returns {Attribute} */
export function attribute(domain, type, values) {
  const [Type] = LAYOUTS[type];
  return { domain, type, data: Type.from(values.flat(), Number) };
}
