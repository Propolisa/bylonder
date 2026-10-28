// The Text Editor (SPACE_TEXT, space_text.cc and text_draw.cc): Blender's header, footer and sidebar from its scripts
// (space_text.py, through areaUI), the main region drawn as text_draw.cc lays it out (line numbers, syntax colors,
// selection, line highlight, cursor, margin, scroll bar) and every event through Blender's Text keymaps, which run the
// text operators (text-ops.js) on this editor.
import { createApp, h, reactive, markRaw, Teleport, nextTick } from 'vue';
import { LayoutView, RegionView } from '../interface/layout-view.js';
import { areaUI, keyEvent } from '../interface/area-ui.js';
import { createContext } from '../../blenkernel/context.js';
import { TXT_TABSIZE } from '../../blenkernel/texts.js';
import { WM_DRAG_THRESHOLD_MOUSE } from '../../windowmanager/wm-event-system.js';
import { formatText, flatten, isSyntaxHighlightSupported, FMT } from './text-format.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';
import './text-editor.css';

// The keymaps of the main region (text_main_region_init), then the window's.
const KEYMAPS = ['Text Generic', 'Text', 'Screen', 'Window'];
const BUTTONS = ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE', 'BUTTON4MOUSE', 'BUTTON5MOUSE'];
// SpaceText's defaults (space_text_create).
const DEFAULTS = { show_line_numbers: true, show_word_wrap: false, show_syntax_highlight: true, show_line_highlight: true, show_margin: false, margin_column: 80,
  font_size: 12, tab_width: TXT_TABSIZE, show_region_ui: false, show_region_footer: true, use_live_edit: false, use_match_case: false, use_find_wrap: true,
  use_find_all: false, find_text: '', replace_text: '', overwrite: false, select_start: 0, select_end: 0 };
// TXT_LINE_VPAD, TXT_NUMCOL_PAD, TXT_BODY_LPAD (text_intern.hh) and TXT_SCROLL_WIDTH (a widget unit).
const LINE_VPAD = 0.3, NUMCOL_PAD = 1, BODY_LPAD = 1, SCROLL_WIDTH = 20;
const FORMAT_CLASS = { [FMT.SYMBOL]: 's', [FMT.COMMENT]: 'c', [FMT.NUMERAL]: 'n', [FMT.STRING]: 'l', [FMT.DIRECTIVE]: 'd', [FMT.SPECIAL]: 'v', [FMT.RESERVED]: 'r', [FMT.KEYWORD]: 'b' };

// BLF_fixed_width: the monospace font's advance at a size, whole pixels as Blender truncates it.
const advance = (() => {
  const cache = new Map();
  return (size) => {
    if (!cache.has(size)) {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--bl-font-mono') || 'monospace'}`;
      const exact = ctx.measureText('0'.repeat(10)).width / 10;
      cache.set(size, { exact, whole: Math.max(1, Math.floor(exact)) });
    }
    return cache.get(size);
  };
})();

