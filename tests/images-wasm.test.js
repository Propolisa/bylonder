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
console.log(`images: ${Object.keys(expected).join(', ')} open with Blender's readers and give Blender's pixels`);
