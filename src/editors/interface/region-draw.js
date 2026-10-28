// A region drawn by Blender's code in the module (tools/blender-port/wasm/region-draw.cc): its recording, in region
// pixels with y up, replayed on a 2D canvas, and its buttons found by position. Text is measured and drawn with the
// browser's fonts (theme.css's --bl-font-family) at Blender's sizes; icons are Blender's SVGs (icon.js), rasterized
// as blf_glyph.cc rasterizes them: a monochrome icon as coverage tinted in the color Blender's code gives, a
// multicolor one in its own colors with its themed groups recolored (icon_source_edit_cb).
import { provided } from '../../port/wasm.js';
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import { iconUrl } from './icon.js';

const { exports: x } = blenderModule;
const decoder = new TextDecoder();

const fontFamily = () => (globalThis.document && getComputedStyle(document.documentElement).getPropertyValue('--bl-font-family').trim()) || 'sans-serif';
const fontOf = (size) => `${size}px ${fontFamily()}`;
let measurer;
const measure = () => (measurer ??= globalThis.OffscreenCanvas ? new OffscreenCanvas(1, 1).getContext('2d') : null);
// Without a canvas (Node), text measures as a fixed share of its size per character.
const metrics = (text, size) => {
  const ctx = measure();
  if (!ctx) return { width: text.length * size * 0.55, ascent: size * 0.73, descent: size * 0.21 };
  ctx.font = fontOf(size);
  const m = ctx.measureText(text);
  return { width: m.width, ascent: m.fontBoundingBoxAscent ?? size * 0.73, descent: m.fontBoundingBoxDescent ?? size * 0.21 };
};
provided.region_text_width = (pointer, length, size) => metrics(decoder.decode(new Uint8Array(x.memory.buffer, pointer, length)), size).width;
provided.region_font_ascender = (size) => metrics('', size).ascent;
provided.region_font_descender = (size) => -metrics('', size).descent;

