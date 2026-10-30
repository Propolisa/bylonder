# Volcanic island

A three-minute film at 24 fps, low poly and toon shaded. A volcano rises from the sea and a forest grows on it. A pair
of seabirds court and raise a chick in a blossom tree. An odd star with a faint trail has been low in the sky from the
first frame; it grows night after night, then falls just after sunset, a burning rock in a violet dusk. It breaks up
in the air, its fragments streaking off to fall far out to sea, the largest striking as hard as it, and the main chunk
strikes the island's far shoulder glancingly. The strike burns that side to glass and sends a great wave racing out,
highest downrange, but the volcano shelters the nest; burning debris over the ridge lights the forest above it. The
mother pushes the chick, who has failed to fly twice, off the burning branch; it flies, and she falls with the tree.
The father and the chick keep out at sea through the night, and come home at first light to the sapling growing where
the tree stood.

- **Story.** `story.js` holds the film's clock: island time runs as a time-lapse whose speed follows the story, slowing
  toward real time as each key moment comes, and solved so the strike falls at sunset and the homecoming at first light.
  The beats, the meteor, the fire's path and the camera's shots are all functions of the film's time, so playback and
  renders agree. The beats are timeline markers.
- **Island.** One low-poly mesh from a height field (`island.js`, `createMesh`). The sea is Blender's Circle primitive.
- **Look.** `toon.js` shades every surface flat in hard bands of sun, moon and fire light, with a sky rim and distance
  haze. The ground's colors follow the story: rock, lava, basalt, soil, grass, the burnt path and its healing. The sky
  draws the sun's shafts, stars, aurora, the new star with its coma and tail, and the meteor's contrail.
- **Family.** `family.js`: the nest tree, nest, egg and chick, the parents' flights as keyed paths, and where each bird
  looks, bows, sleeps or looks back, as gaze timelines.
- **Effects.** `particles.js` makes particles that are each a function of time (born, thrown, falling under gravity and
  drag), as layers of low-poly puffs: the fireball and its trail, its fragments' streamers, each impact's flash, fire,
  debris, sparks, water column, spray, vapor ring, steam and a wave that the island breaks, with foam and surf, the
  strike's smoke column, the forest fire, ash, embers and petals (`meteor.js`), and steam where the first lava meets the
  sea (`life.js`).
- **Life.** `forest.js` grows clumps of trees with bushes, ferns and flowering vines between, sways, burns and regrows
  them; `life.js` has the flock, the whales and fireflies.
- **Sound.** `sounds.js` makes the roar, the booms, the distant thuds and the surf from noise; `audio.js` plays them in
  Babylon's spatial audio, heard from the camera: the roar moves with the asteroid, and each impact is heard from where
  it lands, as late as its shock reaches the camera. Sound plays with the timeline; renders are silent.
- **Camera.** Keys on the camera's location and target (channels **Camera**), linear within a shot and held on its last
  frame, so each shot cuts to the next. Each impact shakes it, later and weaker the farther away it is.

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
