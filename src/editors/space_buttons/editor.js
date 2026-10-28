// The Properties editor (space_buttons.cc): Blender's own header, navigation bar and panels (src/bl_ui, transpiled from
// Blender's properties_*.py and space_properties.py), drawn by the shared layout renderer (interface/layout-view.js)
// over Bylonder's data through Blender's RNA (makesrna/rna-bylonder.js), in the context buttons_context.cc gives
// (buttons-context.js). Bylonder's own panels go after Blender's in their tab, as add-ons' do.
import { createApp, h, reactive, Teleport, markRaw } from 'vue';
import { loadRNAUI, rnaProperty } from '../../makesrna/rna.js';
import { MODULES, panelTypes, drawPanels } from '../interface/panels.js';
import { UILayout } from '../interface/layout.js';
import { LayoutView, RegionView, panelState } from '../interface/layout-view.js';
import { drawMenu } from '../interface/ui-layout.js';
import { openMenu } from '../interface/menu.js';
import { menuUI, menuClasses, kw } from '../../windowmanager/wm-operators.js';
import { propertiesContext, propertiesTabs, propertiesPath, TAB_CONTEXTS, structIcon } from './buttons-context.js';
import { propertyPanels } from './registry.js';
import { addonPanels } from './addon-panels.js';
import { modifierTemplates } from './modifier-panel.js';
import { deleted } from '../object/identity.js';
import { modifierAddMenu } from './modifier-add-menu.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';

const modules = Promise.all(MODULES.map((name) => import(`../../bl_ui/${name}.js`).catch(() => null)));

// The path bar (buttons_panel_context_draw, C in Blender): the path of the data the tab shows, and the pin.
function contextBar(context, space) {
  const layout = new UILayout(), row = layout.row(kw({ align: true }));
  propertiesPath(context, space.context).forEach((struct, i) => {
    if (i) row.label(kw({ text: '', icon: 'RIGHTARROW_THIN' }));
    row.label(kw({ text: struct.name ?? '', icon: structIcon(struct) }));
  });
  row.separator_spacer();
  row.prop(context.space_data, 'use_pin_id', kw({ text: '', icon: space.pin ? 'PINNED' : 'UNPINNED', emboss: false }));
  return layout;
}

// A header (bpy.types.Header) drawn into a layout.
function drawHeader(type, context) {
  const header = type(), layout = new UILayout('row');
  header.layout = layout;
  header.draw(context);
  return layout;
}

