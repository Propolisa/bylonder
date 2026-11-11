# SDK model

How a project's own code shapes a scene and makes it behave, so that what it does in the app also happens in an
exported page and in Node. Approved by the owner on 2026-11-11; nothing here is implemented yet.

## The problem

Code-built examples (`examples/*/index.js`) export `createScene`, which runs in the app and builds a Babylon scene.
File > Export > JavaScript writes the result as a package, and the code stays behind. What the code did per frame is
lost: Lumen's neon pulses in the app and holds still in its package, as Solar's orbits did. The noodle shop demo
(`docs/demos/noodle-shop/game.js`) shows the other side: its game is a page written by hand around two packages, so
none of it can be seen or tried in the app.

## Authoring scripts and runtime scripts

A project's code lives in **scripts**: JS or TS files in the project, each with one default export made by
`defineScript`. A script holds up to two kinds of code, following the editor and runtime split of Unity and Unreal.

- **Authoring scripts** shape the scene. They run in the app only and make Blender data: saved with the scene,
  undoable, listed in the Outliner, and exported as data like anything modeled by hand. They make that data through the
  SDK, or build a Babylon object with Babylon's API and transfer it explicitly (Transfer, below). Entry point:
  `author(ctx)`.
- **Runtime scripts** are what runs as the scene plays: gameplay, input, per-frame motion, and the Babylon scene's own
  settings. They run the same way in the app, in the Package View, in an exported page and in Node. Entry points:
  `init(ctx)` once, returning the script's state; `tick(ctx, state, time)` once per drawn frame; `dispose(ctx, state)`
  once at the end.

A script with only `author` is a scene builder as today; one with only runtime hooks adds behaviour to a scene made by
hand or opened from a .blend.

