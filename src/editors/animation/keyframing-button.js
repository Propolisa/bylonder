// The button under the pointer, as Blender's interface makes it the region's active button: Blender's "User Interface"
// keymap runs on it (I inserts a keyframe, Alt I deletes it, Shift Alt I clears its keys) and its context menu lists
// the same operators (keyframing.cc's ANIM_OT_keyframe_insert_button and the rest). A button is Blender's (a layout
// tree's, block-view.js), whose operators run in the module on it, or a Babylon-only panel's property (primitives.js),
// keyed through its animation channels. Either is { run(idname, props): whether it ran, menu(event) }.
import { registerOperators } from '../../windowmanager/wm-operators.js';
import { keymapHandler, blenderKeys } from '../../windowmanager/keyconfig.js';
import { keyType } from '../../windowmanager/input/keymap.js';
import { blenderModule, newOperator } from '../../bmesh/bmesh-wasm.js';
import { OPERATOR_FINISHED } from './anim-area.js';

const { exports: x, cString } = blenderModule;
const POPUP_LAYOUT = 4;

let hovered = null;
export const hoverButton = (button) => { hovered = button; };
export const leaveButton = (button) => { if (hovered === button) hovered = null; };

// The operators Blender's button context menu and the User Interface keymap run on the active button.
const BUTTON_OPERATORS = ['anim.keyframe_insert_button', 'anim.keyframe_delete_button', 'anim.keyframe_clear_button', 'anim.driver_button_add',
  'anim.driver_button_remove', 'anim.keyingset_button_add', 'anim.keyingset_button_remove', 'anim.copy_driver_button', 'anim.paste_driver_button',
  'anim.view_curve_in_graph_editor', 'ui.reset_default_button', 'ui.unset_property_button', 'ui.copy_data_path_button', 'ui.copy_as_driver_button',
  'ui.copy_to_selected_button', 'ui.override_idtemplate_make'];
registerOperators(Object.fromEntries(BUTTON_OPERATORS.map((idname) => [idname, {
  supports: () => !!hovered,
  run: (props) => (hovered.run(idname, props) ? 'FINISHED' : 'CANCELLED'),
}])));

// The User Interface keymap on the hovered button, before any editor's keymaps (as Blender's button handlers run
// before the region's).
const keys = keymapHandler(['User Interface']);
globalThis.addEventListener?.('keydown', (e) => {
  if (!hovered || e.repeat || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  const event = { type: keyType(e), value: 'PRESS', shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, oskey: e.metaKey, native: e };
  if (keys(event)) { e.preventDefault(); e.stopPropagation(); }
}, true);

// A button of a layout tree (`b`) in a region of an area in the module: its operators run there with it as the
// region's active button (ui_button_active_set, as hovering makes it), and its context menu is Blender's
// (ui_popup_context_menu_for_button), whose items run on it. `done()` follows each run (an undo step, a redraw).
export function blenderButton(area, regionType, b, done) {
  const activate = (id) => area.inContext(regionType, (C) => x.ui_button_active_set(C, id));
  const run = (idname, props = {}) => {
    let op;
    try { op = newOperator(idname, props); } catch { return false; }
    activate(b.id);
    try {
      return !!(area.run(op, regionType) & OPERATOR_FINISHED);
    } finally {
      activate(0);
      done();
    }
  };
  return {
    run,
    async menu(event) {
      const popup = area.inContext(regionType, (C) => x.ui_button_context_menu(C, b.id) && x.operator_popup() === POPUP_LAYOUT
        && { type: 'LAYOUT', title: cString(x.operator_popup_title()), text: cString(x.operator_popup_text()) });
      activate(0);
      if (!popup) return;
      const { openPopup } = await import('../../windowmanager/wm-popups.js');
      openPopup(popup, { at: { x: event.clientX, y: event.clientY }, finish: () => {}, run, C: null });
    },
  };
}

// A Babylon-only panel's property as a button: its channels (`refs()`) keyed through the scene's animation as Blender's
// button operators key a property, `reset()` to its default, and its data paths copied.
export function channelButton(animation, refs, reset) {
  const actions = {
    'anim.keyframe_insert_button': () => animation.insert(refs()),
    'anim.keyframe_delete_button': () => animation.deleteKeys(refs().map((ref) => ({ ref, frame: Math.round(animation.time.frame) }))),
    'anim.keyframe_clear_button': () => animation.clear(refs()),
    'ui.reset_default_button': reset,
    'ui.copy_data_path_button': () => navigator.clipboard?.writeText(refs().map(animation.dataPath).join('\n')),
  };
  return {
    run(idname) {
      const action = actions[idname];
      if (!action || (idname.startsWith('anim.') && !refs().length)) return false;
      action();
      return true;
    },
    // Its context menu, with the items ui_popup_context_menu_for_button lists for a property.
    async menu(event) {
      const { openMenu } = await import('../interface/menu.js');
      openMenu(this.items(), { x: event.clientX, y: event.clientY });
    },
    items() {
      const state = refs().length ? animation.state(refs()[0]) : 'unavailable';
      const item = (label, idname) => ({ label, blender: idname, keys: blenderKeys(['User Interface'], idname), run: () => this.run(idname) });
      return [
        ...(state === 'keyed' ? [item('Replace Keyframe', 'anim.keyframe_insert_button'), item('Delete Keyframe', 'anim.keyframe_delete_button')]
          : state !== 'unavailable' ? [item('Insert Keyframe', 'anim.keyframe_insert_button')] : []),
        ...(['keyed', 'animated', 'changed'].includes(state) ? [item('Clear Keyframes', 'anim.keyframe_clear_button')] : []),
        '-',
        ...(reset ? [item('Reset to Default Value', 'ui.reset_default_button')] : []),
        ...(refs().length ? [item('Copy Data Path', 'ui.copy_data_path_button')] : []),
      ].filter((entry, i, all) => entry !== '-' || (i > 0 && i < all.length - 1));
    },
  };
}
