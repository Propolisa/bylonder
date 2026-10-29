// The Properties editor (space_buttons.cc): Blender's own, an area in the module whose regions Blender lays out over
// Main (buttons_main_region_layout, buttons_context.cc's tabs and context, Blender's Python panels registered as
// Blender's panel types), drawn by block-view.js: the header, the navigation bar's tabs and the panels. Main is made
// current from the scene before it draws, and what its buttons change reaches the scene after (the scene sync).
// Bylonder's own panels go after Blender's in their tab, as add-ons' do.
import { createApp, h, reactive, Teleport, markRaw } from 'vue';
import { blenderMain } from '../../bmesh/bmesh-wasm.js';
import { AnimArea, RGN_TYPE_WINDOW, RGN_TYPE_HEADER } from '../animation/anim-area.js';
import { regionPanels, regionHeader, menuTree, panelClosedSet } from '../interface/ui-tree.js';
import { BlockView, PanelsView, treeMenu } from '../interface/block-view.js';
import { panelState } from '../interface/layout-view.js';
import { openMenu } from '../interface/menu.js';
import { pointerStruct, structFind } from '../../python/bpy_rna.js';
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import { inArea, invokeOperator } from '../../windowmanager/wm-operators.js';
import { keymapHandler, blenderKeys } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import './properties-operators.js';
import { blenderButton } from '../animation/keyframing-button.js';
import { propertyPanels } from './registry.js';
import { addonPanels } from './addon-panels.js';
import { hasMesh } from '../object/identity.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';

const { exports: x } = blenderModule;
const SPACE_PROPERTIES = 4, RGN_TYPE_NAV_BAR = 9;

