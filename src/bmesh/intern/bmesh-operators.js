// Shims for bmesh/intern/bmesh-operators.js: export a Blender name here to replace its generated port.
// port-override: BMO slots hold JS values instead of C unions: numbers and vectors as is, element buffers as element
// indices with their types (BM_VERT, BM_EDGE, BM_FACE) alongside, mappings as Maps keyed by element.
import {
  BMO_OP_SLOT_ELEMENT_BUF, BMO_OP_SLOT_INT, BMO_OP_SLOT_MAPPING, BMO_OP_SLOT_SUBTYPE_INT_ENUM, BMO_OP_SLOT_SUBTYPE_INT_FLAG,
  BMO_OP_SLOT_VEC, BMO_OPTYPE_FLAG_NORMALS_CALC, BMO_OPTYPE_FLAG_SELECT_FLUSH, BMO_OPTYPE_FLAG_SELECT_VALIDATE,
  BMO_FLAG_RESPECT_HIDE,
  BMO_ERROR_CANCEL, // Not used here: importing it has the generator write it, for the editors' EDBM_op_finish.
} from './bmesh-operators.gen.js';
import * as opdefines from './bmesh-opdefines.js';
import { BM_VERT, BM_EDGE, BM_FACE, BM_ELEM_HIDDEN, BM_ELEM_SELECT, BM_ITER_MESH, BM_elem_flag_test, BM_elem_flag_enable, BM_elem_flag_disable } from './bmesh-class.js';
import { BM_mesh_normals_update } from './bmesh-mesh-normals.js';
import { BM_mesh_select_mode_flush, BM_elem_select_set } from './bmesh-marking.js';

const POOLS = [[BM_VERT, 'v'], [BM_EDGE, 'e'], [BM_FACE, 'f']];
const pool_of = (htype) => POOLS.find(([t]) => t === htype)[1];

// Tool flags: one layer per running operator, so a nested operator never sees or clears its caller's flags.
export function BMO_push(bm) {
  bm.toolflag_index = (bm.toolflag_index ?? -1) + 1;
  bm.toolflag_stack ??= [];
  bm.toolflag_stack.push(POOLS.map(([, name]) => bm[name].oflag));
  for (const [, name] of POOLS) bm[name].oflag = new Uint16Array(bm[name].oflag.length);
}

export function BMO_pop(bm) {
  const saved = bm.toolflag_stack.pop();
  POOLS.forEach(([, name], i) => {
    // The pool may have grown during the operator; the caller's layer grows with it.
    const layer = new Uint16Array(bm[name].oflag.length);
    layer.set(saved[i]);
    bm[name].oflag = layer;
  });
  bm.toolflag_index--;
}

// bmo_call: runs a hand-ported operator function, which takes its inputs as arguments, inside its own flag layer.
export function bmo_call(bm, exec, ...args) {
  BMO_push(bm);
  try {
    return exec(bm, ...args);
  } finally {
    BMO_pop(bm);
  }
}

// The generated operator definitions (the manifest roots name which), in place of Blender's bmo_opdefines array.
let defs;
const bmo_opdefines = () => (defs ??= Object.values(opdefines).filter((def) => typeof def?.opname === 'string'));
export const BMO_opcode_from_opname = (opname) => bmo_opdefines().findIndex((def) => def.opname === opname);

function slots_init(slot_types) {
  const slots = {};
  for (const type of slot_types) {
    if (!type.type) break;
    const slot = { slot_name: type.name, slot_type: type.type, slot_subtype: type.subtype, len: 0, data: null, types: null };
    if (type.type === BMO_OP_SLOT_MAPPING) slot.data = new Map();
    else if (type.type === BMO_OP_SLOT_INT && [BMO_OP_SLOT_SUBTYPE_INT_ENUM, BMO_OP_SLOT_SUBTYPE_INT_FLAG].includes(type.subtype.intg)) {
      slot.enum_flags = type.enum_flags;
      slot.data = type.enum_flags[0].value; // The first value of the enum is the default.
    } else if (type.type === BMO_OP_SLOT_ELEMENT_BUF) {
      slot.data = [];
      slot.types = [];
    } else slot.data = type.type === BMO_OP_SLOT_VEC ? [0, 0, 0] : 0;
    slots[type.name] = slot;
  }
  return slots;
}

// The operator, which Blender's fills in through its argument.
export function BMO_op_init(bm, flag, opname) {
  const opcode = Math.max(BMO_opcode_from_opname(opname), 0);
  const def = bmo_opdefines()[opcode];
  const op = { type: opcode, type_flag: def.type_flag, flag, slots_in: slots_init(def.slot_types_in), slots_out: slots_init(def.slot_types_out), exec: def.exec };
  def.init?.(op);
  return op;
}

