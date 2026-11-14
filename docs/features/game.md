---
id: game
title: Game
summary: Bylonder's own editor that plays the scene as File > Export > JavaScript ships it, run by the exported page's runtime, while edits, undo and redo made in the app reach the running game.
expect: Play exports the scene in memory and runs its page in the area; each edit, undo or redo reaches the running game as a patch once the app is idle (about a second on Rigged Character), and the game's own state never writes back to the scene; Reset starts the game again from the scene as it is now; Play takes as long as an export.
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
  - src/editors/space_package/package-preview.js
  - src/io_scene_babylon/scoped-export.js
  - src/io_scene_babylon/scene-patch.js
tests:
  - tests/live-package-wasm.test.js
  - tests/package-preview-wasm.test.js
  - tests/export-scoped-wasm.test.js
limits:
  - The game runs in a frame of its own (its page), not yet on the app's engine; a separate window is not built yet.
  - The page draws with WebGL 2 for now, not WebGPU.
  - A change of the scene, its world, a node group or a collection exports the whole scene, so on a large scene it reaches the game after an export's time.
  - Game code (game.js) does not run in it yet.
---

# Game

The Game area plays the scene the way an exported page does: File > Export > JavaScript's package, written in memory
and run by the page's own runtime. While it plays, what you change in the app reaches it: an edit, undo or redo becomes
a patch the running game applies, keeping its state. Nothing the game does writes back to the scene. It is Bylonder's
own editor, chosen from an area's editor type menu.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=rigged-character)

## Steps

1. Open an area's editor type menu and choose Game, then press Play. The scene is exported and its page plays in the
   area. Pause holds the game; Reset starts it again from the scene as it is now.

   ![Game chosen and played](../media/features/game/play.gif)

2. Edit the scene while it plays: move an object, change a light. Once the app is idle, the running game takes the
   change. Undo and redo reach it the same way.

   ![The game following an edit](../media/features/game/edit.gif)

## Project files

The [Rigged Character](../../examples/rigged-character/) example's files.
