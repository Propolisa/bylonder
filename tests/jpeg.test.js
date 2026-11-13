// Converted color images are written as JPEG by Bylonder's own encoder (src/imbuf/jpeg.js), the same bytes in the
// browser and in Node: a decoder (ffmpeg's) reads them back close to the pixels, top row first, at any size (edges
// past a 16 pixel block repeated). Opaque sRGB color is a JPEG; alpha, data and float bytes stay a lossless PNG.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { encodeJpeg } from '../src/imbuf/jpeg.js';
import { imageDataUrl } from '../src/imbuf/data-url.js';

// A smooth picture with a sharp edge, bottom row first as Blender keeps it; its top half brighter.
const width = 203, height = 117, rgba = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const top = y >= height / 2;
  rgba.set([(x * 255) / width, top ? 220 : 60, ((x + y) * 255) / (width + height), 255], (y * width + x) * 4);
}
const jpeg = encodeJpeg(rgba, width, height);
assert.deepEqual(encodeJpeg(rgba, width, height), jpeg, 'the same pixels encode to the same bytes');

const dir = mkdtempSync(join(tmpdir(), 'jpeg-test-'));
// Its PSNR read back by ffmpeg's decoder, top row first.
function psnr(pixels) {
  const file = join(dir, 'a.jpg');
  writeFileSync(file, encodeJpeg(pixels, width, height));
  const decoded = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  assert.equal(decoded.length, width * height * 4, 'it decodes at its size');
  let squared = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
    squared += (decoded[(y * width + x) * 4 + c] - pixels[((height - 1 - y) * width + x) * 4 + c]) ** 2;
  }
  return 10 * Math.log10(255 ** 2 / (squared / (width * height * 3)));
}
const grey = rgba.map((v, i) => (i & 3) === 3 ? v : rgba[i - (i & 3) + 1]);
const color = psnr(rgba), luma = psnr(grey);
rmSync(dir, { recursive: true });
// Color at half resolution (4:2:0, as libjpeg's default) softens the sharp green edge, as ffmpeg's encoder does (37 dB).
assert.ok(color > 33, `color decodes close to the pixels (PSNR ${color.toFixed(1)} dB)`);
assert.ok(luma > 42, `grey, at full resolution, closer (PSNR ${luma.toFixed(1)} dB)`);

assert.match(imageDataUrl(rgba, width, height, { srgb: true }), /^data:image\/jpeg;/, 'opaque sRGB color is a JPEG');
assert.match(imageDataUrl(rgba, width, height), /^data:image\/png;/, 'data stays a PNG');
const clear = rgba.slice();
clear[3] = 0;
assert.match(imageDataUrl(clear, width, height, { srgb: true }), /^data:image\/png;/, 'and color with alpha');
console.log(`JPEG: converted color images encode the same everywhere and decode at ${color.toFixed(1)} dB PSNR (grey ${luma.toFixed(1)} dB)`);
