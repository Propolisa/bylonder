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

// The active element (ColorBand.cur), kept by the ramp as Blender's DNA keeps it.
export const activeElement = (ramp) => Math.min(ramp.cur ?? 0, ramp.elements.length - 1);
const MAXCOLORBAND = 32;
// BKE_colorband_update_sort: elements in position order, the active one still active.
function sortElements(ramp) {
  const active = ramp.elements[activeElement(ramp)];
  ramp.elements.sort((a, b) => a.position - b.position);
  ramp.cur = ramp.elements.indexOf(active);
}
// colorband_add_cb: a new element halfway to the active one's neighbor, its color the ramp's there, made active.
export function addElement(ramp) {
  if (ramp.elements.length >= MAXCOLORBAND) return;
  sortElements(ramp);
  const cur = activeElement(ramp), { elements } = ramp;
  const position = elements.length > 1 ? (elements[cur > 0 ? cur - 1 : cur + 1].position + elements[cur].position) / 2 : elements[0].position;
  // port-override: BKE_colorband_evaluate at the position, read from the ramp's table (257 samples, linear between them).
  const table = colorRampTable(ramp), at = Math.min(Math.max(position, 0), 1) * (TABLE_SIZE - 1), i = Math.min(Math.floor(at), TABLE_SIZE - 2), t = at - i;
  const color = [0, 1, 2, 3].map((k) => table[i * 4 + k] * (1 - t) + table[(i + 1) * 4 + k] * t);
  elements.push({ position, color });
  ramp.cur = elements.length - 1;
  sortElements(ramp);
}
// BKE_colorband_element_remove: the active element, the one before it made active.
export function removeElement(ramp) {
  if (ramp.elements.length < 2) return;
  const cur = activeElement(ramp);
  ramp.elements.splice(cur, 1);
  ramp.cur = Math.max(0, cur - 1);
}
// An element's position set, as RNA's ColorRampElement.position does (clamped, then sorted).
export function setElementPosition(ramp, index, position) {
  ramp.elements[index].position = Math.min(Math.max(position, 0), 1);
  ramp.cur = index;
  sortElements(ramp);
}
