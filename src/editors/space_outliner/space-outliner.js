// The Outliner (editors/space_outliner), Blender's own: its tree is built, drawn, selected and edited by Blender's code
// in the module (outliner-area.js) over the world's Blender mirror (object-blender.js, collections-blender.js). Its
// header is Blender's script (OUTLINER_HT_header, drawn by the shared layout renderer); its main region is a canvas
// the module's drawing is replayed on (region-draw.js). Events become Blender's: a button under the pointer applies as
// Blender's handlers apply it, the rest runs Blender's keymaps on the Outliner's operators, registered by idname and
// run in the Outliner as the context area. After each, what Blender's code changed comes back to Bylonder (writeBack).
import { blenderModule, operatorNames, pollOperator } from '../../bmesh/bmesh-wasm.js';
import { createContext } from '../../blenkernel/context.js';
import { dnaStruct } from '../../makesrna/dna-struct.js';
import { keymapHandler } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import { inArea, menuUI, registerOperator } from '../../windowmanager/wm-operators.js';
import { startGestureBox } from '../../windowmanager/wm-gesture-box.js';
import { drawMenu } from '../interface/ui-layout.js';
import { openMenu } from '../interface/menu.js';
import { buttonAt, drawRecording } from '../interface/region-draw.js';
import { headerLayout, drawPanels, drawType } from '../interface/panels.js';
import { LayoutView } from '../interface/layout-view.js';
import { menus, headers, panels } from '../../python/bpy_interface.js';
import { propBinding } from '../../makesrna/rna-bylonder.js';
import { createApp, h, reactive, markRaw } from 'vue';
import '../interface/layout-view.css';
import { deleted } from '../object/identity.js';
import { OutlinerArea, modifierOf, OPERATOR_FINISHED, OPERATOR_CANCELLED, OPERATOR_PASS_THROUGH } from './outliner-area.js';
import './space-outliner.css';

const { exports: x, cString } = blenderModule;
// The keymaps the Outliner's main region runs, in the order its handlers run them (ED_area_init).
const KEYMAPS = ['Outliner', 'View2D Buttons List', 'Screen', 'Window'];
// U.dbl_click_time in milliseconds, U.drag_threshold_mouse in pixels.
const DOUBLE_CLICK_TIME = 350, DRAG_THRESHOLD = 3;
const BUTTONS = ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE', 'BUTTON4MOUSE', 'BUTTON5MOUSE'];
// ID_OB (MAKE_ID2('O', 'B')), and the ui::ButtonType values of the buttons the Outliner defines.
const ID_OB = 0x424f;
const BUT_TEXT = 3, BUT_LABEL = 21, BUT_DRAG_LOCK = 1 << 12;