The Logic Editor (`src/editors/space_node/logic-editor.js`, Babylon's FlowGraph) edits runtime scripts drawn as nodes.
FlowGraph's Get and Set Bylonder Property blocks reach the same SDK.

## The context

Every entry point gets one object, `ctx`, of one type, `Context`, wherever it runs.

| Member | What it is |
|---|---|
| `ctx.babylon` | Babylon's objects: `scene` (the Babylon scene), `engine`, `canvas` (null in Node) |
| `ctx.blend` | The controller, `BlendScene`, as `load()` returns it: `get` and `set` by RNA path, `onChanged`, `settled()`, `controls()`, `playhead`, `clips`, `collections()` and the rest of `docs/controllable-exports.md`. In the app the same interface is routed to Main |
| `ctx.data` | ID refs: typed references to Blender's datablocks, grouped as `bpy.data` groups them: `ctx.data.objects.Lattice`, `ctx.data.materials['Cyan Neon']`, `ctx.data.scenes.Scene`. Each has `get(path)` and `set(path, value)` relative to its datablock, `path`, `node` (the Babylon node or material that draws it), `exists` and `toBabylon()` (Transfer, below) |
| `ctx.host` | Where the code runs: `'app'`, `'page'` or `'node'` |
| `ctx.app` | The app's own part, optional in the types and absent outside the app: today's `@workbench/sdk` surface (`controls`, `createText`, `meshTools`, `openBlend`, `registerModifier` and the rest), `key()` for authoring keys, `fromBabylon()` (Transfer, below), `report()` to the Info editor, and the playtest's state. In `author` its type is not optional |

A script reaches both sides directly: Babylon's through `ctx.babylon`, Blender's through `ctx.data` and `ctx.blend`.
Nothing passes from one side to the other on its own; a transfer is the one way to copy an object across.

`time` in `tick` is the playhead's: `{ frame, delta }`, the frame shown (a sub-frame unless the playhead snaps) and the
frames advanced since the last tick. Real time is an explicit opt-in: a script that sets `realTime: true` gets
`time.seconds` and `time.realDelta` (wall-clock seconds); without it those members do not exist in its types.

## Rules

1. **Blender-owned state changes through the SDK** (`ctx.data` or `ctx.blend.set`): a datablock's transform, a
   material's input, a custom property, a collection's visibility, the frame. The app and the package then agree, and
   in the app undo, the Outliner and the Properties editor see the change. Writing such a value on a Babylon object
   directly works for one frame and is undone by the next evaluation.
2. **Run-time-only Babylon objects use plain Babylon**: a GlowLayer, a follow camera, a TransformNode a game parents a
   character to, an input handler. `init` creates them and returns them in its state; `dispose` removes them. Babylon
   objects a script creates stay Babylon objects: the app never syncs them into Main, in authoring scripts or in
   runtime scripts. Only `fromBabylon` turns one into Blender data.
3. **Babylon-only scene settings go in `init`**: fog, the clear color, image processing, a rendering pipeline. Blender
   has no place for them, and `init` runs wherever the Babylon scene draws, in the app's viewport and in a package
   alike, so one place serves both. `dispose` restores or removes what `init` set.
4. **Time comes from the playhead.** `tick` advances with the playhead, so a paused or scrubbed scene shows the same
   frame everywhere and Node can reproduce any frame. Wall-clock time is used only with `realTime: true`.
5. **Ticks run in the project's file order, before the frame's evaluation**, so a script's writes show in the frame it
   makes them, and the order is one a user can see and change.

## Transfer

A transfer copies one object between the two sides, once, when the script asks. Neither copy follows the other
afterwards.

- `ctx.app.fromBabylon(object, { key })` turns a Babylon object into Blender data and returns its ID ref. It exists in
  the app only, since it makes datablocks: saved, undoable, listed in the Outliner and exported as data. In an
  authoring script the new datablocks carry the authoring key (`key`, else the script's path and the object's name),
  so a rerun updates them. The Babylon object is disposed, since the app now draws the datablock.
- `ref.toBabylon()` makes a new Babylon object from a datablock, evaluated at the current frame (modifiers applied),
  in every host. The new object belongs to the script, a run-time-only object under rule 2. It is not `ref.node`,
  which draws the datablock and follows its evaluation.

What maps, both ways:

| Babylon | Blender |
|---|---|
| `Mesh` with its vertex data (positions, normals, UVs, colors, indices), transform and material | Object with Mesh data, and its Material |
| `PointLight`, `SpotLight`, `DirectionalLight` | Object with a Point, Spot or Sun Light |
| `FreeCamera`, `TargetCamera`, `ArcRotateCamera`: transform, projection, field of view, clip range | Object with Camera data |
| `StandardMaterial`, `PBRMaterial` with colors, factors and image textures | Material with a Principled BSDF |

One object moves per call; a parent link is kept when the parent is already on the other side. Anything outside the
table is refused with an error that names the object and the property that does not map, and nothing is made: a
`HemisphericLight`, a `NodeMaterial` or `ShaderMaterial`, instances, thin instances, morph targets and skeletons on the
Babylon side; a curve, a Grease Pencil object or a material whose node tree is more than a Principled BSDF with
constant inputs and image textures on the Blender side. A transfer never makes a partial copy.

## Robustness and autocomplete

- **ID refs are bound to stable keys, not names.** Each datablock gets a persistent identity (`uid`) that survives
  renames: Blender's own persistent ID identity when the tracked version has one, else a hidden ID property
  (`_bylonder_uid`; Blender hides properties starting with `_`), and a linked datablock takes its `uid` from its
  library. Blender's own identity is preferred because it needs nothing written into the file. The IR carries the
  `uid` beside its readable key (`OB:Cube`), and an ID ref resolves by `uid`. When a datablock is renamed in the app,
  its symbol in the generated types changes, and the app applies TypeScript's rename refactor (`findRenameLocations`)
  to the project's scripts, so `ctx.data.objects.Cube` becomes `ctx.data.objects.Crate` in the code. A deleted
  datablock's symbol leaves the types, so its uses are type errors while editing; at run time its ID ref is an inert
  stand-in (`exists` false, `get` returns the path's default, `set` does nothing) that reports once.
- **Generated types for every Blender-made symbol and settable path.** One generator writes `scene.d.ts`: the ID refs
  by group, each with the paths it can set and their value types; `Controls` (as today); clip, marker and collection
  names as string unions. The app's Text Editor gets it live in its TypeScript worker (`src/workspace/intelligence.js`),
  regenerated as the scene changes. A local IDE gets it from the dev server endpoint `/bylonder/types/scene.d.ts` or
  the `bylonder types` command, which writes it into the checkout. Every package ships it, as it ships today's.
- **A path not live in the package is a type error.** The generated types list only the paths a package computes, so
  a write the page would ignore is caught while editing. The escape hatch is explicit: `ref.setUnchecked(path, value)`
  takes any RNA path the script knows to be live and reports at run time when it is not.
- **Babylon objects made in runtime scripts are typed by inference.** `defineScript` is generic over what `init`
  returns, so `tick` and `dispose` receive that state with its types, with no annotation.
- **Values are validated by the IR's Zod schema, with repair** (`runtime/ir.js`): a value of the wrong type is
  converted when it can be and refused with a report when it cannot; one out of range is clamped to the property's
  hard range; a missing one takes its default.
- **Versioned SDK and IR.** The SDK has a semver version, which `defineScript` records; the IR keeps its `version`.
  The loader migrates older IR on read, and an SDK major version ships a codemod for scripts with a list of what it
  renames.

## In the app

- **Authoring scripts are idempotent and keyed.** `author` runs when the script changes or on demand (Script > Run
  Authoring), never on its own during playback. Each datablock it makes carries an authoring key (from `ctx.app.key`
  or `fromBabylon`'s `key`, else the script's path and the datablock's name) and the values it last wrote. A rerun
  updates the datablocks with the same keys, makes the new ones and removes those it no longer makes, in one undo step.
  Babylon objects it leaves untransferred are not data: they are not saved or exported, the next rerun disposes them,
  and the app reports them once so a missing `fromBabylon` is noticed.
- **Hand edits are protected.** A value of an authored datablock that differs from what authoring last wrote is a hand
  edit (a scene edit to an authored value). The Outliner flags such datablocks. On a rerun the app asks once per
  datablock, Keep or Overwrite; Keep makes authoring skip those values until the edit is reverted.
- **Runtime scripts run in a playtest** (Modes, below), and in the Viewport Runtime.

## Modes

Bylonder keeps Blender's modes (Object Mode, Edit Mode, Pose Mode and the rest) as Blender has them. Runtime scripts
add one state, not a mode:

- **Playtest.** Started from the 3D Viewport's header (Playtest) or a key of Bylonder's own; Stop or Esc ends it, as
  Esc ends Walk Navigation. The app pushes an undo step, restarts the runtime scripts (`dispose`, then `init`), gives
  input in the viewport to the scene instead of the editor, ticks every frame, and allows real time. Runtime scripts'
  writes make no undo steps of their own; Stop runs `dispose` and undoes back to the step it pushed, so everything
  the playtest changed reverts at once, then the Viewport Runtime runs `init` again if it is on.
- Outside a playtest the editor owns input, and runtime scripts run only in the Viewport Runtime.

## Previews

- **Viewport Runtime**: runtime scripts running in the app's 3D Viewport on Blender data, `ctx.blend` routed to Main.
  `init` runs when the scene opens and again (after `dispose`) when a script changes, so the Babylon scene's settings
  show while editing; `tick` runs while the playhead plays (Space) and in a playtest. A toggle in the viewport's header
  (Viewport Runtime) turns it off, running `dispose`. Its writes outside a playtest are held as an evaluated layer,
  as the app holds animated values, and discarded when the playhead stops, so the file stays clean. It is quick and
  shows runtime scripts and editing together, but it is the app's implementation of the SDK.
- **Package View**: a Bylonder editor that writes the package as File > Export > JavaScript would, in memory, and loads
  it in a frame with plain Babylon, the page's own `load()` and the bundled runtime scripts. It is the authoritative
  check: what it shows is what a page shows. It reloads on demand and after each change once idle, and lists where it
  differs from the viewport (missing controls, units not live in the page, script errors).

## Packaging

File > Export > JavaScript bundles each script's runtime code into the package (`scripts.js`, beside `scene.js`) with
esbuild, as it bundles `scene.js` today, tree-shaken: `author` and everything only it imports are dropped, so
`installation.js` in the example below does not ship. `load()` starts the runtime scripts by default: it runs `init`
after the scene is ready, ticks from the playhead and runs `dispose` from `blend.dispose()`, because a package is
meant to behave as it did in the app. A page that wants the data alone opts out with `load(engine, { scripts: false })`.

The scripts keep the user's licence: `scripts.js` is a file of its own with the project's licence notice, never merged
into the GPL units or the SDK's MIT OR Apache-2.0 files, as the licence table in `docs/controllable-exports.md` already
says for project SDK code. The notice comes from the project's `package.json` `license`, and the export dialog asks
for one when it is missing, so a package never ships scripts without a stated licence.

In Node, runtime scripts that read pointer or keyboard input get none from a device. The SDK offers recorded input
instead (`load(engine, { input: recording })`, a list of timed events by frame), so tests can replay a session and
compare frames by value.

## A script

```js
// lumen.js: the installation, and its neon pulsing to the beat.
import { defineScript } from '@bylonder/sdk';
import { GlowLayer, Color3, Scene } from '@babylonjs/core';
import { neon, geodesic } from './installation.js';

const BEAT = 12;

export default defineScript({
  author(ctx) {
    const scene = ctx.babylon.scene;
    const lattice = geodesic(scene, neon(scene, 'Cyan Neon', new Color3(0.1, 0.75, 1)));
    lattice.position.y = 2.2;
    ctx.app.fromBabylon(lattice, { key: 'lattice' });
    ctx.app.controls({ id: 'mix', title: 'Mix', schema: { energy: { default: 0.6, min: 0, max: 1.5, label: 'Energy' } } });
  },

  init(ctx) {
    const scene = ctx.babylon.scene;
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.02;
    scene.fogColor = new Color3(0.02, 0.01, 0.04);
    scene.imageProcessingConfiguration.exposure = 1.4;
    const glow = new GlowLayer('Glow', scene, { blurKernelSize: 32 });
    return { glow };
  },

  tick(ctx, { glow }, time) {
    const { objects, materials, scenes } = ctx.data;
    const energy = scenes.Scene.get('["mix energy"]');
    const flash = Math.exp(-((time.frame - 1) % BEAT) / 3);
    materials['Cyan Neon'].set('node_tree.nodes["Emission"].inputs["Strength"].default_value', energy * (0.6 + flash));
    objects.Lattice.set('rotation_euler', [0, 0, time.frame * 0.012]);
    glow.intensity = 0.45 * energy;
  },

  dispose(ctx, { glow }) {
    ctx.babylon.scene.fogMode = Scene.FOGMODE_NONE;
    glow.dispose();
  },
});
```

`author` builds the lattice with Babylon's API and transfers it, with its neon material, into Blender data, which the
package then carries as data. `init` sets the Babylon scene's fog and exposure, which Blender has no place for, so the
viewport and the package show them alike. `tick` writes the lattice's rotation and the neon's strength through the
SDK (Blender's data, in Blender's axes) and the glow, a run-time-only Babylon object, directly. In a page the same
file's runtime code runs through `load()`:

```js
import { load } from './lumen/scene.js';
const blend = await load(engine);   // init runs; the playhead ticks the runtime scripts
```

## Names

The owner asked for names that cannot be read two ways. Each choice below was checked against the code and docs
(grep), Blender's and Babylon's vocabulary and the SDK's current names. "Runtime" means only runtime scripts and run
time; Bylonder's choice of Blender or Babylon code per feature is called evaluation.

| Name | Why, and what it avoids |
|---|---|
| **Script** (`defineScript`) | Blender's word for user code in the Text Editor. Not "module", which in this repo is Blender's WASM module |
| **Authoring scripts**, `author` | Unity's and Unreal's word for editor-time code. Not "build" (`npm run build`, module builds) and not "setup". Unused in the code today |
| **Runtime scripts**, `init`, `tick`, `dispose` | Unity's and Unreal's word for code that runs as the game plays. Not "behaviour": Babylon's `Behavior` is a class attached to nodes (`node.addBehavior`); not "logic", which reads as the Logic Editor alone. `init` and `dispose` are Babylon's lifecycle words; `tick` is unused by Blender and Babylon (the app's internal `time.tick` is not user facing). Not `start` and `stop`, which read as `frame_start` and a clip's `stop`, nor `update`, Blender's RNA update callbacks |
| **Context**, `ctx` | The conventional name. Distinct from Blender's `bpy.context` by its type name and members; nothing in it is called "context" |
| `ctx.babylon.scene` | "Scene" alone is never used: the Babylon scene is always reached through `babylon`, Blender's Scene through `ctx.data.scenes` |
| `ctx.blend` | The name `docs/controllable-exports.md` already uses for the controller; "blend" means the .blend and its data, nothing else |
| **ID refs**, `ctx.data` | Not "handles", which in Blender are Bezier and F-Curve handles. `data` mirrors `bpy.data`. "Ref" agrees with the IR's `references` (ID pointers) |
| `ctx.host` | Not "environment", which in Babylon is the environment texture and in Blender the World's environment |
| `ctx.app` | Replaces the global `workbench`: Workbench is Blender's render engine |
| **Playtest** | Not "Play mode": "mode" is Blender's interaction mode (`object.mode_set`), and "play" is the playhead's playback. Unused in the code today |
| **Viewport Runtime**, **Package View** | Each names where the runtime scripts run: the 3D Viewport on Blender data, or the real package. Not "preview": Blender's Material Preview shading, preview range, the Sequencer's Preview and ID previews own it. Not "live", which the export docs use for values computed in the page |
| **Package** | What File > Export > JavaScript writes. "Export" alone means the act or the File > Export menu |
| **SDK** | The package's code in `bylonder/` and its app counterpart |
| **Evaluation** | Which code computes a feature: Blender, Babylon (mapped) or Babylon (native). Blender's own word for computing data (the depsgraph's evaluated data); frees "runtime" for runtime scripts |
| `fromBabylon`, `toBabylon()` | Each names its direction and the other side. Not "sync", which reads as ongoing and implicit (`main-sync.js`); not "import" or "export", which mean files and File > Export; not "convert", which in Blender is `object.convert` between object types |
| `bylonder types` | Not "sync", which is `main-sync.js` syncing Babylon nodes into Main |

### Existing names that change

| Today | New | Where |
|---|---|---|
| `blend.play(name)`, `stop(name)`, `setWeight`, `crossFade`, `clips()` | `blend.clips.play(name)`, `.stop`, `.setWeight`, `.crossFade`, `.list()` | `runtime/blend-scene.js`, `clips.js`, docs; the old names stay one SDK major version as aliases. Two `play` methods on one object (`blend.play`, `blend.playhead.play`) read alike |
| `@workbench/sdk`, global `workbench` | `@bylonder/sdk` (`defineScript`, types), `ctx.app` | `src/runtime/sdk-module.js`, `intelligence.js`, examples, `default-project.js` |
| "Scene builder", `createScene` in examples | Authoring script, `author` | `docs/concepts.md` Terms; an example's `createScene` becomes `author`, with a `fromBabylon` for each object that should be data and its scene settings moved to `init`. The package's own `createScene(engine, canvas)` keeps its name: it is the Babylon Playground's |
| `editable(node, { id })` | `ctx.app.key(ref, key)`, or `fromBabylon`'s `key` | `src/runtime/sdk.js` |
| "The page runtime", `src/io_scene_babylon/runtime/` | "The SDK", `src/io_scene_babylon/sdk/` | Docs and paths; the package folder `bylonder/` keeps its name |
| `src/runtime/` (the app's project host) | `src/project/` | Paths; next to `src/runtimes/` it reads as the same thing |
| Runtimes: the Runtime setting, `docs/runtimes.md`, `src/runtimes/` with `runtimes.js` | Evaluation: the Evaluation setting (property `evaluation`, the Evaluation panel), `docs/evaluation.md`, `src/evaluation/` with `evaluation.js` | `src/runtimes/`, `export-dialog.js`, `docs/runtimes.md`, the Runtimes section of `CLAUDE.md` and the docs that link them. A later commit of its own |
| "build" for one load of an asset | "load" | Comments in `runtime/asset.js` |
| "the runtime `BABYLON.Scene`" | "the Babylon scene" | `docs/concepts.md` |
| `#preview-pane` | `#viewport-pane` | `src/workspace/layout.js`, `workspace.css` |

`BlendScene`, `load()`, `playhead`, `controls()`, `onChanged`, `onMarker`, `nodeOf`, `objectsIn` and the IR's names
stay as they are.

## Glossary

- **Authoring script**: a script's `author`; runs in the app only; what it makes through the SDK or transfers is
  Blender data.
- **Authoring key**: the identity of a datablock authoring made, so a rerun updates it instead of adding another.
- **Babylon scene**: Babylon's `Scene`, `ctx.babylon.scene`.
- **Blender scene**: Blender's Scene datablock, `ctx.data.scenes.Scene`.
- **blend**: a .blend file or the data it holds; `ctx.blend` is the controller over that data. An NLA strip's blending
  is its "blend type", Blender's `blend_type`.
- **Build**: `npm run build` or a module build only.
- **Bundle**: what esbuild makes of a package's modules and runtime scripts.
- **Clip**: an action exported to play on its own (`docs/ir.md`, Clips); clips play with `blend.clips.play`.
- **Controller**: `BlendScene`, what `load()` returns and `ctx.blend` holds.
- **Evaluation**: which code computes a feature, per instance: Blender, Babylon (mapped) or Babylon (native)
  (`docs/evaluation.md`, formerly the runtimes).
- **Export**: File > Export or the act of exporting. Its JavaScript entry writes a package.
- **Hand edit**: a scene edit to a value authoring wrote.
- **Host**: where code runs, `ctx.host`: the app, a page or Node.
- **ID ref**: a typed reference to a datablock in `ctx.data`, bound to its `uid`.
- **Load**: `load()` reading a package. Blender files are opened (File > Open, `openBlend`); Babylon's files are
  imported (`ImportMeshAsync`).
- **Logic Editor**: the node editor for runtime scripts, on Babylon's FlowGraph.
- **Mode**: Blender's interaction mode only.
- **Object**: Blender's Object. Babylon's are nodes (meshes, transform nodes, lights, cameras).
- **Package**: the files File > Export > JavaScript writes.
- **Package View**: the editor that runs the real package in the app.
- **Play**: playback by the playhead (Blender's Play Animation), or a clip's `play`; never a playtest.
- **Playhead**: the scene's one clock (`runtime/playhead.js`).
- **Playtest**: runtime scripts running with input in the 3D Viewport, reverted on Stop.
- **Preview**: Blender's meanings only.
- **Run time**: when a scene plays, in the app, a page or Node.
- **Runtime script**: a script's `init`, `tick` and `dispose`; runs everywhere.
- **Scene edit**: a change made in the editor and saved on the scene (`docs/concepts.md`).
- **Script**: a project file with a `defineScript` default export.
- **SDK**: `@bylonder/sdk`: the controller, `defineScript`, the context and the generated types; in a package,
  `bylonder/`.
- **Sync**: `main-sync.js` mirroring a scene builder's Babylon nodes into Main; scripts never sync.
- **Tick**: one call of a script's `tick`, once per drawn frame.
- **Transfer**: a one-time copy of one object between the two sides on the script's request, `ctx.app.fromBabylon`
  or an ID ref's `toBabylon()`; neither copy follows the other.
- **uid**: a datablock's persistent identity, which renames keep.
- **Viewport Runtime**: runtime scripts running in the 3D Viewport on Blender data.

## Stages

Each stage lands as one commit with its tests, checked in the Package View and in Node.

1. **Runtime scripts and ID refs, with the Package View.** `defineScript`, the context in the app, a page and Node;
   `uid` in the IR (version 2, migrating version 1); ID refs with stand-ins; `scripts.js` bundled into packages;
   recorded input in Node; the Package View. Lumen moves its per-frame code into `tick` and its scene settings (fog,
   image processing, the lens pipeline) into `init`, and the noodle shop's game becomes a script in a project holding
   the lane and her, its page reduced to `load()`. Checks: the Lumen package's neon pulses frame for frame as in the
   app (headless, compared by value), with the same fog and exposure; the noodle shop walks, sits and sips in the
   Package View, in a page and in Node from recorded input.
2. **Live types that follow the scene.** The generator, the TS worker in the app, the dev server endpoint and
   `bylonder types`. Checks: completing `ctx.data.` lists the scene's datablocks; a wrong value type is an error; a
   path not live in the package is an error; a rename in the Outliner renames uses in scripts; a deletion is a type
   error.
3. **Renames applied to code.** The table above, with aliases and a codemod for the old SDK names. Checks: the test
   suite, examples and feature docs pass with the new names; `node scripts/feature-docs.mjs` is clean.
4. **Authoring scripts with transfers and protected hand edits.** `author`, `fromBabylon` and `toBabylon()` for the
   kinds in the Transfer table, authoring keys, reruns in one undo step, hand edit flags, Keep or Overwrite. Examples
   move from `createScene` to `author` with explicit transfers, and `main-sync.js` no longer runs for scripts. Checks:
   a rerun leaves an example unchanged; a transfer there and back gives equal geometry, transform and material values;
   an object that does not map is refused with an error and makes nothing; a hand edit survives a rerun with Keep;
   undo restores the state before a rerun.
5. **Playtest.** Start and Stop, input routed to the scene, real time, revert through undo. Checks: after Stop, Main
   equals its state before Start; the noodle shop plays in the app as in its page.