export function mountTextEditor(section, { header: headerHost, rna, texts, beforeRun = () => {} }) {
  const state = reactive({ revision: 0, width: 0, height: 0 });
  const space = markRaw({
    settings: { ...DEFAULTS },
    text: null,
    top: 0,
    changed: () => state.revision++,
    setText(text) { space.text = text; space.top = 0; space.changed(); },
    scrollTo(top) { space.top = Math.max(0, Math.min(top, Math.max(0, rows().length - 1))); space.changed(); },
    visibleLines: () => visibleLines(),
  });
  const area = { space: 'TEXT_EDITOR' };
  const context = () => createContext(rna, { area: 'TEXT_EDITOR', space });
  const areaui = areaUI({ area, context, keymaps: KEYMAPS, rna, idIcon: 'TEXT', ids: (struct) => (struct === 'Text' ? texts.all.map((text) => rna.pointer('Text', text)) : []) });
  const refresh = () => { state.revision++; areaui.refresh(); };

  // ---- Metrics (text_draw.cc): line height, character width, the line number column and the body's left edge.
  const metrics = () => {
    const lheight = space.settings.font_size, { exact, whole } = advance(lheight);
    const digits = space.settings.show_line_numbers && space.text ? String(space.text.lines.length).length : 0;
    const gutter = digits ? whole * (digits + 2 * NUMCOL_PAD) : 0;
    return { lheight, line: Math.floor((1 + LINE_VPAD) * lheight), cw: whole, spacing: whole - exact, digits, gutter, left: gutter + BODY_LPAD * whole };
  };
  const visibleLines = () => { const m = metrics(); return Math.max(1, Math.floor((state.height + m.lheight - 1) / m.line)); };
  // The visual rows: one per line, or a line's wrapped pieces with word wrap (columns of the body's width).
  const rows = () => {
    const text = space.text;
    if (!text) return [];
    const m = metrics(), columns = Math.max(8, Math.floor((state.width - m.left - SCROLL_WIDTH) / m.cw));
    const tab = space.settings.tab_width;
    return text.lines.flatMap((line, index) => {
      const flat = flatten(line, tab);
      if (!space.settings.show_word_wrap || flat.length <= columns) return [{ line: index, start: 0, end: flat.length }];
      const pieces = [];
      for (let start = 0; start < flat.length; start += columns) pieces.push({ line: index, start, end: Math.min(flat.length, start + columns) });
      return pieces;
    });
  };
  const column = (line, ch) => flatten(line.slice(0, ch), space.settings.tab_width).length;
  const fromColumn = (line, col) => { for (let i = 0; i <= line.length; i++) if (column(line, i) >= col) return i; return line.length; };
  // The visual row and column of a text position.
  const rowOf = (all, line, ch) => {
    const col = column(space.text.lines[line], ch);
    const index = all.findIndex((row) => row.line === line && col >= row.start && (col < row.end || all[all.indexOf(row) + 1]?.line !== line));
    const i = index < 0 ? all.findIndex((row) => row.line === line) : index;
    return { row: i, col: col - all[i].start };
  };
  // A region point (pixels from the top left) as a text position.
  const positionAt = (x, y) => {
    const all = rows(), m = metrics(), row = all[Math.max(0, Math.min(all.length - 1, space.top + Math.floor(y / m.line)))];
    const line = space.text.lines[row.line], col = row.start + Math.max(0, Math.round((x - m.left) / m.cw));
    return { line: row.line, ch: fromColumn(line, Math.min(col, row.end)) };
  };
  // space_text_scroll_to_cursor: the selection's end in view.
  const scrollToCursor = () => {
    const text = space.text;
    if (!text || !state.height) return;
    const { row } = rowOf(rows(), text.sell, text.selc), visible = visibleLines();
    if (row < space.top) space.top = row;
    else if (row >= space.top + visible) space.top = row - visible + 1;
  };

  // ---- What the text operators ask of the editor (contextArea().textEditor).
  let drag = null;
  const editor = {
    space, area, context: () => context(), beforeRun,
    edited(text, { save = true } = {}) { if (save) texts.edited(text); scrollToCursor(); refresh(); },
    visibleLines,
    lineEdge: (text, sel, end) => (end ? text.moveEol(sel) : text.moveBol(sel)),
    moveLines(text, sel, count) { for (let i = 0; i < Math.abs(count); i++) (count < 0 ? text.moveUp(sel) : text.moveDown(sel)); },
    cursorAt(text, event, sel) { const { line, ch } = positionAt(event.x, event.y); text.moveTo(line, ch, sel); },
    // text.selection_set: from the press (or the cursor, with Shift) to the pointer while the button is held.
    selectFrom(text, event) { editor.cursorAt(text, event, event.value !== 'CLICK_DRAG'); drag = { kind: 'select' }; },
    scroll(lines) { space.scrollTo(space.top + lines); },
    dragScroll(event) { drag = { kind: 'scroll', y: event.y, top: space.top }; },
    scrollBar(event) {
      if (event.x < state.width - SCROLL_WIDTH) return 'PASS_THROUGH';
      drag = { kind: 'bar' };
      scrollBarTo(event.y);
    },
    lineNumber(event) { return event.x < metrics().gutter ? jumpDigits(event.text) : 'PASS_THROUGH'; },
    startFind() {
      const text = space.text;
      if (text?.hasSel()) space.settings.find_text = text.selText();
      space.settings.show_region_ui = true;
      refresh();
      nextTick(() => section.querySelector('.bl-text-sidebar input')?.focus());
    },
  };
  area.textEditor = editor;
  const scrollBarTo = (y) => space.scrollTo(Math.round((y / state.height) * rows().length - visibleLines() / 2));
  // text.line_number: digits typed over the line numbers jump to that line.
  let typed = '', typedAt = 0;
  function jumpDigits(ch) {
    if (!/\d/.test(ch ?? '')) return 'PASS_THROUGH';
    typed = performance.now() - typedAt < 1000 ? typed + ch : ch;
    typedAt = performance.now();
    space.text.moveTo(Number(typed) - 1, 0, false);
    editor.edited(space.text, { save: false });
  }

  // ---- Events into Blender's, positions relative to the main region.
  const main = () => section.querySelector('.bl-text-main');
  const regionEvent = (e, type, value) => {
    const r = main().getBoundingClientRect();
    return { ...keyEvent(e, value), type, value, x: e.clientX - r.left, y: e.clientY - r.top, native: e };
  };
  const dispatch = (event) => { const handled = areaui.handle(event); refresh(); return handled; };
  let press = null;
  const onPointerDown = (e) => {
    section.focus({ preventScroll: true });
    if (!e.target.closest('.bl-text-main')) return;
    const type = BUTTONS[e.button];
    main().setPointerCapture(e.pointerId);
    let handled = e.detail === 2 && type === 'LEFTMOUSE' && dispatch(regionEvent(e, type, 'DOUBLE_CLICK'));
    if (!handled) handled = dispatch(regionEvent(e, type, 'PRESS'));
    press = { type, e, dragged: false };
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (drag && space.text) {
      const event = regionEvent(e, 'MOUSEMOVE', 'NOTHING');
      if (drag.kind === 'select') { const { line, ch } = positionAt(event.x, event.y); space.text.moveTo(line, ch, true); scrollToCursor(); }
      if (drag.kind === 'scroll') space.scrollTo(drag.top - Math.round((event.y - drag.y) / metrics().line));
      if (drag.kind === 'bar') scrollBarTo(event.y);
      refresh();
      return;
    }
    if (!press || press.dragged || Math.hypot(e.clientX - press.e.clientX, e.clientY - press.e.clientY) < WM_DRAG_THRESHOLD_MOUSE) return;
    press.dragged = true;
    dispatch(regionEvent(press.e, press.type, 'CLICK_DRAG'));
  };
  const onPointerUp = (e) => {
    const down = press;
    press = null;
    if (drag) { drag = null; return; }
    if (down && !down.dragged) dispatch(regionEvent(e, down.type, 'CLICK'));
  };
  const onWheel = (e) => {
    if (!e.target.closest('.bl-text-main')) return;
    e.preventDefault();
    dispatch(regionEvent(e, e.deltaY < 0 ? 'WHEELUPMOUSE' : 'WHEELDOWNMOUSE', 'PRESS'));
  };
  const onKeyDown = (e) => {
    if (e.target.closest('input,textarea,select')) return;
    if (dispatch(keyEvent(e))) { e.preventDefault(); e.stopPropagation(); }
  };

  // ---- The main region (draw_text_main).
  function drawMain() {
    const text = space.text, m = metrics(), s = space.settings;
    const style = { '--lh': m.line + 'px', '--cw': m.cw + 'px', '--font-size': m.lheight + 'px', '--letter-spacing': m.spacing + 'px', '--body-left': m.left + 'px' };
    if (!text) return h('div', { class: 'bl-text-main', style });
    const all = rows(), visible = all.slice(space.top, space.top + visibleLines() + 1);
    const syntax = s.show_syntax_highlight && isSyntaxHighlightSupported(text), formats = syntax ? formatText(text.lines, s.tab_width) : null;
    const y = (row) => (row - space.top) * m.line;
    const x = (col) => m.left + col * m.cw;
    const rect = (left, top, width, cls) => h('div', { class: cls, style: { left: left + 'px', top: top + 'px', width: width + 'px' } });
    const children = [];
    if (m.gutter) children.push(h('div', { class: 'bl-text-gutter', style: { width: m.gutter + 'px' } }));
    if (s.show_margin) children.push(h('div', { class: 'bl-text-margin', style: { left: x(s.margin_column) + 'px' } }));
    // Selection (TH_SHADE2), from the cursor to the selection's end, then the line highlight and the cursor.
    const cur = rowOf(all, text.curl, text.curc), sel = rowOf(all, text.sell, text.selc);
    if (text.hasSel()) {
      const [from, to] = cur.row < sel.row || (cur.row === sel.row && cur.col < sel.col) ? [cur, sel] : [sel, cur];
      for (let row = from.row; row <= to.row; row++) {
        if (row < space.top || row > space.top + visibleLines()) continue;
        const start = row === from.row ? x(from.col) : m.left - 1, end = row === to.row ? x(to.col) : state.width;
        if (end > start) children.push(rect(start, y(row), end - start, 'bl-text-selection'));
      }
    }
    if (s.show_line_highlight) {
      const lineRows = all.map((row, i) => [row, i]).filter(([row]) => row.line === text.sell).map(([, i]) => i);
      children.push(h('div', { class: 'bl-text-line-highlight', style: { top: y(lineRows[0]) + 'px', height: lineRows.length * m.line + 'px' } }));
    }
    for (const [i, row] of visible.entries()) {
      const line = text.lines[row.line], flat = flatten(line, s.tab_width).slice(row.start, row.end);
      const runs = formats ? sliceRuns(formats[row.line], row.start, row.end) : [{ text: flat, type: FMT.DEFAULT }];
      children.push(h('div', { class: 'bl-text-row', style: { top: i * m.line + 'px' } }, [
        m.gutter && row.start === 0 ? h('span', { class: ['bl-text-line-number', row.line === text.sell && 'is-current'], style: { left: NUMCOL_PAD * m.cw + 'px' } }, String(row.line + 1).padStart(m.digits)) : null,
        h('span', { class: 'bl-text-body' }, runs.map((run) => h('span', { class: FORMAT_CLASS[run.type] }, run.text))),
      ]));
    }
    if (sel.row >= space.top && sel.row <= space.top + visibleLines()) {
      children.push(h('div', { class: ['bl-text-cursor', s.overwrite && 'is-overwrite'], style: { left: x(sel.col) + 'px', top: y(sel.row) + 'px', width: s.overwrite ? m.cw + 'px' : undefined } }));
    }
    children.push(h('div', { class: 'bl-text-scroll' }, [h('div', { class: 'bl-text-scroll-thumb', style: scrollThumb(all.length) })]));
    return h('div', { class: 'bl-text-main', style }, children);
  }
  // calc_text_rcts: the thumb over the rows and half a view of blank lines, at least 20 pixels, in margins of 0.4 units.
  const scrollThumb = (count) => {
    const unit = SCROLL_WIDTH, available = state.height - 0.8 * unit, view = visibleLines();
    const total = Math.max(count + Math.floor(view / 2), space.top + view);
    const height = Math.max(20, (view * available) / total), start = ((available - Math.max(0, 20 - (view * available) / total)) * space.top) / total;
    return { top: 0.8 * unit + start + 'px', height: height + 'px' };
  };
  const sliceRuns = (runs, start, end) => {
    const out = [];
    let at = 0;
    for (const run of runs) {
      const from = Math.max(start, at), to = Math.min(end, at + run.text.length);
      if (to > from) out.push({ text: run.text.slice(from - at, to - at), type: run.type });
      at += run.text.length;
    }
    return out;
  };

  const app = createApp({
    render() {
      void state.revision;
      const ui = areaui.layoutUI, s = space.settings;
      return h('div', { class: 'bl-ui bl-text-editor flex h-full min-h-0 flex-col', 'data-blender': 'TEXT_EDITOR', tabindex: -1 }, [
        headerHost ? h(Teleport, { to: headerHost }, [h('div', { class: 'bl-ui bl-area-header flex min-w-0 flex-1 items-center' }, [h(LayoutView, { layout: areaui.header('TEXT_HT_header'), ui })])]) : null,
        h('div', { class: 'flex min-h-0 flex-1' }, [
          drawMain(),
          s.show_region_ui ? h('div', { class: 'bl-text-sidebar bl-region-sidebar shrink-0 overflow-y-auto' }, [h(RegionView, { panels: areaui.regionPanels('TEXT_EDITOR', 'UI'), ui })]) : null,
        ]),
        s.show_region_footer ? h('div', { class: 'bl-text-footer flex shrink-0 items-center', 'data-blender': 'TEXT_HT_footer' }, [h(LayoutView, { layout: areaui.header('TEXT_HT_footer'), ui })]) : null,
      ]);
    },
  });
  app.mount(section);
  // Keys typed here are this editor's, not the window's (main.js acceptsKey).
  section.classList.add('wm-area');
  section.tabIndex = -1;
  section.addEventListener('pointerdown', onPointerDown);
  section.addEventListener('pointermove', onPointerMove);
  section.addEventListener('pointerup', onPointerUp);
  section.addEventListener('wheel', onWheel, { passive: false });
  section.addEventListener('keydown', onKeyDown);
  section.addEventListener('contextmenu', (e) => e.preventDefault());
  // Keys go to the area under the pointer, as Blender's do.
  section.addEventListener('pointerenter', () => { if (!section.contains(document.activeElement)) section.focus({ preventScroll: true }); });
  const resized = new ResizeObserver(() => {
    const r = main()?.getBoundingClientRect();
    if (r) { state.width = r.width; state.height = r.height; }
  });
  nextTick(() => main() && resized.observe(main()));
  const unsubscribe = texts.subscribe(() => {
    if (space.text && !texts.all.includes(space.text)) space.text = texts.get(space.text.name);
    refresh();
  });
  return {
    editor,
    refresh,
    dispose() { unsubscribe(); resized.disconnect(); app.unmount(); },
  };
}
