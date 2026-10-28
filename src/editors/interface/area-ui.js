// An editor's regions drawn from Blender's scripts (Text Editor, Python Console, Info): its header and footer
// (bpy.types.Header) and sidebar panels through the shared layout renderer, its menus, and its keymaps, all run in the
// editor's area (inArea) with its bpy.context.
//   area: the context area ({ menu, space, ... }, wm-operators.js), context(): its bpy.context, keymaps: the region's
//   keymap names in handler order, rna: createRNA(host), ids(struct): the data-blocks a pointer can point to, idIcon:
//   the icon of the editor's data-blocks.
import { markRaw, reactive } from 'vue';
import { menus as MENUS, headers as HEADERS, panels as PANELS } from '../../python/bpy_interface.js';
import { propBinding } from '../../makesrna/rna-bylonder.js';
import { menuUI, inArea, invokeOperator, registerOperator, contextArea } from '../../windowmanager/wm-operators.js';
import { keymapHandler } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import { headerLayout, panelTypes, drawPanels } from './panels.js';
import { panelState } from './layout-view.js';
import { useContext } from './layout.js';
import { drawMenu } from './ui-layout.js';
import { openMenu } from './menu.js';

// A DOM event as the window manager's event for keymaps: Blender's type, value, modifiers, the typed character.
export const keyEvent = (e, value = 'PRESS') => ({
  type: keyType(e), value, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, repeat: e.repeat,
  text: e.key?.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : '', native: e,
});

// wm.context_toggle on the editor's own context (space_data.show_region_ui), as Blender's runs in the context area.
const contextToggle = {
  run: ({ data_path = '' }) => {
    const path = data_path.split('.'), key = path.pop(), owner = path.reduce((data, name) => data?.[name], contextArea().context());
    if (typeof owner?.[key] !== 'boolean') return 'PASS_THROUGH';
    owner[key] = !owner[key];
  },
};

export function areaUI({ area, context, keymaps, rna, ids = () => [], idIcon }) {
  const state = reactive({ revision: 0, open: {} });
  area.context = context;
  registerOperator('wm.context_toggle', contextToggle, area.space);
  const inThisArea = (fn) => (...args) => inArea(area, () => { useContext(context()); return fn(...args); });
  const ui = menuUI({ menus: MENUS, context, prop: propBinding(rna.host), keymaps: () => keymaps });
  Object.assign(ui, { run: inThisArea(ui.run), supported: inThisArea(ui.supported), poll: inThisArea(ui.poll), keys: inThisArea(ui.keys) });
  const menuItems = inThisArea((name) => drawMenu(name, ui));
  area.menu ??= (name) => (MENUS[name] ? (event) => openMenu(() => menuItems(name), event?.native ? { x: event.native.clientX, y: event.native.clientY } : event, MENUS[name].bl_label ?? '') : null);
  const panels = panelState(state);
  const refresh = () => state.revision++;
  const layoutUI = markRaw({
    get revision() { return state.revision; },
    undoPush: (name) => { rna.host.undoPush?.(name); refresh(); },
    report: (error) => rna.host.notify?.(error.message),
    run: (idname, props, event) => { const result = inThisArea(invokeOperator)(idname, props, event); refresh(); return result; },
    supported: ui.supported,
    poll: ui.poll,
    isOpen: panels.isOpen,
    toggle: (id, event, closed) => { panels.toggle(id, event, closed); refresh(); },
    ids,
    structIcon: () => idIcon,
    drawMenu: menuItems,
    menuLabel: (idname) => MENUS[idname]?.bl_label,
    menuContents: (idname) => MENUS[idname] && markRaw(headerLayout(context(), (layout) => Object.assign(MENUS[idname](), { layout }).draw(context()))),
    popover: (id) => {
      const type = PANELS[id];
      if (!type) return null;
      const [drawn] = drawPanels({ roots: [{ type, children: [] }] }, context(), { contexts: [type.bl_context].filter(Boolean) });
      return drawn?.body && { label: drawn.label, layout: drawn.body, units: type.bl_ui_units_x };
    },
  });
  // A header type's layout (TEXT_HT_header, TEXT_HT_footer).
  const header = (idname) => headerLayout(context(), (layout) => Object.assign(HEADERS[idname](), { layout }).draw(context()));
  // A region's panels (the sidebar's TEXT_PT_*), in Blender's order and filtered by poll.
  const regionPanels = (space, region) => drawPanels(panelTypes([{ classes: Object.values(PANELS) }], { space, region }), context(), { contexts: [], open: panels.isOpen });
  const keys = keymapHandler(keymaps);
  const handle = inThisArea((event) => keys(event));
  return { state, ui, layoutUI, header, regionPanels, handle, menuItems, refresh, inArea: inThisArea };
}
