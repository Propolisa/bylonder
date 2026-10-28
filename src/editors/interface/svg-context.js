// The part of CanvasRenderingContext2D the editors draw regions with, drawn as SVG instead (flush): paths, rectangles,
// circles, round rectangles, text and clipping, in drawing order, and Blender's icons (icon). The browser rasterizes;
// nothing here touches pixels.
import { iconSvg } from './icon.js';

const n = (v) => +v.toFixed(2);
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ANCHOR = { left: 'start', start: 'start', center: 'middle', right: 'end', end: 'end' };

export const svgSize = (svg) => {
  const tag = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
  const box = tag.match(/viewBox="([^"]*)"/)?.[1]?.split(/[\s,]+/).map(Number);
  return { width: box?.[2] ?? Number(tag.match(/\bwidth="([\d.]+)/)?.[1] ?? 1600), height: box?.[3] ?? Number(tag.match(/\bheight="([\d.]+)/)?.[1] ?? 1600) };
};
const dataUrl = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

let contexts = 0, measurer;
export class SvgContext {
  constructor(width, height) {
    Object.assign(this, { width, height, id: `s${contexts++}`, body: [], defs: [], clips: new Map(), masks: new Map(), stack: [], path: '' });
    this.state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, dash: null, globalAlpha: 1, font: '10px sans-serif', textAlign: 'left', clip: '' };
  }
  get fillStyle() { return this.state.fillStyle; }
  set fillStyle(v) { this.state.fillStyle = v; }
  get strokeStyle() { return this.state.strokeStyle; }
  set strokeStyle(v) { this.state.strokeStyle = v; }
  get lineWidth() { return this.state.lineWidth; }
  set lineWidth(v) { this.state.lineWidth = v; }
  get globalAlpha() { return this.state.globalAlpha; }
  set globalAlpha(v) { this.state.globalAlpha = v; }
  get font() { return this.state.font; }
  set font(v) { this.state.font = v; }
  get textAlign() { return this.state.textAlign; }
  set textAlign(v) { this.state.textAlign = v; }
  set textBaseline(_) {}
  save() { this.stack.push({ ...this.state }); }
  restore() { this.state = this.stack.pop() ?? this.state; }
  setTransform() {}
  setLineDash(dash) { this.state.dash = dash?.length ? dash : null; }

  beginPath() { this.path = ''; }
  moveTo(x, y) { this.path += `M${n(x)} ${n(y)}`; }
  lineTo(x, y) { this.path += `L${n(x)} ${n(y)}`; }
  closePath() { this.path += 'Z'; }
  rect(x, y, w, h) { this.path += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`; }
  // Whole circles: what the editors draw.
  arc(x, y, r) { this.path += `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`; }
  roundRect(x, y, w, h, radii = 0) {
    const [tl, tr, br, bl] = (Array.isArray(radii) ? (radii.length === 4 ? radii : Array(4).fill(radii[0] ?? 0)) : Array(4).fill(radii))
      .map((r) => Math.max(0, Math.min(r, w / 2, h / 2)));
    this.path += `M${n(x + tl)} ${n(y)}H${n(x + w - tr)}A${tr} ${tr} 0 0 1 ${n(x + w)} ${n(y + tr)}V${n(y + h - br)}A${br} ${br} 0 0 1 ${n(x + w - br)} ${n(y + h)}`
      + `H${n(x + bl)}A${bl} ${bl} 0 0 1 ${n(x)} ${n(y + h - bl)}V${n(y + tl)}A${tl} ${tl} 0 0 1 ${n(x + tl)} ${n(y)}Z`;
  }
  clip() {
    if (!this.clips.has(this.path)) {
      this.clips.set(this.path, `${this.id}c${this.clips.size}`);
      this.defs.push(`<clipPath id="${this.clips.get(this.path)}"><path d="${this.path}"/></clipPath>`);
    }
    // Nested clips: the element is wrapped once per clip in force.
    this.state.clip += ` ${this.clips.get(this.path)}`;
  }

  emit(element) {
    const alpha = this.state.globalAlpha < 1 ? `<g opacity="${this.state.globalAlpha}">${element}</g>` : element;
    this.body.push(this.state.clip.trim().split(' ').filter(Boolean).reduceRight((inner, id) => `<g clip-path="url(#${id})">${inner}</g>`, alpha));
  }
  fill(rule) { if (this.path) this.emit(`<path d="${this.path}" fill="${this.state.fillStyle}"${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}/>`); }
  stroke() {
    if (!this.path) return;
    const { strokeStyle, lineWidth, dash } = this.state;
    this.emit(`<path d="${this.path}" fill="none" stroke="${strokeStyle}" stroke-width="${lineWidth}"${dash ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/>`);
  }
  fillRect(x, y, w, h) { this.emit(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${this.state.fillStyle}"/>`); }
  strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.stroke(); }
  // From the left of the baseline (or as textAlign places it), in the font set.
  fillText(text, x, y) {
    this.emit(`<text x="${n(x)}" y="${n(y)}" style="font:${escape(this.state.font)}" text-anchor="${ANCHOR[this.state.textAlign] ?? 'start'}"`
      + ` fill="${this.state.fillStyle}" xml:space="preserve">${escape(text)}</text>`);
  }
  // The browser's metrics of text in the font set (an offscreen canvas only measures).
  measureText(text) {
    measurer ??= new OffscreenCanvas(1, 1).getContext('2d');
    measurer.font = this.state.font;
    return measurer.measureText(text);
  }
  // One of Blender's icons (icon.js) in its document's box at (x, y), w by h: a monochrome icon as a luminance mask of
  // its SVG in `color` (its coverage, gray times alpha, as blf_glyph.cc draws it), a multicolor one as `source` is.
  icon(name, x, y, w, h, color, source = null) {
    const svg = source ?? iconSvg(name);
    if (!svg) return;
    if (source) {
      this.emit(`<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" href="${dataUrl(source)}"/>`);
      return;
    }
    const key = `${name}|${n(w)}|${n(h)}`;
    if (!this.masks.has(key)) {
      this.masks.set(key, `${this.id}m${this.masks.size}`);
      this.defs.push(`<mask id="${this.masks.get(key)}"><image width="${n(w)}" height="${n(h)}" href="${dataUrl(svg)}"/></mask>`);
    }
    // The mask's image is at its user space's origin, so the masked rectangle is drawn there, moved into place.
    this.emit(`<g transform="translate(${n(x)} ${n(y)})"><rect width="${n(w)}" height="${n(h)}" fill="${color}" mask="url(#${this.masks.get(key)})"/></g>`);
  }

  flush(svg) {
    svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    svg.setAttribute('width', this.width);
    svg.setAttribute('height', this.height);
    svg.innerHTML = `<defs>${this.defs.join('')}</defs>${this.body.join('')}`;
  }
}
