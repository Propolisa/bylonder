// Blender's curve mapping (CurveMapping) by its RNA names, and what Blender's GPU code links of it and of the spectrum
// tables (BKE_curvemapping_table_RGBA and its parameters, IMB_colormanagement_*_table, in the module).
import { blenderModule } from '../bmesh/bmesh-wasm.js';

const { exports: x, withArrays } = blenderModule;

// DNA_color_types.h: the handle types' point flags, and the mapping's flags.
const HANDLE_FLAGS = { AUTO: 0, VECTOR: 1 << 1, AUTO_CLAMPED: 1 << 2 };
const CUMA_DO_CLIP = 1 << 0, CUMA_EXTEND_EXTRAPOLATE = 1 << 4;
const CURVES = 4, TABLE_TEXELS = 1024;

// BKE_curvemapping_add: `count` curves, each a line from the clipping rectangle's corner to its opposite.
export function defaultCurveMapping(count, [min, max]) {
  return { use_clip: true, extend: 'EXTRAPOLATED', clip: [min, min, max, max],
    curves: Array.from({ length: count }, () => [{ location: [min, min], handle_type: 'AUTO' }, { location: [max, max], handle_type: 'AUTO' }]) };
}

// A CurveMapping of RNA (a node's mapping) as plain data.
export const plainCurveMapping = (mapping) => ({
  use_clip: mapping.use_clip, extend: mapping.extend, clip: [mapping.clip_min_x, mapping.clip_min_y, mapping.clip_max_x, mapping.clip_max_y],
  curves: [...mapping.curves].map((curve) => [...curve.points].map((p) => ({ location: [...p.location], handle_type: p.handle_type }))),
});

// The table and parameters gpu_shader_curve_* link: { table (RGBA texels), minimums, dividers, startSlopes, endSlopes,
// identity } with a value per curve (R, G, B and combined; a vector's X, Y, Z; a float's one first).
export function curveMappingGPU(mapping) {
  const curves = Array.from({ length: CURVES }, (_, i) => mapping.curves[i] ?? mapping.curves[0]);
  const points = Float32Array.from(curves.flatMap((curve) => curve.flatMap((p) => [...p.location, HANDLE_FLAGS[p.handle_type] ?? 0])));
  const counts = Int32Array.from(curves, (curve) => curve.length);
  const flag = (mapping.use_clip ? CUMA_DO_CLIP : 0) | (mapping.extend === 'EXTRAPOLATED' ? CUMA_EXTEND_EXTRAPOLATE : 0);
  return withArrays([points, counts, Float32Array.from(mapping.clip), new Float32Array(TABLE_TEXELS * 4), new Float32Array(20)], ([p, c, clip, table, params]) => {
    const size = x.curvemapping_gpu(p, c, flag, clip, table, params);
    const read = (pointer, length) => new Float32Array(x.memory.buffer, pointer >>> 0, length).slice();
    const values = read(params, 20), at = (i) => Array.from(values.subarray(i * 4, i * 4 + 4));
    return { table: read(table, size * 4), minimums: at(0), dividers: at(1), startSlopes: at(2), endSlopes: at(3), identity: at(4).map(Boolean) };
  });
}

// CM_TABLE + 1 RGBA texels, as node_shader_gpu_blackbody and node_shader_gpu_wavelength sample them.
const spectrum = (fill) => withArrays([new Float32Array(257 * 4)], ([table]) => {
  fill(table);
  return new Float32Array(x.memory.buffer, table >>> 0, 257 * 4).slice();
});
let blackbody, wavelength;
export const blackbodyTable = () => (blackbody ??= spectrum(x.blackbody_table));
export const wavelengthTable = () => (wavelength ??= spectrum(x.wavelength_table));
