# Controllable exports

An exported page that shows the whole Blender scene, loads fast, and keeps its controls live: any knob the scene
exposes can be set from JavaScript by its Blender path, and what depends on it follows as it does in Blender. No Blender
module runs unless a change needs Blender's own evaluator; then it loads, once. A headless SDK (Blender's logic
without its UI, driven from JavaScript) is the same runtime packaged without a page.

Written 2026-11-09 from a review of the export code and Node-side runs of real exports. The decisions below were
approved by the coordinator or decided by the owner.

## What an export carries today

Checked on `origin/main` at `ea4f1eb0`, by reading the code and by exporting examples in Node (NullEngine, the CI
module, one process per example, as `tests/runtimes-armature-wasm.test.js` opens a project). `tests/export.test.js`,
`tests/export-live.test.js` and `tests/export-node-material.test.js` pass.

### Control inputs

| Input | Exported as | Tunable after export |
|---|---|---|
| Transforms | Babylon node position, rotation, scaling | Yes, as Babylon properties (not by Blender path) |
| Visibility | `isEnabled`, `isVisible` | Yes, as Babylon properties |
| Lights, camera | Babylon's `Light.serialize`, `Camera.serialize` | Babylon's settings only |
| World | An environment image URL with a default skybox, else the clear color (`babylon-export.js:75`); a World node tree is not exported (its skybox is `doNotSerialize`) | No |
| Shader node inputs | Folded into one `CustomBlock` per material with each value a GLSL constant (`node-material-export.js:199`). Lava: 38 blocks, one CustomBlock of 74 lines, 0 tunable InputBlocks | No |
| Materials of one Principled BSDF | `PBRMaterial` (all 7 of the Steam Engine's) | Babylon's settings |
| Custom properties | Not exported; only a node's own Babylon metadata, minus Bylonder's (`babylon-export.js`, `authoredMetadata`) | No |
| SDK controls (`sdk.controls`, `store:` channels) | Not exported (`babylon-export.js:112`) | No |
| Geometry Nodes inputs | Not exported; the evaluated mesh is | No |
| Modifier settings | Applied; with Live Modifiers, mesh-only stacks keep their settings under `metadata.bylonderModifiers` | Yes, through the polyfill, by a Babylon metadata path |
| Rig controls | Pose bones sampled into `_matrix` keys | No |
| Time | One AnimationGroup | Yes (`goToFrame`) |
| Attributes | Vertex buffers of the evaluated mesh | No |

### Propagation

- **Animation** is sampled at every frame of the scene range (`babylon-export.js:130`) from the raw F-curves
  (`model.js:276`, `fcurve.sample`), with no tangents: the compositor example's 43 tracks are 10,320 keys.
- **Drivers, constraints and NLA are lost on objects and materials**, because those samples are the F-curve's own
  values, not Main's. The Steam Engine's driven Crosshead moves from 1.95 to 1.12 over frames 1 to 30 in Main; the
  export has no track for it and holds it where it was at the current frame. The NLA example (three NLA tracks, no
  active action) exports no animation at all.
- **Armature poses and shape key influences are evaluated through Main** at each frame (`sync.frameChanged`,
  `armature.js:321`, `shape-keys.js:211`), so drivers, constraints and IK on them are baked correctly.
- **In the app, driven values do reach Babylon objects**: Main's depsgraph evaluates drivers (`main-sync.js`
  `frameChanged`) and `main-view.js` `drawEvaluated` sets each node's world matrix from Main's `matrix_world`. Only the
  export misses them.
- **Python handlers** are not carried.

### Evaluators

- **Shader nodes**: a node's GLSL is made by Blender's GPU node function in the module (`gpu-graph.js:69`,
  `node_gpu_graph`) or by its link steps (`node-code.js`); in the app unlinked inputs are uniforms
  (`shader-nodes.js:968`), so values change without a rebuild. The exporter keeps the code and inlines the values.
- **Compositor**: not exported (no post-process, no render graph in any export). In the app it is a Babylon
  `NodeRenderGraph` with a block class per Blender node (`compositor-nodes.js`), and operations Blender's GPU
  compositor records in the module replayed on Babylon's frame graph (`compositor-replay.js`).
- **Mesh modifiers**: applied; with Live Modifiers, `modifiers.wasm` (6.3 MB, 1.6 MB gz, 1.3 MB br, 10 ms to compile)
  evaluates mesh-only stacks in a worker.
- **Geometry Nodes**: evaluated mesh only. Instances are dropped: the view draws them as `__instances ...` meshes
  (`main-view.js:568`), which the exporter skips as helpers (`babylon-export.js:13`); the Geometry Nodes example
  exports its planet without its trees.
- **Skinning and shape keys**: native (`Skeleton`, `MorphTargetManager`) through the runtimes registry.
- **Particles and simulation**: Babylon particle systems serialize; Blender's are not exported.

### Size and load

| Example | .babylon | of which geometry | .js |
|---|---|---|---|
| Steam Engine | 3.96 MB | | 1.28 MB |
| Geometry Nodes | 12.7 MB | 12.6 MB | fails |
| Compositor | 35.9 MB | 33.7 MB | fails |

The compositor example's geometry is 33.7 MB as JSON (3.9 MB gzipped, 205 ms to `JSON.parse` the file), 9.7 MB as raw
f32 and u32 arrays (2.3 MB gzipped, 1.2 MB brotli). Everything else is 2.2 MB (0.18 MB gzipped), 1.2 MB of it materials
that repeat Blender's GLSL library per material. Its `.blend` is 2.6 MB.

### Bugs found

Handed to the `export-fixes` branch: File > Export > JavaScript throws on any scene with thin instances
(`js-export.js:24` reads the `world0` to `world3` instance buffers as vertex data); instances are dropped from
`.babylon`; the NLA example exports no animation; a constrained or driven object exports at its unconstrained
transform.

## The model

An export has three parts:

1. **The snapshot**: the evaluated scene as Babylon objects, which draws with plain `@babylonjs/core` and nothing else.
2. **The control table**: plain data naming the scene's knobs by Blender path, what each binds to in Babylon, and the
   operations that propagate a change (the dependency table).
3. **Evaluators**: the code that runs those operations, each loaded only when a table entry needs it.

