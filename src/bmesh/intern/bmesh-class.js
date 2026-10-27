// BMesh (bmesh_class.hh) in typed arrays: an element is an index into its pool, and a field is an array on the
// pool, so `l->radial_next` is `bm.l.radial_next[l]`. Pools reuse freed slots last-in first-out and iterate in slot
// order, like BLI_mempool, so element order matches Blender's.
const FIELDS = {
  v: { co: [Float32Array, 3], no: [Float32Array, 3], e: [Int32Array, 1], hflag: [Uint8Array, 1], api_flag: [Uint8Array, 1], oflag: [Uint16Array, 1], index: [Int32Array, 1] },
  e: { v1: [Int32Array, 1], v2: [Int32Array, 1], l: [Int32Array, 1], v1_disk_link_next: [Int32Array, 1], v1_disk_link_prev: [Int32Array, 1], v2_disk_link_next: [Int32Array, 1], v2_disk_link_prev: [Int32Array, 1], hflag: [Uint8Array, 1], api_flag: [Uint8Array, 1], oflag: [Uint16Array, 1], index: [Int32Array, 1] },
  l: { v: [Int32Array, 1], e: [Int32Array, 1], f: [Int32Array, 1], next: [Int32Array, 1], prev: [Int32Array, 1], radial_next: [Int32Array, 1], radial_prev: [Int32Array, 1], hflag: [Uint8Array, 1], api_flag: [Uint8Array, 1], index: [Int32Array, 1] },
  f: { l_first: [Int32Array, 1], len: [Int32Array, 1], no: [Float32Array, 3], mat_nr: [Int16Array, 1], hflag: [Uint8Array, 1], api_flag: [Uint8Array, 1], oflag: [Uint16Array, 1], index: [Int32Array, 1] },
};

function createPool(fields, capacity) {
  const pool = { size: 0, tot: 0, capacity, free: [], alive: new Uint8Array(capacity), layers: [] };
  for (const [name, [Type, n]] of Object.entries(fields)) pool[name] = new Type(capacity * n);
  pool.fields = Object.entries(fields).map(([name, [, n]]) => [name, n]);
  return pool;
}

function grow(pool) {
  const capacity = pool.capacity * 2;
  const resize = (array, n) => { const next = new array.constructor(capacity * n); next.set(array); return next; };
  for (const [name, n] of pool.fields) pool[name] = resize(pool[name], n);
  for (const layer of pool.layers) layer.data = resize(layer.data, layer.size);
  pool.alive = resize(pool.alive, 1);
  pool.capacity = capacity;
}

// BLI_mempool_alloc: a freed slot if there is one, else the next new slot. Fields are reset to their defaults.
export function poolAlloc(pool) {
  const i = pool.free.length ? pool.free.pop() : pool.size++;
  if (i >= pool.capacity) grow(pool);
  for (const [name, n] of pool.fields) pool[name].fill(0, i * n, i * n + n);
  for (const layer of pool.layers) layer.data.set(layer.default, i * layer.size);
  pool.alive[i] = 1;
  pool.tot++;
  return i;
}

export function poolFree(pool, i) {
  pool.alive[i] = 0;
  pool.free.push(i);
  pool.tot--;
}

// BM_mesh_create.
export function BM_mesh_create({ totvert = 64, totedge = 64, totloop = 256, totface = 64 } = {}) {
  return {
    v: createPool(FIELDS.v, Math.max(totvert, 8)),
    e: createPool(FIELDS.e, Math.max(totedge, 8)),
    l: createPool(FIELDS.l, Math.max(totloop, 8)),
    f: createPool(FIELDS.f, Math.max(totface, 8)),
    get totvert() { return this.v.tot; },
    get totedge() { return this.e.tot; },
    get totloop() { return this.l.tot; },
    get totface() { return this.f.tot; },
    // CustomData: each pool holds its own layers.
    get vdata() { return this.v; },
    get edata() { return this.e; },
    get ldata() { return this.l; },
    get pdata() { return this.f; },
    act_face: -1,
    selectmode: 1,
  };
}

