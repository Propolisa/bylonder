---
id: mobile
title: Touch and Pen
summary: Blender's own screens, keymaps and operators on large phones and tablets, with gestures for navigation, press and hold for tooltips and right clicks, pinch to scale the interface, drawers for areas that do not fit and a touch bar for keys.
expect: Blender's screens, menus, tools and context menus work by touch on a large phone or a tablet; the UI stays dense (pinch over it to scale it); a dragged value shows above the finger with soft Shift and Ctrl; area edges and headers take a long press; a one row touch bar gives modifier keys, a keys pie and a keyboard, with tappable bubbles while a transform runs; hover needs a pen.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/3dview/navigate/navigation.html
  - https://docs.blender.org/manual/en/5.2/editors/preferences/interface.html
  - https://docs.blender.org/manual/en/5.2/editors/preferences/keymap.html
  - https://docs.blender.org/manual/en/5.2/interface/window_system/areas.html
example: cube
thumbnail: mobile/thumbnail.png
media:
  - mobile/layout.png
  - mobile/drawer.gif
  - mobile/navigate.gif
  - mobile/header.gif
  - mobile/hold.gif
  - mobile/value.gif
  - mobile/edge.gif
  - mobile/carry.gif
  - mobile/bubbles.gif
ui:
  - VIEW_3D
  - PROPERTIES
  - OUTLINER
  - VIEW3D_HT_header
  - VIEW3D_MT_object_context_menu
  - VIEW3D_MT_view_pie
  - VIEW3D_MT_shading_pie
  - OBJECT_PT_transform
  - VIEW3D_PT_transform
operators:
  - view3d.move
  - view3d.zoom
  - view3d.rotate
  - wm.call_menu
  - ed.undo
  - ed.redo
  - screen.area_options
  - screen.area_split
  - screen.area_join
  - screen.area_swap
  - transform.translate
  - transform.rotate
  - transform.resize
code:
  - src/windowmanager/input/wm-touch.js
  - src/editors/interface/touch.js
  - src/editors/interface/components/ui/touch-hold/TouchHold.vue
  - src/editors/interface/components/ui/touch-bar/TouchBar.vue
  - src/editors/interface/components/ui/touch-bar/ShortcutBubbles.vue
  - src/editors/interface/components/ui/touch-bar/KeysPie.vue
  - src/editors/interface/components/ui/touch-bar/KeyboardSheet.vue
  - src/editors/interface/components/ui/touch-bar/ValueDragOverlay.vue
  - src/editors/interface/components/ui/number-field/NumberField.vue
  - src/editors/interface/touch-keys.js
  - src/editors/screen/dock.js
  - src/theme.css
tests:
  - tests/touch.test.js
  - tests/touch-keys.test.js
  - tests/e2e/touch.mjs
limits:
  - Shortcut bubbles show for the 3D Viewport's modal operators (transforms, Extrude); the 2D editors' (Graph Editor, Dope Sheet, Outliner) do not show them yet.
  - The quick keys pie's slots are fixed per mode; pinning or replacing a slot is not here yet.
  - Blender's pies (Z shading, accent grave views) open as menus, not drawn as pies.
  - An area carried by its header swaps with the area it is dropped on; docking it at another area's edge is not here yet.
  - Panels do not reorder by a hold and drag on their header.
  - Hover without a press (tool previews, Knife and Poly Build preselection) needs a pen; a finger has no hover, and the touch bar has no pointer mode yet.
  - Twisting two fingers does nothing; three fingers orbit.
---
# Touch and Pen

Bylonder runs Blender's own screens on large phones and tablets. A finger is Blender's mouse: Blender's keymaps,
tools, modal operators and context menus run unchanged. Gestures navigate, a press and hold shows a control's tooltip
and then right clicks, and a pinch over the interface sets Preferences > Interface > Resolution Scale. A touch
device's first run sets Preferences > Keymap > Middle Mouse Action to Pan, so two
fingers pan. The design is in `docs/mobile.md`.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=cube)

The demo is the Default Cube, opened on a phone or a tablet (or with a desktop browser's device emulation).

## Steps

1. **Open the Layout workspace.** The screen is startup.blend's. An area too small for its panels folds into a strip
   on its edge; the topbar, headers and status bar scroll sideways and fade where more is beyond the edge.

   ![The Layout workspace on a large phone](../media/features/mobile/layout.png)

2. **Open a folded area.** Tap the strip on the right: the Outliner and Properties editor open as a drawer over the
   3D Viewport at a usable width. A tap outside closes it.

   ![The Outliner and Properties editor as a drawer](../media/features/mobile/drawer.gif)

3. **Navigate.** Drag two fingers to pan, pinch to zoom, drag three fingers to orbit. A tap selects; two fingers
   tapping undo, three redo.

   ![Pan, zoom and orbit by touch](../media/features/mobile/navigate.gif)

4. **Reach a header's far end.** Drag the 3D Viewport's header sideways to its shading buttons and tap Rendered.

   ![The header scrolled to Rendered shading](../media/features/mobile/header.gif)

5. **Press and hold.** Hold a finger on a button: its tooltip shows at 400 ms and stays when you lift; the next tap
   closes it. Keep holding to 800 ms for the right click: on the 3D Viewport, the object context menu.

   ![A tooltip, then a context menu, by press and hold](../media/features/mobile/hold.gif)

6. **Drag a value.** In the Properties editor's Object tab, drag Location X sideways with one finger: its name and
   value show above the finger. Hold Shift (Fine) beside the readout with a second finger for ten times finer steps,
   or Ctrl (Snap) for Blender's snapped increments; let go to drag at normal speed again.

   ![Location X dragged, with its readout and Shift held](../media/features/mobile/value.gif)

7. **Use an area edge.** Press and hold on the edge between the 3D Viewport and the Timeline: Blender's Area Edge
   Options menu opens, with Vertical Split, Horizontal Split, Join Up, Join Down and Swap Areas. Tap Swap Areas.

   ![The area edge menu by a long press, then Swap Areas](../media/features/mobile/edge.gif)

8. **Carry an area.** Hold the Timeline's header until the ring fills halfway, then drag it over the 3D Viewport:
   the area under the finger is highlighted, and lifting swaps the two.

   ![The Timeline carried by its header onto the 3D Viewport](../media/features/mobile/carry.gif)

9. **Tap shortcuts.** Tap the cube, then Keys on the touch bar and Move in the pie. While the move runs, the touch
   bar shows its keys as bubbles: tap X, then the numbers button and 2, then Confirm. The cube moves 2 along X.

   ![Move by the keys pie, then X, 2 and Confirm by bubbles](../media/features/mobile/bubbles.gif)

## Project files

The demo is the Default Cube example (`examples/cube`); nothing in its files is specific to touch.
