// The Timeline, Dope Sheet and Graph Editor: Blender's DOPESHEET_EDITOR (ui_type TIMELINE or DOPESHEET) and
// GRAPH_EDITOR. Each is an area in the module (anim-area.js) holding Blender's space and regions; events go through
// Blender's keymaps for the region under the pointer, as its handlers run them, with this editor as the context area,
// and Blender's operators run there in Blender's C, modal ones (transform, frame change, view panning) getting the
// following events with modal keymaps applied. The window manager's part (gestures, event values, redraws) is here;
// the header and menus are Blender's scripts' (space_graph.py, space_dopesheet.py, space_time.py) laid out by Blender.
import { AnimArea, GRAPH_MODES, SPACE_GRAPH, SPACE_ACTION, RGN_TYPE_WINDOW, RGN_TYPE_HEADER, RGN_TYPE_CHANNELS, RGN_TYPE_UI, ACTION_MODES, ACHANNEL_SETTING, KM_SHIFT, KM_CTRL, KM_ALT, KM_OSKEY,
  OPERATOR_RUNNING_MODAL, OPERATOR_CANCELLED, OPERATOR_FINISHED, OPERATOR_PASS_THROUGH } from './anim-area.js';
import { regionDrawing, drawMarkers, UI_MARKER_MARGIN_Y, drawGrid, drawFrameRange, drawScrubbing, channelRows, drawKeyRows, drawCurves, drawGesture } from './anim-draw.js';
import theme from '../interface/theme-default.json' with { type: 'json' };
import { newOperator, operatorNames, blenderMain } from '../../bmesh/bmesh-wasm.js';
import { openPopup as openModulePopup } from '../../windowmanager/wm-popups.js';
import { keymapHandler, modalItem } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import { inArea, contextArea, registerOperator, registerOperators, runOperator, menuUI } from '../../windowmanager/wm-operators.js';
import { WM_DRAG_THRESHOLD_MOUSE } from '../../windowmanager/wm-event-system.js';
import { openMenu } from '../interface/menu.js';
import { BlockView, PanelsView, treeMenu } from '../interface/block-view.js';
import { regionPanels, regionHeader, menuTree, menuLabel, panelClosedSet, categorySet } from '../interface/ui-tree.js';
import { drawRecording, buttonAt } from '../interface/region-draw.js';
import { contextStruct } from '../../python/bpy_rna.js';
import { createApp, h, reactive, markRaw, shallowRef } from 'vue';
import { operatorIdname } from '../../makesrna/rna.js';
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
// HEADERY: a header region's height in pixels at 1x scale.
const HEADER_HEIGHT = 26;
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
      'wm.call_menu_pie': { run: ({ name }, event) => animEditor().menu(name)(event) },
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
//   for reports; sync: the scene's Main (blenkernel/main-sync.js), made current before Blender's code;
//   commit(): an undo step.
// A module operator's status as the registry's operators return it: the event goes on after a pass through or a cancel.
const statusName = (status) => (status & OPERATOR_PASS_THROUGH ? 'PASS_THROUGH' : status === OPERATOR_CANCELLED ? 'CANCELLED' : 'FINISHED');

