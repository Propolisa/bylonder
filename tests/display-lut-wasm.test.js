// Blender's display transform as Bylonder draws it (render/display-lut.js): the lattices the module evaluates with
// Blender's OpenColorIO processor (image-api.cc display_lut), sampled as their views sample them, give what Blender
// gives each pixel: a rendered view's log shaped lattice (display-transform.js) within an 8-bit step, darks included
// (Khronos PBR Neutral's toe, a corner, within a few), and Babylon's color grading lattice (sampled after its pow(1/2.2)
// encoding) within a few, for the view transforms a .blend most often has.
import assert from 'node:assert/strict';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct } from '../src/python/bpy_rna.js';
import { colorManagementFiles } from '../src/imbuf/colormanagement.js';
import { GRADING_SIZE, LOG_SIZE, STOPS } from '../src/render/display-lut.js';

await colorManagementFiles();
const blender = blenderMain(), settings = idStruct(blender.scene).view_settings;

// A lattice of `size` sampled trilinearly at a scene linear color, its shaper giving the lattice coordinate in [0, 1].
function sample({ rgba }, size, color, shaper) {
  const at = color.map((c) => Math.min(Math.max(shaper(c), 0), 1) * (size - 1));
  const lo = at.map((a) => Math.min(Math.floor(a), size - 2)), f = at.map((a, i) => a - lo[i]), out = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const d = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    const w = d.reduce((acc, bit, i) => acc * (bit ? f[i] : 1 - f[i]), 1), index = ((lo[2] + d[2]) * size + lo[1] + d[1]) * size + lo[0] + d[0];
    for (let c = 0; c < 3; c++) out[c] += w * rgba[index * 4 + c];
  }
  return out;
}

const darks = Array.from({ length: 64 }, (_, i) => 0.001 * 100 ** (i / 63));
const colors = [...darks.map((v) => [v, v, v]), ...darks.map((v) => [v, v * 0.4, v * 0.1]), [0.18, 0.18, 0.18], [0.8, 0.3, 0.05], [0.05, 0.2, 0.9], [2, 1.5, 1], [6, 6, 6]];
const steps = (lattice, size, shaper, exact) => 255 * Math.max(...colors.map((color, i) => Math.max(...sample(lattice, size, color, shaper).map((v, c) => Math.abs(v - exact[i * 3 + c])))));
for (const [view, look, rendered, grading] of [['Standard', 'None', 1, 1], ['Filmic', 'Medium High Contrast', 1, 2], ['AgX', 'None', 1, 2.5], ['Khronos PBR Neutral', 'None', 3.5, 12]]) {
  settings.view_transform = view;
  settings.look = look;
  const exact = blender.displayTransform(colors.flat());
  const log = blender.displayLut(LOG_SIZE, STOPS), pow = blender.displayLut(GRADING_SIZE, 0);
  const logError = steps(log, LOG_SIZE, (c) => Math.log2(Math.max(c / log.range, 1e-30)) / STOPS + 1, exact);
  const powError = steps(pow, GRADING_SIZE, (c) => (c / pow.range) ** (1 / 2.2), exact);
  assert.ok(logError < rendered, `${view} (${look}): a rendered view's lattice is within ${logError.toFixed(2)} 8-bit steps of Blender's`);
  assert.ok(powError < grading, `${view} (${look}): the color grading lattice is within ${powError.toFixed(2)} steps of Blender's`);
}
// The files fetched, image files still open through OpenImageIO, which keeps its built-in color config (the config's
// own file stays out of the module's file system, imbuf/colormanagement.js).
const { readFile } = await import('node:fs/promises'), { files } = await import('../src/port/wasm.js'), { blendData, setContextPointer } = await import('../src/python/bpy_rna.js');
setContextPointer(blender.C);
const png = Object.keys(JSON.parse(await readFile(new URL('./fixtures/images/images.json', import.meta.url), 'utf8'))).find((name) => name.endsWith('.png'));
files.set(`/images/${png}`, new Uint8Array(await readFile(new URL(`./fixtures/images/${png}`, import.meta.url))));
assert.equal(blender.run('image.open', { filepath: `/images/${png}` }).status, 4, `${png} opens with the color files fetched`);
assert.ok(blendData().images.get(png).size[0] > 0);
console.log("Display LUT: Blender's view transforms and looks through the lattices match its processor per pixel");