export function BMO_op_exec(bm, op) {
  BMO_push(bm);
  op.exec(bm, op);
  if (bm.toolflag_index === 0) bmesh_edit_end(bm, op.type_flag);
  BMO_pop(bm);
}

// bmesh_edit_end: the normals and selection an operator's type asks to be brought up to date.
function bmesh_edit_end(bm, type_flag) {
  if (type_flag & BMO_OPTYPE_FLAG_NORMALS_CALC) BM_mesh_normals_update(bm);
  const history = bm.selected;
  if (!(type_flag & BMO_OPTYPE_FLAG_SELECT_VALIDATE)) bm.selected = [];
  if (type_flag & BMO_OPTYPE_FLAG_SELECT_FLUSH) BM_mesh_select_mode_flush(bm);
  if (!(type_flag & BMO_OPTYPE_FLAG_SELECT_VALIDATE)) bm.selected = history;
}

// Slot buffers and maps are garbage collected.
export function BMO_op_finish(_bm, _op) {}

export const BMO_op_initf = (bm, flag, fmt, ...args) => BMO_op_vinitf(bm, flag, fmt, args);

export function BMO_op_callf(bm, flag, fmt, ...args) {
  const op = BMO_op_vinitf(bm, flag, fmt, args);
  if (!op) return false;
  BMO_op_exec(bm, op);
  BMO_op_finish(bm, op);
  return true;
}

// BMO_op_vinitf: the operator "opname slot=%f other=%hv ..." names, its input slots set from args as Blender's format
// codes say; null for an unknown operator.
export function BMO_op_vinitf(bm, flag, fmt, args) {
  const [opname, ...assignments] = fmt.trim().split(/\s+/);
  if (BMO_opcode_from_opname(opname) === -1) return null;
  const op = BMO_op_init(bm, flag, opname);
  const next = () => args.shift();
  for (const assignment of assignments) {
    const [, name, code] = assignment.match(/^([^=]+)=%(.+)$/);
    const slot = BMO_slot_get(op.slots_in, name);
    const [type, rest] = [code[0], code.slice(1)];
    const htype = [...rest].reduce((t, c) => t | ({ v: BM_VERT, e: BM_EDGE, f: BM_FACE }[c] ?? 0), 0);
    if (type === 'm') BMO_slot_mat_set(op, op.slots_in, name, next(), Number(rest));
    else if (type === 'v') BMO_slot_vec_set(op.slots_in, name, next());
    else if (type === 'e' && rest === 'b') BMO_slot_buffer_from_array(op, slot, next(), next());
    else if (type === 'e') BMO_slot_buffer_from_single(op, slot, next());
    else if (type === 's' || type === 'S') {
      const other = next();
      BMO_slot_copy(other, type === 's' ? 'slots_in' : 'slots_out', next(), op, 'slots_in', name);
    } else if (type === 'i') BMO_slot_int_set(op.slots_in, name, next());
    else if (type === 'b') BMO_slot_bool_set(op.slots_in, name, next());
    else if (type === 'p') BMO_slot_ptr_set(op.slots_in, name, next());
    else if (type === 'f' && !rest) BMO_slot_float_set(op.slots_in, name, next());
    else if (type === 'h') BMO_slot_buffer_from_enabled_hflag(bm, op, op.slots_in, name, htype, next());
    else if (type === 'H') BMO_slot_buffer_from_disabled_hflag(bm, op, op.slots_in, name, htype, next());
    else if (type === 'a') {
      if (op.flag & BMO_FLAG_RESPECT_HIDE) BMO_slot_buffer_from_disabled_hflag(bm, op, op.slots_in, name, htype, BM_ELEM_HIDDEN);
      else BMO_slot_buffer_from_all(bm, op, op.slots_in, name, htype);
    } else if (type === 'f') BMO_slot_buffer_from_enabled_flag(bm, op, op.slots_in, name, htype, next());
    else if (type === 'F') BMO_slot_buffer_from_disabled_flag(bm, op, op.slots_in, name, htype, next());
  }
  return op;
}

export const BMO_slot_get = (slot_args, identifier) => slot_args[identifier];
export const BMO_slot_exists = (slot_args, identifier) => identifier in slot_args;

