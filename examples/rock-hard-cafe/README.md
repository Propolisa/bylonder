# Rock Hard Café

A 30-second shift behind the counter of a café whose only customers are rocks: pour a coffee at the machine, hand it
to a waiting rock, and it admires it, makes a rock noise, spills it on itself and rolls out.

- **Scene.** `cafe.py` (`blender -b --factory-startup -P cafe.py`) writes `rock-hard-cafe.blend` and the sounds in
  `sounds/`: the counter, the machine, the door, the barista, one waiting rock, and the Rock and Cup collections the
  game spawns copies of. Each object's behaviours are its `behaviors` custom properties (Object properties > Behaviors).
- **Code.** `src/behaviors/` (Rock, Barista, Machine, Spawner), `src/systems/` (Shift, Subtitles), `src/game.js`.
- **Content.** `content/dialogue/cafe.ink`, the rocks' noises as subtitles, an Ink story.
- **Play.** The Game area's Play. WASD walks the barista, E pours at the machine and serves a rock.
