# Touch and pen: handoff

The design is docs/mobile.md. c1 ships: Blender's own screens and input on phones and tablets (the adapter in
src/windowmanager/input/wm-touch.js, press and hold, gestures, Resolution Scale, fold drawers, overflow fades, the
feature page docs/features/mobile.md). What follows does not ship; it sits on the branch `mobile-touch-next`.

## On the branch, not wired in or not tested

- c2, touch bar, shortcut bubbles, quick keys pie, keyboard sheet: the components in
  src/editors/interface/components/ui/touch-bar/ (TouchBar.vue, ShortcutBubbles.vue, KeysPie.vue, KeyboardSheet.vue),
  src/editors/interface/touch-keys.js (bubbles from the running modal keymap; pie slots per mode, labelled from the
  keymaps), keyOf in src/windowmanager/input/keymap.js, modalKeymapItems and binding in src/windowmanager/keyconfig.js.
  The wiring is written but not applied: scratch/mobile-touch-c2.js replaces src/editors/interface/touch.js; main.js
  must then pass `modal` (the running operator's modal keymap: x.operator_modal_added(C), x.operator_modal_keymap(op),
  x.operator_modal_item(op, id), all existing module exports, no rebuild), `mode` (OBJECT, EDIT, SCULPT, POSE) and
  `pinned` (the user's pie keys, to keep as a Bylonder preference). Not tested in a browser.
- c3, value drag readout and soft Shift and Ctrl: ValueDragOverlay.vue (in touch-bar/), and the NumberField.vue edit
  in scratch/mobile-e14.py (announces `bl-value-drag`, touch-pan-y). The overflow test (every clipped element without
  a scroll container, at each size) is not written.

## Not started

- c4: a long press on an area edge as Blender's edge menu (screen.area_options: splits, Join in both directions,
  Swap Areas), the dock needs area_swap and area_join by edge; a hold and drag on a header to swap and dock areas; a
  hold and drag on a panel header to reorder panels.
- Feature page steps and GIFs for c2 to c4 (tools/docs/record-mobile.mjs takes more `r.gif` steps).
- Finger hover (a pointer mode), twist.

## Tools

- tests/e2e/touch.mjs (npm run test:touch): 8 checks at four sizes; `fingers(page)` drives CDP touch.
- Wrap every browser run in flock /root/work/build.lock.
