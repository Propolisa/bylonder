// The Timeline, Dope Sheet and Graph Editor: Blender's DOPESHEET_EDITOR (ui_type TIMELINE or DOPESHEET) and
// GRAPH_EDITOR. Each is an area in the module (anim-area.js) holding Blender's space and regions; events go through
// Blender's keymaps for the region under the pointer, as its handlers run them, with this editor as the context area,
// and Blender's operators run there in Blender's C, modal ones (transform, frame change, view panning) getting the
// following events with modal keymaps applied. The window manager's part (gestures, event values, redraws) is here;
// the header is drawn from Blender's scripts (space_graph.py, space_dopesheet.py, space_time.py).
import { AnimArea, SPACE_GRAPH, SPACE_ACTION, RGN_TYPE_WINDOW, RGN_TYPE_CHANNELS, RGN_TYPE_UI, ACTION_MODES, ACHANNEL_SETTING, KM_SHIFT, KM_CTRL, KM_ALT, KM_OSKEY,
  OPERATOR_RUNNING_MODAL, OPERATOR_CANCELLED, OPERATOR_FINISHED, OPERATOR_PASS_THROUGH } from './anim-area.js';
import { regionCanvas, drawMarkers, UI_MARKER_MARGIN_Y, drawGrid, drawFrameRange, drawScrubbing, drawChannels, channelRows, channelToggles, drawKeyRows, drawCurves, drawGesture } from './anim-draw.js';
import theme from '../interface/theme-default.json' with { type: 'json' };
import { newOperator, operatorNames } from '../../bmesh/bmesh-wasm.js';
import { keymapHandler, modalItem } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import { inArea, contextArea, registerOperator, registerOperators, runOperator, menuUI, kw } from '../../windowmanager/wm-operators.js';
import { WM_DRAG_THRESHOLD_MOUSE } from '../../windowmanager/wm-event-system.js';
import { openMenu } from '../interface/menu.js';
import { drawMenu } from '../interface/ui-layout.js';
import { headerLayout, drawPanels, panelTypes } from '../interface/panels.js';
import { LayoutView, RegionView, panelState } from '../interface/layout-view.js';
import { GRAPH_PANELS } from './anim-buttons.js';
import { loadRNAUI } from '../../makesrna/rna.js';
import { menus as MENUS, headers as HEADER_TYPES, panels as PANEL_TYPES } from '../../python/bpy_interface.js';
import { propBinding, operatorProperties } from '../../makesrna/rna-bylonder.js';
import rnaOperators from '../../makesrna/rna-operators.json' with { type: 'json' };
import { UILayout } from '../interface/layout.js';
import { createContext } from '../../blenkernel/context.js';
import { createApp, h, reactive, markRaw } from 'vue';
import '../interface/layout-view.css';
import '../interface/components/tailwind.css';
import './anim-editor.css';


// The keymaps a region's handlers run, in order (ed_default_handlers' then the region type's init), then the window's.
const KEYMAPS = {
  GRAPH_EDITOR: {
    [RGN_TYPE_WINDOW]: ['View2D', 'Markers', 'Time Scrub', 'Animation', 'Frames', 'Graph Editor', 'Graph Editor Generic', 'Screen', 'Window'],
    [RGN_TYPE_CHANNELS]: ['View2D', 'Frames', 'Animation Channels', 'Graph Editor Generic', 'Screen', 'Window'],
  },
  DOPESHEET_EDITOR: {
    [RGN_TYPE_WINDOW]: ['View2D', 'Markers', 'Time Scrub', 'Animation', 'Frames', 'Dopesheet', 'Dopesheet Generic', 'Screen', 'Window'],
    [RGN_TYPE_CHANNELS]: ['View2D', 'Frames', 'Animation Channels', 'Dopesheet Generic', 'Screen', 'Window'],
  },
};
const HEADERS = { GRAPH_EDITOR: 'GRAPH_HT_header', DOPESHEET_EDITOR: 'DOPESHEET_HT_header' };
const SPACE_TYPES = { GRAPH_EDITOR: SPACE_GRAPH, DOPESHEET_EDITOR: SPACE_ACTION };
// The channel region's width (its region type's prefsizex): the Graph Editor's leaves room for its scroll bar.
// The editors' own keymaps, which the marker strip's events skip.
const EDITOR_KEYMAPS = new Set(['Dopesheet', 'Graph Editor']);
const CHANNELS_WIDTH = { GRAPH_EDITOR: 200 + 11, DOPESHEET_EDITOR: 200 }, UI_SIDEBAR_PANEL_WIDTH = 280;
const BUTTONS = ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE', 'BUTTON4MOUSE', 'BUTTON5MOUSE'];
const KEYMAP_EVENT_TYPES = { SPACEBAR: 'SPACE' };
// The Blender operators this editor runs in the module, and Blender's macros of them (wm_operator_type.cc's macros
// as ED_operatormacros_graph and ED_operatormacros_action define them).
const MODULE_OPERATOR = /^(graph|action|anim|marker|view2d|transform)\./;
const MACROS = {
  'graph.duplicate_move': [['graph.duplicate', {}], ['transform.translate', {}]],
  'action.duplicate_move': [['action.duplicate', {}], ['transform.transform', { mode: 'TIME_TRANSLATE' }]],
};

