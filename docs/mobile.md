# Touch and pen

How Bylonder runs on large phones and tablets. Decided 2026-11-02. Built: the input model and gestures, press and
hold, Resolution Scale, folding, overflow, dragging a value, area edges by long press, area swap by a header's hold
and drag, the touch bar with its keyboard, shortcut bubbles for the modal operators the page runs, the quick keys pie,
and their test plan rows (`tests/e2e/touch.mjs`). Not built yet: see What is left.

The rule: everything Blender can do with a mouse and keyboard can be done with fingers or a pen, in Blender's own
layouts, keymaps, menus and operators. The touch layer adds only what the hardware lacks. It never adds a second way
of doing what Blender already has a way for, and it never hides or rearranges Blender's UI by device.

Target devices are large phones (about 430 x 930 CSS pixels) and tablets (1024 x 1366 and 1366 x 1024). The UI stays
dense; users zoom it when they want bigger targets.

## Input model

Blender's window manager already takes the browser's input (`docs/blender-boundary.md`, Window manager): DOM events
become GHOST events in `wm-event-system.js`, and Blender's keymaps, modal operators, clicks, drags and double clicks
run unchanged. Touch joins that path instead of running beside it.

One adapter, `src/windowmanager/input/wm-touch.js`, listens at the window's capture phase before the event system. It
turns touch contacts into the pointer stream of a mouse and the key events of a keyboard, so everything downstream
(Blender's window, the page's keymaps, every widget and editor) sees the same events it sees on a desktop:

- **One finger** is the mouse's left button, at the finger. A contact is held back until it is known to be one finger:
  it commits as a press when it moves past the drag threshold (Blender's for a tablet, `drag_threshold_tablet`, the
  nearest of its inputs to a finger), as a click when it lifts, and as a gesture when a second finger lands first. Over
  UI, where the browser scrolls under a drag, a drag never presses: it scrolls. Held back events are replayed in order, so a stroke loses no samples.
  Once a contact has committed, further fingers are ignored until all lift, except on the soft modifier buttons of a
  value drag and on the touch bar, which take a second finger (see Dragging a value).
- **Modifier keys** are sticky Shift, Ctrl and Alt (and Cmd on Apple devices) in the touch bar (see Discoverability).
  A tap latches a modifier for the next press, a double tap locks it, holding it keeps it down while another finger
  works. Each state change is a real key press or release of `left_shift`, `left_ctrl` or `left_alt` sent to the
  window, so modal keymaps see them as they see a keyboard's (Shift for precision, Ctrl to snap during a transform).
- **Middle and right buttons.** Long press is a right click (press and release of the right button where the finger
  is), so every context menu is Blender's, chosen by Blender's keymap for the editor, mode and button under the finger.
  See Press and hold for its stages. The touch bar also has a button latch (left, middle, right) that makes the next one finger drag that button, for
  bindings with no gesture equivalent: middle drag to pick a transform axis, Ctrl right drag to cut node links, Shift
  right drag for reroutes.
- **Scroll wheel.** Two finger drags are GHOST trackpad scroll events, which Blender binds where a wheel would be
  awkward (`TRACKPADPAN`). Where a keymap needs the wheel itself (Ctrl wheel over a field, Alt wheel to change frame,
  the wheel in a modal operator), the touch bar's wheel stepper sends `WHEELUPMOUSE` and `WHEELDOWNMOUSE` with the
  latched modifiers, at the last finger position.
- **Hover.** Blender reads the pointer position for keys (the area and button under the mouse take them) and for
  preselection. The last finger position is the mouse position between touches. For hover that matters while no
  button is down (tool previews, Knife and Poly Build preselection, tooltips), the touch bar's pointer mode turns one
  finger into a trackpad: the finger moves a drawn cursor relative to where it was, a tap is a click at the cursor.
  A pen hovers natively and needs none of this.
- **Keyboard.** A physical keyboard works as on a desktop. Without one, the Keys sheet is a full Blender keyboard
  (letters, numbers, F keys, numpad, Esc, Tab, Delete, arrows, Home, Page keys), each key a GHOST key event sent to the
  area under the last finger. Text fields use the system keyboard (see Text and number input).