**Live or baked.** Anything a knob can change stays live. A driver, constraint or NLA strip whose inputs are only
animation is baked into the AnimationGroup for playback; one that reads a knob runs through the scheduler (natively,
compiled, or in the lazy evaluator) and its baked samples are used only while nothing it reads has been set. Baking per
frame is the playback fallback, not the model.

**Structure or value.** A value change (a socket's default, a modifier's setting, a transform) goes to the fastest
evaluator that covers it. A structural change (a link, a node's enum that changes its code, a modifier added) goes to
Blender's evaluator.

## Modules and interfaces

Five modules, each with one concern. Today's pieces map onto them below.

### Controller and property paths

```js
import { load } from './steam-engine/scene.js';      // or loadBlendScene(engine, url) from bylonder/blend-scene.js
const blend = await load(engine);
blend.scene;                                          // Babylon's Scene
blend.get('objects["Flywheel"].rotation_euler[1]');
blend.set('objects["Flywheel"].location[2]', 0.5);
blend.onChanged.add(({ path, value }) => {});          // a Babylon Observable
blend.controls();                                     // [{ path, type, default, soft_min, soft_max, subtype, unit, suggested }]
blend.dispose();
```

That is the whole surface. The runtime (`src/io_scene_babylon/runtime/`, MIT OR Apache-2.0) is plain ES modules with
`// @ts-check` and JSDoc, no build step, importing only `@babylonjs/core`; `tsc --noEmit` checks it in the test suite,
and its `.d.ts` files are generated from the JSDoc and committed, a test keeping them current. Each package writes
`scene.d.ts`, an interface of its controls by path, so `set` and `get` complete the scene's paths and check value
types. `controls()` fields are named as Blender's RNA names them.

- Paths are Blender RNA paths from `bpy.data`, Blender's identifiers. In the app the same path goes to the module's
  `rna_set`, so the IR names them as the app does.
- Every RNA path is settable; there is no hidden whitelist. A path with a binding or an operation in the table runs on
  its fast path; any other is not live in the page yet (no IR entity computes it).
- The export lists suggested controls for authors and UIs: custom properties, exposed node group and Geometry Nodes
  inputs, the SDK store controls, and every property a driver reads. An author can trim the list in the export options.
- The controller is returned by the loader, not hung on Babylon's Scene. The page and the headless SDK get the same
  object.
- SDK store controls are Scene custom properties in Main already (`blender-boundary.md`, Animation:
  `scenes["Scene"]["<owner> <path>"]`), so they are knobs like any other.
- Interop: a pair of FlowGraph blocks (Get and Set Bylonder Property) calls `get` and `set`, so a user's own FlowGraph
  or glTF interactivity drives the same knobs. Nothing else is FlowGraph's.

#### Use it from Node

The same package runs in Node without a page, on Babylon's `NullEngine`: install `@babylonjs/core` beside it (its
`package.json` names the version), import its `scene.js` by file URL, set controls and read the evaluated scene from
Babylon's objects. Drivers run in the clean-room units, live modifiers run `modifiers.wasm` in the script's own thread
(Node has no Web Worker) and Geometry Nodes run Bylonder's evaluator on Blender's per-node kernels, each reading its
files from the package
folder. Values read back are in Babylon's axes (y up).

```js
import { pathToFileURL } from 'node:url';
import { NullEngine } from '@babylonjs/core';

const { load } = await import(pathToFileURL('steam-engine/scene.js').href);
const blend = await load(new NullEngine());
blend.set('objects["Flywheel"].rotation_euler[1]', 1.2);
await blend.settled();                                // once an evaluator has loaded
blend.scene.getNodeById('Crosshead').computeWorldMatrix(true);
blend.scene.getMeshById('Crosshead').getVerticesData('position');
blend.dispose();
```

`docs/examples/headless-sdk.mjs` is a complete script: it takes a package, controls as JSON and object names, and
prints each object's world matrix and evaluated positions. `tests/headless-sdk-wasm.test.js` runs it on exported
examples in a process of its own and compares with the app. Nothing draws: textures are created, not decoded, and
Babylon warns that an area light has no LTC data.

### Bindings

Each knob's binding says where its value lands in Babylon: a target (node, light, camera, material InputBlock, morph
target, bone, render graph block), a property, and a conversion (Blender's axes and units to Babylon's). Its seed is the
animation model's channel registry (`blenkernel/animation/bindings.js` `register`: id, path, get, set, target, property,
the Euler order and axis conversions), which already maps every animated value to Babylon for the app; the export
writes those entries as data. A knob without a binding is consumed by an operation instead.

### Dependency table

Replaced by the IR (`docs/ir.md`): the knobs are its `properties`, the operations its `entities`, each reading
properties and other entities' outputs by reference, and `order` a topological order of entity keys. A package ships it
as `scene.ir.json`.

### Scheduler

One module, well under 200 lines. On `scene.onBeforeAnimationsObservable` it takes the knobs set since the last tick,
marks the operations that read them (transitively), and runs the marked ones in `order`, each through its evaluator;
written knobs are applied through their bindings. Babylon's own systems are the leaves: AnimationGroup for time,
Skeleton, MorphTargetManager, NodeMaterial InputBlocks, NodeRenderGraph blocks. An operation whose evaluator is not
loaded yet is queued, and the evaluator loader is asked for it.

