// Shims for blenkernel/customdata.js: export a Blender name here to replace its generated port.
// port-override: BMesh CustomData is a pool's layers (bmesh-class.js), not C blocks. A CustomData is the pool, an
// offset is the index of a layer in pool.layers (sorted by type, like Blender's), and an element's block is the element.
import {
  CD_PROP_BOOL, CD_PROP_BYTE_COLOR, CD_PROP_COLOR, CD_PROP_FLOAT, CD_PROP_FLOAT2, CD_PROP_FLOAT3, CD_PROP_FLOAT4, CD_PROP_INT16_2D,
  CD_PROP_INT32, CD_PROP_INT32_2D, CD_PROP_INT8, CD_PROP_QUATERNION,
} from '../makesdna/customdata-types.js';

const sum = (round) => (layer, sources, weights, dst) => {
  const { data, size } = layer;
  for (let c = 0; c < size; c++) {
    let result = 0;
    for (let i = 0; i < sources.length; i++) result = Math.fround(result + Math.fround(data[sources[i] * size + c] * weights[i]));
    data[dst * size + c] = round ? round(result) : result;
  }
};
const any = (layer, sources, weights, dst) => {
  layer.data[dst] = sources.some((s, i) => layer.data[s] && weights[i] > 0) ? 1 : 0;
};
const round = (x) => Math.sign(x) * Math.round(Math.abs(x)); // C's round(): halves away from zero.
const uchar = (x) => Math.min(255, Math.max(0, Math.round(x)));

// LAYERTYPEINFO: storage, numbers per element, default (zeros unless given), interp (layerInterp_*), and `math`
// where Blender's type has equal, add, multiply, initminmax and dominmax.
export const LAYER_TYPES = {
  [CD_PROP_FLOAT]: { Type: Float32Array, size: 1, interp: sum() },
  [CD_PROP_INT32]: { Type: Int32Array, size: 1, interp: sum(round) },
  [CD_PROP_BYTE_COLOR]: { Type: Uint8Array, size: 4, interp: sum(uchar), math: true, default: [255, 255, 255, 255] },
  [CD_PROP_INT16_2D]: { Type: Int16Array, size: 2 },
  [CD_PROP_FLOAT4]: { Type: Float32Array, size: 4, interp: sum() },
  [CD_PROP_INT8]: { Type: Int8Array, size: 1 },
  [CD_PROP_INT32_2D]: { Type: Int32Array, size: 2 },
  [CD_PROP_COLOR]: { Type: Float32Array, size: 4, interp: sum(), math: true, default: [1, 1, 1, 1] },
  [CD_PROP_FLOAT3]: { Type: Float32Array, size: 3, interp: sum() },
  [CD_PROP_FLOAT2]: { Type: Float32Array, size: 2, interp: sum(), math: true },
  [CD_PROP_BOOL]: { Type: Uint8Array, size: 1, interp: any },
  [CD_PROP_QUATERNION]: { Type: Float32Array, size: 4, default: [1, 0, 0, 0] },
};

export const CustomData_get_layer_index = (data, type) => data.layers.findIndex((l) => l.type === type);
export const CustomData_get_named_layer_index = (data, type, name) => data.layers.findIndex((l) => l.type === type && l.name === name);
export const CustomData_get_n_offset = (data, type, n) => {
  const first = CustomData_get_layer_index(data, type);
  return first === -1 || data.layers[first + n]?.type !== type ? -1 : first + n;
};
export const CustomData_get_offset = (data, type) => CustomData_get_layer_index(data, type);
export const CustomData_get_offset_named = CustomData_get_named_layer_index;
export const CustomData_has_layer = (data, type) => CustomData_get_layer_index(data, type) !== -1;
export const CustomData_has_layer_named = (data, type, name) => CustomData_get_named_layer_index(data, type, name) !== -1;
export const CustomData_number_of_layers = (data, type) => data.layers.filter((l) => l.type === type).length;
export const CustomData_layer_has_math = (data, layer_n) => Boolean(LAYER_TYPES[data.layers[layer_n].type].math);

// Interpolates every layer with an interp from src_blocks into dst_block; no weights averages.
export function CustomData_bmesh_interp(data, src_blocks, weights, count, dst_block) {
  if (count <= 0) return;
  const sources = src_blocks.slice(0, count);
  weights ??= new Array(count).fill(Math.fround(1 / count));
  for (const layer of data.layers) LAYER_TYPES[layer.type].interp?.(layer, sources, weights, dst_block);
}

export function CustomData_bmesh_copy_block(data, src_block, dst_block) {
  for (const { data: values, size } of data.layers) values.copyWithin(dst_block * size, src_block * size, src_block * size + size);
}

export function CustomData_bmesh_set_default(data, block) {
  for (const layer of data.layers) layer.data.set(layer.default, block * layer.size);
}

// Blocks are pool slots, freed with their element.
export function CustomData_bmesh_free_block() {}

// The element's values in the n-th layer of type, as a view that writes through, or null.
export function CustomData_bmesh_get_n(data, block, type, n) {
  const offset = CustomData_get_n_offset(data, type, n);
  if (offset === -1) return null;
  const { data: values, size } = data.layers[offset];
  return values.subarray(block * size, block * size + size);
}
export const CustomData_bmesh_get = (data, block, type) => CustomData_bmesh_get_n(data, block, type, 0);

export * from './customdata.gen.js';
