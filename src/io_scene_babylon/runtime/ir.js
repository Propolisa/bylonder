// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Bylonder's IR (docs/ir.md): an exported scene as data, which the scheduler walks. This schema is the one source of
// its shape: ir.schema.json and the types are made from it (scripts/ir-runtime.mjs), and readIR rehydrates a file with
// it, filling defaults and repairing what it can with a warning.
import * as z from './zod.js';

const Data = z.record(z.string(), z.any());
const Name = z.string();
/** @param {RegExp} pattern */
const matching = (pattern) => z.string().check(z.regex(pattern));
/** A default of a fresh object or array each time. @template T @param {z.ZodMiniType<T>} schema @param {() => any} value */
const fresh = (schema, value) => z._default(schema, value);

export const IDSchema = z.object({
  /** RNA's struct name in capitals (`OBJECT`, `MESH`, `SHADERNODETREE`) */
  type: Name, name: Name,
  /** from bpy.data, null for an ID outside its collections */
  path: z._default(z.nullable(Name), null),
  /** the Babylon node or material it draws as */
  node: z.optional(Name),
  /** its RNA properties that differ from their defaults; an ID pointer as `{ id }` */
  data: z._default(z.nullable(Data), null),
  /** what Blender evaluated at export, for an object a Geometry Nodes graph reads: its world matrix (4x4 by columns) and IR geometry */
  evaluated: z.optional(z.object({ matrix_world: z.array(z.number()), geometry: z.optional(Data) })),
});

/** `from` reads `to`: by the ID pointer at `path` in it, or by a depsgraph `relation` (`to` being `time` for the scene's time). */
export const IDReferenceSchema = z.object({ from: Name, path: z.optional(Name), to: Name, relation: z.optional(Name) });

export const PROPERTY_TYPES = /** @type {const} */ (['FLOAT', 'INT', 'BOOLEAN', 'STRING']);
/** A value a page sets and reads, by RNA path; `bind` is where it lands in Babylon (blend-scene.js Binding). */
export const PropertySchema = z.object({
  id: z._default(z.nullable(Name), null),
  type: z.enum(PROPERTY_TYPES),
  default: z.union([z.number(), z.boolean(), z.string()]),
  soft_min: z.optional(z.number()), soft_max: z.optional(z.number()),
  subtype: z.optional(Name), unit: z.optional(Name), suggested: z.optional(z.boolean()),
  /** Blender's UI name of the property (a socket's name, a custom property's key) */
  name: z.optional(Name),
  /** the value Blender gives it new (RNA's default, a node's socket default), where known */
  blender_default: z.optional(z.union([z.number(), z.boolean(), z.string()])),
  hard_min: z.optional(z.number()), hard_max: z.optional(z.number()),
  /** RNA's step (a hundredth of the value for a float) and display precision */
  step: z.optional(z.number()), precision: z.optional(z.number()),
  bind: z.optional(Data),
});

export const GraphNodeSchema = z.looseObject({
  name: Name,
  /** `node:<idname>` */
  type: matching(/^node:/),
  settings: fresh(Data, () => ({})),
  /** unlinked inputs by socket identifier: values or references */
  inputs: fresh(Data, () => ({})),
});

export const GraphSchema = z.object({
  type: z.enum(['SHADER', 'GEOMETRY', 'COMPOSITOR']),
  nodes: fresh(z.array(GraphNodeSchema), () => []),
  /** `[from node, output, to node, input]` */
  links: fresh(z.array(z.tuple([Name, Name, Name, Name])), () => []),
  interface: fresh(z.array(Data), () => []),
});

const Output = z.nullable(z.union([z.object({ property: Name }), z.object({ draw: Name })]));
/** A computed entity: its type key, the ID it belongs to, its inputs, where its outputs land, and what the package ships for it (none: baked). */
export const EntitySchema = z.object({
  type: matching(/^[a-z_]+:/),
  id: Name,
  inputs: fresh(Data, () => ({})),
  outputs: fresh(z.record(Name, Output), () => ({})),
  implementation: z.optional(Name),
});