export function mountAnimEditor(section, { header, space, uiType = space === 'GRAPH_EDITOR' ? 'FCURVES' : 'DOPESHEET', animation, rna, sync: scene, commit = () => {} }) {
  // A Dope Sheet's space is made as the startup file's Timeline area's, whose Dope Sheet it becomes, keeping its regions
  // (channels and sidebar hidden), as Blender switches an area's sub-type.
  const area = new AnimArea(animation.ids.blender, SPACE_TYPES[space], space === 'DOPESHEET_EDITOR' ? ACTION_MODES.TIMELINE : GRAPH_MODES[uiType]);
  if (uiType === 'DOPESHEET') {
    area.subtype = ACTION_MODES.DOPESHEET;
    area.show(RGN_TYPE_UI, false);
  }
  // The Drivers editor's X axis is a driver's input, not time: no scrubbing, frame range or markers.
  const timeline = uiType === 'TIMELINE', graph = space === 'GRAPH_EDITOR', drivers = uiType === 'DRIVERS';
  section.classList.add('anim-editor');
  section.tabIndex = 0;
  const svg = (className) => {
    const view = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    view.setAttribute('class', className);
    return view;
  };
  // The channel region is the module's drawing; the main region is Bylonder's (anim-draw.js) with the module's over it.
  const channelsView = svg('anim-channels');
  const mainView = svg('anim-main');
  const sidebar = Object.assign(document.createElement('div'), { className: 'bl-ui anim-sidebar' });
  sidebar.setAttribute('aria-label', 'Sidebar');
  // The sidebar's own events stay there, as a region's handlers take them.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'contextmenu']) sidebar.addEventListener(type, (e) => e.stopPropagation());
  section.replaceChildren(channelsView, mainView, sidebar);
  const status = Object.assign(document.createElement('div'), { className: 'anim-status' });
  const menus = Object.assign(document.createElement('div'), { className: 'bl-ui anim-header' });
  header?.replaceChildren(menus, status);

  let size = { width: 0, height: 0, channels: 0, ui: 0 }, frame = 0, gesture = null, press = null, hover = RGN_TYPE_WINDOW, pointer = { x: 0, y: 0, region: RGN_TYPE_WINDOW };
  const editor = {
    area, space, uiType, rna,
    changed: () => redraw(),
  };
  // This editor as the context area: its space for its operators, and Blender's menus for wm.call_menu.
  const contextAreaOf = { animEditor: null, space, menu: (name) => (event) => openAreaMenu(name, screenPoint(event)) };
  const ui = menuUI({ keymaps: () => KEYMAPS[space][RGN_TYPE_WINDOW] });
  const inThisArea = (fn) => (...args) => inArea(contextAreaOf, () => fn(...args));
  Object.assign(ui, { run: inThisArea((idname, props) => (MODULE_OPERATOR.test(idname) || MACROS[idname] ? runFromMenu(idname, props) : runOperator(idname, props))), supported: inThisArea(ui.supported), poll: inThisArea(ui.poll), keys: inThisArea(ui.keys) });
  const headerState = reactive({ revision: 0 });

  // The sidebar (RGN_TYPE_UI): Blender's region lays out its panels (graph_buttons.cc's, the F-Modifiers' instanced
  // ones, Blender's Python's) in the tab shown, and its tabs (the panels' categories); block-view.js draws them.
  const regionUI = (type) => markRaw({
    inContext: (fn) => { sync(); return area.inContext(type, fn); },
    refresh: () => { after(0); },
    undoPush: () => { after(0); commit(); },
    report: (error) => rna.host.notify?.(error.message ?? String(error)),
    run: (idname, props) => ui.run(idname, props),
    keys: (idname, props) => ui.keys(idname, props),
    panelClosed: (id, closed) => area.inContext(type, (C) => panelClosedSet(C, id, closed)),
  });
  const sidebarUI = regionUI(RGN_TYPE_UI), headerUI = regionUI(RGN_TYPE_HEADER);
  // A menu Blender lays out (wm.call_menu, a pie's), opened at a page point.
  function openAreaMenu(name, at) {
    const tree = headerUI.inContext((C) => menuTree(C, name));
    if (tree) openMenu(treeMenu(tree, headerUI), at, menuLabel(name));
  }
  const sidebarApp = createApp({ render: () => {
    void headerState.revision;
    if (sidebar.hidden) return null;
    const { category, categories, panels } = sidebarUI.inContext((C) => regionPanels(C));
    return [
      h(PanelsView, { panels, ui: sidebarUI }),
      h('nav', { class: 'bl-region-tabs', role: 'tablist' }, categories.map((name) => h('button', {
        type: 'button', class: 'bl-region-tab', role: 'tab', 'aria-selected': String(name === category),
        onClick: () => { area.inContext(RGN_TYPE_UI, (C) => categorySet(C, name)); headerState.revision++; },
      }, name))),
    ];
  } });
  sidebarApp.mount(sidebar);

  // The channel region's block layouts (ED_time_scrub_channel_search_draw), over its canvas where the draw laid them.
  const channelLayouts = shallowRef([]);
  const channelOverlay = Object.assign(document.createElement('div'), { className: 'bl-ui anim-channel-layouts' });
  const channelUI = regionUI(RGN_TYPE_CHANNELS);
  const channelLayoutsApp = createApp({ render: () => {
    void headerState.revision;
    return channelLayouts.value.map(({ rect: [x0, , x1, y1], layout }) => h('div', {
      class: 'anim-block-layout', style: { left: x0 + 'px', top: size.height - y1 + 'px', width: x1 - x0 + 'px' },
    }, layout.map((tree) => h(BlockView, { tree, ui: channelUI }))));
  } });
  channelLayoutsApp.mount(channelOverlay);
  for (const type of ['pointerdown', 'pointerup', 'keydown', 'keyup', 'wheel']) channelOverlay.addEventListener(type, (e) => e.stopPropagation());
  section.append(channelOverlay);
  const headerApp = createApp({ render: () => {
    void headerState.revision;
    area.layout(RGN_TYPE_HEADER, 0, size.height, menus.clientWidth || section.clientWidth, menus.clientHeight || HEADER_HEIGHT);
    return (headerUI.inContext((C) => regionHeader(C)) ?? []).map((tree) => h(BlockView, { tree, ui: headerUI, header: true }));
  } });
  headerApp.mount(menus);

  // Before Blender's code reads them: the scene (its time, the objects' bases) made current in Main.
  function sync() {
    scene.flush();
  }
  // After it ran: what it changed (the frame, the range, the selection) reaches the scene, then the keys it changed
  // reach the channels (at the new frame, Main evaluated for it), and a finished operator that is an undo step makes one.
  function after(status) {
    scene.view();
    animation.edited();
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
    const parts = path.split('.'), name = parts.at(-1);
    const owner = area.inContext(RGN_TYPE_WINDOW, () => parts.slice(0, -1).reduce((data, key) => data?.[key], contextStruct()));
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

  // An invoke's popup (wm-popups.js): a confirmation, an enum's items, the operator's properties, or a menu Blender's
  // code built.
  function openPopup(idname, event) {
    openModulePopup(area.popup, {
      idname, at: screenPoint(event), C: blenderMain().C,
      finish: (props) => { if (!area.popup) return; const status = area.finishPopup(props); if (props) after(status); redraw(); },
      run: (id, values) => runFromMenu(id, values),
      enumItems: (prop) => ui.enumItems(idname, prop),
    });
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
    if (channelButtonClick(e)) return;
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
  // A click on a button the channel region's draw defined (a channel's toggles: expand, visibility, mute, lock...),
  // pressed as Blender's handlers press it; an operator's button runs its operator.
  function channelButtonClick(e) {
    if (e.button !== 0 || area.modal || gesture || !channelRecording) return false;
    const event = regionEvent(e, 'LEFTMOUSE', 'PRESS');
    if (event.region !== RGN_TYPE_CHANNELS) return false;
    const button = buttonAt(channelRecording, event.x, event.y);
    if (!button) return false;
    sync();
    if (button.operator) editor.invoke(operatorIdname(button.operator), {}, event);
    else area.press(RGN_TYPE_CHANNELS, button.index, event.modifier);
    commit();
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
      channelsView.style.display = channels ? '' : 'none';
      sidebar.hidden = !ui;
      Object.assign(channelsView.style, { width: channels + 'px', height: height + 'px' });
      Object.assign(mainView.style, { left: channels + 'px', width: width - channels - ui + 'px', height: height + 'px' });
      sidebar.style.width = ui + 'px';
    }
    return true;
  }


  let scheduled = 0, lastStatus = null, channelRecording = null;
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
    const main = regionDrawing(size.width - size.channels - size.ui, size.height);
    const spaceTheme = graph ? theme.graph_editor : theme.dopesheet_editor;
    const back = spaceTheme.space.back;
    main.ctx.fillStyle = `rgb(${back.map((c) => Math.round(c * 255)).join(',')})`;
    main.ctx.fillRect(0, 0, main.width, main.height);
    if (!drivers) drawFrameRange(main, v2d, range);
    if (graph) {
      drawGrid(main, v2d, spaceTheme.grid, { values: true, fps: t.fps });
      drawCurves(main, v2d, area.curves(), { showHandles: !(settings.flag & (1 << 2)), onlySelectedHandles: !!(settings.flag & (1 << 9)) });
    } else {
      drawGrid(main, v2d, spaceTheme.grid, { fps: t.fps });
      const { cur } = v2d, rows = channelRows(channels, v2d, metrics).map((row) => ({ ...row, keys: area.keys(row.channel.index, cur.xmin, cur.xmax) }));
      drawKeyRows(main, v2d, rows, metrics, { backdrops: !timeline });
    }
    if (markersShown() && !drivers) drawMarkers(main, v2d, animation.anim.markers, frame);
    if (gesture && gesture.region === RGN_TYPE_WINDOW) drawGesture(main, gesture);
    if (!drivers) drawScrubbing(main, v2d, metrics.scrubHeight, { seconds: !!(settings.flag & (graph ? 1 << 4 : 1 << 2)), fps: t.fps, fractions: graph });
    drawRecording(main.ctx, area.draw(RGN_TYPE_WINDOW, true), { height: size.height });
    main.ctx.flush(mainView);
    if (size.channels) {
      const view = regionDrawing(size.channels, size.height);
      channelRecording = area.draw(RGN_TYPE_CHANNELS);
      drawRecording(view.ctx, channelRecording, { height: size.height });
      view.ctx.flush(channelsView);
      // The block layouts the draw made (the channel filter beside the scrubbing area), by the shared renderer.
      channelLayouts.value = channelRecording.draw.filter((op) => op.op === 'layout');
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
      channelLayoutsApp.unmount();
      area.dispose();
    },
  };
}