The event system's touch exclusions (`e.pointerType === 'touch'` in `wm-event-system.js`, `view3d-window.js` and
`space-outliner.js`) go away: those paths now receive the adapter's stream.

Which regions are views and which are UI is said once, in CSS: a view's element sets `touch-action: none` and
`--bl-touch: view` (inherited, so the adapter reads it from the touched element's computed style); the window's root
sets `touch-action: pan-x pan-y` and `--bl-touch: ui`, so UI scrolls natively under one finger and the browser never
zooms the page.

### Press and hold

Holding a finger still is staged, with a small progress ring at the finger:

1. At 400 ms over a control, its tooltip opens beside the finger: the full label (a label Blender shortened with its
   ellipsis included), the description and the Python path, as Blender's tooltip shows them. Every control's tooltip
   is reachable this way, not only shortened ones.
2. At 800 ms the right click happens: the control's or the editor's context menu. Over a view, where there is no
   tooltip, the right click comes at the same 800 ms, so the timing is one rule.

Lifting between the two leaves the tooltip open until the next tap, which closes it and does nothing else. Moving
after the first stage starts a hold drag, which only these take: an area's header (area swap and docking, see Area
management) and a panel's header (reordering, as Blender's panel grip). Elsewhere a move cancels the hold.

## Gestures

Gestures become GHOST trackpad events (`GHOST_TTrackpadEventSubTypes`) sent through the event system's `trackpad`
kind, so the operator that runs is whatever Blender's keymap binds there.

### Over a view

A view is a region whose keymaps bind `TRACKPADZOOM`: the 3D Viewport, the 2D editors (Image, Clip, Node, Sequencer,
Graph, Dope Sheet, NLA, Timeline). In these:

| Gesture | Event | Blender's binding |
|---|---|---|
| One finger | left button | the active tool, selection, gizmos |
| Tap | left click | select |
| Double tap | double click | what Blender binds to a double click |
| Long press | right click | the editor's context menu |
| Two finger drag | `TRACKPADPAN` | 3D: `view3d.move` (pan); 2D: `view2d.pan` |
| Pinch | `TRACKPADZOOM` | `view3d.zoom`, `view2d.zoom` |
| Three finger drag | `TRACKPADPAN` with the orbit modifier | `view3d.rotate` |
| Two finger tap | Ctrl Z | `ed.undo` |
| Three finger tap | Shift Ctrl Z | `ed.redo` |

Pan and orbit follow Blender's keymap preference Preferences > Keymap > Middle Mouse Action (`use_v3d_mmb_pan`):
with Pan, Blender binds plain `TRACKPADPAN` to `view3d.move` and Shift `TRACKPADPAN` to `view3d.rotate`. A touch
device's first run sets that preference to Pan, as a user would; it stays a visible Blender preference. Two finger
drag sends plain `TRACKPADPAN`, three finger drag sends it with Shift. A user who sets Orbit gets Blender's trackpad
behavior instead, as on a Mac.

Rotation is the three finger drag, not a twist. Orbit needs two axes, and a drag gives both as a middle drag does.
A twist gives one: Blender's `MOUSEROTATE` binding turns the view about its vertical axis only. Twist also rides on
every pinch and pan, so it would spin the view during zooms. Twist is not mapped.

Undo and redo on two and three finger taps are the common idiom of mobile painting and sculpting apps. They send
Blender's keys, so the keymap decides what they do (in a text field, the field's own undo).

### Over UI

UI is every other region: headers, toolbars, sidebars, the Properties editor, the Outliner, the File Browser, the Text
Editor, the Console, the Spreadsheet, menus and popups.

