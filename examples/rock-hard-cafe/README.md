# Rock Hard Café

A one-minute shift at an open-air coffee stand in a forest by a brook, whose only customers are rocks: one at a time a
rock rolls up from the trailhead, you pour a coffee at the machine and hand it over, and it shivers with delight, makes
a rock noise, spills it on itself and rolls back down.

- **Scene.** `cafe.py` (`blender -b --factory-startup -P cafe.py`) writes `rock-hard-cafe.blend` and the sounds in
  `sounds/`: the forest (../character-controller/environment.py), the brook, the stand and its machine, the barista,
  one waiting rock, the stand spot and the trailhead, and the Rock A, B, C and Cup collections the game spawns copies
  of. Each object's behaviours are its `behaviors` custom properties (Object properties > Behaviors).
- **Code.** `src/behaviors/` (Rock, Barista, Machine, Spawner), `src/systems/` (Shift, Subtitles, Hud), `src/game.js`.
- **Content.** `content/dialogue/cafe.ink`, the rocks' noises and lines, an Ink story.
- **Play.** The example opens on the Game workspace. Play, then WASD walks the barista, E pours at the machine and
  serves a rock.
- **Credits.** CREDITS.md: the mannequin and the forest are Quaternius' (CC0).