export function mountProperties(host, { world, editor, history, systems, properties, storage, files = [] }, areaId = 'properties', headerHost) {
  const key = 'workbench:properties:' + areaId;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* No saved state: Blender's defaults. */ }
  const state = reactive({ open: saved.open || {}, revision: 0 });
  const save = () => { try { localStorage.setItem(key, JSON.stringify({ open: state.open })); } catch { /* Storage blocked. */ } };
  const area = markRaw(new AnimArea(blenderMain(), SPACE_PROPERTIES));
  // The space's RNA (SpaceProperties): its tab (context), pinned data and search.
  const space = () => pointerStruct(structFind('SpaceProperties'), 0, x.anim_area_space(area.pointer) >>> 0);
  const ob = () => editor.selection.nodes.at(-1);
  const sync = world.mainSync;

  // Region sizes from the editor's own boxes, as the screen gives Blender's regions theirs.
  const size = { width: 300, height: 600, nav: 30, header: 26 };
  const layout = () => {
    area.layout(RGN_TYPE_HEADER, 0, size.height, size.width, size.header);
    area.layout(RGN_TYPE_NAV_BAR, 0, 0, size.nav, size.height);
    area.layout(RGN_TYPE_WINDOW, size.nav, 0, Math.max(1, size.width - size.nav), size.height);
  };

  // What a region's buttons need: its context, and after a change the scene made current and redrawn (an undo step at
  // the end of an edit).
  const refresh = () => { sync?.writeBack(); state.revision++; };
  const regionUI = (type) => markRaw({
    inContext: (fn) => area.inContext(type, fn),
    refresh,
    undoPush: () => { refresh(); history.commit(); },
    report: (error) => world.notify?.(error.message ?? String(error)),
    run: (idname, props, event) => { inArea(contextArea, () => invokeOperator(idname, props, event)); refresh(); },
    keys: (idname, props) => blenderKeys(['Property Editor', 'Window'], idname, props),
    panelClosed: (id, closed) => area.inContext(type, (C) => panelClosedSet(C, id, closed)),
    button: (b) => blenderButton(area, type, b, () => { refresh(); history.commit(); }),
  });
  const ui = { [RGN_TYPE_HEADER]: regionUI(RGN_TYPE_HEADER), [RGN_TYPE_NAV_BAR]: regionUI(RGN_TYPE_NAV_BAR), [RGN_TYPE_WINDOW]: regionUI(RGN_TYPE_WINDOW) };

  // The tabs Blender offers (the navigation bar's buttons for SpaceProperties.context).
  let tabs = [];
  // This editor as the context area (wm-operators.js): its menus, and what its operators act on (properties-operators.js).
  const contextArea = {
    menu: (name) => (event) => openMenu(treeMenu(area.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, name)) ?? { children: [] }, ui[RGN_TYPE_WINDOW]),
      event?.currentTarget instanceof Element ? event.currentTarget : { x: event?.native?.clientX ?? 0, y: event?.native?.clientY ?? 0 }),
    properties: {
      cycle(step) {
        const at = tabs.indexOf(space().context);
        space().context = tabs[(at + step + tabs.length) % tabs.length];
        refresh();
      },
      startFilter: () => host.querySelector('.bl-properties-header input')?.focus(),
      clearFilter: () => { space().search_filter = ''; refresh(); },
      canAddModifier: () => space().context === 'MODIFIER' && !!ob() && hasMesh(ob()),
      newTexture: () => world.textures?.create(null),
      materials: () => {
        const node = ob(), library = world.materials;
        if (!node?.getTotalVertices || !library) return null;
        return { count: () => library.slots(node).length, add: () => library.addSlot(node), remove: () => library.removeSlot(node),
          move: (delta) => library.moveSlot(node, library.active(node), delta), newMaterial: () => library.newMaterial(node) };
      },
    },
    // The modifier an operator of a modifier's panel names (its `modifier` property), else the last.
    modifier: (name) => {
      const node = ob(), stack = node && world.modifiers?.stack(node);
      const modifier = stack?.find((m) => m.name === name) ?? stack?.at(-1);
      return modifier ? { remove: () => world.modifiers.remove(node, modifier.id), duplicate: () => world.modifiers.duplicate(node, modifier.id),
        apply: () => world.modifiers.apply(node, modifier.id) } : null;
    },
  };
  const keys = keymapHandler(['Property Editor', 'Frames', 'Screen', 'Window']);
  const onKeydown = (e) => {
    if (e.target.closest('input,textarea,select') || e.repeat) return;
    const event = { type: keyType(e), value: 'PRESS', shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, native: e };
    if (inArea(contextArea, () => keys(event))) { e.preventDefault(); e.stopPropagation(); }
  };

  // Bylonder's panels keep their open state here, as Blender's keep theirs in the region.
  const addonState = panelState(state);
  const addonUI = { isOpen: addonState.isOpen, toggle: (id, event, closed) => { addonState.toggle(id, event, closed); save(); }, undoPush: () => history.commit() };

  const app = createApp({
    render() {
      void state.revision;
      sync?.flush();
      layout();
      const header = area.inContext(RGN_TYPE_HEADER, (C) => regionHeader(C)) ?? [];
      const nav = area.inContext(RGN_TYPE_NAV_BAR, (C) => regionPanels(C));
      const main = area.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C));
      tabs = navigationTabs(nav, space());
      const headerView = h('div', { class: 'bl-ui bl-properties-header flex min-w-0 flex-1 items-center' }, header.map((tree) => h(BlockView, { tree, ui: ui[RGN_TYPE_HEADER] })));
      const tab = space().context;
      return h('section', { class: 'bl-ui bl-properties flex h-full flex-col overflow-hidden bg-region', 'data-blender': 'PROPERTIES', tabindex: -1, onKeydown,
        onPointerenter: (e) => e.currentTarget.focus({ preventScroll: true }) }, [
        headerHost ? h(Teleport, { to: headerHost }, [headerView]) : headerView,
        h('div', { class: 'flex min-h-0 flex-1' }, [
          h('div', { class: 'bl-navigation-bar flex shrink-0 flex-col items-center', 'data-blender': 'PROPERTIES_PT_navigation_bar' },
            h(PanelsView, { panels: nav.panels, ui: ui[RGN_TYPE_NAV_BAR] })),
          h('div', { class: 'bl-properties-region min-w-0 flex-1 overflow-y-auto' }, h(PanelsView, { panels: main.panels, ui: ui[RGN_TYPE_WINDOW] },
            () => addonPanels({ world, editor, history, systems, properties, storage, files, tab, node: ob(), state, registered: propertyPanels, ui: addonUI }))),
        ]),
      ]);
    },
  });
  app.mount(host);
  const observer = new ResizeObserver(() => {
    const region = host.querySelector('.bl-properties-region'), bar = host.querySelector('.bl-navigation-bar');
    Object.assign(size, { width: host.clientWidth || size.width, height: region?.clientHeight || size.height, nav: bar?.clientWidth || size.nav });
    state.revision++;
  });
  observer.observe(host);

  const sources = [world.modifiers, world.textures, world.materials, world.particles, world.compositor, world.sceneSettings, world.worlds, world.renderSettings, world.collections].filter(Boolean);
  const unsubscribers = [...sources, ...systems.map((system) => system.store)].map((source) => source.subscribe(() => state.revision++));
  return {
    refresh() { state.revision++; },
    context(id) { space().context = id; state.revision++; },
    dispose() { unsubscribers.forEach((fn) => fn()); observer.disconnect(); app.unmount(); area.dispose(); },
  };
}

// The tabs the navigation bar's buttons offer (prop_tabs_enum of SpaceProperties.context), in order.
function navigationTabs(nav, space) {
  const values = [];
  const visit = (node) => (node.kind === 'button' ? node.rna?.prop === 'context' && values.push(node.value) : node.children?.forEach(visit));
  nav.panels.forEach((panel) => panel.parts.forEach((part) => visit(part.layout)));
  const items = [...space.bl_rna.properties.get('context').enum_items];
  return values.map((value) => items.find((item) => item.value === value)?.identifier).filter(Boolean);
}