export function mountProperties(host, { world, editor, history, rna, systems, properties, storage, files = [] }, areaId = 'properties', headerHost) {
  const key = 'workbench:properties:' + areaId;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* No saved state: Blender's defaults. */ }
  const state = reactive({ context: saved.context || 'OBJECT', pin: null, search: '', open: saved.open || {}, revision: 0, ready: false });
  const save = () => { try { localStorage.setItem(key, JSON.stringify({ context: state.context, open: state.open })); } catch { /* Storage blocked. */ } };
  let context, types, navigation, menus;
  const space = markRaw({
    get context() { return state.context; },
    set context(value) { state.context = value; save(); state.revision++; },
    get pin() { return state.pin && !deleted(state.pin.owner) ? state.pin.struct : null; },
    setPin(value) { state.pin = value ? { struct: context.object, owner: editor.selection.nodes.at(-1) } : null; state.revision++; },
    get search() { return state.search; },
    set search(value) { state.search = value; state.revision++; },
    tabs: () => propertiesTabs(context, rnaProperty('SpaceProperties', 'context').items),
  });
  const panels = panelState(state, () => []);
  const operatorUI = () => menuUI({ menus, context: () => context });
  const ui = {
    get revision() { return state.revision; },
    undoPush: (name) => { rna.host.undoPush?.(name); state.revision++; },
    report: (error) => world.notify?.(error.message),
    // wm.call_menu opens the menu under its button: Add Modifier's from the modifier types Bylonder has.
    run: (idname, props, event) => {
      if (idname !== 'wm.call_menu') return operatorUI().run(idname, props, event);
      const ob = editor.selection.nodes.at(-1);
      openMenu(props.name === 'OBJECT_MT_modifier_add' ? modifierAddMenu(world, ob, () => {}) : drawMenu(props.name, operatorUI()), event.currentTarget);
    },
    supported: (idname, props) => (idname === 'wm.call_menu' ? !!menus[props.name] : operatorUI().supported(idname, props)),
    poll: (idname, props) => operatorUI().poll(idname, props),
    isOpen: (id, closed) => panels.isOpen(id, closed),
    toggle: (id, event, closed) => { panels.toggle(id, event, closed); save(); state.revision++; },
    structIcon,
    ids: (struct) => ({
      Object: () => rna.objects().map((ob) => rna.pointer('Object', ob)),
      World: () => world.worlds?.all().map((entry) => rna.pointer('World', entry)) ?? [],
      Collection: () => world.collections?.all().map((entry) => rna.pointer('Collection', entry)) ?? [],
      Scene: () => [context.scene],
    })[struct]?.() ?? [],
    drawMenu: (idname) => drawMenu(idname, operatorUI()),
    animation: {
      state: (refs) => world.animation.state(refs[0]),
      insert: (refs) => { world.animation.insert(refs); history.commit(); },
      remove: (refs) => { world.animation.deleteKeys(refs.map((ref) => ({ ref, frame: Math.round(world.animation.time.frame) }))); history.commit(); },
    },
    templates: { template_modifiers: modifierTemplates({ world, editor, rna, history }) },
  };

  const region = () => {
    const tab = state.context;
    const drawn = drawPanels(types, context, { contexts: [TAB_CONTEXTS[tab]], open: ui.isOpen,
      panelOpen: (id, node) => (node.data ? !!node.data[node.property] : ui.isOpen(`layout:${node.idname}`, node.default_closed)) });
    const path = { id: 'context-path', hideHeader: true, open: true, body: contextBar(context, space), children: [] };
    return h(RegionView, { panels: [path, ...drawn], ui },
      () => addonPanels({ world, editor, history, systems, properties, storage, files, tab, node: editor.selection.nodes.at(-1), state, registered: propertyPanels, ui }));
  };

  const app = createApp({
    render() {
      void state.revision;
      if (!state.ready) return h('section', { class: 'bl-ui bl-properties' });
      context = propertiesContext(rna, space);
      if (!space.tabs().some((tab) => tab?.[0] === state.context)) state.context = 'OBJECT' in TAB_CONTEXTS && space.tabs().some((tab) => tab?.[0] === 'OBJECT') ? 'OBJECT' : 'SCENE';
      const nav = drawPanels(navigation, context, { contexts: [] });
      const headerLayout = drawHeader(menus.PROPERTIES_HT_header ?? (() => ({ draw() {} })), context);
      const header = h(LayoutView, { layout: headerLayout, ui });
      return h('section', { class: 'bl-ui bl-properties flex h-full flex-col overflow-hidden bg-region', 'data-blender': 'PROPERTIES' }, [
        headerHost ? h(Teleport, { to: headerHost }, [h('div', { class: 'bl-ui bl-properties-header flex min-w-0 flex-1 items-center' }, [header])]) : header,
        h('div', { class: 'flex min-h-0 flex-1' }, [
          h('div', { class: 'bl-navigation-bar flex shrink-0 flex-col items-center', 'data-blender': 'PROPERTIES_PT_navigation_bar' }, nav.map((p) => h(LayoutView, { layout: p.body, ui }))),
          h('div', { class: 'bl-properties-region min-w-0 flex-1 overflow-y-auto' }, region()),
        ]),
      ]);
    },
  });
  app.mount(host);

  Promise.all([modules, loadRNAUI(() => import('../../makesrna/rna-ui.json'))]).then(([loaded]) => {
    types = panelTypes(loaded, { space: 'PROPERTIES' });
    navigation = panelTypes(loaded, { space: 'PROPERTIES', region: 'NAVIGATION_BAR' });
    menus = { ...menuClasses(...loaded.filter(Boolean)), PROPERTIES_HT_header: loaded.find((m) => m?.PROPERTIES_HT_header)?.PROPERTIES_HT_header };
    state.ready = true;
  });

  const sources = [world.modifiers, world.materials, world.particles, world.compositor, world.sceneSettings, world.worlds, world.renderSettings, world.collections].filter(Boolean);
  const unsubscribers = [...sources, ...systems.map((system) => system.store)].map((source) => source.subscribe(() => state.revision++));
  return {
    refresh() { state.revision++; },
    context(id) { state.context = id; },
    dispose() { unsubscribers.forEach((fn) => fn()); app.unmount(); },
  };
}

