---
id: mobile
title: Touch and Pen
summary: Blender's own screens, keymaps and operators on large phones and tablets, with gestures for navigation, press and hold for tooltips and right clicks, pinch to scale the interface and drawers for areas that do not fit.
expect: Blender's screens, menus, tools and context menus work by touch on a large phone or a tablet; the UI stays dense (pinch over it to scale it), keys without a keyboard come later (the touch bar), and hover needs a pen.
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
ui:
  - VIEW_3D
  - PROPERTIES
  - OUTLINER
  - VIEW3D_HT_header
  - VIEW3D_MT_object_context_menu
operators:
  - view3d.move
  - view3d.zoom
  - view3d.rotate
  - wm.call_menu
  - ed.undo
  - ed.redo
code:
  - src/windowmanager/input/wm-touch.js
  - src/editors/interface/touch.js
  - src/editors/interface/components/ui/touch-hold/TouchHold.vue
  - src/editors/screen/dock.js
  - src/theme.css
tests:
  - tests/touch.test.js
  - tests/e2e/touch.mjs
limits:
  - Keys need a keyboard; a touch bar with sticky modifiers, shortcut bubbles and a keyboard sheet is not here yet.
  - Hover without a press (tool previews, Knife and Poly Build preselection) needs a pen; a finger has no hover.
  - Twisting two fingers does nothing; three fingers orbit.
  - A value dragged by a finger is under the finger; its readout above the finger is not here yet.
  - Areas swap and dock by mouse only (Ctrl drag from a corner); the long press on headers and edges is not here yet.
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

## Project files

The demo is the Default Cube example (`examples/cube`); nothing in its files is specific to touch.