/** A collection's flags in a view layer, as its LayerCollection holds them. */
export const LayerCollectionSchema = z.object({
  exclude: z._default(z.boolean(), false), hide_viewport: z._default(z.boolean(), false),
  holdout: z._default(z.boolean(), false), indirect_only: z._default(z.boolean(), false),
});

export const COLOR_TAGS = /** @type {const} */ (['NONE', 'COLOR_01', 'COLOR_02', 'COLOR_03', 'COLOR_04', 'COLOR_05', 'COLOR_06', 'COLOR_07', 'COLOR_08']);
/** A collection: its members by key (child collections, then objects), its metadata and its visibility. */
export const CollectionSchema = z.object({
  name: Name,
  children: fresh(z.array(Name), () => []),
  objects: fresh(z.array(Name), () => []),
  color_tag: z._default(z.enum(COLOR_TAGS), 'NONE'),
  /** its custom properties */
  custom: fresh(Data, () => ({})),
  hide_viewport: z._default(z.boolean(), false), hide_render: z._default(z.boolean(), false), hide_select: z._default(z.boolean(), false),
  /** its flags by view layer name */
  view_layers: fresh(z.record(Name, LayerCollectionSchema), () => ({})),
});

/** A marker: a named frame, the scene's (timeline_markers) or an action's (pose_markers, at the action's frames). */
export const MarkerSchema = z.object({ name: z._default(z.string(), ''), frame: z._default(z.number(), 0) });
/**
 * An action exported as a clip (an animation group of its own, named by the action): its frame range, and how the first
 * NLA strip using it plays it, its blending (REPLACE, ADD, or COMBINE played as ADD), influence, speed (1 / its scale) and
 * repeat; its pose markers.
 */
export const ClipSchema = z.object({
  action: Name,
  frame_start: z._default(z.number(), 1), frame_end: z._default(z.number(), 1),
  blend: z._default(z.enum(['REPLACE', 'ADD', 'SUBTRACT', 'MULTIPLY', 'COMBINE']), 'REPLACE'),
  influence: z._default(z.number(), 1), speed: z._default(z.number().check(z.refine((speed) => speed > 0)), 1), repeat: z._default(z.number(), 1),
  markers: fresh(z.array(MarkerSchema), () => []),
});

/**
 * A sound strip of the scene's sequencer (Blender's SoundStrip): its sound's file in the package and the seconds of
 * encoder delay the file's decoded sound starts with (an AAC encoder's priming), its channel, the frame its sound would
 * start at (frame_start) and the frames it plays (frame_final_start to frame_final_end, its offsets cut from the sound's
 * start and end), its volume and whether it is muted.
 */
export const SoundSchema = z.object({
  name: Name, file: z.string(), delay: z._default(z.number(), 0),
  channel: z._default(z.number(), 1), frame_start: z._default(z.number(), 1),
  frame_final_start: z._default(z.number(), 1), frame_final_end: z._default(z.number(), 1),
  frame_offset_start: z._default(z.number(), 0), frame_offset_end: z._default(z.number(), 0),
  volume: z._default(z.number(), 1), mute: z._default(z.boolean(), false),
});

