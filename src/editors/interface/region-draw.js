// A region drawn by Blender's code in the module (tools/blender-port/wasm/region-draw.cc): its recording, in region
// pixels with y up, drawn on an SVG context (drawRecording, svg-context.js), and its buttons found by position. Text is measured and drawn with
// the browser's fonts (theme.css's --bl-font-family) at Blender's sizes; icons are Blender's SVGs (icon.js).
import { provided } from '../../port/wasm.js';
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import { iconSvg } from './icon.js';
import { svgSize } from './svg-context.js';

const { exports: x } = blenderModule;
const decoder = new TextDecoder();

const fontFamily = () => (globalThis.document && getComputedStyle(document.documentElement).getPropertyValue('--bl-font-family').trim()) || 'sans-serif';
const monoFamily = () => (globalThis.document && getComputedStyle(document.documentElement).getPropertyValue('--bl-font-mono').trim()) || 'monospace';
const fontOf = (size, mono = false) => `${size}px ${mono ? monoFamily() : fontFamily()}`;
let measurer;
const measure = () => (measurer ??= globalThis.OffscreenCanvas ? new OffscreenCanvas(1, 1).getContext('2d') : null);
// Without a canvas (Node), text measures as a fixed share of its size per character.
const metrics = (text, size, mono = false) => {
  const ctx = measure();
  if (!ctx) return { width: text.length * size * (mono ? 0.6 : 0.55), ascent: size * 0.73, descent: size * 0.21 };
  ctx.font = fontOf(size, mono);
  const m = ctx.measureText(text);
  return { width: m.width, ascent: m.fontBoundingBoxAscent ?? size * 0.73, descent: m.fontBoundingBoxDescent ?? size * 0.21 };
};
provided.region_text_width = (pointer, length, size) => metrics(decoder.decode(new Uint8Array(x.memory.buffer, pointer >>> 0, length)), size).width;
provided.region_font_ascender = (size) => metrics('', size).ascent;
// BLF_fixed_width: a monospace cell, whole pixels as Blender truncates it.
provided.region_mono_width = (size) => Math.floor(metrics('0', size, true).width);
provided.region_font_descender = (size) => -metrics('', size).descent;