//   world, editor, commands: Bylonder's; objects: the world's Blender mirror (createBlenderObjects); rna:
//   createRNA(host); region: the element the main region fills; header: the area's header element.
export function createOutliner({ world, editor, commands, objects, rna, region, header }) {
  const area = new OutlinerArea(objects.blender);
  const canvas = Object.assign(document.createElement('canvas'), { className: 'bl-ui bl-outliner-region' });
  canvas.tabIndex = -1;
  canvas.setAttribute('aria-label', 'Outliner');
  region.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  let recording = { draw: [], buttons: [] }, textField = null, pointer = [0, 0];

  // bpy.context in the Outliner, for its header, popover and menus.
  const space = area.space;
  const context = () => createContext(rna, { area: 'OUTLINER', space });
  const ui = menuUI({ menus, context, prop: propBinding(rna.host), keymaps: () => KEYMAPS });
  // The Outliner as the context area: its operators act on it, and wm.call_menu opens its menus.
  const outlinerArea = { outliner: true, menu: (name) => (menus[name] ? (event) => openOutlinerMenu(name, event) : null) };

  const keys = keymapHandler(KEYMAPS);
  const dispatch = (event) => inArea(outlinerArea, () => keys(event));

  // Bylonder's world into the mirror; the Outliner syncs its selection from the view layer's when Bylonder's changed.
  let selection = '';
  function sync() {
    objects.sync();
    const next = editor.selection.nodes.map((node) => objects.objectOf(node)).join();
    if (next !== selection) area.selectionChanged();
    selection = next;
  }

  // What Blender's code changed, back into Bylonder's objects, then its collections.
  function writeBack() {
    const { blender } = objects, alive = new Set(blender.ids(ID_OB)), selected = [], active = [];
    for (const node of world.objects.filter((n) => !deleted(n))) {
      const ob = objects.objectOf(node);
      if (!ob) continue;
      if (!alive.has(ob)) {
        node.metadata = { ...node.metadata, wbDeleted: true };
        node.setEnabled(false);
        objects.forget(node);
        continue;
      }
      const base = blender.base(ob), dna = dnaStruct('Object', ob), data = rna.pointer('Object', node);
      if (base?.selected) (base.active ? active : selected).push(node);
      if (base && data.hide_get() !== base.hidden) node.setEnabled(!base.hidden);
      for (const name of ['hide_select', 'hide_render', 'hide_viewport']) if (data[name] !== dna[name]) data[name] = dna[name];
      const name = blender.name(ob);
      if (name !== objects.syncedName(node)) {
        node.name = name;
        objects.named(node, name);
      }
      const parent = objects.nodeOf(blender.parent(ob));
      if (parent !== (objects.objectOf(node.parent) ? node.parent : null)) node.setParent(parent);
    }
    editor.selection.replace([...selected, ...active]);
    world.collections.assign(objects.collections.read());
    selection = editor.selection.nodes.map((node) => objects.objectOf(node)).join();
  }

  // An operator's run ended: what it changed comes back, as one undo step when its type makes one.
  function finished({ status, undo }) {
    if (status & OPERATOR_FINISHED) {
      if (undo) commands.transaction(writeBack);
      else writeBack();
    }
    openCalledMenu();
    draw();
    return status & OPERATOR_PASS_THROUGH ? 'PASS_THROUGH' : status & OPERATOR_CANCELLED ? 'CANCELLED' : 'FINISHED';
  }

  // Blender's event for an event of Bylonder's window manager: its type and value by identifier, where it is in the
  // region (pixels, y up), and the keys held.
  const blenderEvent = (event) => event && { type: event.type.toUpperCase(), value: event.value, region: event.region ?? pointer, modifier: modifierOf(event) };

  // Runs an Outliner operator: invoked with the event that ran it (or one at the pointer, from a menu), as Blender's
  // handlers invoke it in its area's main region.
  function run(idname, props, event) {
    sync();
    const result = area.run(idname, props, blenderEvent(event) ?? { type: 'NONE', value: 'NOTHING', region: pointer });
    if (area.gesture) return startGesture(props, event?.value === 'CLICK_DRAG' ? { x: event.clientX, y: event.clientY } : null);
    return finished(result);
  }
  for (const idname of operatorNames().filter((name) => /^(outliner|view2d)\./.test(name))) {
    registerOperator(idname, {
      run: (props, event) => run(idname, props, event),
      poll: () => area.inContext((C) => pollOperator(C, idname)),
    });
  }

  // Menus: one an operator called (WM_menu_name_call), or wm.call_menu's, at the pointer.
  function openOutlinerMenu(name, at = lastClient) {
    openMenu(drawMenu(name, ui), { x: at.clientX ?? at.x, y: at.clientY ?? at.y }, menus[name].bl_label);
    return 'FINISHED';
  }
  function openCalledMenu() {
    const name = cString(x.operator_menu_called());
    if (name && menus[name]) openOutlinerMenu(name);
  }

  // The box gesture an invoke started (WM_gesture_box_invoke), run by Bylonder's window manager: from a drag it has
  // begun at the press. Its box goes to the operator in region pixels, with the mode gesture_modal_state_to_operator
  // gives when the keymap set none.
  function startGesture(props, begin) {
    startGestureBox(world.wm, {
      begin,
      select({ xmin, xmax, ymin, ymax }, mode) {
        const rect = canvas.getBoundingClientRect();
        finished(area.finishGesture({ xmin: Math.round(xmin - rect.left), xmax: Math.round(xmax - rect.left), ymin: Math.round(rect.bottom - ymax),
          ymax: Math.round(rect.bottom - ymin), wait_for_input: false, mode: props.mode ?? (mode === 'SUB' ? 'SUB' : 'ADD') }));
      },
    });
    return 'RUNNING_MODAL';
  }

  // Events in the main region: presses, clicks, double clicks and drags as wm_event_system.cc makes them.
  let press = null, lastPress = null, lastClient = { clientX: 0, clientY: 0 }, dragToggle = null;
  const regionAt = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, rect.height - (e.clientY - rect.top)];
  };
  const wmEvent = (e, type, value, extra = {}) => ({
    type: type.toLowerCase(), value, native: e, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey,
    region: regionAt(e), clientX: e.clientX, clientY: e.clientY, ...extra,
  });
  const handled = (e) => { e.preventDefault(); e.stopPropagation(); };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || world.wm.modal) return;
    handled(e);
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    pointer = regionAt(e);
    lastClient = e;
    if (textField) return finishTextEdit(true);
    const button = e.button === 0 && buttonAt(recording, ...pointer);
    if (button && ![BUT_LABEL, BUT_TEXT].includes(button.type)) return pressButton(button, e);
    const type = BUTTONS[e.button];
    const double = lastPress?.type === type && e.timeStamp - lastPress.time < DOUBLE_CLICK_TIME &&
      Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < DRAG_THRESHOLD;
    // An unhandled double click goes on as a press, as wm_event_system.cc sends it again.
    const used = (double && dispatch(wmEvent(e, type, 'DOUBLE_CLICK'))) || dispatch(wmEvent(e, type, 'PRESS'));
    press = { type, x: e.clientX, y: e.clientY, e, double, used, dragged: false };
    lastPress = double ? null : { type, x: e.clientX, y: e.clientY, time: e.timeStamp };
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer = regionAt(e);
    if (world.wm.modal) return;
    if (dragToggle) return continueDragToggle(e);
    if (area.modal) {
      finishedModal(area.handle(blenderEvent(wmEvent(e, 'MOUSEMOVE', 'NOTHING'))));
      return;
    }
    if (area.dragging) return moveDrag(e);
    if (press && !press.dragged && !press.used && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= DRAG_THRESHOLD) {
      press.dragged = true;
      dispatch(wmEvent(press.e, press.type, 'CLICK_DRAG', { region: regionAt(press.e) }));
      if (area.dragging) moveDrag(e);
      return;
    }
    if (!press) dispatch(wmEvent(e, 'MOUSEMOVE', 'NOTHING'));
  });
  canvas.addEventListener('pointerup', (e) => {
    pointer = regionAt(e);
    if (world.wm.modal) return;
    if (dragToggle) { dragToggle = null; return; }
    const type = BUTTONS[e.button];
    if (area.dragging) {
      press = null;
      return endDrag(type === 'LEFTMOUSE' ? area.drop(blenderEvent(wmEvent(e, type, 'RELEASE'))) : null);
    }
    if (area.modal) finishedModal(area.handle(blenderEvent(wmEvent(e, type, 'RELEASE'))));
    else dispatch(wmEvent(e, type, 'RELEASE'));
    if (press && !press.used && !press.dragged && !press.double) dispatch(wmEvent(press.e, type, 'CLICK'));
    press = null;
  });
  canvas.addEventListener('wheel', (e) => {
    handled(e);
    pointer = regionAt(e);
    dispatch(wmEvent(e, e.deltaY < 0 ? 'WHEELUPMOUSE' : 'WHEELDOWNMOUSE', 'PRESS'));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerenter', () => canvas.focus({ preventScroll: true }));
  canvas.addEventListener('pointerleave', () => { if (!press) dispatch({ type: 'mousemove', value: 'NOTHING', region: [-1, -1] }); });
  canvas.addEventListener('keydown', (e) => {
    if (world.wm.modal || (e.repeat && !/arrow|page/.test(keyType(e)))) return;
    if (area.dragging && e.key === 'Escape') return handled(e), endDrag(null);
    const event = { type: keyType(e), value: 'PRESS', native: e, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, region: pointer, clientX: lastClient.clientX, clientY: lastClient.clientY };
    if (area.modal ? (finishedModal(area.handle(blenderEvent(event))), true) : dispatch(event)) handled(e);
  });

  // A drag an operator started (outliner.item_drag_drop): the drop it would make shows by the pointer, as
  // wm_drags_draw shows it, and the tree marks its target; the release drops, Escape or another button cancels it.
  const dragTip = Object.assign(document.createElement('div'), { className: 'bl-tooltip bl-outliner-drag', hidden: true });
  document.body.append(dragTip);
  function moveDrag(e) {
    dragTip.textContent = area.dragUpdate(blenderEvent(wmEvent(e, 'MOUSEMOVE', 'NOTHING')));
    Object.assign(dragTip.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
    dragTip.hidden = !dragTip.textContent;
    draw();
  }
  function endDrag(result) {
    dragTip.hidden = true;
    if (result) return finished(result);
    area.dragCancel();
    draw();
  }

  const finishedModal = (result) => { if (!area.modal) finished(result); else draw(); };

  // A button applied as interface_handlers.cc applies it: a toggle flips, and dragging over the toggles of its column
  // sets them alike (BUT_DRAG_LOCK).
  function pressButton(button, e) {
    sync();
    const value = area.press(button.index, { modifier: modifierOf(wmEvent(e, 'LEFTMOUSE', 'PRESS')) });
    if (button.flag & BUT_DRAG_LOCK) dragToggle = { value, type: button.type, column: button.rect[0], pressed: new Set([button.index]) };
    commands.transaction(writeBack);
    draw();
  }
  function continueDragToggle(e) {
    const button = buttonAt(recording, ...regionAt(e));
    if (!button || button.type !== dragToggle.type || button.rect[0] !== dragToggle.column || dragToggle.pressed.has(button.index)) return;
    dragToggle.pressed.add(button.index);
    if (button.selected !== dragToggle.value) {
      sync();
      area.press(button.index, { value: Number(dragToggle.value) });
      commands.transaction(writeBack);
      draw();
    }
  }

  // A text button being edited (an item's rename): Bylonder's field over it until Return applies or Escape cancels.
  function startTextEdit(button) {
    const [x0, y0, x1, y1] = button.rect, height = canvas.clientHeight;
    textField = Object.assign(document.createElement('input'), { className: 'bl-field bl-outliner-rename', value: button.text, maxLength: button.maxlength - 1 });
    Object.assign(textField.style, { left: `${x0}px`, top: `${height - y1}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    textField.dataset.index = button.index;
    textField.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finishTextEdit(true);
      else if (e.key === 'Escape') finishTextEdit(false);
    });
    textField.addEventListener('blur', () => finishTextEdit(true));
    region.append(textField);
    textField.focus();
    textField.select();
  }
  function finishTextEdit(apply) {
    const field = textField;
    if (!field) return;
    textField = null;
    field.remove();
    sync();
    area.editText(Number(field.dataset.index), apply ? field.value : null);
    if (apply) commands.transaction(writeBack);
    draw();
    canvas.focus({ preventScroll: true });
  }

  // The header: OUTLINER_HT_header from Blender's script, drawn by the shared layout renderer, with its popovers'
  // panels (OUTLINER_PT_filter).
  const headerState = reactive({ revision: 0 });
  const drawInto = (type) => (layout) => drawType(type, layout, context());
  const layoutUI = markRaw({
    get revision() { return headerState.revision; },
    undoPush: () => { commands.transaction(() => {}); draw(); },
    report: (error) => rna.host.notify?.(error.message),
    run: (idname, props) => inArea(outlinerArea, () => ui.run(idname, props)),
    supported: (idname, props) => inArea(outlinerArea, () => ui.supported(idname, props)),
    poll: (idname, props) => inArea(outlinerArea, () => ui.poll(idname, props)),
    isOpen: () => true,
    toggle: () => {},
    ids: () => [],
    drawMenu: (idname) => inArea(outlinerArea, () => drawMenu(idname, ui)),
    menuLabel: (idname) => menus[idname]?.bl_label,
    menuContents: (idname) => menus[idname] && markRaw(headerLayout(context(), drawInto(menus[idname]))),
    popover: (id) => {
      const type = panels[id];
      if (!type) return null;
      const [drawn] = drawPanels({ roots: [{ type, children: [] }] }, context(), { contexts: [type.bl_context].filter(Boolean) });
      return drawn?.body && { label: drawn.label, layout: drawn.body, units: type.bl_ui_units_x };
    },
  });
  const headerHost = Object.assign(document.createElement('div'), { className: 'bl-ui bl-outliner-header' });
  header?.append(headerHost);
  const headerApp = createApp({ render: () => {
    void headerState.revision;
    return h(LayoutView, { layout: headerLayout(context(), drawInto(headers.OUTLINER_HT_header)), ui: layoutUI });
  } });
  headerApp.mount(headerHost);
  const drawHeader = () => { headerState.revision++; };

  // Draws the main region from the module's recording; a text button being edited shows Bylonder's field.
  let signature = '';
  function draw() {
    const width = canvas.clientWidth, height = canvas.clientHeight, scale = devicePixelRatio || 1;
    if (!width || !height) return;
    if (area.size[0] !== width || area.size[1] !== height) area.resize(width, height);
    if (canvas.width !== Math.round(width * scale)) canvas.width = Math.round(width * scale);
    if (canvas.height !== Math.round(height * scale)) canvas.height = Math.round(height * scale);
    sync();
    recording = area.draw();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const replay = () => drawRecording(ctx, recording, { height, scale, redraw: replay });
    replay();
    const editing = recording.buttons.find((b) => b.type === BUT_TEXT && b.active);
    if (editing && !textField) startTextEdit(editing);
    drawHeader();
  }

  // Redraws when Bylonder's data the Outliner shows changed.
  function refresh() {
    const next = JSON.stringify([world.objects.map((n) => [n.uniqueId, n.name, n.parent?.uniqueId, n.isEnabled(false), n.metadata?.wbDeleted, n.metadata?.wbLocked,
      n.metadata?.wbHideRender, editor.selection.has(n)]), editor.selection.nodes.at(-1)?.uniqueId, world.collections.state]);
    if (next !== signature) {
      signature = next;
      draw();
    }
  }
  const resized = new ResizeObserver(() => draw());
  resized.observe(region);
  const unsubscribe = world.collections.subscribe(() => refresh());
  draw();

  return { refresh, draw, area, dispose() { resized.disconnect(); unsubscribe(); area.cancel(); dragTip.remove(); headerApp.unmount(); } };
}