/** The scene's time as Blender's Scene holds it: the frame shown, the range played, its frame rate (fps / fps_base) and whether playback loops. */
export const TimeSchema = z.object({
  frame_current: z._default(z.number(), 1), frame_start: z._default(z.number(), 1), frame_end: z._default(z.number(), 250),
  fps: z._default(z.number(), 24), fps_base: z._default(z.number(), 1), loop: z._default(z.boolean(), true),
  /** keys per second of each object whose animation groups hold baked (sampled) keys, by object name */
  sample_rates: fresh(z.record(Name, z.number().check(z.refine((rate) => rate > 0))), () => ({})),
  /** the actions exported as clips, by name */
  clips: fresh(z.record(Name, ClipSchema), () => ({})),
  /** the scene's markers */
  markers: fresh(z.array(MarkerSchema), () => []),
  /** the sound strips of the scene's sequencer */
  sounds: fresh(z.array(SoundSchema), () => []),
});
const TIME = () => ({ frame_current: 1, frame_start: 1, frame_end: 250, fps: 24, fps_base: 1, loop: true, sample_rates: {}, clips: {}, markers: [], sounds: [] });

/** The scene the page shows: its ID, its scene collection (the collections' root), the view layer it draws and its time. */
export const SceneSchema = z.object({
  id: z._default(z.nullable(Name), null),
  collection: z._default(z.nullable(Name), null),
  view_layer: z._default(z.nullable(Name), null),
  time: fresh(TimeSchema, TIME),
});

export const IR_SCHEMA = 'bylonder-ir', IR_VERSION = 1;
export const IRSchema = z.object({
  schema: z.literal(IR_SCHEMA),
  version: z.literal(IR_VERSION),
  scene: fresh(SceneSchema, () => ({ id: null, collection: null, view_layer: null, time: TIME() })),
  ids: fresh(z.record(matching(/^[A-Z]{2,3}:/), IDSchema), () => ({})),
  collections: fresh(z.record(Name, CollectionSchema), () => ({})),
  references: fresh(z.array(IDReferenceSchema), () => []),
  properties: fresh(z.record(Name, PropertySchema), () => ({})),
  graphs: fresh(z.record(Name, GraphSchema), () => ({})),
  entities: fresh(z.record(matching(/^[A-Z]{2,3}:.+\/[a-z_]+\/.+$/), EntitySchema), () => ({})),
  order: fresh(z.array(Name), () => []),
});

// Geometry as units take it and give it (docs/ir.md, Geometry): typed arrays in Blender's axes.
const Floats = z.instanceof(Float32Array), Ints = z.instanceof(Int32Array);
export const AttributesSchema = fresh(z.record(Name, z.object({ domain: z.enum(['POINT', 'EDGE', 'FACE', 'CORNER', 'INSTANCE']), type: Name, data: z.any() })), () => ({}));
/** A vertex group: its name, and its vertices with their weights. */
export const VertexGroupSchema = z.object({ name: Name, verts: Ints, weights: Floats });
export const MeshSchema = z.object({ vert_positions: Floats, edges: Ints, face_offsets: Ints, corner_verts: Ints, corner_edges: Ints, uvs: z.optional(Floats), attributes: AttributesSchema,
  vertex_groups: z.optional(z.array(VertexGroupSchema)) });
/** Points; a radius is the attribute `radius`. */
export const PointsSchema = z.object({ positions: Floats, attributes: AttributesSchema });
/**
 * Instances: each of `references` an ID (`{ id: 'OB:Tree' }`) or a geometry; per instance its reference's index and its
 * transform, 4x4 by columns.
 */
export const InstancesSchema = z.object({ references: z.array(z.union([z.object({ id: Name }), z.object({ geometry: z.any() })])), reference_indices: Ints,
  transforms: Floats, attributes: AttributesSchema });
export const GeometrySchema = z.object({ mesh: z.optional(MeshSchema), points: z.optional(PointsSchema), instances: z.optional(InstancesSchema) });

