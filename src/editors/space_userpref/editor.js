// The Preferences editor (space_userpref.cc): Blender's own, an area in the module whose regions Blender lays out over
// its Preferences (U): the header (USERPREF_HT_header), the navigation bar (USERPREF_PT_navigation_bar), the execute
// region under it (USERPREF_PT_save_preferences) and the active section's panels, all Blender's Python panels drawn by
// block-view.js. What Bylonder does not honor is greyed by Bylonder's own add-on (python/bylonder_addon.js).
import { createApp, h, reactive, Teleport, markRaw } from 'vue';
import { blenderMain } from '../../bmesh/bmesh-wasm.js';
import { AnimArea, RGN_TYPE_WINDOW, RGN_TYPE_HEADER, RGN_TYPE_UI } from '../animation/anim-area.js';
import { regionPanels, regionHeader, menuTree, panelClosedSet } from '../interface/ui-tree.js';
import { BlockView, PanelsView, treeMenu } from '../interface/block-view.js';
import { openMenu } from '../interface/menu.js';
import { inArea, invokeOperator } from '../../windowmanager/wm-operators.js';
import { keymapHandler, blenderKeys } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import { preferencesChanged } from '../../windowmanager/wm-userdef.js';
import { greyUnsupported } from './support.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';

const SPACE_USERPREF = 19, RGN_TYPE_EXECUTE = 10;
const KEYMAPS = ['Preferences', 'Window', 'Screen'];

export function mountPreferences(host, { headerHost } = {}) {
  const state = reactive({ revision: 0 });
  const area = markRaw(new AnimArea(blenderMain(), SPACE_USERPREF));
  const size = { width: 700, height: 500, nav: 150, header: 26, execute: 30 };
  const layout = () => {
    area.layout(RGN_TYPE_HEADER, 0, 0, size.width, size.header);
    area.layout(RGN_TYPE_UI, 0, size.execute, size.nav, size.height - size.execute);
    area.layout(RGN_TYPE_EXECUTE, 0, 0, size.nav, size.execute);
    area.layout(RGN_TYPE_WINDOW, size.nav, size.header, Math.max(1, size.width - size.nav), size.height);
  };
  const refresh = () => { state.revision++; preferencesChanged(); };
  const regionUI = (type) => markRaw({
    inContext: (fn) => area.inContext(type, fn),
    refresh,
    undoPush: refresh,
    report: (error) => console.error(error),
    run: (idname, props, event) => { inArea(contextArea, () => area.inContext(type, () => invokeOperator(idname, props, event))); refresh(); },
    keys: (idname, props) => blenderKeys(KEYMAPS, idname, props),
    panelClosed: (id, closed) => area.inContext(type, (C) => panelClosedSet(C, id, closed)),
  });
  const ui = Object.fromEntries([RGN_TYPE_HEADER, RGN_TYPE_UI, RGN_TYPE_EXECUTE, RGN_TYPE_WINDOW].map((type) => [type, regionUI(type)]));
  const contextArea = {
    blender: true,
    menu: (name) => (event) => openMenu(treeMenu(area.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, name)) ?? { children: [] }, ui[RGN_TYPE_WINDOW]),
      event?.currentTarget instanceof Element ? event.currentTarget : { x: event?.native?.clientX ?? event?.clientX ?? 0, y: event?.native?.clientY ?? event?.clientY ?? 0 }),
  };
  const keys = keymapHandler(KEYMAPS);
  const onKeydown = (e) => {
    if (e.target.closest('input,textarea,select') || e.repeat) return;
    const event = { type: keyType(e), value: 'PRESS', shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, native: e };
    if (inArea(contextArea, () => keys(event))) { e.preventDefault(); e.stopPropagation(); }
  };

  const panels = (type) => (area.inContext(type, (C) => regionPanels(C))?.panels ?? []).map(greyUnsupported);
  const app = createApp({
    render() {
      void state.revision;
      layout();
      const header = area.inContext(RGN_TYPE_HEADER, (C) => regionHeader(C)) ?? [];
      const headerView = h('div', { class: 'bl-ui bl-area-header flex min-w-0 flex-1 items-center' }, header.map((tree) => h(BlockView, { tree, ui: ui[RGN_TYPE_HEADER], header: true })));
      return h('section', { class: 'bl-ui bl-preferences flex h-full flex-col overflow-hidden bg-region', 'data-blender': 'PREFERENCES', tabindex: -1, onKeydown,
        onPointerenter: (e) => e.currentTarget.focus({ preventScroll: true }) }, [
        h('div', { class: 'flex min-h-0 flex-1' }, [
          h('div', { class: 'bl-preferences-nav flex shrink-0 flex-col bg-navigation-bar', 'data-blender': 'USERPREF_PT_navigation_bar' }, [
            h('div', { class: 'min-h-0 flex-1 overflow-y-auto' }, h(PanelsView, { panels: panels(RGN_TYPE_UI), ui: ui[RGN_TYPE_UI] })),
            h('div', { class: 'shrink-0', 'data-blender': 'USERPREF_PT_save_preferences' }, h(PanelsView, { panels: panels(RGN_TYPE_EXECUTE), ui: ui[RGN_TYPE_EXECUTE] })),
          ]),
          h('div', { class: 'bl-preferences-region min-w-0 flex-1 overflow-y-auto' }, h(PanelsView, { panels: panels(RGN_TYPE_WINDOW), ui: ui[RGN_TYPE_WINDOW] })),
        ]),
        headerHost ? h(Teleport, { to: headerHost }, [headerView]) : h('div', { class: 'flex h-(--bl-header-h) shrink-0 bg-header' }, [headerView]),
      ]);
    },
  });
  app.mount(host);
  const observer = new ResizeObserver(() => {
    const region = host.querySelector('.bl-preferences-region'), nav = host.querySelector('.bl-preferences-nav');
    Object.assign(size, { width: host.clientWidth || size.width, height: region?.clientHeight || size.height, nav: nav?.clientWidth || size.nav });
    state.revision++;
  });
  observer.observe(host);
  return {
    refresh() { state.revision++; },
    dispose() { observer.disconnect(); app.unmount(); area.dispose(); },
  };
}