- **Pinch** sets Resolution Scale (Preferences > Interface > Display > Resolution Scale, `PreferencesView.ui_scale`).
  The UI follows the fingers while they move and the scale is written on release, so the regions lay out once. It is
  Blender's preference, saved with the Preferences. Blender binds `TRACKPADZOOM` in View2D Buttons List to
  `view2d.zoom` (a region's own zoom); touch leaves that binding out on purpose, so pinch means one thing over UI.
  The region zoom stays on Ctrl middle drag.
- **One finger drag** on a widget is the widget's drag (a number field's value, a slider, a panel header's reorder,
  a list's resize). Started anywhere else, or vertically on a number field (Blender's number drag is horizontal), it
  scrolls the region, as a middle drag does (`view2d.pan`, `ui.view_scroll`). The toolbar scrolls up and down; a
  sideways drag on a tool group opens its flyout, as Blender's drag does.
- **Two finger drag** is `TRACKPADPAN`: Blender's region scroll.
- **Tap** is a click; **long press** is a right click, so a property's context menu (Insert Keyframe, Copy Data Path,
  Add to Quick Favorites) is one gesture away.

### Pen

A pen is a mouse with pressure and tilt, as GHOST's tablet data (already in `wm-event-system.js`): sculpt, paint and
Grease Pencil read pressure through Blender's own brush code. The barrel button is the right button (Pointer Events
button 2, so the context menu or a cancel), the eraser end is GHOST's eraser. A pen hovers, so tooltips and
preselection work as with a mouse. While a pen is near (or touched within the last second), fingers on a view only
navigate, never paint: palm rejection without a setting.

## Shortcuts made tappable

### Shortcut bubbles

Blender's status bar already shows what the active modal operator accepts (`template_input_status`, from the running
handler's modal keymap) and what the mouse buttons do with the active tool. Bubbles are those same items, drawn as tap
targets in the touch bar's middle while the operator runs, so they cover no more of the window than the bar does. A
bubble sends its key event to the window, so the modal keymap handles it:

- G, then the X bubble constrains to X, a second tap of X switches to local X, the Shift bubble held while dragging is
  precision, the Ctrl bubble toggles snapping, R and S bubbles switch to rotate and scale.
- The numbers bubble opens a numeric pad (digits, minus, period, Backspace, Tab for the next axis, the expression key)
  for Blender's numeric input. It is shown for every modal operator; operators without numeric input ignore it.
- Confirm and Cancel are always there.

Chaining is Blender's: each bubble press changes the operator's state, and the strip redraws from the new state, as
the status bar does. Bubbles come from the keymaps, so a user's keymap edits show.

The running handler's modal keymap is read from the module; if Blender's RNA does not reach it
(`wmOperatorType.modalkeymap`), a seam in `tools/blender-port/wasm/` gives it.

### Quick keys pie

