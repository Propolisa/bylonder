// Image files as data URLs, encoded the same way in the browser and in Node (no canvas): an export writes identical
// image files from either.
import { zlibSync } from 'fflate';
import { encodeJpeg } from './jpeg.js';

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const dataUrl = (type, bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(text)}`;
};

// Formats browsers decode, by their files' first bytes.
const WEB_IMAGES = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/webp', [0x52, 0x49, 0x46, 0x46, -1, -1, -1, -1, 0x57, 0x45, 0x42, 0x50]]];

// A file of a format browsers decode as its data URL; null for any other.
export function webImage(bytes) {
  const [type] = (bytes && WEB_IMAGES.find(([, magic]) => magic.every((byte, i) => byte < 0 || bytes[i] === byte))) ?? [];
  return type ? dataUrl(type, bytes) : null;
}

// 8 bit RGBA rows, bottom row first as Blender keeps them, written top row first as image files are.
export function pngDataUrl(rgba, width, height) {
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * (width * 4 + 1) + 1);
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  parts.reduce((at, part) => (png.set(part, at), at + part.length), 0);
  return dataUrl('image/png', png);
}

// Converted pixels as an export writes them: opaque sRGB color as a JPEG (about a fifth of the PNG's size), anything
// else (data, alpha, a float buffer's bytes) as a lossless PNG.
export function imageDataUrl(rgba, width, height, { srgb = false } = {}) {
  const opaque = () => { for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false; return true; };
  return srgb && opaque() ? dataUrl('image/jpeg', encodeJpeg(rgba, width, height)) : pngDataUrl(rgba, width, height);
}
