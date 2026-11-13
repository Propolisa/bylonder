# Character animation

How a character moves in an exported page. The animator makes actions in Blender; game code or an AI says what the
character wants; layers play actions; effects fit the result to the world; the rig's own constraints solve it, as in
Blender. This is the guide to the characters of an exported scene (`src/io_scene_babylon/runtime/character/`);
`docs/character-animation-design.md` holds the design notes and their sources.

The basic path needs only a skeleton and a few baked actions (Idle, Walk, Run, Jump): input moves the character,
locomotion picks its actions by name, and feet and gaze fit it to the world. Richer rigs add what their controls
give (IK limits, rig settings); richer actions add root motion, markers, keyed properties and sound.

## The model

Four parts, each small:
- **Character**: a rig of the scene. It owns its input, its movement and its clocks.
- **Layer**: a mask, a weight and a mode (replace or add). Layers stack; the first is `body`.
- **Source**: what a layer plays. Built in: an **action** (one Blender action, played as authored), a **mix** (actions
  blended by a value) and **locomotion** (actions chosen from how the character moves). Anyone can write more.
- **Effect**: procedural motion that fits the pose to the world. Built in: `feet`, `gaze`, `lean`, `reach`, `impact`,
  `springs`, `breathe`, `eyes`. Anyone can write more.

Sources choose motion; effects correct it. The core knows poses, clocks, masks, weights and intent, and nothing about
hits, cameras or styles: those are sources, effects or a few lines of game code.

## Every frame

| Step | What happens |
| --- | --- |
| 1. Intent | The character's input says what it wants: `{ move, facing, look, jump }`, a move as a velocity, never a position. |
| 2. Movement | A critically damped spring takes the character toward the intent and predicts the next second, on the ground and out of walls. |
| 3. Sources | Each source updates its clock and pose. Locomotion picks its actions from the predicted motion, never from the raw stick. |
| 4. Layers | The body's root motion moves the character while an action owns the root; then the layers in the order made, each replacing what is below within its mask or adding to it. Every switch is inertialized. |
| 5. Controls | Effects on the rig's controls, so the rig's limits apply: `impact`, then root warping, `reach` and `feet`, then `lean`, `gaze` and `eyes`, then others in the order added. |
| 6. Solve | The rig's own constraints, as Blender evaluates them. |
| 7. Deform | Effects on deform bones: `springs`, then others in the order added. |
| 8. Draw | Skinning and drawing. |

Four rules hold it together:
- **The body's source owns the root.** Locomotion moves it by the movement. An action moves it by its root motion,
  or holds it still; meanwhile intent waits, and a jump in its last 0.3 s is kept. `place` and `turnTo` own it while
  they run. When control returns, movement starts where the body is.
- **Layer order is priority.** An upper layer wins within its mask, rig settings included.
- **Effects correct, never choose.** Limb effects move the rig's IK controls when the limb is in IK, else a two-bone
  solve on the played bones with the rig's limits (the bones' own IK limits, else the matching IK chain's, else by
  role), so an elbow cannot over-bend and a hand stops at full reach.
- **Feet lock only where an action has contact**: from its `L` and `R` markers, or else where a foot is low and moves
  with the ground, until it stops doing so at toe-off; found once at export from Blender's evaluation of the rig, else
  at load.

## What the animator makes

Everything is plain Blender. Names are the only convention, and every one can be overridden in code.

| In Blender | In the game |
| --- | --- |
| An action | a source, by its name |
| A bone collection | a layer mask, `{ group: 'Face' }` |
| Motion of the root bone | root motion: the action moves the character while the body plays it |
| A marker | an `onMarker` event; `L` and `R` are foot contacts; any marker can be a `warpTo` target |
| A keyed custom property, and drivers from it | plays live: shape keys, visibility, rig settings; game code reads it with `property(name)` (a hit window, a cancel window) |
| A keyed property named after an effect (`gaze`, `feet`) | scales that effect while the action plays, so a shot can quiet procedural motion |
| A sound strip | an action's sound, offset as in the sequencer |