export const BMO_slot_float_get = (slot_args, name) => slot_args[name].data;
export const BMO_slot_int_get = BMO_slot_float_get;
export const BMO_slot_bool_get = (slot_args, name) => Boolean(slot_args[name].data);
export const BMO_slot_ptr_get = BMO_slot_float_get;
export const BMO_slot_vec_get = (slot_args, name) => [...slot_args[name].data];
export const BMO_slot_mat4_get = (slot_args, name) => slot_args[name].data?.map((c) => [...c]) ?? null;
export const BMO_slot_mat3_get = (slot_args, name) => slot_args[name].data?.slice(0, 3).map((c) => c.slice(0, 3)) ?? null;

const set = (slot_args, name, value) => { slot_args[name].data = value; };
export const BMO_slot_float_set = set;
export const BMO_slot_int_set = set;
export const BMO_slot_bool_set = (slot_args, name, value) => set(slot_args, name, Boolean(value));
export const BMO_slot_ptr_set = set;
export const BMO_slot_vec_set = (slot_args, name, vec) => set(slot_args, name, [...vec].slice(0, 3));
// A 3x3 matrix is stored as 4x4, as Blender does.
export function BMO_slot_mat_set(op, slot_args, name, mat, size) {
  const m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let c = 0; c < size; c++) for (let r = 0; r < size; r++) m[c][r] = mat[c][r];
  set(slot_args, name, m);
}

// Element buffers.
function buffer_set(slot, elems, types) {
  slot.data = elems;
  slot.types = types;
  slot.len = elems.length;
}
export const BMO_slot_buffer_len = (slot_args, name) => slot_args[name].len;
export const BMO_slot_buffer_alloc = (op, slot_args, name, len) => buffer_set(slot_args[name], new Array(len).fill(-1), new Array(len).fill(0));
export const BMO_slot_buffer_get_single = (slot) => (slot.len ? slot.data[0] : -1);
// The element type of a single-type buffer slot (its subtype also carries flags such as ELEM_IS_SINGLE).
const slot_htype = (slot) => slot.slot_subtype.elem & (BM_VERT | BM_EDGE | BM_FACE);
export const BMO_slot_buffer_from_single = (op, slot, ele) => buffer_set(slot, [ele], [slot_htype(slot)]);
export const BMO_slot_buffer_from_array = (op, slot, elems, len) => buffer_set(slot, elems.slice(0, len), new Array(len).fill(slot_htype(slot)));

// Elements of the types in htype for which test(pool, element) holds, verts first, then edges, then faces.
function buffer_from(bm, slot, htype, test) {
  const elems = [], types = [];
  for (const [type, name] of POOLS) {
    if (!(htype & type)) continue;
    BM_ITER_MESH(bm[name], (ele) => { if (test(bm[name], ele)) { elems.push(ele); types.push(type); } });
  }
  buffer_set(slot, elems, types);
}
export const BMO_slot_buffer_from_all = (bm, op, slot_args, name, htype) => buffer_from(bm, slot_args[name], htype, () => true);
export const BMO_slot_buffer_from_enabled_hflag = (bm, op, slot_args, name, htype, hflag) => buffer_from(bm, slot_args[name], htype, (pool, e) => BM_elem_flag_test(pool, e, hflag));
export const BMO_slot_buffer_from_disabled_hflag = (bm, op, slot_args, name, htype, hflag) => buffer_from(bm, slot_args[name], htype, (pool, e) => !BM_elem_flag_test(pool, e, hflag));
export const BMO_slot_buffer_from_enabled_flag = (bm, op, slot_args, name, htype, oflag) => buffer_from(bm, slot_args[name], htype, (pool, e) => (pool.oflag[e] & oflag) !== 0);
export const BMO_slot_buffer_from_disabled_flag = (bm, op, slot_args, name, htype, oflag) => buffer_from(bm, slot_args[name], htype, (pool, e) => (pool.oflag[e] & oflag) === 0);

// Each element of the slot's buffer whose type is in htype.
function each_buffered(bm, slot, htype, fn) {
  for (let i = 0; i < slot.len; i++) if (slot.types[i] & htype) fn(bm[pool_of(slot.types[i])], slot.data[i], slot.types[i]);
}
export function BMO_slot_buffer_hflag_enable(bm, slot_args, name, htype, hflag, do_flush) {
  each_buffered(bm, slot_args[name], htype, (pool, e, type) => {
    if (do_flush && (hflag & BM_ELEM_SELECT)) BM_elem_select_set(bm, type, e, true);
    BM_elem_flag_enable(pool, e, hflag);
  });
}
export function BMO_slot_buffer_hflag_disable(bm, slot_args, name, htype, hflag, do_flush) {
  each_buffered(bm, slot_args[name], htype, (pool, e, type) => {
    if (do_flush && (hflag & BM_ELEM_SELECT)) BM_elem_select_set(bm, type, e, false);
    BM_elem_flag_disable(pool, e, hflag);
  });
}
export const BMO_slot_buffer_flag_enable = (bm, slot_args, name, htype, oflag) => each_buffered(bm, slot_args[name], htype, (pool, e) => { pool.oflag[e] |= oflag; });
export const BMO_slot_buffer_flag_disable = (bm, slot_args, name, htype, oflag) => each_buffered(bm, slot_args[name], htype, (pool, e) => { pool.oflag[e] &= ~oflag; });

