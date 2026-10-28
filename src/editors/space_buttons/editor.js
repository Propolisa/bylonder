// The Properties editor (space_buttons.cc): Blender's own header, navigation bar and panels (Blender's Python tree, transpiled from
// Blender's properties_*.py and space_properties.py), drawn by the shared layout renderer (interface/layout-view.js)
// over Bylonder's data through Blender's RNA (makesrna/rna-bylonder.js), in the context buttons_context.cc gives
// (buttons-context.js). Bylonder's own panels go after Blender's in their tab, as add-ons' do.
import { createApp, h, reactive, Teleport, markRaw } from 'vue';
import { loadRNAUI, rnaProperty, INFO } from '../../makesrna/rna.js';
import { createPreview } from '../../blenkernel/material/preview.js';
import { texturePreview } from '../../blenkernel/texture/texture.js';
import { panelTypes, drawPanels, headerLayout, drawType } from '../interface/panels.js';
import { panels as blenderPanels, menus as blenderMenus, headers } from '../../python/bpy_interface.js';
import { UILayout } from '../interface/layout.js';
import { LayoutView, RegionView, panelState, menuButton } from '../interface/layout-view.js';
import { drawMenu } from '../interface/ui-layout.js';
import { openMenu } from '../interface/menu.js';
import { menuUI, menuClasses, kw, inArea, invokeOperator } from '../../windowmanager/wm-operators.js';
import { keymapHandler } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import './properties-operators.js';
import { propertiesContext, propertiesTabs, propertiesPath, TAB_CONTEXTS, structIcon } from './buttons-context.js';
import { propertyPanels } from './registry.js';
import { addonPanels } from './addon-panels.js';
import { modifierTemplates } from './modifier-panel.js';
import { deleted, hasMesh } from '../object/identity.js';
import { modifierAddMenu } from './modifier-add-menu.js';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';

// Blender's classes in the order its scripts register them.
const modules = [{ classes: [...Object.values(blenderPanels), ...Object.values(blenderMenus), ...Object.values(headers)] }];

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

// A texture's preview image (texture.js), by its settings.
const texturePreviews = new Map();
function texturePreviewURL(values, size = 128) {
  const key = JSON.stringify(values);
  if (!texturePreviews.has(key)) {
    const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
    canvas.getContext('2d').putImageData(new ImageData(texturePreview(values, size), size), 0, 0);
    if (texturePreviews.size > 32) texturePreviews.clear();
    texturePreviews.set(key, canvas.toDataURL());
  }
  return texturePreviews.get(key);
}

