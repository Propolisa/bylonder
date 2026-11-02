// Image files read by Blender's own readers in the module (tools/blender-reference/image-fixtures.py): JPEG through
// libjpeg-turbo, OpenEXR (each compression) through OpenEXR and the others through OpenImageIO open with image.open as
// in Blender and give Blender's pixels, color space and settings.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { files } from '../src/port/wasm.js';
import { blendData, setContextPointer } from '../src/python/bpy_rna.js';


const dir = new URL('./fixtures/images/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('images.json', dir), 'utf8'));
await import('../src/python/bpy_interface.js');
const main = new BlenderMain();
setContextPointer(main.C);

for (const [name, want] of Object.entries(expected)) {
  files.set(`/images/${name}`, new Uint8Array(await readFile(new URL(name, dir))));
  assert.equal(main.run('image.open', { filepath: `/images/${name}` }).status, 4, `${name} opens`);
  const image = blendData().images.get(name);
  assert.deepEqual([...image.size], want.size, `${name}: its size is Blender's`);
  assert.deepEqual({ is_float: image.is_float, colorspace: image.colorspace_settings.name, file_format: image.file_format },
    { is_float: want.is_float, colorspace: want.colorspace, file_format: want.file_format }, `${name}: its settings are Blender's`);
  const pixels = [...image.pixels];
  const error = Math.max(...pixels.map((v, i) => Math.abs(v - want.pixels[i])));
  // OpenColorIO's CPU processor rounds differently without SIMD (16 bit files become scene linear through it).
  assert.ok(error < 5e-5, `${name}: its pixels are Blender's within ${error}`);
}

// Blender's writers: a generated image saved in each lossless format (with its resolution and the format's settings as
// metadata, the PNG text chunks among them) opens again with the same pixels; OpenEXR from a float image, whose
// scene linear values it keeps.
const WRITTEN = { PNG: ['png', false], TARGA: ['tga', false], BMP: ['bmp', false], TIFF: ['tif', false], OPEN_EXR: ['exr', true] };
for (const [format, [extension, float_buffer]] of Object.entries(WRITTEN)) {
  main.run('image.new', { name: format, width: 16, height: 8, color: [0.25, 0.5, 0.75, 1], float: float_buffer });
  const written = blendData().images.get(format), source = [...written.pixels];
  const filepath = `/images/written.${extension}`;
  written.file_format = format;
  written.filepath_raw = filepath;
  written.save();
  assert.ok(files.get(filepath)?.length, `${format} is written`);
  files.set(`/images/reread.${extension}`, files.get(filepath));
  assert.equal(main.run('image.open', { filepath: `/images/reread.${extension}` }).status, 4, `${format} opens again`);
  const reread = blendData().images.get(`reread.${extension}`);
  const error = Math.max(...[...reread.pixels].map((v, i) => Math.abs(v - source[i])));
  assert.ok(error < 0.01, `${format}: its pixels survive within ${error}`);
}
console.log(`images: ${Object.keys(expected).join(', ')} open with Blender's readers and give Blender's pixels; ${Object.keys(WRITTEN).join(', ')} written and read back`);
