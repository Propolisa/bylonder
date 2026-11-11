// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// The rig description (schema `bylonder-rig`, version 1): plain JSON named after Blender's Python API (RNA). See
// README.md, Rig description. normalize() fills defaults and turns row-list matrices into column-major arrays.
import { ROT } from './m4.js';

export const SCHEMA = 'bylonder-rig';
export const VERSION = 1;

const IDENTITY_ROWS = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

// A matrix given as rows (Python `[list(r) for r in M]`) into a column-major Float64Array(16).
export function fromRows(rows = IDENTITY_ROWS) {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = rows[r][c];
  return out;
}

const BONE_DEFAULTS = {
  parent: null, use_connect: false, use_inherit_rotation: true, inherit_scale: 'FULL', use_local_location: true,
  use_deform: true, bbone_segments: 1,
};

const POSE_DEFAULTS = {
  location: [0, 0, 0], rotation_mode: 'QUATERNION', rotation_quaternion: [1, 0, 0, 0], rotation_euler: [0, 0, 0],
  rotation_axis_angle: [0, 0, 1, 0], scale: [1, 1, 1], constraints: [],
};

const OBJECT_DEFAULTS = {
  type: 'EMPTY', parent: null, parent_type: 'OBJECT', parent_bone: null, matrix_parent_inverse: null,
  location: [0, 0, 0], rotation_mode: 'XYZ', rotation_quaternion: [1, 0, 0, 0], rotation_euler: [0, 0, 0],
  rotation_axis_angle: [0, 0, 1, 0], scale: [1, 1, 1], constraints: [],
};

// The four rotation values a basis kernel reads for a rotation mode (m4.js composeBasis).
export function rotationValues(p) {
  const mode = p.rotation_mode;
  if (mode === 'QUATERNION') return p.rotation_quaternion;
  if (mode === 'AXIS_ANGLE') return p.rotation_axis_angle;
  return [...p.rotation_euler, 0];
}

export function rotationCode(mode) {
  if (!(mode in ROT)) throw new Error(`unknown rotation_mode ${mode}`);
  return ROT[mode];
}

// --- packed (typed array) mesh data and keyframes, and the canonical forms the runtime reads ---

const isTyped = (a) => ArrayBuffer.isView(a);
// Positions as one flat array (xyz per vertex): a Float32Array as given, or nested [[x, y, z]] flattened.
export const flatPositions = (v) => (isTyped(v) ? v : Float32Array.from((v ?? []).flat()));

// Faces as vertex index lists from { offsets, indices } (offsets: the start of each face, length faces + 1) or lists.
function facesOf(f) {
  if (!f || Array.isArray(f)) return f ?? [];
  const out = [];
  for (let i = 0; i + 1 < f.offsets.length; i++) out.push(Array.from(f.indices.subarray(f.offsets[i], f.offsets[i + 1])));
  return out;
}

function edgesOf(e) {
  if (!e || Array.isArray(e)) return e ?? [];
  const out = [];
  for (let i = 0; i < e.length; i += 2) out.push([e[i], e[i + 1]]);
  return out;
}

// A vertex group's weights, one per vertex: dense as given, or from sparse { indices, values }.
function denseWeights(g, n) {
  if (g.weights) return g.weights;
  const w = new Float32Array(n);
  for (let k = 0; k < g.indices.length; k++) w[g.indices[k]] = g.values[k];
  return w;
}

// Shape keys with every key's positions flat: the Basis as given; another key as given, or as the Basis plus its
// sparse offsets { indices (vertex), values (xyz per listed vertex) }.
function shapeKeysOf(sk, n) {
  if (!sk) return null;
  const blocks = sk.key_blocks.map((k) => ({ ...k }));
  const basis = flatPositions(blocks[0].co);
  blocks[0].co = basis;
  for (const k of blocks.slice(1)) {
    if (k.co) { k.co = flatPositions(k.co); continue; }
    const co = Float32Array.from(basis);
    const { indices, values } = k.offsets;
    for (let j = 0; j < indices.length; j++) for (let a = 0; a < 3; a++) co[indices[j] * 3 + a] += values[j * 3 + a];
    k.co = co;
    delete k.offsets;
  }
  return { ...sk, key_blocks: blocks };
}

// Keyframes from one Float32Array per curve (9 numbers per key: co x, y, handle_left x, y, handle_right x, y, back,
// amplitude, period) with per-key enum arrays (interpolation, easing, handle_left_type, handle_right_type).
const KEY_FIELDS = 9;
function keysOf(fc) {
  const k = fc.keyframe_points;
  if (!k || Array.isArray(k)) return fc;
  const d = k.data, n = d.length / KEY_FIELDS, out = [];
  for (let i = 0; i < n; i++) {
    const o = i * KEY_FIELDS;
    out.push({
      co: [d[o], d[o + 1]], handle_left: [d[o + 2], d[o + 3]], handle_right: [d[o + 4], d[o + 5]], back: d[o + 6],
      amplitude: d[o + 7], period: d[o + 8], interpolation: k.interpolation?.[i] ?? 'BEZIER', easing: k.easing?.[i] ?? 'AUTO',
      handle_left_type: k.handle_left_type?.[i], handle_right_type: k.handle_right_type?.[i],
    });
  }
  return { ...fc, keyframe_points: out };
}

function meshData(data) {
  const vertices = flatPositions(data.vertices), n = vertices.length / 3;
  return {
    ...data, vertices, faces: facesOf(data.faces), edges: edgesOf(data.edges),
    vertex_groups: (data.vertex_groups ?? []).map((g) => ({ name: g.name, weights: denseWeights(g, n) })),
    shape_keys: shapeKeysOf(data.shape_keys, n),
  };
}

export function normalize(desc) {
  if (desc.schema && desc.schema !== SCHEMA) throw new Error(`not a ${SCHEMA} description: ${desc.schema}`);
  if ((desc.version ?? VERSION) > VERSION) throw new Error(`${SCHEMA} version ${desc.version} is newer than ${VERSION}`);
  const objects = (desc.objects ?? []).map((o) => {
    const ob = { ...OBJECT_DEFAULTS, ...o };
    ob.matrix_parent_inverse = o.matrix_parent_inverse ? fromRows(o.matrix_parent_inverse) : null;
    ob.matrix_basis = o.matrix_basis ? fromRows(o.matrix_basis) : null;
    if (ob.type === 'ARMATURE') {
      const pose = Object.fromEntries((o.pose?.bones ?? []).map((p) => [p.name, p]));
      ob.bones = (o.data?.bones ?? []).map((b) => {
        const bone = { ...BONE_DEFAULTS, ...b, matrix_local: fromRows(b.matrix_local) };
        if (bone.length == null) throw new Error(`bone ${b.name}: length is required`);
        bone.pose = { ...POSE_DEFAULTS, ...pose[b.name] };
        return bone;
      });
    }
    // A lattice's points double as vertices so its own modifiers can deform them.
    if (ob.type === 'LATTICE' && ob.data?.points) ob.data = meshData({ ...ob.data, vertices: ob.data.vertices ?? ob.data.points.map((p) => p.co_deform ?? p.co) });
    if (ob.type === 'MESH' && ob.data?.vertices) ob.data = meshData(ob.data);
    return ob;
  });
  return { schema: SCHEMA, version: VERSION, objects, drivers: (desc.drivers ?? []).map(keysOf), actions: (desc.actions ?? []).map((a) => ({ ...a, fcurves: (a.fcurves ?? []).map(keysOf) })), scene: desc.scene ?? {}, view_layer: desc.view_layer ?? {} };
}