export function mountProperties(host, { world, editor, history, rna, systems, properties, storage, files = [] }, areaId = 'properties', headerHost) {
  const key = 'workbench:properties:' + areaId;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* No saved state: Blender's defaults. */ }
  const state = reactive({ context: saved.context || 'OBJECT', pin: null, search: '', open: saved.open || {}, revision: 0, ready: false });
  const save = () => { try { localStorage.setItem(key, JSON.stringify({ context: state.context, open: state.open })); } catch { /* Storage blocked. */ } };
  let context, types, navigation, menus;
  const space = markRaw({
    // The tab shown: the one the user chose (mainbuser) while the data has it, else the first there is (buttons_context_compute).
    get context() { const tabs = space.tabs().filter(Boolean).map(([id]) => id); return tabs.includes(state.context) ? state.context : tabs[0]; },
    set context(value) { state.context = value; save(); state.revision++; },
    get pin() { return state.pin && !deleted(state.pin.owner) ? state.pin.struct : null; },
    setPin(value) { state.pin = value ? { struct: context.object, owner: editor.selection.nodes.at(-1) } : null; state.revision++; },
    get search() { return state.search; },
    set search(value) { state.search = value; state.revision++; },
    tabs: () => propertiesTabs(context, rnaProperty('SpaceProperties', 'context').items),
  });
  const panels = panelState(state, () => []), preview = createPreview();
  const operatorUI = () => menuUI({ menus, context: () => context });
  const ob = () => editor.selection.nodes.at(-1);
  // A menu as a popup under the button that opened it, or at the pointer for a key.
  const popup = (items) => (event) => openMenu(items, event?.currentTarget instanceof Element ? event.currentTarget : { x: event?.native?.clientX ?? editor.pointer?.x ?? 0, y: event?.native?.clientY ?? editor.pointer?.y ?? 0 });
  let hovered = null;
  // This editor as the context area (wm-operators.js): its menus, and what its operators act on (properties-operators.js).
  const area = {
    menu: (name) => (name === 'OBJECT_MT_modifier_add' ? popup(() => modifierAddMenu(world, ob(), () => {})) : menus?.[name] ? popup(() => drawMenu(name, operatorUI())) : null),
    properties: {
      cycle(step) { const tabs = space.tabs().filter(Boolean).map(([id]) => id); space.context = tabs[(tabs.indexOf(space.context) + step + tabs.length) % tabs.length]; },
      startFilter: () => host.querySelector('.bl-properties-header input, input[aria-label="Live search filtering string"]')?.focus(),
      clearFilter: () => { space.search = ''; },
      canAddModifier: () => space.context === 'MODIFIER' && !!ob() && hasMesh(ob()),
      // texture.new: a new texture, given to the data-block selector that asked for it.
      newTexture(template) {
        const texture = rna.texture(world.textures.create(null, { finish: false }));
        template?.set(texture);
        ui.undoPush('New Texture');
      },
      // The active object's material slots in the material library.
      materials: () => {
        const node = ob(), library = world.materials;
        if (!node?.getTotalVertices || !library) return null;
        return { count: () => library.slots(node).length, add: () => library.addSlot(node), remove: () => library.removeSlot(node),
          move: (delta) => library.moveSlot(node, library.active(node), delta), newMaterial: () => library.newMaterial(node) };
      },
    },
    modifier: () => {
      const node = ob(), id = hovered ?? world.modifiers?.stack(node ?? {})?.at(-1)?.id;
      if (!node || !id || space.context !== 'MODIFIER') return null;
      const stack = world.modifiers.stack(node), index = stack.findIndex((m) => m.id === id);
      return index < 0 ? null : { remove: () => world.modifiers.remove(node, id), duplicate: () => world.modifiers.duplicate(node, id), apply: () => world.modifiers.apply(node, id) };
    },
  };
  const keys = keymapHandler(['Property Editor', 'Frames', 'Screen', 'Window']);
  const onKeydown = (e) => {
    if (e.target.closest('input,textarea,select') || e.repeat) return;
    const event = { type: keyType(e), value: 'PRESS', shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, native: e };
    if (inArea(area, () => keys(event))) { e.preventDefault(); e.stopPropagation(); }
  };
  const ui = {
    get revision() { return state.revision; },
    undoPush: (name) => { rna.host.undoPush?.(name); state.revision++; },
    report: (error) => world.notify?.(error.message),
    run: (idname, props, event) => inArea(area, () => invokeOperator(idname, props, event)),
    supported: (idname, props) => inArea(area, () => operatorUI().supported(idname, props)),
    poll: (idname, props) => inArea(area, () => operatorUI().poll(idname, props)),
    isOpen: (id, closed) => panels.isOpen(id, closed),
    toggle: (id, event, closed) => { panels.toggle(id, event, closed); save(); state.revision++; },
    hover: (modifierId) => { hovered = modifierId; },
    structIcon,
    ids: (struct) => ({
      Object: () => rna.objects().map((node) => rna.pointer('Object', node)),
      World: () => world.worlds?.all().map((entry) => rna.pointer('World', entry)) ?? [],
      Collection: () => world.collections?.all().map((entry) => rna.pointer('Collection', entry)) ?? [],
      Scene: () => [context.scene],
      Material: () => world.materials?.all().map((material) => rna.pointer('Material', material)) ?? [],
      Texture: () => world.textures?.all().map((entry) => rna.texture(entry)) ?? [],
    })[struct]?.() ?? [],
    drawMenu: (idname) => drawMenu(idname, operatorUI()),
    animation: {
      state: (refs) => world.animation.state(refs[0]),
      insert: (refs) => { world.animation.insert(refs); history.commit(); },
      remove: (refs) => { world.animation.deleteKeys(refs.map((ref) => ({ ref, frame: Math.round(world.animation.time.frame) }))); history.commit(); },
    },
    templates: {
      template_modifiers: modifierTemplates({ world, editor, rna, history }),
      // uiTemplateTextureUser: the texture user the tab shows (a modifier), chosen from the context's users.
      template_texture_user: () => {
        const users = context.texture_users, user = context.texture_user;
        const items = () => [{ heading: 'Modifiers' }, ...users.map((other, i) => ({ label: other.name, icon: structIcon(other).toLowerCase(),
          run: () => { space.textureUser = i; state.revision++; } }))];
        return user ? menuButton({ text: user.name, iconName: structIcon(user), items }) : null;
      },
      // A material's preview, rendered by Bylonder's preview scene.
      template_preview: (node) => {
        const material = node.id?.[INFO]?.owner;
        if (material?.values) return h('div', { class: 'bl-preview flex aspect-[1.6] max-h-[220px] items-center justify-center rounded-md' },
          h('img', { class: 'h-full', src: texturePreviewURL(material.values), alt: material.name }));
        if (!material || !world.materials) return null;
        preview.request(material, (url) => { state.preview = url; });
        return h('div', { class: 'bl-preview flex aspect-[1.6] max-h-[220px] items-center justify-center rounded-md' }, state.preview ? h('img', { class: 'h-full', src: state.preview, alt: material.name }) : null);
      },
    },
  };

  const region = () => {
    const tab = space.context;
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
      const nav = drawPanels(navigation, context, { contexts: [] });
      const header = h(LayoutView, { layout: headerLayout(context, (layout) => menus.PROPERTIES_HT_header && drawType(menus.PROPERTIES_HT_header, layout, context)), ui });
      return h('section', { class: 'bl-ui bl-properties flex h-full flex-col overflow-hidden bg-region', 'data-blender': 'PROPERTIES', tabindex: -1, onKeydown,
        onPointerenter: (e) => e.currentTarget.focus({ preventScroll: true }) }, [
        headerHost ? h(Teleport, { to: headerHost }, [h('div', { class: 'bl-ui bl-properties-header flex min-w-0 flex-1 items-center' }, [header])]) : header,
        h('div', { class: 'flex min-h-0 flex-1' }, [
          h('div', { class: 'bl-navigation-bar flex shrink-0 flex-col items-center', 'data-blender': 'PROPERTIES_PT_navigation_bar' }, nav.map((p) => h(LayoutView, { layout: p.body, ui }))),
          h('div', { class: 'bl-properties-region min-w-0 flex-1 overflow-y-auto' }, region()),
        ]),
      ]);
    },
  });
  app.mount(host);

  Promise.resolve(modules).then((loaded) => {
    types = panelTypes(loaded, { space: 'PROPERTIES' });
    navigation = panelTypes(loaded, { space: 'PROPERTIES', region: 'NAVIGATION_BAR' });
    menus = { ...blenderMenus, PROPERTIES_HT_header: headers.PROPERTIES_HT_header };
    state.ready = true;
  });

  const sources = [world.modifiers, world.textures, world.materials, world.particles, world.compositor, world.sceneSettings, world.worlds, world.renderSettings, world.collections].filter(Boolean);
  const unsubscribers = [...sources, ...systems.map((system) => system.store)].map((source) => source.subscribe(() => state.revision++));
  return {
    refresh() { state.revision++; },
    context(id) { state.context = id; },
    dispose() { unsubscribers.forEach((fn) => fn()); preview.dispose(); app.unmount(); },
  };
}

