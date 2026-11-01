---
id: preferences
title: Preferences
summary: Blender's Preferences editor with all of its sections and settings, kept in this browser, with laptop input (Emulate 3 Button Mouse, Emulate Numpad, trackpad gestures), Blender's keymaps to edit, and its themes on the interface.
status: partial
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/editors/preferences/index.html
  - https://docs.blender.org/manual/en/5.2/editors/preferences/input.html
  - https://docs.blender.org/manual/en/5.2/editors/preferences/navigation.html
  - https://docs.blender.org/manual/en/5.2/editors/preferences/keymap.html
  - https://docs.blender.org/manual/en/5.2/editors/preferences/themes.html
  - https://docs.blender.org/manual/en/5.2/editors/3dview/navigate/navigation.html
example: cube
thumbnail: preferences/thumbnail.png
media:
  - preferences/open.png
  - preferences/input.png
  - preferences/keymap.png
  - preferences/themes.png
  - preferences/bylonder.png
ui:
  - PREFERENCES
  - USERPREF_HT_header
  - USERPREF_PT_navigation_bar
  - USERPREF_PT_save_preferences
  - USERPREF_PT_input_mouse
  - USERPREF_PT_input_keyboard
  - USERPREF_PT_input_touchpad
  - USERPREF_PT_navigation_orbit
  - USERPREF_PT_navigation_zoom
  - USERPREF_PT_keymap
  - USERPREF_PT_theme
  - TOPBAR_MT_edit
  - VIEW_3D
operators:
  - screen.userpref_show
  - wm.save_userpref
  - wm.read_userpref
  - wm.read_factory_userpref
  - preferences.keyconfig_activate
  - preferences.reset_default_theme
  - view3d.rotate
  - view3d.move
  - view3d.zoom
  - view3d.view_axis
  - view3d.view_persportho
  - view3d.view_selected
code:
  - src/editors/space_userpref/editor.js
  - src/editors/space_userpref/support.js
  - src/editors/space_userpref/userpref-operators.js
  - src/windowmanager/wm-userdef.js
  - src/windowmanager/keyconfig.js
  - src/windowmanager/wm-window.js
  - src/windowmanager/wm-event-system.js
  - src/editors/space_view3d/navigation.js
  - src/editors/interface/theme-tokens.js
  - src/workspace/preferences.js
  - tools/blender-port/wasm/wm-api.cc
  - tools/blender-port/wasm/ghost-paths.cc
tests:
  - tests/preferences-wasm.test.js
  - tests/context.test.js
  - tests/e2e/smoke.mjs
