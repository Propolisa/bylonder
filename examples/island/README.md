# Volcanic island

A film of about three and a half minutes at 24 fps, low poly and toon shaded. A volcano rises from the sea and a forest grows on it. A pair
of seabirds court and raise a chick in a blossom tree. An odd star with a faint trail has been low in the sky from the
first frame; it grows night after night, then falls just after sunset, a burning rock in a violet dusk. It breaks up
in the air, its fragments streaking off to fall far out to sea, the largest striking as hard as it, and the main chunk
strikes the island's far shoulder glancingly. The strike burns that side to glass and sends a great wave racing out,
highest downrange, but the volcano shelters the nest; burning debris over the ridge lights the forest above it. The
mother pushes the chick, who has failed to fly twice, off the burning branch; it flies, and she falls with the tree.
The chick turns back for her and sits on the beach below, calling up at the burning tree; nothing answers, and the
father comes down beside it for the night. At first light a faint call comes from up the slope: the falling crown
threw her into an old lava tube, and the fire passed over her. She limps out, one wing bent and a scar across her face,
and the three, sooty from the fire, huddle together. The camera draws back over them: a turtle hauls itself up the
beach, rubble floats on the sea, the far side is black glass, and the lee is still green.

- **Story.** `story.js` holds the film's clock. The story is told in story seconds, which the film plays at its own
  pace: the strike, the mother's fall and the reunion play in slow motion, as Blender's time remapping plays a scene slower, and
  sounds heard then play slower and lower. Island time runs as a time-lapse while the island forms and in short bursts
  between the story's moments; within a moment the sun barely moves. The bursts are solved so each moment has its time
  of day: the strike just after sunset, the reunion in the early morning. The beats, the meteor, the fire's path and the
  camera's shots are all functions of story time, so playback and renders agree. The beats are timeline markers.
- **Island.** One low-poly mesh from a height field (`island.js`, `createMesh`). The sea is Blender's Circle primitive.
- **Look.** `toon.js` shades every surface flat in hard bands of sun, moon and fire light, with a sky rim and distance
  haze. The ground's colors follow the story: rock, lava, basalt, soil, grass, the burnt path and the blasted glass. The sky
  draws the sun's shafts, stars, aurora, the new star with its coma and tail, and the meteor's contrail.
- **Family.** `family.js`: the nest tree, nest, egg and chick, the lava tube, the parents' flights as keyed paths, and where each bird
  looks, bows, sleeps or looks back, as gaze timelines. The mother's bent wing, her scar and the family's soot are
  pose options of the bird kit, marks painted on its faces.
- **Effects.** `particles.js` makes particles that are each a function of time (born, thrown, falling under gravity and
  drag), as layers of low-poly puffs: the fireball and its trail, its fragments' streamers, each impact's flash, fire,
  debris, sparks, water column, spray, vapor ring, steam and a wave that the island breaks, with foam and surf, the
  strike's smoke column, the forest fire, ash, embers and the rubble left floating on the sea (`meteor.js`), and steam where the first lava meets the
  sea (`life.js`).
- **Life.** `forest.js` grows clumps of trees with bushes, ferns and flowering vines between, sways and burns them;
  `life.js` has the flock, the whales, fireflies and the turtle.
- **Sound.** `sounds.js` makes every sound from noise and tones; `audio.js` holds the cue sheet and plays it in
  Babylon's spatial audio, heard from the camera. Beds loop under the film as loud as the story makes them (the sea, the
  wind, the eruption and its steam, insects on warm nights, the forest fire); over them the family's calls come from
  where each bird is, with the egg cracking, the flock, the whales, the tree falling, and the asteroid's roar travelling
  with it, each impact heard as late as its shock reaches the camera. Sound plays with the timeline and is mixed into renders.
- **Camera.** Keys on the camera's location and target (channels **Camera**), linear within a shot and held on its last
  frame, so each shot cuts to the next. Each impact shakes it, later and weaker the farther away it is.

Look through the camera (Numpad 0) in Rendered shading and press Space, or use Render > Render Animation.
