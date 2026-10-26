// BMesh (bmesh_class.hh) in typed arrays: an element is an index into its pool, and a field is an array on the
// pool, so `l->radial_next` is `bm.l.radial_next[l]`. Pools reuse freed slots last-in first-out and iterate in slot
// order, like BLI_mempool, so element order matches Blender's.
export const BM_VERT = 1, BM_EDGE = 2, BM_LOOP = 4, BM_FACE = 8;

// eBM_elem_hflag
export const BM_ELEM_SELECT = 1 << 0, BM_ELEM_HIDDEN = 1 << 1, BM_ELEM_SEAM = 1 << 2, BM_ELEM_SMOOTH = 1 << 3,
  BM_ELEM_TAG = 1 << 4, BM_ELEM_DRAW = 1 << 5, BM_ELEM_TAG_ALT = 1 << 6, BM_ELEM_INTERNAL_TAG = 1 << 7;

// Internal api flags (bmesh_private.hh).
export const _FLAG_JF = 1 << 0, _FLAG_MF = 1 << 1, _FLAG_MV = 1 << 1, _FLAG_OVERLAP = 1 << 2, _FLAG_WALK = 1 << 3,
  _FLAG_ELEM_CHECK = 1 << 4;

const FIELDS = {
  v: { co: [Float32Array, 3], no: [Float32Array, 3], e: [Int32Array, 1], hflag: [Uint8Array, 1], api_flag: [Uint8Array, 1], oflag: [Uint16Array, 1], index: [Int32Array, 1] },
  e: { v1: [Int32Array, 1], v2: [Int32Array, 1], l: [Int32Array, 1], v1_disk_next: [Int32Array, 1], v1_disk_prev: [Int32Array, 1], v2_disk_next: [Int32Array, 1], v2_disk_prev: [Int32Array, 1], hflag: [Uint8Array, 1], api_flag: [Uint8Array, 1], oflag: [Uint16Array, 1], index: [Int32Array, 1] },
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

// CustomData layer on a pool (CD_PROP_FLOAT2 UV maps and the like), one value of `size` numbers per element.
export function poolLayerAdd(pool, name, Type, size, defaultValue = new Array(size).fill(0)) {
  const layer = { name, size, default: defaultValue, data: new Type(pool.capacity * size) };
  for (let i = 0; i < pool.size; i++) layer.data.set(defaultValue, i * size);
  pool.layers.push(layer);
  return layer;
}

export const poolLayer = (pool, name) => pool.layers.find((layer) => layer.name === name);

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
    act_face: -1,
    selectmode: 1,
  };
}

// BM_ITER_MESH: live elements of a pool in slot order. The callback may kill the element it is given.
export function BM_ITER_MESH(pool, fn) {
  for (let i = 0, n = pool.size; i < n; i++) if (pool.alive[i]) fn(i);
}

export const BM_elem_flag_test = (pool, i, flag) => (pool.hflag[i] & flag) !== 0;
export const BM_elem_flag_enable = (pool, i, flag) => { pool.hflag[i] |= flag; };
export const BM_elem_flag_disable = (pool, i, flag) => { pool.hflag[i] &= ~flag; };
export const BM_ELEM_API_FLAG_TEST = (pool, i, flag) => (pool.api_flag[i] & flag) !== 0;
export const BM_ELEM_API_FLAG_ENABLE = (pool, i, flag) => { pool.api_flag[i] |= flag; };
export const BM_ELEM_API_FLAG_DISABLE = (pool, i, flag) => { pool.api_flag[i] &= ~flag; };

// BMO tool flags (bmesh_operator_api.hh).
// BM_elem_flag_merge_ex: both elements get the union of their flags, keeping `hflag_and` only where both had it.
export function BM_elem_flag_merge_ex(pool_a, a, pool_b, b, hflag_and) {
  if (!(pool_a.hflag[a] & pool_b.hflag[b] & hflag_and)) { pool_a.hflag[a] &= ~hflag_and; pool_b.hflag[b] &= ~hflag_and; }
  pool_a.hflag[a] = pool_b.hflag[b] = pool_a.hflag[a] | pool_b.hflag[b];
}
export const BMO_flag_test = (pool, i, flag) => (pool.oflag[i] & flag) !== 0;
export const BMO_flag_enable = (pool, i, flag) => { pool.oflag[i] |= flag; };
export const BMO_flag_disable = (pool, i, flag) => { pool.oflag[i] &= ~flag; };