const animEditor = () => contextArea()?.animEditor;

// Registers Blender's animation editor operators for the Dope Sheet and Graph Editor spaces, once: each runs on the
// editor that is the context area. Screen operators over the scene's time are registered for every area.
export function registerAnimOperators(animation) {
  for (const space of Object.keys(SPACE_TYPES)) {
    for (const idname of operatorNames().filter((name) => MODULE_OPERATOR.test(name))) {
      registerOperator(idname, { poll: (props, event) => !!animEditor()?.poll(idname, event), run: (props, event) => animEditor().invoke(idname, props, event) }, space);
    }
    for (const [idname, steps] of Object.entries(MACROS)) registerOperator(idname, { run: (props, event) => animEditor().macro(steps, event) }, space);
    registerOperators({
      'wm.context_toggle': { supports: ({ data_path }) => /^(space_data|tool_settings|scene)\./.test(data_path ?? ''), run: ({ data_path }) => animEditor().toggle(data_path) },
      'wm.call_menu_pie': { supports: ({ name }) => !!MENUS[name], run: ({ name }, event) => animEditor().menu(name)(event) },
    }, space);
  }
  const time = animation.time;
  const keyFrames = () => [...new Set(animation.action.tracks.flatMap((t) => t.keys.map((k) => k.frame)))].sort((a, b) => a - b);
  registerOperators({
    'screen.frame_offset': { run: ({ delta = 0 }) => animation.seek(Math.round(time.frame) + delta) },
    'screen.frame_jump': { run: ({ end }) => animation.seek(time.range()[end ? 1 : 0]) },
    'screen.keyframe_jump': {
      run: ({ next = true }) => {
        const frames = keyFrames(), frame = next ? frames.find((f) => f > time.frame) : frames.filter((f) => f < time.frame).at(-1);
        if (frame !== undefined) animation.seek(frame);
      },
    },
    'screen.animation_cancel': { poll: () => time.playing, run: () => animation.pause() },
  });
}

const modifiers = (e) => (e.shiftKey ? KM_SHIFT : 0) | (e.ctrlKey ? KM_CTRL : 0) | (e.altKey ? KM_ALT : 0) | (e.metaKey ? KM_OSKEY : 0);

//   section: the area's element; header: its header element; space: GRAPH_EDITOR or DOPESHEET_EDITOR; uiType: the
//   Dope Sheet's (TIMELINE or DOPESHEET); animation: the scene's (blenkernel/animation/model.js); rna: createRNA(host)
//   for the header's context; objects: the Object Mode mirror (its sync() puts the objects' bases in the module);
//   commit(): an undo step.
// A module operator's status as the registry's operators return it: the event goes on after a pass through or a cancel.
const statusName = (status) => (status & OPERATOR_PASS_THROUGH ? 'PASS_THROUGH' : status === OPERATOR_CANCELLED ? 'CANCELLED' : 'FINISHED');