const css = ([r, g, b, a]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;

// UI_CNR_*: which corners of a round box are round.
const CNR_TOP_LEFT = 1, CNR_TOP_RIGHT = 2, CNR_BOTTOM_RIGHT = 4, CNR_BOTTOM_LEFT = 8;
function roundRect(ctx, left, top, right, bottom, radius, corners) {
  const r = Math.max(0, Math.min(radius, (right - left) / 2, (bottom - top) / 2));
  const at = (bit) => (corners & bit ? r : 0);
  ctx.roundRect(left, top, right - left, bottom - top, [at(CNR_TOP_LEFT), at(CNR_TOP_RIGHT), at(CNR_BOTTOM_RIGHT), at(CNR_BOTTOM_LEFT)]);
}

// Icons: each SVG's text once, and its rasters by size, color and outline.
const sources = new Map(), rasters = new Map();
let changed = () => {};
function source(name) {
  if (!sources.has(name)) {
    sources.set(name, null);
    fetch(iconUrl(name)).then((r) => (r.ok ? r.text() : '')).then((text) => { sources.set(name, text); changed(); }, () => {});
  }
  return sources.get(name);
}

// As icon_source_edit_cb and svg_replace_color_attributes recolor a multicolor icon: each group with a blender_ id
// takes its theme color (given by the module) for its fills.
function editSource(svg, colors) {
  return svg.replace(/<g\b[^>]*\bid="(blender_\w+)"[\s\S]*?<\/g>/g, (group, id) =>
    colors[id] ? group.replace(/fill="[^"]*"/g, `fill="#${colors[id]}"`).replace(/fill:[^;"]*/g, `fill:#${colors[id]}`) : group);
}

// blf_glyph_cache_add_svg: the icon drawn at `size / 1600` of its SVG's size, placed in its size-square as Blender
// places the glyph; monochrome icons keep coverage (gray times alpha) for the tint.
async function rasterize(svg, size, scale, multicolor) {
  const image = new Image();
  image.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await image.decode();
  URL.revokeObjectURL(image.src);
  const { width, height } = svgSize(svg);
  const pixels = size * scale;
  const destW = Math.ceil(width * pixels / 1600), destH = Math.ceil(height * pixels / 1600);
  const canvas = new OffscreenCanvas(destW, destH), ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, destW, destH);
  if (!multicolor) {
    const data = ctx.getImageData(0, 0, destW, destH);
    for (let i = 0; i < data.data.length; i += 4) {
      const [r, g, b, a] = data.data.subarray(i, i + 4);
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      data.data.set([255, 255, 255, Math.round(gray * a / 255)], i);
    }
    ctx.putImageData(data, 0, 0);
  }
  const s = destW / width;
  return { canvas, offsetX: Math.max(Math.round((pixels - width * s) / 2), Math.trunc(-100 * s)),
    offsetY: Math.max(Math.ceil((pixels + destH) / 2), destH - Math.trunc(100 * s)) };
}
const svgSize = (svg) => {
  const tag = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
  const box = tag.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
  return { width: box?.[2] ?? Number(tag.match(/\bwidth="([\d.]+)/)?.[1] ?? 1600), height: box?.[3] ?? Number(tag.match(/\bheight="([\d.]+)/)?.[1] ?? 1600) };
};

function icon(name, size, scale, multicolor, colors) {
  const svg = source(name.toLowerCase());
  if (!svg) return null;
  const key = `${name}|${size * scale}|${multicolor}`;
  if (!rasters.has(key)) {
    rasters.set(key, null);
    rasterize(multicolor ? editSource(svg, colors) : svg, size, scale, multicolor).then((r) => { rasters.set(key, r); changed(); }, () => {});
  }
  return rasters.get(key);
}

// Draws a recording ({ draw: [...] }) on a 2D context scaled to device pixels by `scale`, for a region `height`
// pixels high. `redraw()` is called when icons it waited for have loaded.
export function drawRecording(ctx, { draw, iconColors = {} }, { height, scale = 1, redraw = () => {} }) {
  changed = redraw;
  const y = (v) => height - v;
  const tint = new OffscreenCanvas(1, 1).getContext('2d');
  for (const op of draw) {
    ctx.save();
    if (op.clip) {
      const [x0, y0, x1, y1] = op.clip;
      ctx.beginPath();
      ctx.rect(x0, y(y1), x1 - x0, y1 - y0);
      ctx.clip();
    }
    if (op.op === 'clear') {
      ctx.fillStyle = css(op.color);
      ctx.fillRect(0, 0, ctx.canvas.width / scale, ctx.canvas.height / scale);
    } else if (op.op === 'tris') {
      ctx.beginPath();
      for (let i = 0; i < op.points.length; i += 6) {
        ctx.moveTo(op.points[i], y(op.points[i + 1]));
        ctx.lineTo(op.points[i + 2], y(op.points[i + 3]));
        ctx.lineTo(op.points[i + 4], y(op.points[i + 5]));
        ctx.closePath();
      }
      ctx.fillStyle = css(op.color);
      ctx.fill();
    } else if (op.op === 'lines') {
      ctx.beginPath();
      // Lines sit on pixel centers, as the GPU rasterizes one-pixel lines.
      for (let i = 0; i < op.points.length; i += 4) {
        ctx.moveTo(Math.floor(op.points[i]) + 0.5, Math.floor(y(op.points[i + 1])) + 0.5);
        ctx.lineTo(Math.floor(op.points[i + 2]) + 0.5, Math.floor(y(op.points[i + 3])) + 0.5);
      }
      if (op.dash) ctx.setLineDash(op.dash);
      ctx.lineWidth = op.width;
      ctx.strokeStyle = css(op.color);
      ctx.stroke();
    } else if (op.op === 'roundbox') {
      const [x0, y0, x1, y1] = op.rect, w = op.outlineWidth;
      ctx.beginPath();
      roundRect(ctx, x0, y(y1), x1, y(y0), op.radius, op.corners);
      if (op.outline[3] > 0 && w > 0) {
        roundRect(ctx, x0 + w, y(y1) + w, x1 - w, y(y0) - w, op.radius - w, op.corners);
        ctx.fillStyle = css(op.outline);
        ctx.fill('evenodd');
      }
      if (op.inner[3] > 0) {
        ctx.beginPath();
        roundRect(ctx, x0 + w, y(y1) + w, x1 - w, y(y0) - w, op.radius - w, op.corners);
        ctx.fillStyle = css(op.inner);
        ctx.fill();
      }
    } else if (op.op === 'text') {
      if (op.textClip) {
        const [x0, y0, x1, y1] = op.textClip;
        ctx.beginPath();
        ctx.rect(x0, y(y1), x1 - x0, y1 - y0);
        ctx.clip();
      }
      ctx.font = fontOf(op.size);
      ctx.fillStyle = css(op.color);
      // BLF draws from the left of the baseline, whatever the canvas was drawing before.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(op.text, Math.round(op.at[0]), Math.round(y(op.at[1])));
    } else if (op.op === 'icon') {
      const raster = icon(op.icon, op.size, scale, !!op.multicolor, iconColors);
      if (raster) {
        const left = Math.round(op.at[0]) + raster.offsetX / scale, top = y(Math.round(op.at[1]) + raster.offsetY / scale);
        if (op.multicolor) {
          ctx.globalAlpha = op.color[3];
          ctx.drawImage(raster.canvas, left, top, raster.canvas.width / scale, raster.canvas.height / scale);
        } else {
          tint.canvas.width = raster.canvas.width;
          tint.canvas.height = raster.canvas.height;
          tint.drawImage(raster.canvas, 0, 0);
          tint.globalCompositeOperation = 'source-in';
          tint.fillStyle = css(op.color);
          tint.fillRect(0, 0, tint.canvas.width, tint.canvas.height);
          tint.globalCompositeOperation = 'source-over';
          ctx.drawImage(tint.canvas, left, top, raster.canvas.width / scale, raster.canvas.height / scale);
        }
      }
    }
    ctx.restore();
  }
}

// The button at a point in region pixels (y up), the last one defined there as Blender's handlers find it.
export const buttonAt = ({ buttons }, px, py) =>
  buttons.findLast(({ rect: [x0, y0, x1, y1] }) => px >= x0 && px < x1 && py >= y0 && py < y1) ?? null;