A pie (Blender's pie menu layout, `UILayout.menu_pie`) opened from the touch bar's Keys button, or by a long press on
it for the full Keys sheet. Its eight slots are key events with a fixed place per mode, so muscle memory holds: slots
never move by themselves. Each slot is a key, not an operator: what it does, its label and its icon come from Blender's
keymaps active in the area under the last finger, and a key with no binding there shows greyed. In Object Mode the
slots are Tab, G, R, S, Shift A, X, Z and the accent grave key; in Edit Mode E and Ctrl R take the places of Shift A
and X. Where Blender has a pie for a key, the slot follows Blender's pie convention and opens that pie: accent grave
opens `VIEW3D_MT_view_pie` (Blender's numpad views), Z opens `VIEW3D_MT_shading_pie`, Ctrl Tab
`VIEW3D_MT_object_mode_pie`, Shift S `VIEW3D_MT_snap_pie`, so pies nest as in Blender.

A user pins or replaces a slot from its long press menu (Replace with Key, Reset Slot). The slots are kept as a
Bylonder preference in the module's user directory, next to Blender's, so they follow Save Preferences and Load
Factory Settings.

This needs Blender's pie menus drawn as pies (`menu_pie` records a column today). That benefits Blender's own pies on
the desktop too: Z shading, Shift S snap, period pivot, Ctrl Tab mode.

## Layout

The screens are startup.blend's, the same on every device: Layout, Modeling, Sculpting, UV Editing, Texture Paint,
Shading, Animation, Rendering, Compositing, Geometry Nodes, Scripting, with Blender's split fractions. The per device
profiles (desktop, landscape, portrait) and the touch only tab bar of sections are removed; a screen is one layout.

### Folding

An area folds when it would be smaller than Blender's minimum for it: narrower than the width Blender gives panels
(`UI_SIDEBAR_PANEL_WIDTH`, 11 widget units) or lower than its header and one more header. Both are in widget units,
so they scale with Resolution Scale, and pinching the UI smaller unfolds areas. A split's minimum adds its areas'
along the split and takes the largest across it. Of a split's two sides, the one under its minimum folds (the smaller
if both are).

A folded side is drawn as a strip one header thick on its edge of the split, with its editors' icons. A tap on the
strip opens it as a drawer over its neighbour, at the size its share of startup.blend's 1920 x 1080 window would have
at Resolution Scale (within nine tenths of the split, never under its minimum); a tap outside or on the strip closes
it. A folded side keeps its own splits inside the drawer, so the Outliner over the Properties editor stays one
column.

On a large phone in portrait the Layout screen is the 3D Viewport over the Timeline, with a strip on the right for the
Outliner and Properties column. On a tablet nothing folds at Resolution Scale 1.0.

### Area management

All of it is Blender's:

- **Maximize and toggle.** `screen.screen_full_area` (Ctrl Space, View > Area > Toggle Maximize Area, Focus Mode),
  from the header's context menu (long press on the header) or the quick keys pie.
- **Switching an area's editor** is the header's editor type menu.
- **Switching workspaces** is the topbar's workspace tabs. The topbar scrolls sideways when the tabs do not fit; it is
  never hidden.
- **Split, join, resize.** Area edges and corner action zones keep Blender's look; touch gets a larger invisible hit
  area around them (see Density). The header's context menu has Vertical Split, Horizontal Split and Join Areas.
- **Area edges.** A drag on an edge resizes, as in Blender. A long press on an edge is a right click there, which opens
  Blender's own edge menu (`screen.area_options`: Vertical Split, Horizontal Split, Join Areas in the edge's
  directions, Join Left and Right or Up and Down, and Swap Areas, as Blender 5.2 draws it). Edges get a hit margin of
  at least 12 CSS pixels on each side, well beyond their drawn 3 pixels.
- **Swap and dock by the header.** A press and hold on an area's header, then a drag, carries the area. Dropped on the
  middle of another area anywhere in the layout, the two swap (`screen.area_swap`, what Ctrl drag from a corner does
  on the desktop), with Blender's drop highlight on the target. Dropped near another area's edge, it docks there as
  Blender's area docking does (`screen.area_join` split and move, Blender's highlight of the half it will take), and
  dropped outside the window it becomes Duplicate Area into New Window where Bylonder has windows (`screen.area_dupli`).
- **Panel order.** A press and hold on a panel's header, then a drag, reorders the panels in its region, as Blender's
  panel grip does; the order is kept per region as Blender keeps it.
- **Header and region collapse.** Show Header, Show Tool Settings, Toolbar (T) and Sidebar (N) are Blender's View menu
  toggles and keys. A hidden region shows Blender's small arrow action zone at its edge; a tap opens it.