export function mountAnimEditor(section, { header, space, uiType = space === 'GRAPH_EDITOR' ? 'FCURVES' : 'DOPESHEET', animation, rna, objects, commit = () => {} }) {
  // A Dope Sheet's space is made as the startup file's Timeline area's, whose Dope Sheet it becomes, keeping its regions
  // (channels and sidebar hidden), as Blender switches an area's sub-type.
  const area = new AnimArea(animation.ids.blender, SPACE_TYPES[space], space === 'DOPESHEET_EDITOR' ? ACTION_MODES.TIMELINE : -1);
  if (uiType === 'DOPESHEET') {
    area.subtype = ACTION_MODES.DOPESHEET;
    area.show(RGN_TYPE_UI, false);
  }
  const timeline = uiType === 'TIMELINE', graph = space === 'GRAPH_EDITOR';
  section.classList.add('anim-editor');
  section.tabIndex = 0;
  const channelsCanvas = Object.assign(document.createElement('canvas'), { className: 'anim-channels' });
  const mainCanvas = Object.assign(document.createElement('canvas'), { className: 'anim-main' });
  const sidebar = Object.assign(document.createElement('div'), { className: 'bl-ui anim-sidebar' });
  sidebar.setAttribute('aria-label', 'Sidebar');
  // The sidebar's own events stay there, as a region's handlers take them.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'contextmenu']) sidebar.addEventListener(type, (e) => e.stopPropagation());
  section.replaceChildren(channelsCanvas, mainCanvas, sidebar);
  const status = Object.assign(document.createElement('div'), { className: 'anim-status' });
  const menus = Object.assign(document.createElement('div'), { className: 'bl-ui anim-header' });
  header?.replaceChildren(menus, status);

  let size = { width: 0, height: 0, channels: 0, ui: 0 }, frame = 0, gesture = null, press = null, hover = RGN_TYPE_WINDOW, pointer = { x: 0, y: 0, region: RGN_TYPE_WINDOW };
  const editor = {
    area, space, uiType, rna,
    changed: () => redraw(),
  };
  // This editor as the context area: its space for its operators, and Blender's menus it has for wm.call_menu.
  const contextAreaOf = { animEditor: null, space, menu: (name) => (MENUS[name] ? (event) => openMenu(() => menuItems(name), screenPoint(event), MENUS[name].bl_label ?? '') : null) };

  // The header's and menus' bpy.context: this area, its space's RNA and the scene's.
  const context = () => createContext(rna, { area: space, uiType, space: editor });
  const ui = menuUI({ menus: MENUS, context, prop: propBinding(rna.host), keymaps: () => KEYMAPS[space][RGN_TYPE_WINDOW] });
  const inThisArea = (fn) => (...args) => inArea(contextAreaOf, () => fn(...args));
  Object.assign(ui, { run: inThisArea((idname, props) => (MODULE_OPERATOR.test(idname) || MACROS[idname] ? runFromMenu(idname, props) : runOperator(idname, props))), supported: inThisArea(ui.supported), poll: inThisArea(ui.poll), keys: inThisArea(ui.keys) });
  const menuItems = (name) => inArea(contextAreaOf, () => drawMenu(name, ui));

  // The header (DOPESHEET_HT_header, GRAPH_HT_header) drawn by the shared layout renderer; its popovers draw their panels.
  const headerState = reactive({ revision: 0, ready: false });
  const layoutUI = markRaw({
    get revision() { return headerState.revision; },
    undoPush: () => { animation.edited(); commit(); redraw(); },
    report: (error) => rna.host.notify?.(error.message),
    run: (idname, props) => ui.run(idname, props),
    supported: (idname, props) => ui.supported(idname, props),
    poll: (idname, props) => ui.poll(idname, props),
    isOpen: () => true,
    toggle: () => {},
    ids: () => [],
    drawMenu: (idname) => menuItems(idname),
    enumItems: (idname, property) => ui.enumItems(idname, property),
    menuLabel: (idname) => MENUS[idname]?.bl_label,
    menuContents: (idname) => MENUS[idname] && markRaw(headerLayout(context(), drawHeaderType(MENUS[idname]))),
    popover: (id) => {
      const type = PANEL_TYPES[id];
      if (!type) return null;
      const [drawn] = drawPanels({ roots: [{ type, children: [] }] }, context(), { contexts: [type.bl_context].filter(Boolean) });
      return drawn?.body && { label: drawn.label, layout: drawn.body, units: type.bl_ui_units_x };
    },
  });
  const drawHeaderType = (type) => (layout) => Object.assign(type(), { layout }).draw(context());

  // The sidebar (RGN_TYPE_UI): its tabs (the panels' bl_category) and the active tab's panels whose poll() passes,
  // the Graph Editor's from graph_buttons.cc (anim-buttons.js), the Dope Sheet's from Blender's scripts.
  const sidebarTypes = panelTypes(graph ? [{ classes: GRAPH_PANELS }] : [{ classes: Object.values(PANEL_TYPES) }], { space, region: 'UI' });
  const sidebarState = reactive({ category: null, open: {} });
  const sidebarPanels = panelState(sidebarState);
  const sidebarContext = () => createContext(rna, { area: space, uiType, space: editor, region: 'UI', members: () => ({
    get active_action() { const action = area.activeAction(); return action ? rna.pointer('Action', action) : null; },
  }) });
  const sidebarUI = markRaw({ ...layoutUI, isOpen: sidebarPanels.isOpen, toggle: (id, event, closed) => { sidebarPanels.toggle(id, event, closed); headerState.revision++; } });
  const sidebarApp = createApp({ render: () => {
    void headerState.revision;
    if (!headerState.ready || sidebar.hidden) return null;
    const ctx = sidebarContext(), polls = (type) => { try { return !type.poll || !!type.poll(ctx); } catch { return false; } };
    const roots = sidebarTypes.roots.filter(({ type }) => polls(type));
    // Tabs in registration order: C panels as graph_buttons_register adds them (no header-first sorting).
    const ordered = graph ? GRAPH_PANELS.filter((type) => roots.some((root) => root.type === type)) : roots.map(({ type }) => type);
    const categories = [...new Set(ordered.map((type) => type.bl_category))];
    const category = categories.includes(sidebarState.category) ? sidebarState.category : categories[0];
    const drawn = drawPanels({ roots: roots.filter(({ type }) => type.bl_category === category) }, ctx, { contexts: ['data'], open: sidebarPanels.isOpen });
    return [
      h(RegionView, { panels: drawn, ui: sidebarUI }),
      h('nav', { class: 'bl-region-tabs', role: 'tablist' }, categories.map((name) => h('button', {
        type: 'button', class: 'bl-region-tab', role: 'tab', 'aria-selected': String(name === category), onClick: () => { sidebarState.category = name; },
      }, name))),
    ];
  } });
  sidebarApp.mount(sidebar);
  const headerApp = createApp({ render: () => {
    void headerState.revision;
    return headerState.ready ? h(LayoutView, { layout: headerLayout(context(), drawHeaderType(HEADER_TYPES[HEADERS[space]])), ui: layoutUI }) : null;
  } });
  headerApp.mount(menus);
  loadRNAUI(() => import('../../makesrna/rna-ui.json')).then(() => { headerState.ready = true; });

  // Before Blender's code reads them: the scene's time, and the objects' bases (selection, visibility).
  function sync() {
    objects?.sync?.();
    animation.syncTime();
  }
  // After it ran: the keys it changed reach the channels, the frame it set reaches the scene, and a finished
  // operator that is an undo step makes one.
  function after(status) {
    animation.edited();
    const next = animation.anim.frame;
    if (Math.round(next) !== Math.round(animation.time.frame)) animation.time.seek(next);
    const { start, end, previewStart, previewEnd, preview } = animation.anim.range, t = animation.time.state;
    if (start !== t.frameStart || end !== t.frameEnd || preview !== t.usePreviewRange || (preview && (previewStart !== t.framePreviewStart || previewEnd !== t.framePreviewEnd))) {
      animation.time.configure({ frameStart: start, frameEnd: end, usePreviewRange: preview, ...(preview ? { framePreviewStart: previewStart, framePreviewEnd: previewEnd } : {}) }, { record: false });
    }
    if (status & OPERATOR_FINISHED && area.undo) commit();
    redraw();
    return status;
  }

  // Blender's event for an operator in a region: type and value, where it is (region pixels, y up), modifiers, text.
  const blenderEvent = (event) => ({ type: KEYMAP_EVENT_TYPES[event.type.toUpperCase()] ?? event.type.toUpperCase(), value: event.value, x: event.x, y: event.y,
    modifier: event.modifier ?? 0, text: event.text ?? '' });
  editor.poll = (idname, event) => { sync(); return area.poll(idname, event?.region ?? RGN_TYPE_WINDOW); };
  editor.invoke = (idname, props, event) => {
    sync();
    const region = event?.region ?? RGN_TYPE_WINDOW;
    const status = area.run(newOperator(idname, props), region, event ? blenderEvent(event) : { ...blenderEvent({ type: 'MOUSEMOVE', value: 'NOTHING', ...pointer }) });
    if (area.gesture) startGesture(event);
    if (area.popup) openPopup(idname, event);
    after(status);
    return statusName(status);
  };
  editor.macro = (steps, event) => {
    for (const [idname, props] of steps) {
      const result = editor.invoke(idname, props, event);
      if (result === 'PASS_THROUGH' || area.modal) break;
    }
  };
  // wm.context_toggle on this editor's context (space_data.show_handles).
  editor.toggle = (path) => {
    const parts = path.split('.'), owner = parts.slice(0, -1).reduce((data, key) => data?.[key], context()), name = parts.at(-1);
    if (owner && typeof owner[name] === 'boolean') owner[name] = !owner[name];
    redraw();
  };
  editor.menu = (name) => contextAreaOf.menu(name);
  contextAreaOf.animEditor = editor;

  // A menu entry runs its operator as Blender's menus do (INVOKE_REGION_WIN): invoked in the main region at the
  // pointer.
  function runFromMenu(idname, props) {
    const event = { type: 'MOUSEMOVE', value: 'NOTHING', ...pointer, region: RGN_TYPE_WINDOW, x: pointer.region === RGN_TYPE_WINDOW ? pointer.x : 0 };
    return MACROS[idname] ? editor.macro(MACROS[idname], event) : editor.invoke(idname, props, event);
  }
  const screenPoint = (event) => {
    const r = section.getBoundingClientRect();
    return { x: r.left + (event?.region === RGN_TYPE_CHANNELS ? 0 : size.channels) + (event?.x ?? 0), y: r.top + size.height - (event?.y ?? 0) };
  };

  // An invoke's popup (wm_operators.cc): a confirmation's one button, or the items of the enum property it asks for.
  function openPopup(idname, event) {
    const { type, title, text } = area.popup, finish = (props) => { after(area.finishPopup(props)); redraw(); };
    if (type === 'PROPS') return openPropsPopup(idname, title, event, finish);
    const items = type === 'CONFIRM' ? [{ label: text, run: () => finish({}) }]
      : ui.enumItems(idname, text).map(([value, label, , icon]) => ({ label, icon: icon && icon !== 'NONE' ? icon : undefined, run: () => finish({ [text]: value }) }));
    const menu = openMenu(items, screenPoint(event), title);
    new MutationObserver((_, observer) => { if (!menu.isConnected) { observer.disconnect(); if (area.popup) area.finishPopup(null); } }).observe(menu.parentNode ?? document.body, { childList: true });
  }

  // WM_operator_props_popup: the operator's properties, drawn by the shared layout renderer, with OK to run it.
  function openPropsPopup(idname, title, event, finish) {
    const values = {}, state = reactive({ revision: 0 });
    const props = operatorProperties(idname, values, { update: () => { state.revision++; } });
    const popup = Object.assign(document.createElement('div'), { className: 'bl-ui anim-popup' });
    const at = screenPoint(event);
    Object.assign(popup.style, { left: at.x + 'px', top: at.y + 'px' });
    const close = (run) => {
      app.unmount();
      popup.remove();
      removeEventListener('pointerdown', outside, true);
      run ? finish({ ...values }) : area.finishPopup(null);
    };
    const outside = (e) => { if (!popup.contains(e.target)) close(false); };
    const popupUI = markRaw({ ...layoutUI, get revision() { return state.revision; }, undoPush: () => { state.revision++; } });
    const app = createApp({ render: () => {
      void state.revision;
      const layout = new UILayout('root');
      layout.label(kw({ text: title }));
      for (const name of Object.keys(rnaOperators[idname]?.properties ?? {})) layout.prop(props, name);
      return [h(LayoutView, { layout, ui: popupUI }),
        h('button', { type: 'button', class: 'bl-tool flex h-unit w-full items-center justify-center rounded-md px-1.5 text-xs', onClick: () => close(true) }, 'OK')];
    } });
    app.mount(popup);
    popup.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter' && !e.target.closest('input')) close(true);
    });
    document.body.append(popup);
    addEventListener('pointerdown', outside, true);
    popup.tabIndex = -1;
    popup.focus();
  }

  // Gestures (wm_gesture_ops.cc): box, circle and lasso, drawn here; on release their operator's properties are set
  // and its exec runs.
  function startGesture(event) {
    const at = [event?.x ?? pointer.x, event?.y ?? pointer.y];
    const tweak = event?.value === 'CLICK_DRAG';
    gesture = { type: area.gesture.type, region: area.gesture.regionType, wait: !tweak, start: tweak ? at : null, end: at, radius: 25, path: tweak ? [at] : [], down: tweak };
    redraw();
  }
  // The modal maps wm_gesture_ops.cc assigns: circle select uses the 3D View's in every editor.
  const GESTURE_MAPS = { BOX: 'Gesture Box', CIRCLE: 'View3D Gesture Circle', LASSO: 'Gesture Lasso' };
  function gestureEvent(event) {
    const item = modalItem(GESTURE_MAPS[gesture.type], event);
    const at = [event.x, event.y];
    if (event.type === 'mousemove') {
      gesture.end = at;
      if (gesture.type === 'LASSO' && gesture.down) gesture.path.push(at);
      if (gesture.type === 'CIRCLE' && gesture.down) applyCircle(gesture.mode ?? 'ADD');
    }
    if (item === 'CANCEL' || (gesture.type === 'CIRCLE' && item === 'CANCEL')) return endGesture(null);
    if (item === 'BEGIN' && gesture.wait) { gesture.start = at; gesture.down = true; gesture.path = [at]; }
    if (gesture.type === 'CIRCLE') {
      if (item === 'SELECT' || item === 'DESELECT') { gesture.down = true; gesture.mode = item === 'SELECT' ? 'ADD' : 'SUB'; applyCircle(gesture.mode); }
      if (item === 'NOP' || event.value === 'RELEASE') gesture.down = false;
      if (item === 'SIZE_ADD') gesture.radius += 5;
      if (item === 'SIZE_SUB') gesture.radius = Math.max(1, gesture.radius - 5);
      if (item === 'CONFIRM') return endGesture(null);
    } else if (gesture.start && (item === 'SELECT' || item === 'DESELECT' || (!gesture.wait && event.value === 'RELEASE'))) {
      const mode = gesture.wait ? { mode: item === 'DESELECT' ? 'SUB' : 'ADD' } : {};
      if (gesture.type === 'BOX') {
        const [[x0, y0], [x1, y1]] = [gesture.start, gesture.end];
        return endGesture({ xmin: Math.min(x0, x1), xmax: Math.max(x0, x1), ymin: Math.min(y0, y1), ymax: Math.max(y0, y1), wait_for_input: false, ...mode });
      }
      return endGesture({ ...mode }, gesture.path);
    }
    redraw();
  }
  function applyCircle(mode) {
    sync();
    area.applyGesture({ x: gesture.end[0], y: gesture.end[1], radius: gesture.radius, mode, wait_for_input: false });
    animation.edited();
  }
  function endGesture(props, path = null) {
    sync();
    const status = area.finishGesture(props, path);
    gesture = null;
    after(status);
  }

  // Events into Blender's terms: region-relative positions (y up) of the region under the pointer.
  function regionEvent(e, type, value, region = null) {
    const r = section.getBoundingClientRect(), x = e.clientX - r.left, y = size.height - (e.clientY - r.top);
    const into = region ?? (x < size.channels ? RGN_TYPE_CHANNELS : RGN_TYPE_WINDOW), left = into === RGN_TYPE_CHANNELS ? 0 : size.channels;
    return { type, value, x: x - left, y, region: into, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, modifier: modifiers(e), native: e };
  }
  // ED_markers_region_visible: the space shows markers (SACTION_SHOW_MARKERS, SIPO_SHOW_MARKERS).
  const markersShown = () => !!(area.settings.flag & (graph ? 1 << 16 : 1 << 14));
  // Which of a region's keymaps take an event now (their handlers' polls).
  function keymapActive(name, event) {
    if (name === 'Time Scrub') return event.region === RGN_TYPE_WINDOW && event.y >= size.height - area.metrics().scrubHeight;
    // WM_event_handler_region_marker_poll, and the editor's own keymap's no_marker poll: the marker strip takes events
    // when there are markers to show.
    const onMarkers = event.region === RGN_TYPE_WINDOW && markersShown() && animation.anim.markers.length > 0 && event.y < UI_MARKER_MARGIN_Y;
    if (name === 'Markers') return onMarkers;
    if (EDITOR_KEYMAPS.has(name)) return !onMarkers;
    return true;
  }
  function dispatch(event) {
    if (area.modal) return modalEvent(event);
    if (gesture) return gestureEvent(event), true;
    const handled = inArea(contextAreaOf, () => keymapHandler(KEYMAPS[space][event.region], (name) => keymapActive(name, event))(event));
    redraw();
    return handled;
  }
  // A modal operator's event: an item of its modal keymap when one matches and it allows it, else the raw event.
  function modalEvent(event) {
    const keymap = area.modal.keymap, item = keymap && modalItem(keymap, event, (id) => area.modalItem(id) >= 0);
    const status = area.handle(item ? { ...blenderEvent(event), modal: area.modalItem(item) } : blenderEvent(event));
    if (area.modal) { animation.edited(); redraw(); }
    else after(status);
    return true;
  }

  const onPointerDown = (e) => {
    section.focus({ preventScroll: true });
    if (channelToggleClick(e)) return;
    const type = BUTTONS[e.button], event = regionEvent(e, type, 'PRESS', area.modal?.regionType ?? gesture?.region);
    section.setPointerCapture(e.pointerId);
    const handled = dispatch(event);
    press = { type, event, handled, dragged: false, x: e.clientX, y: e.clientY };
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    const event = regionEvent(e, 'mousemove', 'NOTHING', area.modal?.regionType ?? gesture?.region ?? press?.event.region);
    pointer = { x: event.x, y: event.y, region: event.region };
    hover = event.region;
    if (area.modal) modalEvent(event);
    else if (gesture) gestureEvent(event);
    if (!press || press.dragged || area.modal || gesture) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < WM_DRAG_THRESHOLD_MOUSE) return;
    press.dragged = true;
    dispatch({ ...press.event, value: 'CLICK_DRAG' });
  };
  const onPointerUp = (e) => {
    const type = BUTTONS[e.button], down = press?.type === type ? press : null;
    const event = regionEvent(e, type, 'RELEASE', area.modal?.regionType ?? gesture?.region ?? down?.event.region);
    const modal = !!(area.modal || gesture);
    dispatch(event);
    if (down && !down.dragged && !modal && !area.modal && !gesture) dispatch({ ...down.event, value: 'CLICK' });
    if (down) press = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    dispatch(regionEvent(e, e.deltaY < 0 ? 'wheelupmouse' : 'wheeldownmouse', 'PRESS'));
  };
  const onKey = (value) => (e) => {
    if (e.target.closest('input,textarea,select') || (value === 'PRESS' && e.repeat && !area.modal)) return;
    const r = section.getBoundingClientRect();
    const event = { ...regionEvent({ clientX: r.left + pointer.x + (pointer.region === RGN_TYPE_CHANNELS ? 0 : size.channels), clientY: r.top + size.height - pointer.y, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey },
      keyType(e), value, area.modal?.regionType ?? gesture?.region ?? hover), text: e.key.length === 1 ? e.key : '', native: e };
    if (value === 'RELEASE' && !area.modal && !gesture) return;
    if (dispatch(event) || area.modal || gesture) { e.preventDefault(); e.stopPropagation(); }
  };
  const onContextMenu = (e) => e.preventDefault();

  // A click on a channel's toggle (expand, visibility, mute, lock), which Blender's channel list draws as buttons.
  function channelToggleClick(e) {
    if (e.button !== 0 || area.modal || gesture) return false;
    const event = regionEvent(e, 'LEFTMOUSE', 'PRESS');
    if (event.region !== RGN_TYPE_CHANNELS) return false;
    sync();
    const channels = area.channels(), v2d = area.v2d(RGN_TYPE_CHANNELS), metrics = area.metrics(RGN_TYPE_CHANNELS);
    const [, vy] = v2d.toView(event.x, event.y);
    const row = channelRows(channels, v2d, metrics).find(({ ymin, ymax }) => vy >= ymin && vy <= ymax);
    if (!row) return false;
    const toggle = channelToggles(row.channel, size.channels, { graph }).toggles.find(({ x }) => event.x >= x && event.x < x + 16);
    if (!toggle) return false;
    area.channelSetting(row.channel.index, ACHANNEL_SETTING[toggle.setting]);
    if (toggle.setting !== 'EXPAND') commit();
    animation.edited();
    redraw();
    return true;
  }

  // Regions laid out as Blender's area lays them: the channels on the left, the main region the rest.
  function layout() {
    const width = section.clientWidth, height = section.clientHeight;
    if (!width || !height) return false;
    const channels = area.shown(RGN_TYPE_CHANNELS) ? Math.min(CHANNELS_WIDTH[space], Math.round(width / 3)) : 0;
    // action_region_poll_hide_in_timeline: the Timeline has no sidebar.
    const ui = !timeline && area.shown(RGN_TYPE_UI) ? Math.min(UI_SIDEBAR_PANEL_WIDTH, Math.round(width / 3)) : 0;
    if (width !== size.width || height !== size.height || channels !== size.channels || ui !== size.ui) {
      size = { width, height, channels, ui };
      area.layout(RGN_TYPE_CHANNELS, 0, 0, channels, height);
      area.layout(RGN_TYPE_WINDOW, channels, 0, width - channels - ui, height);
      area.layout(RGN_TYPE_UI, width - ui, 0, ui, height);
      area.sync();
      channelsCanvas.hidden = !channels;
      sidebar.hidden = !ui;
      Object.assign(channelsCanvas.style, { width: channels + 'px', height: height + 'px' });
      Object.assign(mainCanvas.style, { left: channels + 'px', width: width - channels - ui + 'px', height: height + 'px' });
      sidebar.style.width = ui + 'px';
    }
    return true;
  }


  let scheduled = 0, lastStatus = null;
  function redraw() {
    if (!scheduled) scheduled = requestAnimationFrame(draw);
  }
  function draw() {
    scheduled = 0;
    if (!section.isConnected || !layout()) return;
    sync();
    area.refresh();
    const t = animation.time.state;
    frame = animation.time.frame;
    const range = { start: t.frameStart, end: t.frameEnd, previewStart: t.framePreviewStart, previewEnd: t.framePreviewEnd, preview: t.usePreviewRange };
    const settings = area.settings, metrics = area.metrics(), v2d = area.v2d();
    const channels = area.channels();
    const main = regionCanvas(mainCanvas, size.width - size.channels - size.ui, size.height);
    const spaceTheme = graph ? theme.graph_editor : theme.dopesheet_editor;
    const back = spaceTheme.space.back;
    main.ctx.fillStyle = `rgb(${back.map((c) => Math.round(c * 255)).join(',')})`;
    main.ctx.fillRect(0, 0, main.width, main.height);
    drawFrameRange(main, v2d, range);
    if (graph) {
      drawGrid(main, v2d, spaceTheme.grid, { values: true, fps: t.fps });
      drawCurves(main, v2d, area.curves(), { showHandles: !(settings.flag & (1 << 2)), onlySelectedHandles: !!(settings.flag & (1 << 9)) });
    } else {
      drawGrid(main, v2d, spaceTheme.grid, { fps: t.fps });
      const { cur } = v2d, rows = channelRows(channels, v2d, metrics).map((row) => ({ ...row, keys: area.keys(row.channel.index, cur.xmin, cur.xmax) }));
      drawKeyRows(main, v2d, rows, metrics, { backdrops: !timeline });
    }
    if (markersShown()) drawMarkers(main, v2d, animation.anim.markers, frame, redraw);
    if (gesture && gesture.region === RGN_TYPE_WINDOW) drawGesture(main, gesture);
    drawScrubbing(main, v2d, frame, metrics.scrubHeight, { seconds: !!(settings.flag & (graph ? 1 << 4 : 1 << 2)), fps: t.fps, fractions: graph });
    if (size.channels) {
      const view = regionCanvas(channelsCanvas, size.channels, size.height), chv = area.v2d(RGN_TYPE_CHANNELS);
      drawChannels(view, chv, channels, area.metrics(RGN_TYPE_CHANNELS), { graph, redraw });
      view.ctx.fillStyle = `rgb(${theme.regions.scrubbing.back.slice(0, 3).map((c) => Math.round(c * 255)).join(',')})`;
      view.ctx.fillRect(0, 0, view.width, metrics.scrubHeight);
    }
    const text = area.status;
    if (text !== lastStatus) {
      lastStatus = text;
      status.textContent = text;
      menus.hidden = !!text;
    }
    headerState.revision++;
  }

  section.addEventListener('pointerdown', onPointerDown);
  section.addEventListener('pointermove', onPointerMove);
  section.addEventListener('pointerup', onPointerUp);
  section.addEventListener('wheel', onWheel, { passive: false });
  section.addEventListener('keydown', onKey('PRESS'));
  section.addEventListener('keyup', onKey('RELEASE'));
  section.addEventListener('contextmenu', onContextMenu);
  // Keys go to the area under the pointer, as Blender's do.
  section.addEventListener('pointerenter', () => section.focus({ preventScroll: true }));
  section.addEventListener('pointerleave', () => { if (document.activeElement === section && !area.modal && !gesture) section.blur(); });
  const resized = new ResizeObserver(redraw);
  resized.observe(section);
  const unsubscribe = animation.subscribe(redraw);
  redraw();

  return {
    editor,
    redraw,
    dispose() {
      unsubscribe();
      resized.disconnect();
      cancelAnimationFrame(scheduled);
      headerApp.unmount();
      sidebarApp.unmount();
      area.dispose();
    },
  };
}