A character's rig leaves the page's timeline when the character is made; its active action becomes one of its actions.
The package's types list each armature's actions, markers, bone collections, roles and keyed properties as names, so
`play('Wa` autocompletes and a renamed action fails the game's build on the line that uses it.
While the dev server runs, saving the .blend reloads its actions in the running page, keeping the game's state.

## Character

```js
import { load, Character, feet, gaze } from './snow-bar/scene.js';   // the folder File > Export > JavaScript wrote
const blend = await load(engine);                 // the exported scene
const hero = new Character(blend, 'RIG-Snow');    // a character made from the armature named RIG-Snow
hero.add(feet());                                 // effects come from the same scene.js
```

The name is the armature object's in Blender: the object in the Outliner that holds the bones, such as `Armature`
for a Mixamo import or `RIG-Snow` for a Rigify rig, never one of its meshes. Every mesh the armature deforms comes
with it. `Character.quality` and `Character.tier` apply to all characters.

**Roles** name the bones effects and masks need. Found by convention for Rigify, CloudRig, Mixamo and Blender's
metarig (with or without its `DEF-` bones), given by name otherwise; only `hips` is required, plus what the attached
effects need.
- Single bones: `hips`, `spine`, `chest`, `neck`, `head`, `jaw`, `eye.L`, `eye.R`; `lid.L` and `lid.R` are the lid
  controls, upper and lower (without them, `eyes` makes saccades only and says so in the console).
- Chains, root to end: `arm.L`, `arm.R`, `leg.L`, `leg.R`, ending in `hand.L`, `hand.R`, `foot.L`, `foot.R`; `arms`
  and `legs` list all of them (a cat has four legs), and a rig may name others (`tail`).

**Input and movement.**
- `input` is `'default'` (arrows or WASD, Shift to run, Space to jump, a stick on touch screens) or a function
  returning intent each frame, so an AI drives an NPC the same way. `move` is in metres per second. Without input it
  stands still.
- `steer(target)` returns intent toward a node or position, slowing to stop there. `walkTo(target, { run })` steers
  it there in place of its input and resolves on arrival.
- `responsiveness` is the movement spring's half-life (0.1 s): lower is snappier, higher is heavier. A move that
  swings more than 120° from the way it goes is a pivot: it stops, turns in place, then goes.
  Turning in place, the standing foot pivots on its ball and the other steps round, at the walk's own step rate; no
  step, a stop's last included, comes more than 10% quicker than the gait's own.
- The ground is the scene's meshes under it (`ground: [...]` limits it); walls are the same meshes against a capsule,
  in the character's own collision: one seam, which another collision can replace. Its own meshes, hidden meshes and
  skies never collide; instanced grass is walked through; a mesh that moves (a lift, a door) collides where it is now.
  Meshes added later collide too; handed back inside one (an action sat it on a stool), it steps out at walking pace.
- `place(node)` moves it onto a node's place and facing (to sit or to start an action on its mark), and
  `turnTo(target)` turns it in place; both are smooth and return promises.

**Time.** Every source has one clock, shared by every layer that plays it.
- `speed` scales all of its clocks, effects included: `0.3` is slow motion, `0` freezes it.
- `play(source, { with: layer })` starts a source on another layer's clock, on this character or another, so two
  characters' actions stay in step.
- Markers are reliable: each one crossed fires once and in order, through slow frames, loops and changes of speed.
- A character is deterministic: its pose is a function of its intent, what was played when, and its `seed`, so a
  replay or a networked copy needs only those.

**The rest.**
- `bone(roleOrName)` is a node that follows the bone, for attaching props and hit volumes.
- `property(name)` reads a keyed custom property of what it plays now, from the topmost layer that keys it.
- Mistakes throw at `new Character`, `add` or `play`, naming what exists. Missing resources warn and degrade.
- `dispose()` ends it; the scene's end does too.

## Layers