// Copies a slot between operators; buffers and maps are copied, not shared.
export function BMO_slot_copy(op_src, slots_src, name_src, op_dst, slots_dst, name_dst) {
  const src = op_src[slots_src][name_src], dst = op_dst[slots_dst][name_dst];
  if (src === dst) return;
  if (dst.slot_type === BMO_OP_SLOT_ELEMENT_BUF) buffer_set(dst, [...src.data], [...src.types]);
  else if (dst.slot_type === BMO_OP_SLOT_MAPPING) dst.data = new Map(src.data);
  else dst.data = Array.isArray(src.data) ? structuredClone(src.data) : src.data;
}

// Mappings.
export const BMO_slot_map_len = (slot) => slot.data.size;
export const BMO_slot_map_contains = (slot, element) => slot.data.has(element);
export const BMO_slot_map_data_get = (slot, element) => slot.data.get(element) ?? null;
export const BMO_slot_map_elem_get = (slot, element) => slot.data.get(element) ?? -1;
export const BMO_slot_map_float_get = (slot, element) => slot.data.get(element) ?? 0;
export const BMO_slot_map_int_get = BMO_slot_map_float_get;
export const BMO_slot_map_bool_get = (slot, element) => Boolean(slot.data.get(element));
export const BMO_slot_map_ptr_get = BMO_slot_map_data_get;
const map_insert = (op, slot, element, value) => { slot.data.set(element, value); };
export const BMO_slot_map_insert = map_insert;
export const BMO_slot_map_elem_insert = map_insert;
export const BMO_slot_map_float_insert = map_insert;
export const BMO_slot_map_int_insert = map_insert;
export const BMO_slot_map_bool_insert = map_insert;
export const BMO_slot_map_ptr_insert = map_insert;
export const BMO_slot_map_empty_insert = (op, slot, element) => map_insert(op, slot, element, null);
export function BMO_slot_map_to_flag(bm, slot_args, name, htype, oflag) {
  for (const element of slot_args[name].data.keys()) for (const [type, pool] of POOLS) if (htype & type) bm[pool].oflag[element] |= oflag;
}

// Iterators: a buffer gives its elements whose type is in restrictmask, a map its keys.
export function BMO_iter_new(iter, slot_args, name, restrictmask) {
  const slot = slot_args[name];
  Object.assign(iter, { slot, restrictmask, cur: 0, val: null });
  iter.keys = slot.slot_type === BMO_OP_SLOT_MAPPING ? [...slot.data.keys()] : null;
  return BMO_iter_step(iter);
}

export function BMO_iter_step(iter) {
  const { slot } = iter;
  if (iter.keys) {
    if (iter.cur >= iter.keys.length) return -1;
    const key = iter.keys[iter.cur++];
    iter.val = slot.data.get(key);
    return key;
  }
  while (iter.cur < slot.len) {
    const i = iter.cur++;
    if (!iter.restrictmask || slot.types[i] & iter.restrictmask) return slot.data[i];
  }
  return -1;
}

export const BMO_iter_map_value_ptr = (iter) => iter.val;
export const BMO_iter_map_value_float = (iter) => iter.val ?? 0;
export const BMO_iter_map_value_int = BMO_iter_map_value_float;
export const BMO_iter_map_value_bool = (iter) => Boolean(iter.val);

export function BMO_iter_as_array(slot_args, name, restrictmask, _array, len) {
  const out = [], iter = {};
  for (let e = BMO_iter_new(iter, slot_args, name, restrictmask); e >= 0 && out.length < len; e = BMO_iter_step(iter)) out.push(e);
  return out;
}

// Errors: operators report them to the caller, which may cancel.
export function BMO_error_raise(bm, owner, level, msg) {
  (bm.errorstack ??= []).push({ op: owner, level, msg });
}
export const BMO_error_occurred_at_level = (bm, level) => (bm.errorstack ?? []).some((e) => e.level >= level);
export const BMO_error_pop = (bm) => bm.errorstack?.pop() ?? null;

export const BMO_FLAG_DEFAULTS = BMO_FLAG_RESPECT_HIDE;
export * from './bmesh-operators.gen.js';