Built (step 5): `runtime/scheduler.js` runs the marked operations when a control is set, at once, so a page or a
headless script reads the result after `set` (or after `await blend.settled()` the first time an evaluator loads). An
operation that has run stays live: Babylon's AnimationGroup still plays the baked samples of what it writes, and the
scheduler writes the live value back on `scene.onAfterAnimationsObservable`. The table (`DEPENDENCIES` in `scene.js`,
written by `dependency-export.js`) holds one `driver` operation per driver of an exported ID whose inputs are controls:
its expression, its variables (a single property as the control it reads; a transform channel, distance or rotational
difference as the objects' transform controls and their static parts, parents included) and its own F-Curve. The
`driver` evaluator (`runtime/driver-evaluator.js`) runs it with the clean-room units in `runtime/drivers/`, copied
unchanged from the clean room with their proofs in `docs/clean-room/`. A driver needing Python, an F-Curve modifier
other than Cycles, an F-Curve the units miss where the export samples it against Blender's, a bone target or an input that is no control stays baked.

### Evaluators

An evaluator is the runtimes model (`runtimes.md`) applied to an export: Babylon native or mapped where Babylon has the
class, Blender where only Blender's code can do it.

```js
// One per kind; registered with the loader.
{
  id: 'driver',
  runtime: 'MAPPED',                // 'NATIVE' | 'MAPPED' | 'BLENDER'
  load: () => import('./drivers.js'),
  run(operation, knobs) {},         // reads knobs[operation.reads], returns values for operation.writes
}
```

| Evaluator | Runtime | Runs | Loaded |
|---|---|---|---|
| `animation` | Native | AnimationGroup at the scene's time | With the page |
| `material` | Native | NodeMaterial InputBlock values and textures | With the page (bindings only) |
| `skin`, `morph` | Native | Bone local matrices, target influences from pose and Key values without constraints | With the page |
| `driver` | Mapped | Driver expressions, variables and the driver's F-curve, as clean-room units (MIT OR Apache-2.0) | On the first set of a knob a driver reads |
| `modifiers` | Blender | Mesh-only stacks in `modifiers.wasm`'s worker | On the first set of a modifier setting |
| `geometry-nodes` | Mapped, Blender kernels | Geometry Nodes modifiers: Bylonder's evaluator over the IR graph, each node a call into `geometry-nodes.wasm` unless a unit is registered for it | On the first set of an input the modifier reads |

`runtimes.js` features gain an `exportOperations(world)` beside `export(world)`, writing their table entries; no other
code changes for a feature to join.

### Evaluator loader

The scheduler loads an implementation the first time an entity needs it (`runtime/scheduler.js` `EVALUATORS`), with
the page's scene, the package's URL, the IR, `scene.bin`'s buffers and the controls. Threads are used when the page is
cross-origin isolated (`crossOriginIsolated`), else one thread, as Safari gets.

Geometry Nodes (`geometry-nodes`): each Geometry Nodes modifier is a `modifier:NODES` entity reading its graph, the
geometry before it (the base mesh with its attributes, in `scene.bin`) and its float, integer and boolean inputs,
suggested controls by path (`objects["Planet"].modifiers["Planet"].properties.inputs.Socket_2.value`). On the first set
of one, `runtime/geometry-nodes-evaluator.js` (MIT OR Apache-2.0) imports `bylonder-geometry-nodes/kernels.js` and
instantiates `geometry-nodes.wasm` beside it, Blender's Geometry Nodes kernels (GPL-3.0-or-later). For now that file
is the scene module itself (`runtime-files.js` `GEOMETRY_NODES_KERNELS`), of which the page calls only the per-node
entry points (`geometry-nodes-api.cc`); a module of their own replaces it once built. Bylonder's evaluator (`runtime/geometry-nodes/`) walks the graph and runs each node through the
registry, else as one kernel call. The IDs a graph reads come from the IR: an object's world matrix and mesh as
evaluated at export (`ids[...].evaluated`), a collection's members. The result is drawn by `runtime/mesh.js`: the mesh
with a submesh per material and smooth or flat normals per face, instances as thin instances of their objects' meshes
under the modifier's object (so they follow its transform without running the nodes again), points as a point cloud.
Until an input is set, the baked result shows. The whole-scene Blender fallback (`scene.blend` opened in Blender's Main)
that this replaces is gone, with the Include Source .blend option. Not yet: simulation zones, and the limits listed in
`docs/licence-free-live.md`.

### Blocks library

One small ES module, `bylonder-blocks.js`, beside the export when the scene needs it, registering its classes with
Babylon's `RegisterClass`:

- the compositor's pass block: a post-process with code made at export and its values as uniforms, and the replay of a
  recorded operation's pass plan;
- Bylonder's extensions of Babylon toward EEVEE (`draw/render-extension.js`), each its own module, imported only when
  the scene uses it and on as in the app: volumes, area light shadows, EEVEE Parity's lobes, the film's accumulation,
  the view transform LUT (`render/display-lut.js`), and later ones as they land.

A scene that uses none of them ships none of them. Shader and world materials need no class: they are plain
NodeMaterials.

Built (step 4): `runtime/blocks.js` ships as `bylonder-blocks.js` with `BylonderPassBlock`, one class for every Blender
compositor node. The export (`compositor-export.js`) builds the app's graph from Main's compositing node group and
writes each node as that block with its pass made there: a pixel node's fragment shader from Blender's GPU node
function with its values as uniforms, or an operation's plan recorded by Blender's GPU compositor at the scene's render
size. Render Layers is Babylon's own external texture input. Which values bind is measured at export: an input is a
control without a rebuild when nudging it changes exactly one uniform, or one uploaded float of the plan, by the same
amount; any other value (a Blur's Size, which changes the plan) needs Blender's evaluator (step 6). The page runs the
graph on the camera's render before the display transform and copies the composite back, as the app does. The view
transform is an extension of its own, `runtime/view-transform.js` shipped as `bylonder-view-transform.js`: scene linear
materials, then exposure, Blender's display processor as a lattice computed at export into `scene.bin` (none for
Standard without a look, which is sRGB's encoding) and the gamma. Each ships only when `scene.js` imports it
(`runtime-files.js` `packageRuntime`). The app's own compositor tasks and display shader are these same classes.
Volumes ship as the app's volume passes (`draw/volume-passes.js` and `draw/volume-blocks.js`, GPL, bundled into
`bylonder-volumes/volumes.js`): each domain's volume material is the app's (its tree drawn with its Volume, the nodes
made from the IR's graph by the kernels' `<graph>/volume`), drawn over the world and the meshes the export lists in
`scene.js` (`volumes-export.js`) with the scene's Volumes settings and the lights' Blender settings. Not yet in the
library: area light shadows, EEVEE Parity's lobes and the film's accumulation; a page draws without them. All code is GLSL through Babylon's own path, so a page renders on WebGL 2 and on WebGPU (Babylon
converts the GLSL with glslang and twgsl there, `webgpu.md`).

### The package

```
scene.js              load(engine) and createScene(engine, canvas): structure, settings, control table
scene.d.ts            the scene's controls as a type
package.json          an ES module package needing only @babylonjs/core
scene.bin             vertex, index, thin instance and key buffers as raw typed arrays, gzipped (lossless)
images/               one file per image
bylonder/             the page runtime: blend-scene.js, buffers.js, their .d.ts, LICENSE.md (MIT OR Apache-2.0)
bylonder-blocks.js    only if the scene composites
bylonder-<extension>.js  each only if the scene uses it (bylonder-view-transform.js)
drivers.js            only if a knob feeds a driver
modifiers/            modifiers.wasm, its worker and modifiers.js, only if a knob feeds a mesh-only stack
bylonder-geometry-nodes/  geometry-nodes.wasm and kernels.js, only if a Geometry Nodes modifier is live
```

Every module of the package imports Babylon module by module (`@babylonjs/core/Meshes/mesh.js`, never the whole
`@babylonjs/core`), so a page loads only the Babylon modules its scene uses. `scene.js` also imports, for their side
effects, the modules its data needs registered before it parses: each class a `customType` or `className` names (a
material, a node material's blocks, a texture, a pipeline), each light's and camera's constructor, and the scene
components of its shadows, effect layers and particles. The export writes these imports from
`babylon-modules.json` (`scripts/babylon-modules.mjs`, kept current by a test), which names the module of each name
Babylon exports or registers and of each member one module adds to another's class (`thinInstanceSetBuffer`). A
package made for WebGPU or WebGL 2 imports neither engine up front: its `createEngine` loads the one it makes.

File > Export's Bundle setting chooses how a page loads the package:

- **Bundled (the default).** The export bundles `scene.js` with esbuild, in the browser, into a minified `scene.js` and
  chunks in `bundle/` that hold the Babylon.js modules the scene uses and the page runtime; shaders and evaluators are
  chunks that load on demand. A page imports `./scene.js` as it is, with no CDN, import map or bundler. Blender's code
  (GPL) stays in its own files, each an entry of the same bundle with its leading comments and its folder's notices:
  only `scene.js` imports it, and no chunk holds any of it; a unit the page replaces is absent from the package, so
  from the bundle too. A package made for WebGPU carries Babylon's GLSL to WGSL compilers in `bundle/webgpu/`, which
  its `createEngine` passes to the engine. A package with area lights, bundled or not, carries Babylon's LTC table
  in `babylon-assets/`, as the app serves it (`scripts/babylon-assets.mjs`), so its page loads nothing from Babylon's sites. Babylon's sources come from the app's own site, an archive of the installed
  `@babylonjs/core` (`babylon-core-<version>.zip`, made by `vite.config.js`), fetched on the first bundled export and kept
  in the browser's Cache Storage; esbuild's WebAssembly is the app's too. Minify off writes the bundle readable.
- **Modules.** Bundle off writes the modules as they are. Map Babylon's module paths to the same version, as the header
  of `scene.js` says:
  `<script type="importmap">{ "imports": { "@babylonjs/core/": "https://cdn.jsdelivr.net/npm/@babylonjs/core@<version>/" } }</script>`.
  The browser fetches each module the scene reaches, about 700 for a typical scene (HTTP/2 serves them in parallel).
  Or, with `@babylonjs/core` installed beside the package, bundle it yourself:
  `npx esbuild scene.js --bundle --splitting --format=esm --minify --external:node:* --outdir=. --entry-names=[name].bundle --chunk-names=bundle/[name]-[hash]`,
  then import `./scene.bundle.js`. The `node:*` imports are the package's Node path, which a page never runs.

A WebGL 2 page's download, brotli, before `load()` returns (scene.js's imports and the engine's; data is scene.bin, the
IR and images):

| Example | Modules from a CDN | Bundled |
| --- | --- | --- |
| Arrays | 307 requests, 917 KB | 46 requests, 476 KB |
| Rigged Character | 311 requests, 872 KB | 46 requests, 428 KB |
| Carousel | 365 requests, 1697 KB | 56 requests, 1175 KB |
| Volumes | 369 requests, 1013 KB | 62 requests, 492 KB |

The `.babylon` export stays as it is, the snapshot alone.

## Export levels

Every feature can reach the page in more than one form: evaluated or live, keyed or driven, Blender's code or
Babylon's own, or baked into data. The export dialog keeps this to one choice with sensible defaults, one switch, and
overrides for the few who need them. The owner's order of priority decides the defaults: the full range of
functionality first, then performance, then load time.

### One choice: the level

`export_level`, an enum property of the export operator:

| Level | What the page holds | Stays tunable after export |
|---|---|---|
| **Static** | The snapshot: evaluated geometry and instances, animation as exact or sampled keys with drivers, constraints and NLA baked, node materials as CustomBlocks with their values as constants, the compositor as a frame graph. No controller | Babylon's own properties; time |
| **Tunable** | Static, plus the controller, the control table, the scheduler, clean-room driver units, material and compositor inputs as uniforms, and `modifiers.wasm` only when a suggested control feeds a mesh-only stack. No `.blend` | Every bound path and suggested control: transforms, visibility, light, camera and world values, node inputs, custom properties, SDK controls, drivers that read them |
| **Live** | Tunable, plus every computed entity of the IR live: Live Modifiers and Geometry Nodes on their kernels | Every IR property; the first change an entity needs downloads its kernels |

The default is Tunable (owner, 2026-11-09). No level ships the scene's `.blend`: every entity runs on the IR
(Decision 7), and the Include Source .blend option is gone.

### Overrides by feature

Operator properties, as Blender's exporters have them (the glTF exporter's `export_animation_mode`), in a collapsed
sub-panel of the file browser's sidebar. The level sets them all; changing one shows the level as Custom.