/**
 * @typedef {z.infer<typeof IRSchema>} IR
 * @typedef {z.infer<typeof IDSchema>} ID
 * @typedef {z.infer<typeof IDReferenceSchema>} IDReference
 * @typedef {z.infer<typeof PropertySchema>} Property
 * @typedef {z.infer<typeof GraphSchema>} Graph
 * @typedef {z.infer<typeof GraphNodeSchema>} GraphNode
 * @typedef {z.infer<typeof EntitySchema>} Entity
 * @typedef {z.infer<typeof MeshSchema>} Mesh
 * @typedef {z.infer<typeof PointsSchema>} Points
 * @typedef {z.infer<typeof InstancesSchema>} Instances
 * @typedef {z.infer<typeof GeometrySchema>} Geometry
 * @typedef {z.infer<typeof TimeSchema>} Time
 * @typedef {z.infer<typeof ClipSchema>} Clip
 * @typedef {z.infer<typeof MarkerSchema>} Marker
 * @typedef {z.infer<typeof CollectionSchema>} Collection
 * @typedef {z.infer<typeof LayerCollectionSchema>} LayerCollection
 * A reference an entity's input may hold, resolved before a unit runs.
 * @typedef {{ property: string } | { entity: string, output: string } | { buffer: number } | { data: [string, string] } | { graph: string }} Reference
 */

const REFERENCES = ['property', 'entity', 'buffer', 'data', 'graph'];
/** Whether a value is a reference. @param {any} value @returns {value is Reference} */
export const isReference = (value) => value?.constructor === Object && REFERENCES.some((kind) => kind in value)
  && Object.keys(value).every((key) => key === 'output' || REFERENCES.includes(key));

/** Whether a value holds a reference anywhere, by object, found once. @type {WeakMap<object, boolean>} */
const holds = new WeakMap();
/** @param {any} value @returns {boolean} */
export function holdsReference(value) {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return false;
  if (!holds.has(value)) holds.set(value, isReference(value) || (Array.isArray(value) ? value.some(holdsReference) : value.constructor === Object && Object.values(value).some(holdsReference)));
  return /** @type {boolean} */ (holds.get(value));
}

/**
 * Every reference in a value, with where it is.
 * @param {any} value
 * @param {string} [at]
 * @returns {Generator<[Reference, string]>}
 */
export function* referencesIn(value, at = '') {
  if (isReference(value)) yield [value, at];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* referencesIn(value[i], `${at}[${i}]`);
  else if (value?.constructor === Object) for (const key in value) yield* referencesIn(value[key], `${at}.${key}`);
}

/**
 * The keys of `entities` so that each comes after those that write a property it reads or give an output it reads.
 * @param {Record<string, Entity>} entities
 */
export function entityOrder(entities) {
  const writers = new Map(Object.entries(entities).flatMap(([key, e]) => Object.values(e.outputs).flatMap((o) => (o && 'property' in o ? [[o.property, key]] : []))));
  /** @type {string[]} */
  const order = [];
  const state = new Map();
  /** @param {string} key */
  const visit = (key) => {
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'visiting') throw new Error(`${key} depends on itself through other entities`);
    state.set(key, 'visiting');
    for (const [ref] of referencesIn(entities[key].inputs)) {
      const from = 'entity' in ref ? ref.entity : 'property' in ref ? writers.get(ref.property) : undefined;
      if (from && from !== key && entities[from]) visit(from);
    }
    state.set(key, 'done');
    order.push(key);
  };
  Object.keys(entities).forEach(visit);
  return order;
}

/**
 * The value at an RNA path (`fcurves[0].keyframe_points`, `modifiers["Bevel"].width`) of an ID's data: a collection's
 * item by index or by its `name`.
 * @param {IR} ir
 * @param {[string, string]} reference
 */
