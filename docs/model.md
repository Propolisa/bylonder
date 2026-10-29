# The model

What owns which state in Bylonder, and what crosses between Blender's code and Babylon. Decided 2026-10-29; it
replaces "Who owns what" (2026-10-28) in `blender-boundary.md`, where Babylon was the source of truth and Main a
second model kept equal both ways.

## Principles

1. **Every datum has one owner, which stores, edits, undoes and saves it.** No datum is kept equal in two places.
2. **Blender owns everything Blender has a type for.** Objects (name, transform, parent, collections, visibility,
   selection, mode), their data (meshes, curves, text, armatures, lights, cameras), materials, worlds, textures,
   modifiers, constraints, animation, scenes, view layers and tool settings live in Blender's Main in the module. Only
   Blender's code changes them: its operators, its RNA, its editors, its undo (memfile) and its file (`.blend`).
3. **Babylon draws; it owns only what Blender has no type for.** Babylon's scene is a view of Blender's evaluated
   state (the depsgraph's output), derived one way and generically per kind of data: evaluated geometry, world
   matrices, visibility, material and light parameters, the camera. Babylon-native data (node materials, GPU effects,
   post-processes, what project code builds that Blender cannot express) is Babylon's and stays in Babylon.
4. **A crossing carries only what the other side needs for its job.** Blender to Babylon: what Babylon needs to draw,
   after each evaluation, for the IDs it tagged. Babylon to Blender: a Babylon-native object exists in Main as an
   Object whose data is a stand-in, so Blender's tools select, transform, parent and collect it; its Babylon-native
   part is linked by id and never copied into Main. Nothing is copied back for undo or saving: each owner undoes and
   saves its own.
5. **Blender's window manager runs Blender's operators.** Browser events become Blender's window events, handled by
   Blender's own event system with Blender's keymaps, modal handlers, macros, gestures and popups. Bylonder's own
   operators (`bylonder.*`) and Blender's Python operators are registered into Blender's operator types, as Python
   add-ons register theirs. CSS lays out the areas; their rectangles go one way, into Blender's screen.
6. **Blender's UI code lays out, the browser draws.** Every panel, header, menu and popup, from Blender's C or its
   Python, is laid out by Blender's `uiLayout` and leaves the module as one layout tree (containers with alignment and
   scale, buttons by kind with their RNA property or operator, text and icon; no coordinates). The browser draws the
   tree with one component per button kind, so a new menu or panel needs no code.

## Consequences

- **Undo** is one stack: Blender's undo steps (memfile and edit-mode steps, `ED_undo_push`) for Main, and steps of
  Babylon-native edits, in order.
- **A project** is its code, its `.blend` (Main) and its Babylon-native data. Project code builds the scene the first
  time; afterwards an object whose id is in the `.blend` takes Blender's state from it, and code adds what is new.
- **Modes** (Edit, Pose, Sculpt, paint) are Blender's, on Main's objects. There is one context, Main's; the separate
  Edit Mode context (`EditMesh`) goes.
- **Editors read and write Main through the module's RNA.** `rna-bylonder.js` keeps bindings only for Babylon-native
  structs.
- **Export** (`.babylon`, JS) is derived from the Babylon view, as before.

## What goes

The two-way scene sync (`main-sync.js` mappings, adopt, write back), the Babylon-side snapshots of Blender data
(`wbCreation`, `wbModifiers`, `wbCurve`, `metadata.wbCreation.armature`), RNA bindings over Babylon objects for
Blender's structs, Bylonder's keymap dispatch and operator bridges (`runModal`, `runBlenderOperator`, popup and macro
bridges, the operator registry's fallbacks), and the JS layout emulation of `UILayout` for Blender's Python.