| Property | Items | Static | Tunable | Live |
|---|---|---|---|---|
| `export_geometry` | `EVALUATED`, `LIVE` | `EVALUATED` | `EVALUATED` | `LIVE` |
| `export_animation` | `KEYS` (exact or sampled, drivers baked), `LIVE` (drivers and constraints that read a knob run) | `KEYS` | `LIVE` | `LIVE` |
| `export_materials` | `NODES_FUSED` (Blender's GLSL, one block per material), `NODES_PER_NODE` (one block per Blender node), `NATIVE` (PBRMaterial or StandardMaterial through the runtimes' mapping), `BAKED` (textures) | `NODES_FUSED` | `NODES_FUSED` | `NODES_PER_NODE` |
| `export_world` | `NODES_FUSED`, `NODES_PER_NODE`, `NATIVE` (an environment image), `BAKED` (a cube map) | `NODES_FUSED` | `NODES_FUSED` | `NODES_PER_NODE` |
| `export_compositor` | `GRAPH` (Blender's nodes on the frame graph), `NATIVE` (Babylon's post-processes), `NONE` | `GRAPH` | `GRAPH` | `GRAPH` |
| `export_lighting` | `LIVE` (lights and shadows), `PROBES` (reflection probes) | `LIVE` | `LIVE` | `LIVE` |
| `export_simulation` | `CACHE` (per frame in `scene.bin`) | `CACHE` | `CACHE` | `CACHE` |
| `use_license_free` | Boolean | Off | Off | Off |

