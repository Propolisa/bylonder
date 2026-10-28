// Blender's color ramp (ColorRamp, a ColorBand in DNA) by its RNA names, and its table as Blender's GPU code samples it
// (GPU_color_band over BKE_colorband_evaluate_table_rgba, in the module).
import { blenderModule } from '../bmesh/bmesh-wasm.js';

const { exports: x, withArrays } = blenderModule;

// DNA_colorband_types.h, in the enums' order.
const INTERPOLATIONS = ['LINEAR', 'EASE', 'B_SPLINE', 'CARDINAL', 'CONSTANT'];
const HUE_INTERPOLATIONS = ['NEAR', 'FAR', 'CW', 'CCW'];
const COLOR_MODES = ['RGB', 'HSV', 'HSL'];
export const TABLE_SIZE = 257;

// BKE_colorband_init: black to white.
export const defaultColorRamp = () => ({
  color_mode: 'RGB', interpolation: 'LINEAR', hue_interpolation: 'NEAR',
  elements: [{ position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }],
});

// A table as the half floats of the texture Blender's GPU code samples it from (SFLOAT_16_16_16_16), rounded to nearest.
export function halfFloats(values) {
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  return Uint16Array.from(values, (value) => {
    f32[0] = value;
    const x = u32[0], sign = (x >>> 16) & 0x8000, exponent = ((x >>> 23) & 0xff) - 127 + 15, mantissa = x & 0x7fffff;
    if (exponent >= 31) return sign | 0x7c00;
    if (exponent <= 0) return sign | (exponent < -10 ? 0 : Math.round((mantissa | 0x800000) / 2 ** (14 - exponent)));
    return (sign | (exponent << 10)) + Math.round(mantissa / 0x2000);
  });
}

// The ramp's 257 RGBA colors, its stops in position order as BKE_colorband_update_sort keeps them.
export function colorRampTable(ramp) {
  const stops = Float32Array.from([...ramp.elements].sort((a, b) => a.position - b.position).flatMap((e) => [...e.color, e.position]));
  return withArrays([stops, new Float32Array(TABLE_SIZE * 4)], ([p, table]) => {
    x.colorband_table(ramp.elements.length, p, INTERPOLATIONS.indexOf(ramp.interpolation), HUE_INTERPOLATIONS.indexOf(ramp.hue_interpolation),
      COLOR_MODES.indexOf(ramp.color_mode), table);
    return new Float32Array(x.memory.buffer, table, TABLE_SIZE * 4).slice();
  });
}