// BM_ITER_MESH: live elements of a pool in slot order. The callback may kill the element it is given.
export function BM_ITER_MESH(pool, fn) {
  for (let i = 0, n = pool.size; i < n; i++) if (pool.alive[i]) fn(i);
}

// BM_DISK_EDGE_NEXT and BM_DISK_EDGE_PREV: around v's disk cycle from e.
export const BM_DISK_EDGE_NEXT = (bm, e, v) => (v === bm.e.v2[e] ? bm.e.v2_disk_link_next : bm.e.v1_disk_link_next)[e];
export const BM_DISK_EDGE_PREV = (bm, e, v) => (v === bm.e.v2[e] ? bm.e.v2_disk_link_prev : bm.e.v1_disk_link_prev)[e];

// v->co, v->no and f->no as [x, y, z] values.
export const vco = (bm, v) => [bm.v.co[v * 3], bm.v.co[v * 3 + 1], bm.v.co[v * 3 + 2]];
export const vno = (bm, v) => [bm.v.no[v * 3], bm.v.no[v * 3 + 1], bm.v.no[v * 3 + 2]];
export const fno = (bm, f) => [bm.f.no[f * 3], bm.f.no[f * 3 + 1], bm.f.no[f * 3 + 2]];

// BM_ELEM_CD_*: an element's value in the layer at `offset` (CustomData_get_offset); _P is a view that writes through.
export const BM_ELEM_CD_GET_FLOAT = (pool, i, offset) => pool.layers[offset].data[i];
export const BM_ELEM_CD_GET_INT = BM_ELEM_CD_GET_FLOAT;
export const BM_ELEM_CD_SET_FLOAT = (pool, i, offset, value) => { pool.layers[offset].data[i] = value; };
export function BM_ELEM_CD_GET_FLOAT_P(pool, i, offset) {
  const { data, size } = pool.layers[offset];
  return data.subarray(i * size, i * size + size);
}
export const BM_ELEM_CD_GET_VOID_P = BM_ELEM_CD_GET_FLOAT_P;

export const BM_elem_flag_test = (pool, i, flag) => pool.hflag[i] & flag;
export const BM_elem_flag_enable = (pool, i, flag) => { pool.hflag[i] |= flag; };
export const BM_elem_flag_disable = (pool, i, flag) => { pool.hflag[i] &= ~flag; };
export const BM_elem_flag_set = (pool, i, flag, value) => (value ? BM_elem_flag_enable : BM_elem_flag_disable)(pool, i, flag);
export const BM_ELEM_API_FLAG_TEST = (pool, i, flag) => pool.api_flag[i] & flag;
export const BM_ELEM_API_FLAG_ENABLE = (pool, i, flag) => { pool.api_flag[i] |= flag; };
export const BM_ELEM_API_FLAG_DISABLE = (pool, i, flag) => { pool.api_flag[i] &= ~flag; };

// BMO tool flags (bmesh_operator_api.hh).
// BM_elem_flag_merge_ex: both elements get the union of their flags, keeping `hflag_and` only where both had it.
export function BM_elem_flag_merge_ex(pool_a, a, pool_b, b, hflag_and) {
  if (!(pool_a.hflag[a] & pool_b.hflag[b] & hflag_and)) { pool_a.hflag[a] &= ~hflag_and; pool_b.hflag[b] &= ~hflag_and; }
  pool_a.hflag[a] = pool_b.hflag[b] = pool_a.hflag[a] | pool_b.hflag[b];
}
export const BMO_flag_test = (pool, i, flag) => pool.oflag[i] & flag;
export const BMO_flag_enable = (pool, i, flag) => { pool.oflag[i] |= flag; };
export const BMO_flag_disable = (pool, i, flag) => { pool.oflag[i] &= ~flag; };
export const BMO_flag_set = (pool, i, flag, value) => (value ? BMO_flag_enable : BMO_flag_disable)(pool, i, flag);

export * from './bmesh-class.gen.js';
