---
id: game
title: Game
summary: Bylonder's own editor that plays the scene as File > Export > JavaScript ships it, run by the exported page's runtime, while edits, undo and redo made in the app reach the running game.
expect: Play exports the scene in memory and runs it in the area on an engine of its own, as its page does; a value edit (a move, a material colour, a light's power or colour, a camera's lens, visibility, a shape key, a custom property) shows in the game on the next frame, and the scoped export behind it checks it once the app is idle, loading the game fresh if they disagree; other edits reach it as a patch after that export (about a second on Rigged Character); the game's own state never writes back to the scene; Reset starts the game again from the scene as it is now; Play takes as long as an export.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/import_export.html
example: rigged-character
thumbnail: game/thumbnail.png
media:
  - game/play.gif
  - game/edit.gif
ui:
  - TOPBAR_MT_file_export
operators:
  - ed.undo
  - ed.redo
code:
  - src/editors/space_game/game-view.js
  - src/editors/space_game/GameView.vue
  - src/editors/space_game/game-run.js
  - src/editors/space_game/package-link.js
  - src/editors/space_package/package-preview.js
  - src/io_scene_babylon/scoped-export.js
  - src/io_scene_babylon/scene-patch.js
tests:
  - tests/game-run-wasm.test.js
  - tests/game-instant-edits-wasm.test.js
  - tests/live-package-wasm.test.js
  - tests/package-preview-wasm.test.js
  - tests/export-scoped-wasm.test.js
limits:
  - A separate window is not built yet.
  - The game draws with WebGL 2, as an exported page does by default, also where the app draws with WebGPU, until exported pages draw area lights on WebGPU.
  - A change of the scene, its world, a node group or a collection exports the whole scene, so on a large scene it reaches the game after an export's time.
  - Settings with no fast control yet (a light's shadow and spot settings, render settings) reach the game after the export; a camera's type and sensor fit remake the camera.
  - A camera's lens shift (Shift X and Y) is not drawn by exported pages yet, so the game shows the camera unshifted.
  - A value the game animates (an F-Curve's or a driver's) is the game's: an edit of it reaches the game through the export only.
  - Game code (game.js) does not run in it yet.
---

# Game

The Game area plays the scene the way an exported page does: File > Export > JavaScript's package, written in memory
and run by the page's own runtime in the app's own modules, on an engine of its own. While it plays, what you change in the app reaches it: an edit, undo or redo becomes
a patch the running game applies, keeping its state. Nothing the game does writes back to the scene. It is Bylonder's
own editor, chosen from an area's editor type menu.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rigged-character)

## Steps

1. Open an area's editor type menu and choose Game, then press Play. The scene is exported and its page plays in the
   area. Pause holds the game; Reset starts it again from the scene as it is now.

   ![Game chosen and played](../media/features/game/play.gif)

2. Edit the scene while it plays: move an object, change a material's colour or a light's power. The game shows the
   value on its next frame. Behind it the change is exported and checked; the header shows the export and says when
   the game was loaded fresh. Undo and redo of a value reach it the same way. Structural edits (a mesh, node links, a
   new modifier or object) reach the game once that export is done.

   ![The game following an edit](../media/features/game/edit.gif)

## Project files

The [Rigged Character](../../examples/rigged-character/) example's files.