`hero.layer(name, { group | roles | bones, weight, add })` makes a layer the first time and returns it after that. The
mask is all bones by default. `add: true` adds the
source's change from its first frame (`add: { from: 'rest' }` or `{ from: 'Action' }` changes the reference).
- `play(source, { blend, with, warpTo })` switches what the layer plays and returns it; playing what it already plays
  does nothing. A name plays that action; `play('Wave', { once: true })` is short for `play(hero.action('Wave', { once: true }))`.
- `done` resolves `{ ended: true }` when an action played once ends, or `{ interrupted: true }` when the layer plays
  something else first. `onEnd` fires each time a source ends or loops.
- `stop({ blend })` fades the layer out; `weight` and `fade(weight, seconds)` set how much it counts.
- A switch is dead blending: the last pose runs on by its velocity, decaying, while the new source blends in, so pose
  and velocity stay continuous. A switch of rig settings (IK to FK) is also smoothed on the solved pose.
- An action's rig settings are set by the layer that plays it; floats blend over the fade, integers and enums switch
  at its midpoint.

## Sources

- **Action**: `hero.action(name, { once, loop, sound, waitForSound, spatial })`. It loops unless `once`, which holds
  the last pose; `loop: s` holds the last pose `s` seconds between loops. With `sound`, it plays the sound strip of
  that name from the character's head; `pause()`, `resume()` and `seek(s)` move the action and its sound together.
