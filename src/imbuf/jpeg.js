// A baseline JPEG encoder (ITU T.81), the same bytes in the browser and in Node: 4:2:0 YCbCr, Annex K's tables scaled
// for a quality as libjpeg scales them, so an export writes identical files from either.

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

// Annex K.1: luminance and chrominance quantization, in natural order.
const LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...Array(32).fill(99)];

// Annex K.3: the typical Huffman tables, as code counts per length (1 to 16) and symbols.
const span = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const tail = (starts) => starts.flatMap((from) => span(from, (from & 0xf0) | 0xa));
const LUMA_AC_HEAD = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a,
  0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a];
const CHROMA_AC_HEAD = [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81,
  0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17,
  0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a];
export const TABLES = {
  lumaDC: { id: 0x00, counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], symbols: [...Array(12).keys()] },
  lumaAC: { id: 0x10, counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], symbols: [...LUMA_AC_HEAD, ...tail([0x43, 0x53, 0x63, 0x73, 0x83, 0x92, 0xa2, 0xb2, 0xc2, 0xd2, 0xe1, 0xf1])] },
  chromaDC: { id: 0x01, counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], symbols: [...Array(12).keys()] },
  chromaAC: { id: 0x11, counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], symbols: [...CHROMA_AC_HEAD, ...tail([0x43, 0x53, 0x63, 0x73, 0x82, 0x92, 0xa2, 0xb2, 0xc2, 0xd2, 0xe2, 0xf2])] },
};

// Annex C: each symbol's code and length from the counts.
function codes({ counts, symbols }) {
  const out = new Map();
  let code = 0, k = 0;
  counts.forEach((n, i) => {
    for (let j = 0; j < n; j++) out.set(symbols[k++], [code++, i + 1]);
    code <<= 1;
  });
  return out;
}

// libjpeg's quality scaling (jcparam.c jpeg_quality_scaling).
const scaled = (table, quality) => {
  const q = Math.min(100, Math.max(1, quality)), scale = q < 50 ? 5000 / q : 200 - q * 2;
  return table.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
};

// The 8 point DCT's basis, C(u) folded in.
const BASIS = Array.from({ length: 64 }, (_, i) => {
  const u = i >> 3, x = i & 7;
  return (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2;
});

// A block's coefficients, quantized, in zigzag order.
function transform(block, quant, out) {
  const rows = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let x = 0; x < 8; x++) s += BASIS[u * 8 + x] * block[y * 8 + x];
    rows[y * 8 + u] = s;
  }
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let y = 0; y < 8; y++) s += BASIS[v * 8 + y] * rows[y * 8 + u];
    out[v * 8 + u] = Math.round(s / quant[v * 8 + u]);
  }
  return out;
}

function bitWriter() {
  const bytes = [];
  let acc = 0, n = 0;
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) {
      acc = (acc << 1) | ((value >> i) & 1);
      if (++n === 8) {
        bytes.push(acc);
        if (acc === 0xff) bytes.push(0);
        acc = 0;
        n = 0;
      }
    }
  };
  return { put, end: () => { if (n) put(0x7f, 8 - n); return bytes; } };
}

const magnitude = (v) => { let a = Math.abs(v), n = 0; while (a) { a >>= 1; n++; } return n; };

/**
 * 8 bit RGBA pixels (bottom row first, as Blender keeps them; alpha ignored) as a baseline JPEG's bytes, top row first.
 * @param {Uint8Array} rgba @param {number} width @param {number} height @param {number} [quality] 1 to 100, as libjpeg's
 * @returns {Uint8Array}
 */
export function encodeJpeg(rgba, width, height, quality = 90) {
  const quant = [scaled(LUMA_Q, quality), scaled(CHROMA_Q, quality)];
  const huff = Object.fromEntries(Object.entries(TABLES).map(([k, t]) => [k, codes(t)]));
  const bits = bitWriter(), coefficients = new Int32Array(64), previous = [0, 0, 0];
  const encode = (block, c) => {
    const dc = c ? huff.chromaDC : huff.lumaDC, ac = c ? huff.chromaAC : huff.lumaAC, q = transform(block, quant[c ? 1 : 0], coefficients);
    const symbol = (table, s) => bits.put(...table.get(s));
    const value = (v, size) => bits.put(v < 0 ? v - 1 + (1 << size) : v, size);
    const diff = q[0] - previous[c], size = magnitude(diff);
    previous[c] = q[0];
    symbol(dc, size);
    if (size) value(diff, size);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = q[ZIGZAG[k]];
      if (!v) { run++; continue; }
      for (; run > 15; run -= 16) symbol(ac, 0xf0);
      const s = magnitude(v);
      symbol(ac, (run << 4) | s);
      value(v, s);
      run = 0;
    }
    if (run) symbol(ac, 0x00);
  };
  // A pixel by its column and row from the top, the edges repeated past the image.
  const at = (x, y) => (((height - 1 - Math.min(height - 1, y)) * width) + Math.min(width - 1, x)) * 4;
  const luma = new Float64Array(64), cb = new Float64Array(64), cr = new Float64Array(64);
  for (let my = 0; my < height; my += 16) for (let mx = 0; mx < width; mx += 16) {
    cb.fill(0);
    cr.fill(0);
    for (let by = 0; by < 16; by += 8) for (let bx = 0; bx < 16; bx += 8) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = at(mx + bx + x, my + by + y), r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        luma[y * 8 + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        const k = ((by + y) >> 1) * 8 + ((bx + x) >> 1);
        cb[k] += (-0.168736 * r - 0.331264 * g + 0.5 * b) / 4;
        cr[k] += (0.5 * r - 0.418688 * g - 0.081312 * b) / 4;
      }
      encode(luma, 0);
    }
    encode(cb, 1);
    encode(cr, 2);
  }
  const data = bits.end();
  const u16 = (v) => [v >> 8, v & 0xff];
  const segment = (marker, body) => [0xff, marker, ...u16(body.length + 2), ...body];
  const tables = Object.values(TABLES).flatMap((t) => [t.id, ...t.counts, ...t.symbols]);
  const header = [0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xdb, [0, ...ZIGZAG.map((i) => quant[0][i]), 1, ...ZIGZAG.map((i) => quant[1][i])]),
    ...segment(0xc0, [8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...segment(0xc4, tables),
    ...segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])];
  const out = new Uint8Array(header.length + data.length + 2);
  out.set(header);
  out.set(data, header.length);
  out.set([0xff, 0xd9], header.length + data.length);
  return out;
}
