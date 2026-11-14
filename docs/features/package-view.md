---
id: package-view
title: Package View
summary: Bylonder's own editor that shows the scene as File > Export > JavaScript writes it, loaded in a frame with plain Babylon.js, and keeps it current as you edit, undo and redo.
expect: Reload writes the package in memory and shows its page as an exported page draws it; after each edit, undo or redo the page takes a patch of what changed once the app is idle, keeping its controls and playing clips; a change exports the objects it reaches again, and the whole scene when it reaches the scene's own settings, so a large scene's Reload takes as long as its export.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/import_export.html
example: rigged-character
thumbnail: package-view/thumbnail.png
media:
  - package-view/open.gif
  - package-view/follow.gif
ui:
  - TOPBAR_MT_file_export
operators:
  - ed.undo
  - ed.redo
code:
  - src/editors/space_package/package-view.js
  - src/editors/space_package/package-preview.js
  - src/editors/space_package/PackageView.vue
  - src/io_scene_babylon/scoped-export.js
  - src/io_scene_babylon/scene-patch.js
  - src/io_scene_babylon/runtime/scene-tables.js
tests:
  - tests/package-preview-wasm.test.js
  - tests/export-scoped-wasm.test.js
  - tests/live-package-wasm.test.js
  - tests/export-patch-wasm.test.js
  - tests/export-patch-apply-wasm.test.js
  - tests/export-patch-integrity-wasm.test.js
limits:
  - A change exports again the objects it reaches (per datablock); a change of the scene, its world, a node group or a collection exports the whole scene.
  - The page draws with WebGL 2 for now, not WebGPU.
  - The scene's own settings (world, render pipelines, post-processes, compositor, its frame range and rate) load the page again instead of patching it.
  - Runtime scripts (docs/sdk-model.md) do not run in it yet.
---

# Package View

The Package View shows the scene the way an exported page does: File > Export > JavaScript's package, written in memory
and loaded with plain Babylon.js and the page's own `load()`. What it shows is what a page shows. It is Bylonder's own
editor, chosen from an area's editor type menu.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rigged-character)

## Steps

1. Open an area's editor type menu and choose Package View, then press Reload. The scene is exported and its page loads
   in the area.

   ![Package View chosen and reloaded](../media/features/package-view/open.gif)

2. Edit the scene: move an object, change a material's color, move a key. Once the app is idle, the page takes the
   change as a patch, without loading again. Undo and redo reach it the same way.

   ![The page following an edit](../media/features/package-view/follow.gif)

## Project files

The [Rigged Character](../../examples/rigged-character/) example's files.