- **Side regions as drawers.** Where an area is narrower than its regions need, the Toolbar and Sidebar overlap the
  main region (Blender's region overlap, which the 3D Viewport already uses) instead of shrinking it.

### Overflow

Anything that does not fit on the current screen scrolls: toolbars, headers, the topbar, the status bar, menus,
popups, dialogs and every region. Blender scrolls headers sideways too (a wheel or middle drag over a header); touch
does it with a one or two finger drag (see Over UI). A bar with more beyond an end fades at that end, so the cut is
seen; the fades follow the scroll (a CSS scroll timeline) and are absent when everything fits.

It is CSS only, with no JS measuring:

- Layout containers are flex or grid with `min-width: 0` and `min-height: 0` on their items, so a child shrinks to its
  container instead of pushing past it.
- The one container that should scroll gets `overflow: auto` on the axis it grows along: a header's and the topbar's
  row (`overflow-x`), a region's panel column, a menu's item column and a popup's body (`overflow-y`).
- `scroll-snap-type: x proximity` on headers, the topbar and the toolbar's columns, with `scroll-snap-align: start` on
  their items (menus, workspace tabs, tool buttons), so a scroll stops on a whole item. No snapping in regions of
  panels or in lists, where it fights free scrolling.
- No `overflow: hidden` or `clip` on anything with content that can grow. Rounded corners clip through `clip-path` on
  the drawn background only, not on the content box.

Menus keep Blender's menu scroll arrows (`menu.js`) and also scroll by drag.

One exception, Blender's: a single line label too long for its button is shortened with Blender's ellipsis
(`UI_text_clip_middle_ex`), and its full text is in the tooltip. The overflow test lists these apart and checks that
they are labels.

## Density

- **Resolution Scale** is the one size control. The page reads `ui_scale` and the pixel size into one CSS factor,
  `--bl-ui-scale` in `theme.css`, which every size token multiplies (`--bl-row`, `--bl-header-h`, fonts, icons), and
  the module's window takes the same factor for region layout. Today `ui_scale` is not honored by the page; this makes
  it honored on every device.
- **Blender's default, 1.0, on every device.** A tablet keeps its screen for areas: at 1.15 the Outliner and
  Properties column would fold on a 1024 pixel tablet. A touch device's first run, with no saved Preferences, sets
  only Middle Mouse Action to Pan.
- **Touch target minimums only where needed:** things that are dragged and drawn thin get an invisible hit area of at
  least 24 CSS pixels: area edges, corner action zones, region edges, scroll bars, node sockets, keyframe handles.
  Buttons, fields and menu items keep Blender's sizes.
- The browser's own page zoom is turned off (`maximum-scale=1` and `touch-action: none` on the window root, once),
  because pinch is Resolution Scale and the view's zoom. The per element `touch-action` rules go.

## Text and number input

- **Text fields** are the page's inputs, so the system keyboard opens on focus, with composition (IME) and
  autocorrect off. The Text Editor and the Console keep a hidden input focused while they have focus, so the system
  keyboard types into them; Blender's keymaps still run for keys the editor binds (Ctrl C, Tab, Home).
- **Number fields** are Blender's (`NumberField.vue`): a horizontal drag changes the value, a tap enters text editing
  with the system keyboard, the arrow zones at the ends step the value, sticky Ctrl snaps the drag, sticky Shift makes
  it fine, a vertical drag scrolls the region. Expressions work because the keyboard is the full one.
- **Modal numeric input** is the numbers bubble's pad (see Shortcut bubbles), or a physical keyboard.

### Dragging a value

A one finger drag on a number field or slider would hide the value under the finger. While the drag runs:

- **A readout** shows the property's name and live value, with its unit, outside the touch point: above the field, or
  below it when the field is near the top of the window, never under a finger. It mirrors the field's own text, so it
  shows exactly what the field shows.
- **Soft modifier buttons** appear on either side of the readout, Shift (fine) and Ctrl (snap), held with a second
  finger; the row stays where the drag started, so a held button does not move. Pressing one sends a real `left_shift` or `left_ctrl` press to the window and releasing it the
  release, and the drag's pointer events carry the modifier, so the field's drag reads them as Blender's number button
  handling does (`ui_numedit_but_NUM`: Shift for precision, Ctrl for snapped increments). Releasing one mid drag goes
  back to normal speed from where the value is, as releasing the key does in Blender.
- Both go away when the drag ends. A modifier latched on the touch bar before the drag applies as well.

The readout and the buttons are one shadcn-vue component (`ValueDragOverlay.vue`) with the Bylonder icon, opened by
`NumberField.vue` when a touch drag starts, so every number field and slider in every region gets it.

## Discoverability

- **The touch bar** is a thin strip at the bottom of the window, above the status bar, on touch devices only (it
  appears at the first touch and hides when a mouse is used): sticky Shift, Ctrl, Alt, the button latch, the wheel
  stepper, pointer mode, Keys. It has the Bylonder icon, as Bylonder's own UI does.
- **Bubbles** show what a modal operator takes while it runs, so a user who knows G knows the rest.
- **The Keys sheet** labels each key with what it does in the area under the last finger (from the keymaps, as menus
  show shortcuts), so it doubles as a keymap reference.
- **Menus show shortcuts** as on the desktop; every shortcut is also a tap on the touch bar or the Keys sheet.
- **First touch** shows a one time hint, dismissable, kept dismissed per device: two fingers pan, pinch zooms, three
  fingers orbit, press and hold for tooltips and right click, pinch over UI changes its scale. It links the feature
  page.

## What is left

- Bubbles for the modal operators of the 2D editors that run them in their own areas (`anim-area.js`,
  `outliner-area.js`); the 3D Viewport's come from Blender's window (`Window.modal_operators`) and the page's modal
  handlers (`view3d-modal.js`).
- Docking an area at another area's edge by its header, and Duplicate Area into New Window by a drop outside.
- Panel order by a hold and drag on a panel's header.
- The quick keys pie's Replace with Key and Reset Slot, kept as a Bylonder preference; Blender's pies drawn as pies.
- The touch bar's pointer mode (finger hover), and pen palm rejection.

## Dropped from the old code

| Old code | What it did | Why it goes |
|---|---|---|
| `windowmanager/input/touch-session.js` | Its own tap, drag, hold and pinch recognizer | Replaced by the adapter, which feeds Blender's event system instead of callbacks |
| `windowmanager/input/viewport-touch.js` | Touch in the 3D Viewport only: Bylonder's Select, Move, Rotate, Scale picker, Multi, Snap, Fine and axis buttons, an Actions button with a hand written mode to menu table, undo and redo buttons | Blender's tools, keymaps, modal keymaps and context menus do all of it; bubbles and sticky modifiers give touch access to them in every editor |
| `view3d-window.js` `trackpad()` with a synthetic Shift, `takes` excluding touch | The old gestures' way in | Gestures are GHOST trackpad events through the event system |
| `world.view3dTrackpad`, `world.multiSelect`, `world.onEditorState` and `emitState` in `editors/object/editor.js` | Hooks for the touch controls | No reader left |
| Touch exclusions in `wm-event-system.js` and `space-outliner.js` | Kept touch away from Blender's path | Touch is on Blender's path |
| `editors/screen/model.js` `profile()`, `dock.js` coarse profiles, per profile defaults in `screen/runtime.js` and `workspace/layout.js` | A different layout per device and orientation | One layout per screen, folded by size |
| `dock.css` coarse block, the `.dock-tabs` section bar | A tab bar replacing areas, hidden editor type menus and corners | Areas, headers and editor type menus are Blender's on every device |
| `theme.css` coarse `--bl-header-h`, `--bl-row`, `.bl-pulldown` sizes | Bigger widgets on touch | Resolution Scale |
| `style.css` `#touch-controls`, coarse toast and HUD offsets, `#pane input` font size | Old controls' styling and iOS input zoom | Controls removed; input zoom off once at the root |
| `viewport.css` coarse navigation gizmo rule | Shrank the gizmo and hid the navigation buttons | Hiding the navigation buttons made them unreachable |
| `workspace/workspace.css` coarse blocks | Hid the workspace tabs, status bar, preview toolbar and footer, enlarged the old workbench's buttons | Hidden UI is unreachable UI; size is Resolution Scale |
| `render/result.css` and splash `max-width` rules | Squeezed two popups on small screens | Popups fit or scroll by one rule, as menus do |
| Per element `touch-action` rules (`node-editor.css`, `anim-editor.css`, `viewport.css`, `dock.css`, `style.css`) | Stopped browser gestures per editor | One rule on the window root |
| `overflow: hidden` on headers and content boxes (`.dock-heading`, `.dock-header-content`, `.dock-content`, `.dock-leaf`, `#appbar` and others) | Cut off what did not fit | Overflow scrolls (see Overflow) |
| `tests/mobile.test.js` touch session and profile checks | Tested the removed code | The share codec checks move to their own test |

Kept: `docs.css` media rules (the docs site, not the app) and the pen data in `wm-event-system.js`.

## Test plan

`tests/e2e/touch.mjs` (`npm run test:touch`), Playwright Chromium with `hasTouch` and `isMobile`, at three sizes:
430 x 930 (large phone), 1024 x 1366 (tablet portrait), 1366 x 1024 (tablet landscape). Taps use
`page.touchscreen`; drags, long presses and multi finger gestures use CDP `Input.dispatchTouchEvent`. No mouse or
keyboard input is sent. Each check states what Blender does and reads the result from Blender's data.

| Category | Touch only check |
|---|---|
| Menus | Every topbar and 3D Viewport header menu opens by tap; a submenu opens; an entry runs (Add > Mesh > Cube adds a cube) |
| Panels | Every Properties tab's panels open, collapse and scroll into reach; a number field drags, steps and takes typed text |
| Value drag | A one finger drag on Location X shows the readout clear of the finger with the live value; holding the Shift soft button with a second finger slows the change by Blender's precision factor and releasing it restores the speed mid drag; holding Ctrl steps by Blender's increment |
| Overflow | At each size, on every startup.blend screen, with each menu and popover opened in turn: no element whose content is larger than its box (`scrollWidth > clientWidth` or `scrollHeight > clientHeight`, one pixel of tolerance) unless that axis computes to `overflow: auto` or `scroll`; Blender's ellipsis labels are listed apart and must be labels. The last item of each scrolling header, toolbar, menu and region is then scrolled to by touch and tapped |
| Press and hold | Holding on a shortened label shows its tooltip with the full label at 400 ms; lifting leaves it open, the next tap only closes it; holding to 800 ms opens the button's context menu |
| Area edges | Drag an edge: the areas resize. Long press an edge: `screen.area_options`'s menu opens; Vertical Split and Horizontal Split split an area; Join Areas joins both ways (left into right and right into left, up and down); Swap Areas swaps the two areas |
| Area swap and docking | Hold and drag the Outliner's header onto the 3D Viewport: the two swap, with the drop highlight shown during the drag; hold and drag a header to another area's edge: it docks there |
| Panel order | Hold and drag the Transform panel's header below another panel in the Object tab: the order changes and stays after switching tabs |
| Context menus | Long press opens `VIEW3D_MT_object_context_menu`, `VIEW3D_MT_edit_mesh_context_menu`, a property's button menu, `OUTLINER_MT_object`, an area header's menu |
| Tools | Every toolbar tool is selected by tap, a flyout opens by long press, Select Box draws a box |
| Modal transforms | G bubble, X bubble, numbers pad `2`, Confirm moves the object 2 on X; Ctrl bubble snaps; Cancel restores |
| View navigation | Two finger drag pans, pinch zooms, three finger drag orbits (view matrix changes as expected); quick keys pie numpad views |
| Area management | Ctrl Space by the pie maximizes and restores; split and join from the header menu; drag an area edge; editor type menu switches an area |
| Folding | At 430 x 930 every area of every startup.blend screen is reachable through a strip or drawer and shows its header |
| Workspaces | Every workspace tab is reachable by tap or by scrolling the topbar |
| Resolution Scale | Pinch over the Properties editor changes `ui_scale`; it persists after reload |
| Properties tabs | Every tab of the default cube, light and camera opens |
| Node editing | Add a node from the Add menu, drag a socket to connect, Ctrl right drag latch cuts the link, pan and zoom the canvas |
| Animation editors | Insert a keyframe from a property's context menu; Timeline scrub by one finger; Graph Editor pan and zoom; select and move a key with G and a bubble |
| Text Editor | New text, type with the system keyboard (filled through CDP `Input.insertText`), select by drag, run script |
| Keys sheet | Every key reaches the window (a key event log of the module matches) |
| Pen | Pressure drag in Sculpt Mode changes the mesh by a pressure dependent amount; barrel button opens the context menu |
| Undo | Two finger tap undoes, three finger tap redoes |

A smaller unit test (`tests/touch.test.js`) drives the adapter with synthetic pointer events and checks the event
stream it produces: held back contacts, replay order, gesture classification, sticky modifier key events, long press
right click.