limits:
  - NDOF devices are greyed out: Bylonder is built without NDOF input, so the Gamepad API is not read.
  - Auto Depth has no depth buffer to read in the module; navigation centers as without it.
  - Interface settings the page draws itself (Resolution Scale, Line Width, fonts, pie menu timing, tooltips' Python) are greyed out until the page's interface follows them.
  - Viewport quality settings (Anti-Aliasing, Texture Limit, Anisotropic Filtering, Clip Alpha) and Studio Lights are shown greyed out; Babylon's drawing does not take them yet.
  - Theme colors that no design token stands for are greyed out. Reset to Default Theme gives Blender Dark; the theme presets menu (Blender Light) does not load its XML yet.
  - The Add-ons list does not draw yet (Blender's addon_utils reads add-ons' sources, which the app's Python cannot open yet); nothing can be installed from disk or online.
  - The Keymap lists operators Bylonder runs its own way as unavailable, as Blender lists an operator it lacks; their keys still work.
  - The Mouse panel's labels are cut short at the window's default width.
  - File Paths are greyed out: projects and their files live in the browser.
---
# Preferences

Edit > Preferences opens Blender's Preferences editor: Blender's own `space_userpref` running in the module, its
header, navigation bar and every panel of every section drawn from Blender's Python UI over Blender's Preferences
(`U`). Settings Bylonder honors work as in Blender; the ones a browser cannot honor, or Bylonder does not yet, are
greyed out with their reason in the tooltip, never hidden. Bylonder's own settings are in System > Bylonder, a panel
with the Bylonder icon.

The Preferences belong to the user, not to a project: Save Preferences writes Blender's `userpref.blend`, which this
browser keeps, and startup reads it as Blender does. Auto-Save Preferences saves changed preferences when the page is
hidden or closed, and Load Factory Preferences and Revert to Saved Preferences are Blender's.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=cube)

The demo is the Default Cube; the steps below change Preferences over it.

## Steps

1. **Open the Preferences.** Edit > Preferences opens Blender's Preferences in a window of its own, which can be moved
   by its title. Preferences can also be shown in any area through its Editor Type menu. With Interface > Editors >
   Temporary Editors > Preferences set to Maximized Area, Edit > Preferences fills the app's area instead.

   ![Edit > Preferences opens Blender's Preferences window](../media/features/preferences/open.png)

2. **Set up a laptop.** In Input, turn on Emulate 3 Button Mouse: Alt and a left drag orbits the 3D Viewport, Shift
   Alt pans and Ctrl Alt zooms. Turn on Emulate Numpad: the number row is the numpad, so 1, 3 and 7 view from the
   front, right and top, 5 switches perspective and 0 looks through the camera. Touchpad > Multi-touch Gestures on
   makes a two-finger drag orbit, with Shift pan and with Ctrl zoom, and a pinch zoom; Scroll Direction sets natural
   scrolling. Without a numpad, the View pie on the backtick key (\`) and the navigation gizmo's axes reach every view.

   ![Input with Emulate 3 Button Mouse and Emulate Numpad on](../media/features/preferences/input.png)

3. **Navigate as you prefer.** Navigation's Orbit Method (Turntable or Trackball), Orbit Around Selection, Auto
   Perspective, Zoom to Mouse Position and Invert Zoom Wheel apply to the 3D Viewport at once: its navigation is
   Blender's own operators, which read them.

4. **Edit the keymap.** Keymap lists Blender's keymaps. Pick Blender or Industry Compatible as the preset; Select With
   Left or Right and Spacebar Action change the keys Blender's preset makes. Click a key item's key and press the new
   key (with its modifiers) to rebind it; Restore puts a keymap back. The changes are kept with the Preferences.

   ![Keymap with Blender's preset and its options](../media/features/preferences/keymap.png)

5. **Change the theme.** Themes applies a theme to the interface through its design tokens: Reset to Default Theme
   gives Blender Dark, and colors that a token stands for can be edited one by one.

   ![Themes, its User Interface colors](../media/features/preferences/themes.png)

6. **Bylonder's settings.** System > Bylonder holds Keep Scenes Loaded and the Video Sequencer's setup: whether it asks
   when the Video Sequencer opens on an empty edit, and the choice it remembers.

   ![System > Bylonder](../media/features/preferences/bylonder.png)

7. **Keep them.** Save Preferences (or Auto-Save Preferences) keeps them in this browser; reload the page and they
   apply at startup.

## Laptop input

Every view and navigation action has a route without a numpad or a middle mouse button:

| Action | Mouse with a middle button and numpad | Laptop |
| --- | --- | --- |
| Orbit | Middle drag | Alt left drag (Emulate 3 Button Mouse), two-finger drag, or drag the navigation gizmo |
| Pan | Shift middle drag | Shift Alt left drag, Shift two-finger drag, or drag the hand button |
| Zoom | Wheel, Ctrl middle drag | Ctrl Alt left drag, pinch, Ctrl two-finger drag, or drag the magnifier button |
| Front, Right, Top views | Numpad 1, 3, 7 | 1, 3, 7 (Emulate Numpad), the backtick View pie, or click the gizmo's axes |
| Opposite views | Ctrl Numpad 1, 3, 7 | Ctrl 1, 3, 7 (Emulate Numpad), or click an axis again |
| Perspective and orthographic | Numpad 5 | 5 (Emulate Numpad), or the projection button |
| Camera view | Numpad 0 | 0 (Emulate Numpad), or the camera button |
| Frame selected | Numpad . | View > Frame Selected |

Touch screens map their gestures onto the same trackpad events: one finger orbits, two fingers pan and pinch.

## Project files

The demo is the Default Cube example (`examples/cube`); Preferences are not part of a project.

## Not done yet

What the page lists under `limits` above.
