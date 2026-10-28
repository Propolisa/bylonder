// textview.cc, which the Python Console and the Info editor draw with: items from the bottom up, each wrapped at
// whole characters of the monospace font (at 0.8 of the line height), with its colors, an optional icon, and the
// selection counted in characters from the end of all items.
import { h } from 'vue';
import { icon } from '../interface/layout-view.js';
import './textview.css';

// BLF_fixed_width at a font size, in whole pixels as Blender truncates it, and the spacing that makes the browser's
// advance match.
const advances = new Map();
export function monoAdvance(size) {
  if (!advances.has(size)) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--bl-font-mono') || 'monospace'}`;
    const exact = ctx.measureText('0'.repeat(10)).width / 10, whole = Math.max(1, Math.floor(exact));
    advances.set(size, { whole, spacing: whole - exact });
  }
  return advances.get(size);
}

// The item under a point and the character offset in it, from the end of all items (textview_draw's mval pick).
export function pickOffset(container, x, y) {
  const caret = document.caretPositionFromPoint?.(x, y) ?? document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? caret?.startContainer, at = caret?.offset ?? caret?.startOffset ?? 0;
  const item = node?.parentElement?.closest('[data-end]') ?? document.elementFromPoint(x, y)?.closest('[data-end]');
  if (!item || !container.contains(item)) return null;
  // The offset within the item's text: the characters of the spans before the caret's.
  let before = 0;
  for (const span of item.querySelectorAll('.bl-textview-text > span')) {
    if (span.contains(node)) { before += at; break; }
    before += span.textContent.length;
  }
  const length = Number(item.dataset.length);
  return Number(item.dataset.end) + length - Math.min(before, length);
}

// A selection [start, end) from the end of all text, as the part of an item ending `end` characters from it.
const selected = (text, end, select) => {
  if (!select || select[0] === select[1]) return null;
  const from = Math.max(0, text.length - (select[1] - end)), to = Math.min(text.length, text.length - (select[0] - end));
  return to > from ? [from, to] : null;
};

// items: newest first, { text, className, icon, iconClass, attrs }; select: [start, end] from the end.
export function textview({ items, lheight, padding = 0, left, columns, className, select, after }) {
  const { whole, spacing } = monoAdvance(0.8 * lheight);
  let end = 0;
  const rows = items.map((item, i) => {
    const range = selected(item.text, end, select), parts = range ? [item.text.slice(0, range[0]), item.text.slice(...range), item.text.slice(range[1])] : [item.text];
    const row = h('div', { key: i, class: ['bl-textview-item', item.className], style: { padding: `${padding}px 0` }, 'data-end': end, 'data-length': item.text.length, ...item.attrs }, [
      item.icon ? h('span', { class: ['bl-textview-icon', item.iconClass], style: { left: left - 1.2 * 24 + 'px', top: padding + (lheight - 24) / 2 + 'px' } }, icon(item.icon)) : null,
      h('div', { class: 'bl-textview-text', style: { marginLeft: left + 'px', width: columns * whole + 'px' } },
        parts.map((part, k) => h('span', { class: range && k === 1 ? 'is-selected' : null }, part))),
      i === 0 ? after?.(whole) : null,
    ]);
    end += item.text.length + 1;
    return row;
  });
  return h('div', { class: ['bl-textview', className], style: { '--lh': lheight + 'px', '--font-size': 0.8 * lheight + 'px', '--letter-spacing': spacing + 'px', '--cw': whole + 'px' } }, rows);
}
