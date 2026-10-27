// Shims for bmesh/intern/bmesh-interp.js: export a Blender name here to replace its generated port.
import { CustomData_get_named_layer_index, LAYER_TYPES } from '../../blenkernel/customdata.js';

// A new layer on the pool `data` (bm.vdata, bm.ldata...), after the layers of its type, holding its default for every
// element. Offsets of later layers move up by one, as in Blender.
export function BM_data_layer_add_named(bm, data, type, name) {
  const { Type, size, default: value = new Array(size).fill(0) } = LAYER_TYPES[type];
  const layer = { type, name, size, default: value, data: new Type(data.capacity * size) };
  for (let i = 0; i < data.size; i++) layer.data.set(value, i * size);
  const after = data.layers.findLastIndex((l) => l.type <= type);
  data.layers.splice(after + 1, 0, layer);
}

export const BM_data_layer_add = (bm, data, type) => BM_data_layer_add_named(bm, data, type, '');

export function BM_data_layer_ensure_named(bm, data, type, name) {
  if (CustomData_get_named_layer_index(data, type, name) === -1) BM_data_layer_add_named(bm, data, type, name);
}

export * from './bmesh-interp.gen.js';