- **Mix**: `hero.mix({ Walk: 1.4, Jog: 3 })`, actions placed on a value; setting `value` eases there.
- **Locomotion**: `hero.locomotion`, one per character. It chooses and blends its actions from how the character
  moves: the gaits by speed on one cycle, played at the rate that keeps a planted foot still; a walk starts and a stop
  ends with a foot under the body, on the spot where the movement comes to rest; standing, a foot steps once the body
  has turned 30° from it; jumps from the movement's jump. Its actions are a map,
  `{ idle, walk, run, sprint, turn, jump, fall, land }`, by default the actions of those names; only `idle` is
  required, and missing ones are covered (a turn by stepping in place, a fall by holding the jump's last pose). A
  `turn` is to the left, mirrored for the right. `stances` holds other maps by name (`crouch`); `stance` switches,
  blended. `speeds` holds its walk's and run's speeds, from their contacts, which the default input moves at.
- **warpTo**: `play(action, { warpTo: { marker, node } })` or `{ marker, position, facing }` lands the action's root at
  the marker's frame on that place; the motion before it is scaled and turned to get there.

A source of your own:

```js
export const swim = defineSource({
  name: 'swim',
  options: { stroke: 'Swim', tread: 'Tread' },
  update(dt, { character, sample, options }) {
    const speed = character.velocity.length();
    sample(options.tread, 1 - Math.min(speed, 1));
    sample(options.stroke, Math.min(speed, 1), { rate: 0.5 + speed });
  },
});
hero.body.play(swim());
```

`sample(action, weight, { rate, time, mirror })` blends an action into the source's pose. Each action keeps its own
phase in the source, advanced at `rate` (1), unless `time` sets it; `mirror` flips it left for right. `init(character, roles, options)`, optional, gives the source's state,
passed to `update` and `dispose`, as for effects; `hero.action(name)` tells an action's `duration` and `markers`.

## Effects

`hero.add(effect, { weight })` attaches one and returns a handle with `weight`, `fade` and `remove({ blend })`, plus
the effect's own fields; `hero.effect(name)` finds it again.
- `feet`: plants feet on contact and on uneven ground, up to `reach` (0.5 m) above or below the played foot.
- `gaze({ targets, near, stare })`: attention. Eyes lead, the head follows; targets are scored by nearness, motion and
  the intent's `look`; the eyes glance away now and then unless `stare`.
- `lean`: leans into turns and acceleration, at most 12 degrees.
- `reach({ hand, target })`: `reached` resolves `true` when the hand arrives, `false` when it stops at full extension.
- `impact()`: `hit({ bone, at, impulse })` turns the bone and its parents by damped springs, a share absorbed at each
  joint. Offsets are split into swing and twist, each limited (from the rig's limits, or by role), so a hit cannot
  twist a limb into nonsense; offsets always decay back to what is played. A large hit shoves the hips and the character steps.
- `springs({ bones })`: secondary motion for hair, tails and props.
- `breathe` and `eyes`: idle life, attached by default (`{ idle: false }` leaves them out). They leave alone bones
  whose action has a sound, so an actor's own breathing and eyes win.

An effect of your own:

```js
export const breathe = defineEffect({
  name: 'breathe',
  needs: ['chest'],
  on: 'controls',
  options: { rate: 0.25, depth: 0.02 },
  tiers: { C: { depth: 0.01 } },
  update(dt, { pose, roles, time, options }) {
    pose.addRotation(roles.chest, 'X', Math.sin(time * options.rate * 2 * Math.PI) * options.depth);
  },
});
```

- `defineEffect` gives the types: `roles` holds the roles in `needs`, checked on attach; `breathe({ depth: 0.03 })`
  overrides options.
- `on: 'controls'` runs before the solve (step 5), `on: 'deform'` after it (step 7); a `deform` effect may hold or
  replace the final pose.
- `tiers` merge into `options` on that tier. `update` must not allocate. `dispose` is optional.
- `init(character, roles, options)`, optional, runs once on attach with the roles resolved to bones: what it returns is the
  effect's state, passed to `update` and `dispose`, and its fields are the handle's (`reach`'s `reached`, `impact`'s
  `hit`). The frame's `character` gives the rest: its movement and ground, its rig, `contact('foot.L')` (how much
  that foot is down, 0 to 1) and `voiced(bone)`.
- The pose, in each bone's own space: `setRotation`, `addRotation(bone, axis, angle)`, `setLocation`, `addLocation`,
  `setScale`; reads `rotation(bone, out)`, `location(bone, out)`, and `world(bone)`, the bone's world matrix so far,
  this step's earlier writes included (read only).

Every part's options have one schema: it gives their defaults, their types and the checks on a preset's JSON.

## Sound

- An action's sound plays on the page's clock until the browser allows sound, then joins at the first user gesture,
  in step; `waitForSound: true` holds the first frame until then.
- With sound playing, the clock is the AudioContext's time less its output latency; a drift over half a frame is
  corrected by an inertialized seek. `spatial: false` plays it flat.

## Quality

- The system's own work takes at most 1 ms per character a frame on a mid-range phone (a Pixel 6a), 0.1 ms for a far
  one, with no allocation per frame. The rig's solve is measured per rig.
- The page picks a tier from its median frame time: one step down after 1 s over budget, one up after 5 s well under.
  `Character.quality` overrides it. Inertialization, foot lock and idle life never degrade. Off screen, a
  character advances only its clocks and root, on every tier.

  | Feature | A | B | C |
  | --- | --- | --- | --- |
  | Update | every frame | every frame | small characters at half rate |
  | Far away | rig solve | rig solve | baked poses, no solve |
  | Springs, impact | all bones | the first bones | the hit bone only |
  | Gaze | eyes, head, glances | eyes and head | head |
  | Locomotion | turns and stride matching | stride matching | speed matching |

## Examples

Each piece is complete apart from loading the scene (`const blend = await load(engine)`) and, after the first, the
`hero` it makes.

**1. A basic character: a Mixamo-style skeleton with Idle, Walk, Run and Jump.**

```js
const hero = new Character(blend, 'Armature', { input: 'default' });
hero.body.play(hero.locomotion);
hero.add(feet());
hero.add(gaze({ targets: [blend.scene.activeCamera] }));
followCamera(hero);
```

**2. Crouching.**

```js
hero.locomotion.stances.crouch = { idle: 'Crouch', walk: 'CrouchWalk' };
addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') hero.locomotion.stance = hero.locomotion.stance === 'crouch' ? 'stand' : 'crouch';
});
```

**3. An NPC that walks to its post, waves, and watches the hero when near.**

```js
const guard = new Character(blend, 'RIG-Guard');
guard.body.play(guard.locomotion);
guard.add(gaze({ targets: [hero.node], near: 4 }));
await guard.walkTo(post);
const upper = guard.layer('upper', { roles: ['spine', 'arms'] });
await upper.play('Wave', { once: true }).done;
upper.stop();
```

**4. Sitting down and standing up.**

```js
await hero.walkTo(chair);
await hero.place(chair);
await hero.body.play('SitDown', { once: true }).done;
hero.body.play('Sit');
// later
await hero.body.play('StandUp', { once: true }).done;
hero.body.play(hero.locomotion);
```

**5. Picking up a cup while walking, and one out of reach.**

```js
const grab = hero.add(reach({ hand: 'hand.R', target: cup }));
if (await grab.reached) {
  cup.parent = hero.bone('hand.R');
  hero.layer('hold', { roles: ['arm.R'] }).play('HoldCup');
}
grab.remove({ blend: 0.3 });
```

**6. Vaulting a wall.** The vault owns the root, warped so the hands land on the ledge.

```js
await hero.body.play('Vault', { once: true, warpTo: { marker: 'Hands', node: ledge } }).done;
hero.body.play(hero.locomotion);
```

**7. Listening while running.** The arms and head take Shush, then Listen; the legs keep running.

```js
const listen = hero.layer('listen', { roles: ['arms', 'neck', 'head'], weight: 0 });
addEventListener('keydown', async (e) => {
  if (e.key !== 'q' || e.repeat) return;
  listen.fade(1, 0.2);
  const { ended } = await listen.play('Shush', { once: true }).done;
  if (ended) listen.play('Listen');
});
addEventListener('keyup', (e) => e.key === 'q' && listen.stop({ blend: 0.3 }));
```

**8. Getting hit.** A light hit is absorbed; a heavy one knocks the character down, and it gets up.

```js
const hits = hero.add(impact());
function onHit(point, impulse) {
  hits.hit({ bone: 'chest', at: point, impulse });
  if (impulse.length() > 12) knockDown(impulse);
}
async function knockDown(impulse) {
  const landing = hero.node.position.add(impulse.scale(0.4));
  await hero.body.play('KnockBack', { once: true, warpTo: { marker: 'Land', position: landing } }).done;
  await hero.body.play('GetUp', { once: true }).done;
  hero.body.play(hero.locomotion);
}
```

A pause on impact is two lines: `for (const c of [hero, enemy]) c.speed = 0;`, then back to 1 after 0.08 s.

**9. A high five.** Both actions run on one clock; `reach` makes the hands meet whatever the heights.

```js
const palm = Vector3.Center(a.bone('hand.R').absolutePosition, b.bone('hand.R').absolutePosition);
for (const c of [a, b]) c.add(reach({ hand: 'hand.R', target: palm }));
a.layer('arms', { roles: ['arm.R', 'chest'] }).play('HighFive', { once: true });
b.layer('arms', { roles: ['arm.R', 'chest'] }).play('HighFive', { once: true, with: a.layer('arms') });
a.onMarker.add(({ name }) => name === 'Contact' && slap.play());
```

**10. A cutscene, then control returns.**

```js
await hero.turnTo(villain.node);
await hero.body.play(hero.action('Intro', { sound: 'Intro', once: true })).done;
await hero.body.play(hero.action('Reply', { sound: 'Reply', once: true })).done;
hero.body.play(hero.locomotion);
```

**11. A dialogue line over gameplay.**

```js
const face = hero.layer('face', { group: 'Face' });
await face.play(hero.action('Line_042', { sound: 'Line_042', once: true })).done;
face.stop();
```

**12. Footsteps and a hit window from the animation.**

```js
hero.onMarker.add(({ name, position }) => {
  if (name !== 'L' && name !== 'R') return;
  step.setPosition(position);
  step.play();
});
blend.scene.onBeforeRenderObservable.add(() => sword.setEnabled(hero.property('hit') > 0));
```

**13. A cat with a tail wag of its own.**

```js
const cat = new Character(blend, 'RIG-Cat', { roles: {
  hips: 'pelvis', spine: 'spine.002', head: 'head',
  legs: [['thigh.L', 'shin.L', 'paw.L'], ['thigh.R', 'shin.R', 'paw.R'], ['shoulder.L', 'arm.L', 'fore_paw.L'], ['shoulder.R', 'arm.R', 'fore_paw.R']],
  tail: ['tail.001', 'tail.002', 'tail.003'],
} });
const wag = defineEffect({
  name: 'wag',
  needs: ['tail'],
  on: 'controls',
  options: { rate: 2.5, angle: 0.4, lag: 0.6 },
  update(dt, { pose, roles, time, options: { rate, angle, lag } }) {
    roles.tail.forEach((bone, i) => pose.addRotation(bone, 'Z', Math.sin(time * rate * 2 * Math.PI - i * lag) * angle));
  },
});
cat.input = () => cat.steer(bowl);
cat.body.play(cat.locomotion);
cat.add(feet());
cat.add(wag({ rate: 3 }));
```

**14. A designer's preset.**

```json
{ "body": "Idle", "effects": [["gaze", { "near": 4 }], ["breathe", { "depth": 0.03 }], ["feet", {}]] }
```

```js
const guard = new Character(blend, 'RIG-Guard', { preset: await (await fetch('./guard.json')).json() });
guard.effect('gaze').targets = [hero.node];
```

**15. The Bar Scene.** Snow acts on a stool with the scene's dialogue; any input after the first tap hands Snow to the
player, who walks Snow away still talking.

```js
const snow = new Character(blend, 'RIG-Snow');
const acting = snow.action('Acting', { sound: 'Dialogue', loop: 1.5, waitForSound: true });
snow.body.play(acting);
snow.layer('face', { group: 'Face' }).play(acting);
const gesture = snow.layer('gesture', { roles: ['neck', 'head'], add: true, weight: 0 }).play(acting);
const fit = [snow.add(feet(), { weight: 0 }), snow.add(gaze({ targets: [blend.scene.activeCamera] }), { weight: 0 })];
snow.add(springs({ bones: ['DEF-Ponytail1'] }));

function takeOver() {
  snow.input = 'default';
  snow.body.play(snow.locomotion, { blend: 0.8 });
  gesture.fade(0.6, 0.8);
  for (const effect of fit) effect.fade(1, 0.8);
  followCamera(snow);
}
addEventListener('pointerdown', () => {
  for (const type of ['keydown', 'pointerdown']) addEventListener(type, takeOver, { once: true });
}, { once: true });
```

**16. Debugging.**

```js
console.table(hero.debug.who('head'));   // [{ by: 'body', source: 'locomotion: Run 0.7, Walk 0.3' }, { by: 'gaze', weight: 0.8 }]
hero.debug.show = true;                  // draws, per bone, what moves it
```

## API reference

```ts
new Character(blend: Blend, armature: string, options?: {
  roles?: Record<string, string | string[] | string[][]>,
  input?: 'default' | (() => Intent) | null,                   // null
  responsiveness?: number,                                      // 0.1 s
  ground?: (string | RegExp)[],
  idle?: boolean,                                               // true
  seed?: number,
  manual?: boolean,                                             // updated by update(seconds), not each frame drawn
  preset?: { body?: string, effects?: [name: string, options: object][] },
}): Character
Character.quality: 'auto' | 'A' | 'B' | 'C'                    // 'auto'
Character.tier: 'A' | 'B' | 'C'
followCamera(character: Character, options?: { pitch?: number, distance?: number /* 4.5 */, height?: number, ease?: number }): void

Character
  input: 'default' | (() => Intent) | null    responsiveness: number    speed: number /* 1 */
  node: TransformNode    velocity: Vector3    body: Layer    locomotion: Locomotion
  layer(name: string, options?: { group?: string, roles?: string[], bones?: string[], weight?: number,
                                  add?: boolean | { from: 'rest' | string } }): Layer
  action(name: string, options?: ActionOptions): Action
  mix(points: Record<string, number>): Mix
  add<E extends Effect>(effect: E, options?: { weight?: number }): EffectHandle & Fields<E>
  effect(name: string): EffectHandle
  bone(roleOrName: string): TransformNode
  property(name: string): number
  steer(target: TransformNode | Vector3): Intent
  walkTo(target: TransformNode | Vector3, options?: { run?: boolean }): Promise<void>
  place(node: TransformNode, options?: { seconds?: number /* 0.6 */ }): Promise<void>
  turnTo(target: TransformNode | Vector3, options?: { seconds?: number /* 0.5 */ }): Promise<void>
  contact(foot: string): number    /* 0 to 1, how much the foot role is planted */
  onMarker: Observable<{ name: string, action: string, bone?: string, position?: Vector3 }>
  debug: { who(bone: string): object[], show: boolean }
  update(seconds: number): void
  dispose(): void

Layer
  play(source: string | Source, options?: ActionOptions & { blend?: number /* 0.3 */, with?: Layer,
       warpTo?: { marker: string } & ({ node: TransformNode } | { position: Vector3, facing?: Vector3 }) }):
       Layer & { done: Promise<{ ended?: true, interrupted?: true }> }
  stop(options?: { blend?: number }): void    weight: number    fade(weight: number, seconds: number): Layer
  onEnd: Observable<string>

ActionOptions  { once?: boolean, loop?: number, sound?: string, waitForSound?: boolean, spatial?: boolean /* true */ }
Action         pause(): void   resume(): void   seek(seconds: number): void
Mix            value: number
Locomotion     actions: Gaits   stances: Record<string, Gaits>   stance: string /* 'stand' */   speeds: { walk, run: number }
Gaits          { idle?, walk?, run?, sprint?, turn?, jump?, fall?, land?: string }
Intent         { move: Vector3, facing?: Vector3, look?: TransformNode | Vector3, jump?: boolean }
EffectHandle   weight: number   fade(weight: number, seconds: number): EffectHandle   remove(options?: { blend?: number }): void

defineSource<O, S>(source: { name: string, options: O, init?(character: Character, roles: Partial<RoleBones>, options: O): S,
  update(dt: number, frame: { character: Character, sample: Sample, time: number, options: O }, state: S): void,
  dispose?(state: S): void }): (options?: Partial<O>) => Source
defineEffect<O, R extends string, S>(effect: { name: string, needs: R[], on: 'controls' | 'deform', options: O,
  tiers?: Partial<Record<'A' | 'B' | 'C', Partial<O>>>, init?(character: Character, roles: Roles<R>, options: O): S,
  update(dt: number, frame: { pose: Pose, roles: Roles<R>, time: number, options: O,
    character: Character }, state: S): void,
  dispose?(state: S): void }): (options?: Partial<O>) => Effect<S>

Roles<R>       a single bone's role (hips, chest, head, foot.L...) is a Bone, a chain's (arm.L, leg.R, a rig's own) Bone[],
               lid.L and lid.R [upper, lower], arms and legs Bone[][]

feet(options?: { reach?: number /* 0.5 m */, align?: number, give?: number /* 0.17 rad */ })
gaze(options?: { targets?: (TransformNode | Camera | Vector3 | null)[], near?: number /* 10 */, stare?: boolean, eyes?: boolean,
  turn?: { yaw: number, pitch: number } /* 1.2, 0.7 rad */ })
lean(options?: { amount?: number /* 1 */, limit?: number /* 0.21 rad, 12 degrees */ })
reach(options: { hand: string, target: TransformNode | Vector3 }): Effect<{ reached: Promise<boolean> }>
impact(options?: { absorb?: number /* 0.4 */, stiffness?: number, step?: number /* 6 N s */ }):
  Effect<{ hit(hit: { bone: string, at?: Vector3, impulse: Vector3 }): void }>
springs(options: { bones: string[], stiffness?: number, damping?: number, gravity?: number })
breathe(options?: { rate?: number, depth?: number })
eyes(options?: { blinkEvery?: number /* 4 s */ })
```
