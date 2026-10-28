// A region drawn by Blender's code in the module (tools/blender-port/wasm/region-draw.cc): its recording, in region
// pixels with y up, drawn as SVG (drawRecording), and its buttons found by position. Text is measured and drawn with
// the browser's fonts (theme.css's --bl-font-family) at Blender's sizes; icons are Blender's SVGs (icon.js).
import { provided } from '../../port/wasm.js';
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import { iconSvg } from './icon.js';

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
const n = (v) => +v.toFixed(2);
function roundRect(left, top, right, bottom, radius, corners) {
  const r = Math.max(0, Math.min(radius, (right - left) / 2, (bottom - top) / 2));
  const [tl, tr, br, bl] = [CNR_TOP_LEFT, CNR_TOP_RIGHT, CNR_BOTTOM_RIGHT, CNR_BOTTOM_LEFT].map((bit) => (corners & bit ? r : 0));
  return `M${n(left + tl)} ${n(top)}H${n(right - tr)}A${tr} ${tr} 0 0 1 ${n(right)} ${n(top + tr)}V${n(bottom - br)}A${br} ${br} 0 0 1 ${n(right - br)} ${n(bottom)}`
    + `H${n(left + bl)}A${bl} ${bl} 0 0 1 ${n(left)} ${n(bottom - bl)}V${n(top + tl)}A${tl} ${tl} 0 0 1 ${n(left + tl)} ${n(top)}Z`;
}
const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// As icon_source_edit_cb and svg_replace_color_attributes recolor a multicolor icon: each group with a blender_ id
// takes its theme color (given by the module) for its fills.
function editSource(svg, colors) {
  return svg.replace(/<g\b[^>]*\bid="(blender_\w+)"[\s\S]*?<\/g>/g, (group, id) =>
    colors[id] ? group.replace(/fill="[^"]*"/g, `fill="#${colors[id]}"`).replace(/fill:[^;"]*/g, `fill:#${colors[id]}`) : group);
}
const svgSize = (svg) => {
  const tag = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
  const box = tag.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
  return { width: box?.[2] ?? Number(tag.match(/\bwidth="([\d.]+)/)?.[1] ?? 1600), height: box?.[3] ?? Number(tag.match(/\bheight="([\d.]+)/)?.[1] ?? 1600) };
};
const dataUrl = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

// Draws a recording ({ draw: [...] }) as the SVG `svg` of a region `width` by `height` pixels, in Blender's order. Text
// is the browser's in the theme's font; an icon is Blender's SVG drawn as blf_glyph_cache_add_svg places it (`size /
// 1600` of its document, in its size-square), a monochrome one as a luminance mask (coverage: gray times alpha) of its
// color, a multicolor one in its own colors with its themed groups recolored.
let drawings = 0;
export function drawRecording(svg, { draw, iconColors = {} }, { width, height }) {
  const y = (v) => height - v;
  const id = (svg.dataset.drawing ??= `r${drawings++}`);
  const defs = [], body = [], clips = new Map(), masks = new Map();
  const clip = (rect) => {
    if (!rect) return '';
    const key = rect.join(',');
    if (!clips.has(key)) {
      const [x0, y0, x1, y1] = rect;
      clips.set(key, `${id}c${clips.size}`);
      defs.push(`<clipPath id="${clips.get(key)}"><rect x="${n(x0)}" y="${n(y(y1))}" width="${n(x1 - x0)}" height="${n(y1 - y0)}"/></clipPath>`);
    }
    return ` clip-path="url(#${clips.get(key)})"`;
  };
  const family = fontFamily().replace(/"/g, "'");
  for (const op of draw) {
    let shape = '';
    if (op.op === 'clear') {
      shape = `<rect width="${width}" height="${height}" fill="${css(op.color)}"/>`;
    } else if (op.op === 'tris') {
      let d = '';
      for (let i = 0; i < op.points.length; i += 6) {
        d += `M${n(op.points[i])} ${n(y(op.points[i + 1]))}L${n(op.points[i + 2])} ${n(y(op.points[i + 3]))}L${n(op.points[i + 4])} ${n(y(op.points[i + 5]))}Z`;
      }
      shape = `<path d="${d}" fill="${css(op.color)}"/>`;
    } else if (op.op === 'lines') {
      // Lines sit on pixel centers, as the GPU rasterizes one-pixel lines.
      let d = '';
      for (let i = 0; i < op.points.length; i += 4) {
        d += `M${Math.floor(op.points[i]) + 0.5} ${Math.floor(y(op.points[i + 1])) + 0.5}L${Math.floor(op.points[i + 2]) + 0.5} ${Math.floor(y(op.points[i + 3])) + 0.5}`;
      }
      shape = `<path d="${d}" fill="none" stroke="${css(op.color)}" stroke-width="${op.width}"${op.dash ? ` stroke-dasharray="${op.dash.join(' ')}"` : ''}/>`;
    } else if (op.op === 'roundbox') {
      const [x0, y0, x1, y1] = op.rect, w = op.outlineWidth;
      const inner = roundRect(x0 + w, y(y1) + w, x1 - w, y(y0) - w, op.radius - w, op.corners);
      if (op.outline[3] > 0 && w > 0) shape += `<path d="${roundRect(x0, y(y1), x1, y(y0), op.radius, op.corners)}${inner}" fill-rule="evenodd" fill="${css(op.outline)}"/>`;
      if (op.inner[3] > 0) shape += `<path d="${inner}" fill="${css(op.inner)}"/>`;
    } else if (op.op === 'text') {
      // BLF draws from the left of the baseline.
      shape = `<text x="${Math.round(op.at[0])}" y="${Math.round(y(op.at[1]))}" font-size="${op.size}" font-family="${family}" fill="${css(op.color)}"`
        + ` xml:space="preserve"${clip(op.textClip)}>${escape(op.text)}</text>`;
    } else if (op.op === 'icon') {
      const source = iconSvg(op.icon);
      if (!source) continue;
      const { width: sw, height: sh } = svgSize(source), s = op.size / 1600, w = sw * s, h = sh * s;
      const left = Math.round(op.at[0]) + Math.max((op.size - w) / 2, -100 * s);
      const top = y(Math.round(op.at[1]) + Math.max((op.size + h) / 2, h - 100 * s));
      if (op.multicolor) {
        shape = `<image x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" opacity="${op.color[3]}" href="${dataUrl(editSource(source, iconColors))}"/>`;
      } else {
        const key = `${op.icon}|${op.size}`;
        if (!masks.has(key)) {
          masks.set(key, `${id}m${masks.size}`);
          defs.push(`<mask id="${masks.get(key)}"><image width="${n(w)}" height="${n(h)}" href="${dataUrl(source)}"/></mask>`);
        }
        // The mask's image is at its user space's origin, so the masked rectangle is drawn there, moved into place.
        shape = `<g transform="translate(${n(left)} ${n(top)})"><rect width="${n(w)}" height="${n(h)}" fill="${css(op.color)}" mask="url(#${masks.get(key)})"/></g>`;
      }
    }
    if (shape) body.push(op.clip ? `<g${clip(op.clip)}>${shape}</g>` : shape);
  }
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.innerHTML = `<defs>${defs.join('')}</defs>${body.join('')}`;
}

// The button at a point in region pixels (y up), the last one defined there as Blender's handlers find it.
export const buttonAt = ({ buttons }, px, py) =>
  buttons.findLast(({ rect: [x0, y0, x1, y1] }) => px >= x0 && px < x1 && py >= y0 && py < y1) ?? null;
