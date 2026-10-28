// The Info editor (SPACE_INFO, space_info.cc and info_draw.cc): the window manager's reports (wm-reports.js) drawn
// as textview.cc draws them, newest at the bottom, each with its type's icon; selection, copy and delete are
// Blender's info.* operators, run through its Info keymap. The header is INFO_HT_header (space_info.py).
import { createApp, h, reactive, markRaw, Teleport } from 'vue';
import { LayoutView } from '../interface/layout-view.js';
import { areaUI, keyEvent } from '../interface/area-ui.js';
import { createContext } from '../../blenkernel/context.js';
import { registerOperators, contextArea } from '../../windowmanager/wm-operators.js';
import { reports, subscribeReports, reportsChanged } from '../../windowmanager/wm-reports.js';
import { setClipboard } from '../../makesrna/rna-bylonder.js';
import { textview, monoAdvance } from './textview.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';
import './info.css';

const KEYMAPS = ['Info', 'Screen', 'Window'];
// info_textview_main__internal: 17 pixel lines with 0.4 of that above and below, after a margin and an icon.
const LHEIGHT = 17, PADDING = Math.floor(0.4 * LHEIGHT), MARGIN = Math.floor(0.45 * 20), ICON = 20, SCROLL_WIDTH = 13;
// icon_from_report_type and icon_colorid_from_report_type.
const ICONS = { ERROR: 'CANCEL', ERROR_INVALID_INPUT: 'CANCEL', ERROR_INVALID_CONTEXT: 'CANCEL', ERROR_OUT_OF_MEMORY: 'CANCEL', WARNING: 'ERROR', INFO: 'INFO', DEBUG: 'SYSTEM', PROPERTY: 'OPTIONS', OPERATOR: 'CHECKMARK' };
const iconClass = (type) => 'is-' + (type.startsWith('ERROR') ? 'error' : type.toLowerCase());

const info = () => contextArea()?.info ?? null;
const changed = () => reportsChanged();

registerOperators({
  'info.select_pick': { poll: () => !!info(), run: ({ extend = false }, event) => {
    const picked = info().pick(event);
    if (!extend) reports.forEach((r) => { r.selected = false; });
    if (picked) picked.selected = extend ? !picked.selected : true;
    changed();
  } },
  'info.select_all': { poll: () => !!info(), run: ({ action = 'SELECT' }) => {
    const none = !reports.some((r) => r.selected);
    reports.forEach((r) => { r.selected = { SELECT: true, DESELECT: false, INVERT: !r.selected, TOGGLE: none }[action]; });
    changed();
  } },
  'info.report_delete': { poll: () => !!info(), run: () => { const kept = reports.filter((r) => !r.selected); reports.splice(0, reports.length, ...kept); changed(); } },
  'info.report_copy': { poll: () => !!info(), run: () => { setClipboard(reports.filter((r) => r.selected).map((r) => r.message).join('\n')); } },
});

export function mountInfo(section, { header: headerHost, rna }) {
  const state = reactive({ revision: 0, width: 0 });
  const space = markRaw({ settings: {}, changed: () => state.revision++ });
  const area = { space: 'INFO' };
  const context = createContext(rna, { area: 'INFO', space });
  const areaui = areaUI({ area, context: () => context, keymaps: KEYMAPS, rna });
  // The report under the pointer (info_text_pick).
  area.info = { pick: (event) => reports[Number(document.elementFromPoint(event.native.clientX, event.native.clientY)?.closest('[data-report]')?.dataset.report)] ?? null };
  const dispatch = (event) => { const handled = areaui.handle(event); state.revision++; return handled; };
  const onPointerDown = (e) => {
    section.focus({ preventScroll: true });
    if (!e.target.closest('.bl-textview')) return;
    section.addEventListener('pointerup', () => dispatch({ ...keyEvent(e, 'CLICK'), type: ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE'][e.button], value: 'CLICK', native: e }), { once: true });
    dispatch({ ...keyEvent(e, 'PRESS'), type: ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE'][e.button], value: 'PRESS', native: e });
  };
  const onKeyDown = (e) => { if (dispatch(keyEvent(e))) { e.preventDefault(); e.stopPropagation(); } };

  const app = createApp({
    render() {
      void state.revision;
      const columns = Math.max(1, Math.floor((state.width - MARGIN - ICON - SCROLL_WIDTH) / monoAdvance(0.8 * LHEIGHT).whole));
      // Each line of a report is a row, the icon on its first; rows alternate shades by report (report_line_data).
      const items = reports.flatMap((report, index) => report.message.split('\n').map((text, line) => ({ text, report, index, line }))).reverse()
        .map(({ text, report, index, line }) => {
          const nth = reports.length - 1 - index;
          return { text, icon: line === 0 ? ICONS[report.type] ?? 'INFO' : null, iconClass: report.selected ? 'is-selected' : iconClass(report.type),
            className: [report.selected ? 'is-selected' : '', nth % 2 ? 'is-alt' : ''], attrs: { 'data-report': index } };
        });
      const view = textview({ items, lheight: LHEIGHT, padding: PADDING, left: MARGIN + ICON, columns, className: 'bl-info-view' });
      return h('div', { class: 'bl-ui bl-info flex h-full min-h-0 flex-col', 'data-blender': 'INFO', tabindex: -1 }, [
        headerHost ? h(Teleport, { to: headerHost }, [h('div', { class: 'bl-ui bl-area-header flex min-w-0 flex-1 items-center' }, [h(LayoutView, { layout: areaui.header('INFO_HT_header'), ui: areaui.layoutUI })])]) : null,
        h('div', { class: 'bl-info-main min-h-0 flex-1' }, [view]),
      ]);
    },
  });
  app.mount(section);
  // Keys typed here are this editor's, not the window's (main.js acceptsKey).
  section.classList.add('wm-area');
  section.tabIndex = -1;
  section.addEventListener('pointerdown', onPointerDown);
  section.addEventListener('keydown', onKeyDown);
  section.addEventListener('contextmenu', (e) => e.preventDefault());
  section.addEventListener('pointerenter', () => section.focus({ preventScroll: true }));
  const resized = new ResizeObserver(() => { state.width = section.clientWidth; });
  resized.observe(section);
  const unsubscribe = subscribeReports(() => state.revision++);
  return { refresh: () => state.revision++, dispose() { unsubscribe(); resized.disconnect(); app.unmount(); } };
}