export function dataAt(ir, [id, path]) {
  let value = ir.ids[id]?.data, at = id;
  // A struct written once and referred to elsewhere (`{ struct }`, or `{ id, struct }` in another ID) is read there.
  const follow = () => { if (value?.constructor === Object && typeof value.struct === 'string') { at = value.id ?? at; value = dataAt(ir, [at, value.struct]); } };
  for (const [, name, index, key] of path.matchAll(/\.?(\w+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g)) {
    follow();
    const wanted = key?.replace(/\\(.)/g, '$1'), nameOf = (/** @type {any} */ item) => (typeof item?.struct === 'string' ? dataAt(ir, [item.id ?? at, item.struct])?.name : item?.name);
    value = name !== undefined ? value?.[name] : index !== undefined ? value?.[+index] : value?.find?.((/** @type {any} */ item) => nameOf(item) === wanted);
  }
  follow();
  return value;
}

/** Steps from each older version to the next: `MIGRATIONS[n]` takes an IR of version n to n + 1. @type {Record<number, (ir: any) => any>} */
export const MIGRATIONS = {};

const typeOf = (/** @type {unknown} */ value) => (typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'STRING' : Number.isInteger(value) ? 'INT' : 'FLOAT');
/** @param {PropertyKey[]} path */
const where = (path) => 'ir' + path.map((key) => (typeof key === 'number' ? `[${key}]` : /^\w+$/.test(String(key)) ? `.${String(key)}` : `[${JSON.stringify(key)}]`)).join('');

/**
 * Explains a schema's issues: where, what was expected and what is there.
 * @param {{ issues: any[] }} error
 * @param {string} [label]
 */
export function explain({ issues }, label = '') {
  return issues.map((/** @type {any} */ issue) => {
    // A union's issues name what each of its options expected.
    const expected = issue.expected ?? [...new Set(issue.errors?.flat().map((/** @type {any} */ e) => e.expected).filter(Boolean))].join(' or ');
    const what = expected ? `expected ${expected}, got ${JSON.stringify(issue.input) ?? 'nothing'}` : issue.message;
    return `${label}${where(issue.path).slice(label ? 2 : 0)}: ${what}`;
  }).join('\n');
}

/**
 * An IR file's data as this runtime reads it: an older version migrated, omitted fields given their defaults, and what
 * can be solved repaired with a warning (a property's type from its default, a reference to what the IR lacks dropped,
 * an implementation this runtime does not ship left baked, `order` made whole). Throws on what cannot be read, naming
 * the path, what was expected and what is there.
 * @param {any} raw
 * @param {{ warn?: (message: string) => void, implementations?: string[] }} [options] the implementations this runtime ships
 * @returns {IR}
 */
export function readIR(raw, { warn = (message) => console.warn(`Bylonder IR: ${message}`), implementations } = {}) {
  if (raw?.schema !== IR_SCHEMA) throw new Error(`Not a Bylonder IR: ir.schema is ${JSON.stringify(raw?.schema)}, expected "${IR_SCHEMA}"`);
  if (!Number.isInteger(raw.version) || raw.version > IR_VERSION) throw new Error(`ir.version is ${JSON.stringify(raw.version)}: this runtime reads versions up to ${IR_VERSION}`);
  let ir = raw;
  for (let version = raw.version; version < IR_VERSION; version++) {
    if (!MIGRATIONS[version]) throw new Error(`ir.version is ${version}, which no step migrates`);
    ir = MIGRATIONS[version](ir);
  }
  const properties = Object.fromEntries(Object.entries(ir.properties ?? {}).map(([path, p]) => {
    if (p?.type !== undefined || p?.default === undefined) return [path, p];
    warn(`properties[${JSON.stringify(path)}] has no type: ${typeOf(p.default)}, from its default`);
    return [path, { ...p, type: typeOf(p.default) }];
  }));
  const collections = Object.fromEntries(Object.entries(ir.collections ?? {}).map(([key, c]) => {
    if (c?.color_tag === undefined || COLOR_TAGS.includes(c.color_tag)) return [key, c];
    warn(`collections[${JSON.stringify(key)}].color_tag is ${JSON.stringify(c.color_tag)}: NONE`);
    return [key, { ...c, color_tag: 'NONE' }];
  }));
  const parsed = z.safeParse(IRSchema, { ...ir, properties, collections }, { reportInput: true });
  if (!parsed.success) throw new Error(explain(parsed.error));
  return repair(parsed.data, warn, implementations);
}

/**
 * Collections made whole: a member the IR lacks dropped, a collection listed under two parents or under itself kept
 * under its first, and the scene's collection the root when it names none.
 * @param {IR} ir
 * @param {(message: string) => void} warn
 */
function repairCollections(ir, warn) {
  const parents = new Map();
  /** @param {string} key @param {string[]} path */
  const visit = (key, path) => {
    const collection = ir.collections[key], at = `collections[${JSON.stringify(key)}]`;
    collection.children = collection.children.filter((child) => {
      const why = !ir.collections[child] ? 'which the IR lacks' : path.includes(child) ? 'which holds it' : parents.has(child) ? `which ${JSON.stringify(parents.get(child))} holds` : '';
      if (why) warn(`${at}.children lists ${JSON.stringify(child)}, ${why}: dropped`);
      else parents.set(child, key);
      return !why;
    });
    collection.objects = collection.objects.filter((object) => object in ir.ids || void warn(`${at}.objects lists ${JSON.stringify(object)}, which the IR lacks: dropped`));
    collection.children.forEach((child) => visit(child, [...path, child]));
  };
  const keys = Object.keys(ir.collections);
  if (!keys.length) return;
  const listed = new Set(keys.flatMap((key) => ir.collections[key].children));
  if (!ir.scene.collection || !ir.collections[ir.scene.collection]) {
    const root = keys.find((key) => !listed.has(key)) ?? keys[0];
    if (ir.scene.collection) warn(`scene.collection is ${JSON.stringify(ir.scene.collection)}, which the IR lacks: ${JSON.stringify(root)}`);
    ir.scene.collection = root;
  }
  visit(ir.scene.collection, [ir.scene.collection]);
  for (const key of keys) if (key !== ir.scene.collection && !parents.has(key)) visit(key, [key]);
}

/**
 * @param {IR} ir
 * @param {(message: string) => void} warn
 * @param {string[]} [implementations]
 */
function repair(ir, warn, implementations) {
  /** @param {Reference} ref */
  const exists = (ref) => ('property' in ref ? ref.property in ir.properties : 'entity' in ref ? ref.entity in ir.entities
    : 'graph' in ref ? ref.graph in ir.graphs : 'data' in ref ? ref.data[0] in ir.ids : true);
  /** @param {any} value @param {string} at @returns {any} */
  const prune = (value, at) => {
    if (isReference(value)) {
      if (exists(value)) return value;
      warn(`${at} refers to ${JSON.stringify(value)}, which the IR lacks: dropped`);
      return undefined;
    }
    if (Array.isArray(value)) return value.map((v, i) => prune(v, `${at}[${i}]`) ?? null);
    if (value?.constructor !== Object) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, prune(v, `${at}.${k}`)]).filter(([, v]) => v !== undefined));
  };
  for (const [key, entity] of Object.entries(ir.entities)) {
    const at = `entities[${JSON.stringify(key)}]`;
    if (entity.implementation && implementations && !implementations.includes(entity.implementation)) {
      warn(`${at} names the implementation "${entity.implementation}", which this runtime does not ship: it stays baked`);
      delete entity.implementation;
    }
    entity.inputs = prune(entity.inputs, `${at}.inputs`);
    for (const [name, output] of Object.entries(entity.outputs)) {
      if (output && 'property' in output && !(output.property in ir.properties)) {
        warn(`${at}.outputs.${name} lands on the property ${output.property}, which the IR lacks: dropped`);
        entity.outputs[name] = null;
      }
    }
  }
  repairCollections(ir, warn);
  const order = ir.order.filter((key) => key in ir.entities);
  if (order.length !== ir.order.length || order.length !== Object.keys(ir.entities).length) {
    warn('order does not list the entities: made from their references');
    ir.order = entityOrder(ir.entities);
  }
  return ir;
}
