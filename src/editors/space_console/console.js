// The Python Console (SPACE_CONSOLE, space_console.cc and console_draw.cc): Blender's header from its scripts
// (space_console.py), the scrollback and edit line drawn as textview.cc draws them, events through Blender's Console
// keymap (console-ops.js). Opening a console starts CPython loading; once it has, the console prints Blender's banner
// (console.banner), as an empty scrollback does in Blender.
import { createApp, h, reactive, markRaw, Teleport, nextTick } from 'vue';
import { LayoutView } from '../interface/layout-view.js';
import { areaUI, keyEvent } from '../interface/area-ui.js';
import { createContext } from '../../blenkernel/context.js';
import { runOperator } from '../../windowmanager/wm-operators.js';
import { WM_DRAG_THRESHOLD_MOUSE } from '../../windowmanager/wm-event-system.js';
import { loadPython } from '../../python/pyodide.js';
import { ConsoleSpace } from './console-ops.js';
import { textview, pickOffset, monoAdvance } from '../space_info/textview.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';
import './console.css';

const KEYMAPS = ['Console', 'Screen', 'Window'];
const BUTTONS = ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE', 'BUTTON4MOUSE', 'BUTTON5MOUSE'];
// console_textview_draw_rect_calc: a 4 pixel margin, the scroll bar's width (V2D_SCROLL_WIDTH) kept free.
const MARGIN = 4, SCROLL_WIDTH = 13;
const LINE_CLASS = { OUTPUT: 'is-output', INPUT: 'is-input', INFO: 'is-info', ERROR: 'is-error' };

export function mountConsole(section, { header: headerHost, rna, beforeRun = () => {} }) {
  const state = reactive({ revision: 0, width: 0, loading: false });
  const space = markRaw(new ConsoleSpace(() => state.revision++));
  const area = { space: 'CONSOLE' };
  // One context per console: its region is the one _console_python keys the console's namespace by.
  const context = createContext(rna, { area: 'CONSOLE', space });
  const areaui = areaUI({ area, context: () => context, keymaps: KEYMAPS, rna });
  let scroller = null, drag = null;
  const editor = {
    space, area, context: () => context, beforeRun,
    run: (fn) => areaui.inArea(fn)(),
    changed({ bottom = false } = {}) {
      state.revision++;
      areaui.refresh();
      if (bottom) nextTick(() => { if (scroller) scroller.scrollTop = 0; });
    },
    selectFrom(event) {
      const offset = pickOffset(scroller, event.native.clientX, event.native.clientY);
      if (offset === null) return 'PASS_THROUGH';
      space.settings.select_start = space.settings.select_end = offset;
      drag = { from: offset };
    },
    selectWord(event) {
      const offset = pickOffset(scroller, event.native.clientX, event.native.clientY);
      if (offset === null) return 'PASS_THROUGH';
      const text = space.text(), at = text.length - offset;
      let from = at, to = at;
      while (from > 0 && /\w/.test(text[from - 1])) from--;
      while (to < text.length && /\w/.test(text[to])) to++;
      space.settings.select_start = text.length - to;
      space.settings.select_end = text.length - from;
    },
  };
  area.console = editor;

  // CPython loads with the first console; Blender's console prints its banner when its scrollback is empty.
  const start = () => {
    if (state.loading) return;
    state.loading = true;
    loadPython().then(() => editor.run(() => { if (!space.scrollback.length) runOperator('console.banner'); }), (error) => {
      space.addScrollback(`Python could not load: ${error.message}`, 'ERROR');
    }).finally(() => editor.changed({ bottom: true }));
  };

  const dispatch = (event) => { const handled = areaui.handle(event); editor.changed(); return handled; };
  const regionEvent = (e, type, value) => ({ ...keyEvent(e, value), type, value, native: e });
  let press = null;
  const onPointerDown = (e) => {
    section.focus({ preventScroll: true });
    if (!e.target.closest('.bl-textview')) return;
    const type = BUTTONS[e.button];
    let handled = e.detail === 2 && type === 'LEFTMOUSE' && dispatch(regionEvent(e, type, 'DOUBLE_CLICK'));
    if (!handled) dispatch(regionEvent(e, type, 'PRESS'));
    press = { type, e, dragged: false };
  };
  const onPointerMove = (e) => {
    if (drag && press) {
      const offset = pickOffset(scroller, e.clientX, e.clientY);
      if (offset !== null) [space.settings.select_start, space.settings.select_end] = [Math.min(drag.from, offset), Math.max(drag.from, offset)];
      editor.changed();
      return;
    }
    if (!press || press.dragged || Math.hypot(e.clientX - press.e.clientX, e.clientY - press.e.clientY) < WM_DRAG_THRESHOLD_MOUSE) return;
    press.dragged = true;
    dispatch(regionEvent(press.e, press.type, 'CLICK_DRAG'));
  };
  const onPointerUp = () => { press = null; drag = null; };
  const onKeyDown = (e) => {
    if (e.target.closest('input,textarea,select')) return;
    if (dispatch(keyEvent(e))) { e.preventDefault(); e.stopPropagation(); }
  };
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    dispatch(regionEvent(e, e.deltaY < 0 ? 'WHEELUPMOUSE' : 'WHEELDOWNMOUSE', 'PRESS'));
  };

  // The edit line's cursor (console_textview_draw_cursor): after the prompt and the characters before it, wrapped.
  const cursor = (columns) => (cw) => {
    const col = space.settings.prompt.length + space.line.current_character, rows = Math.ceil(Math.max(1, space.settings.prompt.length + space.line.body.length) / columns);
    const row = Math.min(Math.floor(col / columns), rows - 1), x = col - row * columns;
    return h('div', { class: 'bl-console-cursor', style: { left: MARGIN + x * cw + 'px', top: row * space.settings.font_size + 'px' } });
  };
  const app = createApp({
    render() {
      void state.revision;
      const lheight = space.settings.font_size, cw = monoAdvance(0.8 * lheight).whole;
      const columns = Math.max(1, Math.floor((state.width - MARGIN - SCROLL_WIDTH) / cw));
      const items = [
        { text: space.settings.prompt + space.line.body, className: LINE_CLASS.INPUT },
        ...[...space.scrollback].reverse().map((line) => ({ text: line.body, className: LINE_CLASS[line.type] })),
      ];
      const { select_start, select_end } = space.settings;
      return h('div', { class: 'bl-ui bl-console flex h-full min-h-0 flex-col', 'data-blender': 'CONSOLE', tabindex: -1 }, [
        headerHost ? h(Teleport, { to: headerHost }, [h('div', { class: 'bl-ui bl-area-header flex min-w-0 flex-1 items-center' }, [h(LayoutView, { layout: areaui.header('CONSOLE_HT_header'), ui: areaui.layoutUI })])]) : null,
        h('div', { class: 'bl-console-main min-h-0 flex-1', ref: (el) => { scroller = el?.firstElementChild ?? scroller; } }, [
          textview({ items, lheight, left: MARGIN, columns, className: 'bl-console-view', select: select_start !== select_end ? [select_start, select_end] : null, after: cursor(columns) }),
        ]),
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
  section.addEventListener('pointerenter', () => section.focus({ preventScroll: true }));
  // Shown (an area of the screen) is opened: CPython starts loading then.
  const resized = new ResizeObserver(() => {
    state.width = section.clientWidth;
    if (section.clientWidth && section.clientHeight) start();
  });
  resized.observe(section);
  return { editor, refresh: () => editor.changed(), dispose() { resized.disconnect(); app.unmount(); } };
}