const css = ([r, g, b, a]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;

// UI_CNR_*: which corners of a round box are round.
const CNR_TOP_LEFT = 1, CNR_TOP_RIGHT = 2, CNR_BOTTOM_RIGHT = 4, CNR_BOTTOM_LEFT = 8;
function roundRect(ctx, left, top, right, bottom, radius, corners) {
  const r = Math.max(0, Math.min(radius, (right - left) / 2, (bottom - top) / 2));
  const at = (bit) => (corners & bit ? r : 0);
  ctx.roundRect(left, top, right - left, bottom - top, [at(CNR_TOP_LEFT), at(CNR_TOP_RIGHT), at(CNR_BOTTOM_RIGHT), at(CNR_BOTTOM_LEFT)]);
}

// As icon_source_edit_cb and svg_replace_color_attributes recolor a multicolor icon: each group with a blender_ id
// takes its theme color (given by the module) for its fills.
function editSource(svg, colors) {
  return svg.replace(/<g\b[^>]*\bid="(blender_\w+)"[\s\S]*?<\/g>/g, (group, id) =>
    colors[id] ? group.replace(/fill="[^"]*"/g, `fill="#${colors[id]}"`).replace(/fill:[^;"]*/g, `fill:#${colors[id]}`) : group);
}

// GPU_KEYFRAME_SHAPE_* (GPU_shader_shared.hh).
const SHAPE_DIAMOND = 1, SHAPE_CIRCLE = 2, SHAPE_CLIPPED_VERTICAL = 4, SHAPE_CLIPPED_HORIZONTAL = 8, SHAPE_INNER_DOT = 16;
const rgba = (c) => css(c.map((v) => v / 255));
// A convex polygon cut to |x| <= h (vertical: |y| <= h), around its center.
const clipPolygon = (points, h, axis) => {
  const out = [];
  for (const sign of [1, -1]) {
    const inside = (p) => sign * p[axis] <= h, kept = [];
    (out.length ? out.splice(0) : points).forEach((p, i, all) => {
      const q = all[(i + 1) % all.length];
      if (inside(p)) kept.push(p);
      if (inside(p) !== inside(q)) {
        const t = (sign * h - p[axis]) / (q[axis] - p[axis]);
        kept.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    });
    out.push(...kept);
  }
  return out;
};
// A keyframe shape as gpu_shader_keyframe_shape_vert.glsl and _frag.glsl draw it: a diamond, circle or square (clipped
// diamond) of the key's size on the pixel grid, filled and outlined, with an inner dot.
function drawKeyShape(ctx, px, py, size, fill, outline, flags) {
  if (!(flags & (SHAPE_DIAMOND | SHAPE_CIRCLE | SHAPE_CLIPPED_VERTICAL | SHAPE_CLIPPED_HORIZONTAL))) flags |= SHAPE_DIAMOND;
  const x = Math.round(px - 0.5) + 0.5, y = Math.round(py - 0.5) + 0.5;
  const halfWidth = 0.06 + (size - 10) * 0.04, lineWidth = halfWidth + 1, radius = Math.round(0.5 * size) + halfWidth;
  const square = Math.round(radius * Math.SQRT1_2);
  ctx.beginPath();
  if (flags & SHAPE_CIRCLE) ctx.arc(x, y, radius * Math.sqrt(2 / Math.PI));
  else {
    let polygon = flags & SHAPE_DIAMOND ? [[radius, 0], [0, radius], [-radius, 0], [0, -radius]] : [[square, square], [-square, square], [-square, -square], [square, -square]];
    if (flags & SHAPE_CLIPPED_HORIZONTAL) polygon = clipPolygon(polygon, square, 0);
    if (flags & SHAPE_CLIPPED_VERTICAL) polygon = clipPolygon(polygon, square, 1);
    polygon.forEach(([dx, dy], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.closePath();
  }
  ctx.fillStyle = rgba(fill);
  ctx.fill();
  ctx.lineWidth = 2 * lineWidth - 1;
  ctx.strokeStyle = rgba(outline);
  ctx.stroke();
  if (flags & SHAPE_INNER_DOT) {
    ctx.beginPath();
    ctx.arc(x, y, lineWidth * 1.6 - 0.5);
    ctx.fillStyle = rgba(outline);
    ctx.fill();
  }
}

// Draws a recording ({ draw: [...] }) on a context (svg-context.js) for a region `height` pixels high, in Blender's
// order. An icon is drawn as blf_glyph_cache_add_svg places it: `size / 1600` of its document, in its size-square.
export function drawRecording(ctx, { draw, iconColors = {} }, { height }) {
  const y = (v) => height - v;
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
      ctx.fillRect(0, 0, ctx.width, ctx.height);
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
      if (op.outline[3] > 0 && w > 0) {
        ctx.beginPath();
        roundRect(ctx, x0, y(y1), x1, y(y0), op.radius, op.corners);
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
    } else if (op.op === 'keys') {
      // Each key: size, fill (RGBA 0 to 255), outline, flags.
      for (let i = 0, k = 0; i < op.points.length; i += 2, k += 10) {
        drawKeyShape(ctx, op.points[i], y(op.points[i + 1]), op.keys[k], op.keys.slice(k + 1, k + 5), op.keys.slice(k + 5, k + 9), op.keys[k + 9]);
      }
    } else if (op.op === 'text') {
      if (op.textClip) {
        const [x0, y0, x1, y1] = op.textClip;
        ctx.beginPath();
        ctx.rect(x0, y(y1), x1 - x0, y1 - y0);
        ctx.clip();
      }
      ctx.font = fontOf(op.size, !!op.mono);
      ctx.fillStyle = css(op.color);
      // Monospace text in Blender's cells: each character at its column.
      if (op.mono) [...op.text].forEach((c, i) => c !== ' ' && ctx.fillText(c, Math.round(op.at[0] + i * op.mono), Math.round(y(op.at[1]))));
      else ctx.fillText(op.text, Math.round(op.at[0]), Math.round(y(op.at[1])));
    } else if (op.op === 'icon') {
      const source = iconSvg(op.icon);
      if (source) {
        const { width, height: h } = svgSize(source), s = op.size / 1600;
        const left = Math.round(op.at[0]) + Math.max((op.size - width * s) / 2, -100 * s);
        const top = y(Math.round(op.at[1]) + Math.max((op.size + h * s) / 2, h * s - 100 * s));
        ctx.globalAlpha = op.multicolor ? op.color[3] : 1;
        ctx.icon(op.icon, left, top, width * s, h * s, css(op.color), op.multicolor ? editSource(source, iconColors) : null);
      }
    }
    ctx.restore();
  }
}

// The button at a point in region pixels (y up), the last one defined there as Blender's handlers find it.
export const buttonAt = ({ buttons }, px, py) =>
  buttons.findLast(({ rect: [x0, y0, x1, y1] }) => px >= x0 && px < x1 && py >= y0 && py < y1) ?? null;