Items appear only when they exist: `BAKED` materials and worlds, and baked lightmaps, wait for their bakers.

### Node graph granularity

Materials and worlds of Blender's nodes export in one of two forms. The compositor needs no such choice: its graph is
already one block per Blender node, of one generic class.

- **`NODES_FUSED`**: one CustomBlock per material holding all its nodes' code, each unlinked input an InputBlock. The
  smallest form, and what the exporter writes today (with constants for values).
- **`NODES_PER_NODE`**: one CustomBlock per Blender node, its GLSL function made at export by Blender's GPU node
  function, linked as in Blender, its unlinked inputs InputBlocks. The graph reads as Blender's in Babylon's Node
  Material Editor and can be rewired there without Blender. Helpers that several nodes call would be defined twice,
  since Babylon emits a CustomBlock's code once per function name (`nodeMaterialBuildState.js` `_emitFunction`): each
  helper is wrapped in a preprocessor guard named by its hash. If Babylon's shader processor does not keep such guards
  on WebGL 2 and WebGPU (checked in step 3), a generic block class in the blocks library emits each helper once by name;
  that graph opens in Bylonder's editor, not Babylon's public one.

Cost, estimated: a node block serializes to about 0.8 KB besides its code (measured, a Noise Texture block with 9
inputs and 2 outputs), so `NODES_PER_NODE` adds about 1 KB per node uncompressed and a fraction of that gzipped; the
code itself is the same functions in both forms. The shader does the same arithmetic in both: the same functions are
called in the same order and the same uniforms are read, and GLSL compilers inline small functions, so the frame cost
is the same; compiling takes a little longer for the extra function boundaries. The difference is size and
readability, not speed.

### What the dialog states

For each level, estimated from scene statistics (vertex buffers, image bytes, code bodies, key counts) times measured
ratios (gzip), so no trial export is needed to open the dialog:

- the package size, compressed;
- the load time at a stated bandwidth;
- for Live, the download on the first change that needs Blender (the module's size);
- one line of what stays tunable;
- the license: license-free, or the GPL terms that apply and the elements that bring them.

The export's report in the Info editor gives the real numbers after.

## The representation and its implementations

What an export writes is Bylonder's own intermediate representation (owner, 2026-11-09): the bindings, the dependency
table, the node graphs (their types, links and values), the keys and the controls. It is data, MIT, and uses Blender's
identifiers only as names. The GPL attaches only to implementations of units: the code that evaluates a node type, a
modifier, a driver variable or a render feature.

The implementation registry (`src/io_scene_babylon/runtime/implementations.json`) is one table of plain data mapping
each Blender unit (a node type's idname, `modifier:<type>`, `driver:<variable type>`, an evaluator such as `action` or
`transform`) to the implementations a page can run it with, each with its license (`MIT`, `Apache-2.0`,
`GPL-2.0-or-later`, or `data` for a baked result) and fidelity (`exact`, `approximate`, `baked`), and `planned` where it
is not built yet. A key ending in `*` stands for every identifier with that prefix. The license-free check, the export
dialog's license line and the clean-room priority list read from it, and a page is license-free exactly when every unit
it uses resolves to a free implementation or is baked. It is seeded with what exists today; each new implementation adds
a row.

## License-free pages

Babylon.js is Apache-2.0 and Blender is GPL-2.0-or-later. Bylonder's own code is MIT OR Apache-2.0, and GPL only where
the law requires it: code derived from Blender (owner, 2026-11-09). The repository's `LICENSE` and `package.json` still
say GPL-3.0-or-later and need to follow that intent (Doc fixes found).

A page carries the GPL when it ships Blender-derived code: Blender's GLSL (node CustomBlocks, the compositor's pass
block), ported units, the module, or a Bylonder file marked `blender-port` (22 in `src`, among them `render/film.js`,
`draw/volumes.js`, `draw/volume-shaders.js`, `blenkernel/light/light-shadows.js`, `blenkernel/light/area-specular.js`,
`draw/curves.js`, `draw/grease-pencil.js` and the view eye block of `node-material-export.js`). The dialog and the docs
say so (decided). The page runtime (controller, scheduler, loader, the `createScene` template the JavaScript export
writes) is MIT OR Apache-2.0 as long as it stays free of Blender-derived code: it lives in a directory of its own, and a
test fails if anything there is marked `blender-port` or imports something that is. Data that GPL code computes at
export time (an evaluated mesh, sampled keys, a light's converted power, a baked texture) is output, not code, and does
not carry the license.

So:

- **License-free Static** is the JavaScript export without Blender's GLSL, ported units or module, or glTF: written by
  Babylon's own glTF serializer (`@babylonjs/serializers`, Apache-2.0) from the snapshot after each feature takes its
  native or baked route, compressed with `EXT_meshopt_compression`, and loaded by Babylon's own loader, so other engines
  read it too. Babylon's serializer writes node, skin and morph animation, lights (`KHR_lights_punctual`), instancing
  (`EXT_mesh_gpu_instancing`) and native PBR (`KHR_materials_*`). Other property animation needs
  `KHR_animation_pointer`, which Babylon's loader reads but its serializer does not write yet; until it does, the glTF
  form lists those tracks as left out.
- **License-free Tunable** is the page runtime with native or baked features: knobs on transforms, visibility, lights,
  camera, native material values, custom properties and SDK controls stay tunable, and drivers stay live once the
  clean-room driver units pass their tests (Decision 8). Live constraints and modifiers are not, as they need the
  module; they are baked instead.
- **License-free Live cannot exist**: it is Blender's module.

With `use_license_free` on, each feature takes its license-free route, and the dialog names what has none and what it
does instead: native, baked, or left out.

### Audit by feature

| Feature | License-free route | Today |
|---|---|---|
| Meshes, curves and text as meshes, applied modifiers, Geometry Nodes results | Evaluated geometry | Yes |
| Instances | Thin instances, or `EXT_mesh_gpu_instancing` in glTF | Yes, once the export-fixes branch lands |
| Armature deform | Babylon `Skeleton` and skinning (the runtimes' mapping) | Yes |
| Shape keys | `MorphTargetManager`, glTF morph targets | Yes |
| Keyed animation, with drivers, constraints and NLA baked into it | Keys and samples (data) | Yes |
| Live drivers | Clean-room driver units (MIT OR Apache-2.0) | Yes, since step 5; a driver they cannot run stays baked |
| Live constraints | None: the module | No; baked instead |
| Live modifiers and Geometry Nodes | None: the module | No; evaluated instead |
| Principled BSDF materials | `PBRMaterial` (`mainPBR`), glTF PBR | Yes |
| Other node materials | `NATIVE` where the runtimes map it, else `BAKED` textures | Could: needs a texture baker |
| World as an image | Environment texture | Yes |
| World of nodes | `BAKED` cube map | Could: render the world into a cube map |
| Lights, shadows, probes | Babylon's lights, shadow generators and reflection probes | Yes |
| Area light shadows (Bylonder's extension) | Babylon's area light without it | Yes, as an approximation |
| Volumes | None in Babylon | No; left out |
| EEVEE Parity lobes | Babylon's clearcoat without the view eye block | Yes, as with Parity off |
| Film accumulation | Babylon's `TAARenderingPipeline` | Could |
| View transform (AgX, Filmic) | Babylon's tone mapping, an approximation; or the LUT as data if the license of Blender's color management files allows it | Could, once that license is checked |
| Compositor | `NATIVE`: Babylon's post-processes where one matches a node (Blur, bloom for Glare, lens distortion) | Could, for a subset; the rest left out |
| Hair curves | Tube meshes | Could |
| Grease Pencil | Strokes baked to meshes | Could |
| Particles and simulations | Per-frame cache (data), played by Babylon's own animation | Yes |
| Babylon render pipelines (DefaultRenderingPipeline, SSAO2) | Babylon's own | Yes |
| Project SDK code | The project's own license | The author's call |

## Decisions

1. **A small scheduler, not FlowGraph.** Propagation needs Blender's depsgraph order once per tick; FlowGraph is
   push execution with pulled data and KHR_interactivity math, so drivers would need an expression-to-blocks compiler
   and custom blocks for variable types: more glue than it removes. The table is plain data and the scheduler stays
   under 200 lines; FlowGraph interoperates through the property API.
2. **Blender RNA paths for the property API**, on a controller the loader returns (`blend.set`, `get`, `onChanged`,
   `blend.scene`). Blender's identifiers, which the IR keeps as they are. The animation channel registry seeds
   the bindings; SDK store controls are Scene custom properties.
3. **Animation in three exact tiers.** Bezier segments whose handles sit at 1/3 and 2/3 of the key spacing become
   Babylon Hermite keys (`inTangent`, `outTangent`), which Babylon serializes; measured, all 237 Bezier segments of the
   compositor example (Auto Clamped) are such. Other Bezier segments become a per-key `BezierCurveEase`, Babylon's 2D
   cubic Bezier in normalized time, set after `Animation.Parse` because Babylon does not serialize per-key easing (an
   upstream change to Babylon would remove those lines). The rest, and any segment that misses a tolerance against
   Blender's `evaluate_fcurve` at export, are sampled per frame. Never approximated.
4. **Shader and world nodes**: one CustomBlock per material with its code made at export, every unlinked input a named
   InputBlock (its RNA path), so values change without a rebuild in plain Babylon. Image Texture nodes are texture
   inputs, swappable by path. Data Blender's GLSL reads as data (a Color Ramp's stops, a curve's table) is a uniform or
   a small data texture, as the exporter already writes a ramp; a setting that changes code (a Noise type) is
   structural. Materials whose trees share a structure share one code body, deduplicated by its hash. The graph's
   granularity is an option (Node graph granularity): fused by default for Static and Tunable, one block per node for
   Live (owner, 2026-11-09).
5. **Compositor as a NodeRenderGraph** with one generic Blender pass block and recorded plans, in the blocks library. A
   plan that depends on a value (a blur size that changes the pass count) stays as exported.
6. **Fast loads**: the JavaScript module plus `scene.bin`, the raw typed arrays gzipped in the file (fflate at export,
   the platform's `DecompressionStream` in the page and in Node), images as files. Meshopt was planned and dropped on
   measurement: its lossless codecs (bit-equality rules out quantizing and reordering; its triangle codec rotates
   corners, so only its sequence codec is lossless) compress no better than gzip of the raw arrays, and worse with
   Brotli:

   | Geometry | raw | raw, gzip | meshopt, gzip | raw, Brotli | meshopt, Brotli |
   |---|---|---|---|---|---|
   | Compositor example | 9.18 MB | 2.20 MB | 2.65 MB | 1.15 MB | 2.14 MB |
   | Steam Engine | 0.91 MB | 0.24 MB | 0.17 MB | 0.10 MB | 0.13 MB |
   | Rigged Character | 0.27 MB | 0.08 MB | 0.09 MB | 0.05 MB | 0.08 MB |

   An export option, Host Compresses Geometry, writes `scene.bin` uncompressed for a host that serves it with Brotli
   (most CDNs), about half the gzipped size there. Brotli in the file is not possible: `DecompressionStream` has no
   Brotli in Node 22 and most browsers. The compositor example's package is 2.22 MB zipped (`scene.bin` 2.18 MB,
   `scene.js` 2.41 MB, 0.19 MB gzipped), against 35.9 MB of `.babylon`, and loads in 321 ms in Node. Not glTF: it animates any property through
   KHR_animation_pointer, but it cannot hold NodeMaterial or NodeRenderGraph without private extensions, so it would need
   side data anyway, while Babylon's own format plus `scene.bin` keeps one format. glTF stays a possible secondary export
   for other engines, not the controllable one. Lossless; quantization only if measured invisible.
7. **Bylonder's IR drives the page; Blender's code only as atomic kernels** (owner, 2026-11-09; replaces "one fallback
   evaluator, Blender itself"). The scene is described by Bylonder's own IR (`docs/ir.md`) and the page's scheduler
   walks it, resolving each computed entity by type key: a clean unit, else Babylon-native, else a Blender atomic kernel
   (compiled shader code in a graph block, `modifiers.wasm` for one modifier, a Geometry Nodes node kernel), else baked
   (`docs/licence-free-live.md`). Nothing structural comes from Blender at run time. Done: Geometry Nodes run on the IR,
   and the interim `blender` evaluator, its `scene.blend` sidecar and the Include Source .blend option are removed.
8. **Driver math as clean-room units (MIT)** (owner, 2026-11-09): simple expressions, the variables `SINGLE_PROP`,
   `TRANSFORMS`, `LOC_DIFF` and `ROTATION_DIFF` (values and world matrices read through the controller), and a driver's
   own F-curve with its F-modifiers. A separate track builds them: an oracle that records the module's behavior, a spec
   written from it, and an implementer without access to Blender's or Bylonder's Blender-derived source, recorded as
   proof; each unit is fuzz-tested against the module. They live in a folder of their own, which step 5 uses. A driver
   that needs Python stays baked. Auto-ported units (Decision 16) are the fallback only if the clean-room ones
   fall short on robustness.
9. **Geometry Nodes are never mapped to NodeGeometry.** Babylon's NodeGeometry has no face, edge or corner domains and
   no fields over them, so a mapping would approximate. They ship evaluated (instances as thin instances) and are tuned
   through Bylonder's Geometry Nodes evaluator on the IR, its nodes Blender's kernels until units replace them (Decision 7). Bylonder's own Array (Nodes)
   already is NodeGeometry and stays so. A future exact mapping, or an auto-ported subset, needs a fuzz-tested proof
   against the module, not a rule against it.
10. **Particles, simulations and Python handlers are baked** for playback (simulation and particle positions per frame
    in `scene.bin`), not tunable in the page yet.
11. **Every path is settable; the export suggests controls.** No whitelist: `set` takes any RNA path. The export lists
    suggested controls (custom properties, exposed node group and Geometry Nodes inputs, SDK store controls, every
    property a driver reads), which an author can trim. Reason: the API stays Blender's whole data model, while UIs and
    the table stay small.
12. **Three export levels**, Static, Tunable and Live, one enum that sets every feature (Export levels). Tunable is the
    default (owner, 2026-11-09). No level ships the scene's `.blend`.
13. **Overrides as export operator properties**, Blender's exporter idiom, in a collapsed sub-panel; changing one shows
    the level as Custom. `export_materials` and `export_world` include the node graph granularity
    (`NODES_FUSED`, `NODES_PER_NODE`).
14. **Estimates in the dialog** from scene statistics and measured ratios, per level; the report gives the real numbers.
15. **A license-free switch** that routes each feature to its native or baked form and names what has none.
    License-free Static and Tunable exist; Live cannot.
16. **Generated ports may ship in exported pages** (owner, 2026-11-09), as the fallback to clean-room units (Decision
    8), with the owner's order of priority: the full range of functionality first, then performance, then load time. The rule for CLAUDE.md, to be added with the first
    unit: "A generated port may ship in an exported page when it is a pure unit from `port.py` (shims only for data
    access) and has a fuzz test against the module; the app's own list of ports still only shrinks." First units:
    driver expressions, driver variables, F-curve evaluation (Decision 8).
17. **GPL terms are stated** in the export dialog and the docs (owner, 2026-11-09): a page that ships Blender-derived
    code carries the GPL, and the dialog names the elements that bring it.
18. **Bylonder's own code is MIT OR Apache-2.0**, GPL only where Blender-derived (owner, 2026-11-09), so the page
    runtime is permissive while it stays free of Blender-derived code, which a test checks.

## How today's pieces fit

| Piece | Becomes | Reshaping |
|---|---|---|
| `serializeScene`, `exportModule` | The snapshot writer | Geometry, instances and keys to `scene.bin`; JSON keeps structure |
| `bakeAnimations` | The `animation` evaluator's data | Three tiers; Main-evaluated samples for drivers, constraints, NLA |
| `exportNodeMaterial` | Material snapshot and bindings | Uniforms as InputBlocks instead of constants; code dedup; worlds |
| `animatable` channels, `bindings.js` | The bindings | Written as data; the Babylon metadata paths of `liveModifiers` give way to RNA paths |
| `runtimes.js` and its features | The evaluator kinds | `exportOperations(world)` beside `export(world)` |
| `liveModifiers`, `modifiers.wasm`, its worker | The `modifiers` evaluator | Keyed by RNA path; its per-frame JSON comparison of every stack (`modifiers.js:50`) is replaced by the scheduler's dirty set |
| Shader node block classes | Stay in the app | Not shipped; their code is made at export |
| Compositor block classes | The app's; one generic pass block ships | Code and plans made at export |
| `sdk.js` controls | Knobs | Already Scene custom properties; nothing new |
| Generated ports (`*.gen.js`) | Not in pages | Only if the clean-room units fall short (Decision 16) |
| Desktop Blender | A native entry: File > Export > Bylonder Package | A thin add-on: Blender writes the `.blend`, the headless SDK (Node and the module) writes the package; no second mapping in Python |

What not to reuse: the `metadata.bylonderModifiers.stack.<i>.values.<path>` addressing (a second, Babylon-side path
scheme), the polyfill's per-frame stringify of every stack, base64 geometry in source text, and inlined GLSL constants.

## Work order

Each step lands on its own, with its tests, and leaves exports working.

1. **Package and controller.** `scene.bin` gzipped (or raw for a compressing host), images as files, `loadBlendScene`
   returning a controller with `get`, `set`, `onChanged` and `controls` for bound knobs (transforms, visibility, light,
   camera and world values, custom properties, SDK controls).
   Checks: the compositor example's package size and load time in Node; geometry equal to the app's to the bit; `set`
   of a transform path moves the Babylon node as Main's `matrix_world` would; the page runtime's directory carries its
   MIT OR Apache-2.0 notice and a test that nothing in it is Blender-derived.
2. **Animation tiers and Main-evaluated baking.** Checks: every frame of the Steam Engine, NLA and compositor examples
   within 1e-5 of Main for each exported track; the compositor example's key count drops; per-key easing restored after
   Parse.
3. **Node graphs.** Material and world InputBlocks by path, textures by path, data textures, code dedup, both
   granularities. Checks: `set` changes a uniform without a new effect; a scene of many variants of one tree ships one
   code body; a `NODES_PER_NODE` export opens in Babylon's Node Material Editor with Blender's nodes and links and builds
   (helper guards kept on both engines); a browser check of Lava in both forms against the app on WebGL 2 and WebGPU
   (the coordinator's GPU slot).
4. **Compositor and blocks library.** Checks: the compositor example's graph parses with `@babylonjs/core` and
   `bylonder-blocks.js` alone; a simple scene ships no blocks library; a browser comparison with the app.
5. **Dependency table, scheduler and driver units.** Checks: Steam Engine: setting the flywheel's rotation moves the
   crosshead as Main does, at many values; fuzz tests per ported unit against the module; the scheduler under 200 lines.
   Done: `tests/export-drivers-wasm.test.js` (every driven part and an added transform-channel driver at 40 angles, the
   scheduler at 83 lines); the units' fuzz runs against the oracle are in `docs/clean-room/impl/`.
6. **Evaluator loader and the Blender fallback** (interim, Decision 7; retired: Geometry Nodes run on the IR). Checks: the Geometry Nodes example: setting a modifier input by path
   loads the module once and the mesh equals the app's; a page whose knobs are all on fast paths never fetches the module
   or the `.blend` (counted fetches in a Node test).
   Done, then retired: `tests/export-blender-wasm.test.js` now checks the evaluator (fast-path controls run no nodes;
   three input sets draw the app's planet bit for bit and its tree instances; no package ships `scene.blend` or
   `bmesh.wasm`).
7. **`modifiers.wasm` under the evaluator interface.** Checks: `tests/export-live.test.js` on RNA paths, with the same
   results.
   Done: modifier settings are controls by RNA path with one `modifiers` operation per live object
   (`modifiers-export.js`), its base Mesh in `scene.bin`; `runtime/modifiers-evaluator.js` runs it in the worker when a
   setting is set, and the animation sets keyed settings through channels of their node (`metadata.bylonderChannels`),
   so a frame marks a stack only when a value changes. The per-frame comparison, `metadata.bylonderModifiers` and the
   base64 geometry are gone.
8. **Headless SDK.** The controller in Node without a page. Exporting headless needs image pixels Node has no GPU for:
   the exporter asks the module, which decodes images with Blender's own readers (`tests/images-wasm.test.js`); today a
   Node-side export writes an Image Texture's name, not its file. Checks: a script sets paths and reads the evaluated
   mesh and transforms, matching the app; a headless export of the Framed Print writes its images.

   Built: a package loads in Node (Use it from Node, above). An export writes each image from Blender's data, never a
   GPU read-back, so the app and Node write the same files (`imbuf/image-textures.js` `imageFile`): an unchanged image
   whose file Blender holds (packed, or in the module's file system) in a format browsers load (PNG, JPEG, WebP) ships
   that file as it is; any other (generated, painted, OpenEXR, Radiance HDR) ships as a PNG of its buffer, a float one
   straight at 8 bits, so high dynamic range is lost. With the Framed Print's two images saved as JPEG, its package
   is 0.73 MB, 2.11 MB when they were PNGs of their pixels.
9. **Blender add-on.** A thin desktop add-on, File > Export > Bylonder Package, that saves the `.blend` and runs the
   same exporter headless through the headless SDK (Node and the module). One exporter, a native entry for Blender
   users, and no second mapping in Python. Checks: the add-on's package of an example equals the app's.
10. **Capability groups and threads**, when dynamic linking and isolation land. Checks: a Geometry Nodes tune fetches
   `core` and `geometry-nodes` only; a threaded evaluation in an isolated page matches the single-threaded one.

The export levels land with the steps they need: `export_level` and the overrides with step 1 (Static and Tunable as
far as built), Live with step 6, and each feature's items as their routes exist.

11. **License-free Static as glTF.** `use_license_free`, the native routes, Babylon's glTF serializer and
    `EXT_meshopt_compression`, and the dialog's license line. Checks: the exported glTF of each example loads with
    Babylon's loader alone; a scan of the written files finds no Blender GLSL and no Bylonder code; the dialog names each
    element left out or approximated.
12. **Estimates in the dialog.** Checks: each level's estimate within 25% of the size the export then reports, on the
    examples.

## Risks

- **Mapping split.** `main-view.js` imports overlays and editor drawing; separating the part that pulls Main's results
  into Babylon objects is the largest reshaping, and it must not change the app.
- **Export-time order.** The dependency table is Main's order for the exposed knobs only; a relation through an
  unexposed ID must still be followed when the table is made.
- **Ported unit drift.** Ports must be regenerated with each Blender update; the fuzz tests are what keep them honest.
- **First-tune latency.** Seconds and about 20 MB until dynamic linking; pages should say so while it loads.
- **WebGPU.** CustomBlock GLSL depends on Babylon's GLSL to WGSL conversion; each step's browser check covers both.

## Doc fixes found

- `blender-boundary.md`, Animation: "Driver values do not reach Babylon's objects yet" is stale; they reach them through
  Main's evaluated matrices (`main-view.js` `drawEvaluated`). Exports are what miss them.
- `blender-boundary.md`, Modifier kernels polyfill: `bmesh.wasm` is 86.7 MB, 24.5 MB gzipped now, not 59.2 MB and
  16.5 MB.
- `LICENSE` and `package.json` say GPL-3.0-or-later; the owner's intent is MIT OR Apache-2.0 for Bylonder's own code,
  GPL only where Blender-derived.

## Open questions

None: the owner has decided each one (decisions 12, 16, 17 and 18).
