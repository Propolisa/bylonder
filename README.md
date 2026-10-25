# Babylon scene starter

Full-viewport Babylon.js workspace with modular reactive systems, generated Tweakpane controls, transform tools and browser-local persistence. MIT licensed. Dependencies are pinned; Inspector is loaded on demand.

## Develop / fork

Node 20+: `npm ci`, `npm run dev`, `npm test`, `npm run build`. Serve `dist/` on any static host. No backend, remote fonts or credentials are needed at runtime. To fork, copy source, remove `.openai/hosting.json` (the original Site identity), rename the package and register a new Site if using Sites hosting.

## Examples and deployment

File → New from Example (or the splash screen shown on first visit) creates a project from one of the bundled demos in `src/workspace/examples.js`.

`.github/workflows/pages.yml` tests, builds with a relative base (`BASE_PATH=./`) and deploys `dist/` to GitHub Pages on every push to `main`. Enable it under Settings → Pages → Source: GitHub Actions. Any sub-path works; the service worker scope follows the deployed directory.

## Controls

| Action                             | Input                                                  |
| ---------------------------------- | ------------------------------------------------------ |
| Select / deselect                  | Click object; click selected object again to remove it |
| Multi-select                       | Shift-click objects or scene rows                      |
| Clear selection                    | Click empty viewport                                   |
| Group / ungroup                    | Ctrl G / Ctrl Alt G, or scene panel buttons            |
| Orbit / pan / zoom                 | MMB / Shift MMB / wheel                                |
| Front / right / top                | Numpad 1 / 3 / 7 (number row also works)               |
| Opposite view                      | Ctrl + view key                                        |
| Perspective / orthographic         | Numpad 5                                               |
| Frame selection                    | F or numpad decimal                                    |
| Modal move / rotate / scale        | G / R / S                                              |
| World-axis constraint              | X / Y / Z during transform                             |
| Precision / snapping               | Hold Shift / Ctrl                                      |
| Reposition without applying motion | Hold Alt; release to start another sweep               |
| Confirm / cancel                   | Enter or left-click / Escape or right-click            |
| Undo / redo                        | Ctrl Z / Ctrl Shift Z                                  |
| Babylon Inspector                  | Ctrl Shift I or Inspector button                       |

No selection is active initially. Selected meshes show an orange outline. Clicking a mesh in a group selects its outermost group; the hierarchy list can select individual children. Grouping creates native Babylon `TransformNode` parents and preserves child world transforms. Ungrouping reparents children without recursively disposing them. Groups can nest.

Modal movement uses the camera plane by default. Scaling is the ratio of current to initial distance from the projected selection pivot; it works in every screen direction. Rotation accumulates signed pointer angle around that pivot, about the camera forward axis, allowing multiple turns. Axis constraints replace the default frame. Pointer lock requests relative input for modal transforms and MMB navigation so the physical screen edge does not stop a gesture. A virtual cursor wraps visually while transform coordinates remain unbounded. Hold Alt to reposition/rebase for additional sweeps without committing; the entire operation still cancels/undoes as one transaction. A small pivot dead zone avoids division by zero. Shift reduces incremental motion; Ctrl snaps translation to 0.1 units, rotation to 15 degrees, and scale factor to 0.1.

Browsers may deny pointer lock (including restricted embeds). The app reports this and falls back to ordinary mouse movement; Alt reposition remains available. Escape/lost pointer lock/window blur cancels the transform. Toolbar gizmos use Babylon's direct manipulation rather than the modal pointer-lock gesture path. Text inputs suppress scene shortcuts. Touch navigation delegates to Babylon.

## Selection and transforms

`selection.js` owns stable selection IDs, outlines, native groups and a transient `TransformNode` pivot. Multi-selection filters parent/child duplicates. The pivot's world delta is applied to selected root nodes and converted back to local space. It is never serialized. Gizmos, numeric fields and modal operations share this transform path. Babylon uses TRS decomposition; arbitrary shear from rotated non-uniform parent scaling is not supported. Grouping is organizational, not mesh merging or geometry editing.

`storage.js` persists versioned node transforms and parent IDs, including groups. Version 1 flat snapshots migrate when read. Remember transforms is off by default. Enabling writes current and subsequent committed changes. Disabling/forgetting removes the saved snapshot without changing the current scene. Camera and system parameters remain session-only. Undo/redo covers 100 committed transform/group states; Inspector edits are direct advanced edits outside that history. Mesh names must be unique and stable; change the storage key for independently deployed projects.

## Reactive systems

`systems.js` composes independent definitions `{id,title,schema,connect}`. Each instance owns a store, subscriptions and cleanup. Display, lighting and geometry are separate example systems. `config.js` defines defaults, labels, ranges and options. `ui.js` generates a section per system. `effects.js` connects explicit dependencies to Babylon objects via injected context.

```js
const materialDefinition = {
  id: "material",
  title: "Material",
  schema: {
    roughness: { default: 0.4, min: 0, max: 1, step: 0.01, label: "Roughness" },
  },
  connect(store, { material }) {
    return store.effect(["roughness"], (values) => {
      material.roughness = values.roughness;
    });
  },
};
// createSystem(materialDefinition, { material }, onError)
// Register the instance alongside the other systems for automatic UI generation.
systems.find((s) => s.id === "lighting").store.set("key", 1.5);
```

Store effects run initially and then coalesce once per animation frame by default. Modes: `immediate`, `frame`, `debounce` (with `delay`), or `manual` (explicit flush). `onStale(key)` notifies invalidation. `store.invalidate(key)` forces dependent effects stale; omit key for all. `store.stale` reports pending work. `store.flush()` cancels schedules and applies latest values. An effect may return cleanup; the framework calls it before the next execution and on disposal. Effects are synchronous; use AbortController or generation tokens for async jobs. The geometry example debounces sphere tessellation by 150ms and preserves mesh identity.

`store.set` validates scalar types, finite numbers, ranges and options; schemas may add `validate(value)`. UI and programmatic edits use the same path. Never directly mutate `store.values`. Each store is independent; repeat keys across stores or instantiate the same definition with distinct IDs and dependencies. Cross-system dependencies should be explicit subscriptions with cleanup.

## Module map

- `scene.js`: engine, sample meshes, lights and ground.
- `store.js`, `config.js`, `systems.js`, `effects.js`: reactive configuration.
- `mouse-capture.js`: pointer-lock lifecycle and fallback.
- `gesture-math.js`: radial scale, unwrapped angle and cursor wrapping math.
- `navigation.js`: projection, view presets and camera input.
- `selection.js`: outlines, multi-selection, group hierarchy and pivot transforms.
- `editor.js`: modal transactions, constraints, gizmos and picking.
- `storage.js`: snapshots, persistence and history.
- `ui.js`: generated parameters, hierarchy and numeric transforms.
- `main.js`: composition, commands, Inspector, render loop and cleanup.

Tests cover store isolation/scheduling, gesture math, relative-input lifecycle, native grouping, multi-object transforms, undo and persistence reconstruction via Babylon's NullEngine. They do not replace browser/WebGL interaction tests. The development preview service was unavailable in the build environment, so browser interaction remains unverified.

## Browser project workspace

The hosted entry is now a Monaco project editor. `viewport.html` runs each project in a fresh same-origin iframe. The initial `index.js` exactly follows the supplied sphere/ground scene and cannot be deleted or renamed. OPFS stores SHA-256-addressed file bodies and immutable version manifests; HEAD advances only after successful writes. Autosave, named checkpoints, snapshot diff/restore, ZIP import/export, multiple projects, and conflict detection are in `src/workspace/`. Browser storage remains local, with an optional durable-storage request.

`workspace-sw.js` serves per-run immutable module URLs from Cache Storage. This preserves native relative/dynamic imports, cycles, asset URLs and remote HTTPS ESM imports. TS/JSX use esbuild-wasm; bare imports use `importmap.json`. Node/CommonJS modules require browser-compatible ESM builds. External modules must allow CORS. The cache is only delivery infrastructure; OPFS is the source of truth.

Monaco includes all 2,125 pinned Babylon declaration files, typed SDK globals, local module models and remote type acquisition (declaration headers, sibling declarations, recursive dependencies and JavaScript inference). `types.json` maps any import string to an explicit local/remote declaration source. Types that are unpublished or inaccessible cannot be synthesized precisely; unresolved sources are reported in the Types panel.

`workbench.controls({id,title,schema,connect})` creates an independent reactive store and generated UI section. `workbench.editable`, `asset`, and `onDispose` complete the SDK. See the project's generated README and examples/controls.js. Edit mode uses the Blender-style camera; Scene mode restores the camera created by user code. Remember scene edits persists transform/group overrides and control values in project snapshots, separately from source files.

## Object-mode tools

Shift+A opens the mesh menu. A temporary Tweakpane panel edits creation arguments live; Apply creates one undo step, Cancel restores the previous scene. F9 reopens the last creation settings until another edit. Twelve curated presets use arguments reflected at build time from Babylon's installed TypeScript declarations (`scripts/mesh-schema.mjs`). Complex callback/vector-array builders remain code APIs.

```js
workbench.meshTools({
  include: ['box', 'sphere', 'cylinder'],
  defaults: { box: { width: 3 }, sphere: { segments: 24 } },
  fields: { box: { size: { default: 2, min: 0.1, max: 10, step: 0.1 } } }
});
```

Call this during createScene. `workbench.meshBuilders` exposes the reflected parameter catalog. New numeric/boolean/string field subsets are validated against the actual builder signature. Avoid combining size and axis overrides unless intended; Babylon's axis-specific options take precedence.

Object actions live in one registry (`src/objects/object-actions.js`), shared by keyboard shortcuts and the same context-menu renderer for viewport and outliner. Shift+D duplicates with independent geometry, then starts Move; cancelling Move keeps the duplicate. X/Delete removes selection, F2 renames, A/Alt+A/Ctrl+I selects/deselects/inverts, H/Shift+H/Alt+H controls visibility, / isolates, Alt+G/R/S resets transforms, Ctrl+P parents to the active object, and Alt+P unparents. Native groups remain available.

The outliner supports hierarchy expansion, search/type filters, range/additive selection, visibility, selection locks, drag parenting, drop-to-root unparenting and camera/light inspection. Unsupported object operations are disabled. This is an object-mode subset, not Blender's mesh-editing/modifier/animation stack.

Stable IDs separate object identity from display names. History and project overrides store primitive recipes or duplicate vertex data plus hierarchy, visibility, locks and deletion tombstones. Deleted authored nodes are disabled rather than disposed so user-code references remain valid. Duplicates share material resources; rig/skeleton independence is not implemented. Turn on Remember scene edits to preserve interactive additions/deletions across Run and reload.

## Text

Shift+A → Text creates real extruded glyph outlines. Tab or the shared right-click **Edit Text** command edits the selected text. The font field searches the Google Fonts catalogue and accepts any family name; the preview uses the same downloaded font as the geometry. Weight, italic, size, depth, spacing, line height, alignment and curve resolution share `textSchema`. Unsupported styles report an error. Color-only glyphs cannot be extruded; outline fonts render as monochrome meshes. Text is capped at 2,000 characters per object.

Apply commits one undo step; Cancel restores the previous geometry. Saved overrides include baked geometry and text settings, so restoration does not need the font network request. Font requests use Google Fonts CSS2 and CacheStorage; the searchable catalogue comes from Fontsource. First use requires network access. Font loading uses Fontkit (WOFF2, TrueType and OpenType); Babylon PolygonMeshBuilder and Earcut preserve glyph holes.

```js
import { createText, updateText, textSchema, controls } from '@workbench/sdk';
const label = await createText('Label', {text: 'Hello', family: 'Inter'}, scene);
controls({id: 'label', schema: textSchema, connect(store) {
  return store.effect(Object.keys(textSchema), values => {
    updateText(label, values).catch(console.error);
  }, {mode: 'debounce', delay: 250});
}});
```

`updateText` discards stale asynchronous results. Use a subset of `textSchema` for smaller UI sections. Text meshes retain normal Babylon materials, parenting and transform behavior.

## Application source

**↓ App source** at the top right downloads the complete unminified application source for the deployed build, including its lockfile, tests and build scripts. Run `npm ci` then `npm run dev`; `npm run build` regenerates the ZIP from tracked and nonignored source files. Dependencies, Git metadata and hosting credentials are excluded. **Export ZIP** separately exports the current in-browser scene project.

## Layout and mobile input

Vue 3 and [Splitpanes](https://antoniandre.github.io/splitpanes/) own the workspace and viewport layouts. Drag splitters to resize; each section selector swaps its contents with another section. Collapse, maximize, restore, change split directions, or reset from **Layout**. On touch screens the Layout menu exposes those same controls without using space for a second title bar. Layout profiles are saved by default in localStorage, independently of projects, for desktop, portrait and landscape. Disable **Remember layout** to stop persistence. Resetting the outer workspace also resets the inner viewport layout.

Portrait defaults to the scene with section tabs; landscape shows code beside the scene. The viewport has separate Objects and Properties sections. Pane contents remain in stable DOM hosts, so swaps and layout changes do not reload the iframe, scene or Monaco models. Splitpanes handles mouse, touch and keyboard resizing.

Touch viewport controls:

- Tap selects/toggles; **Multi** makes selection additive. Double-tap frames an object.
- Long-press in the viewport or object tree opens the same object-action registry. **Actions** opens it without a long-press.
- One finger orbits in Select mode. Move/Rotate/Scale tools transform the current selection with the same screen-space math as desktop. Lift to commit; repeated strokes extend a transformation. OS cancellation rolls back the active stroke.
- Two fingers pan and pinch to zoom without selecting objects. Switching from a transform to two fingers commits that stroke and navigates.
- X/Y/Z, Snap, Fine, Apply, Cancel, Undo and Redo are touch buttons. Parenting, grouping, duplication, visibility, text editing and other commands are available through Actions. Numeric transforms and generated scene controls are in Properties.
- The code toolbar exposes undo, redo, indentation, suggestions, find and format without modifier keys. Project/file operations remain available through the top menu and Files section.

`src/input/touch-session.js` recognizes tap, drag, hold, pinch transitions and cancellation. `viewport-touch.js` dispatches those gestures to the existing editor/navigation operations; it does not maintain a second transform implementation. The authored camera still controls input in Scene mode.

## Share links and resolution

**Share** encodes the current project files/assets into a compressed URL fragment. Current transforms, created objects and control-store values are included by default, even when Remember scene edits is off; uncheck the option to share source only. Finish pending creation/transform operations before sharing. Links contain a snapshot, not history. Opening one offers a new local copy and does not automatically run the sender's JavaScript. The fragment is not uploaded as a project by this app; anyone possessing the link can read its contents. Links are limited to 128 KB and decoded projects to 8 MB; for larger projects or messaging apps that truncate URLs, use project ZIP export/import.

**⋯ → Render resolution** controls Babylon's hardware scaling ratio for all projects on this device. Native resolution (`1 / devicePixelRatio`) is the default. Custom ratios range from 0.25 to 4: lower is sharper and more expensive, 1 is CSS-pixel resolution, 2 is half resolution. Render settings and layouts are device preferences and are not included in share links.

## Animation

Timeline is a dockable pane. Select objects and press **I** to key Location / Rotation / Scale. Each property also has a diamond; hover and press **I** to insert or **Alt-I** to delete. Right-click a property for keying and its stable data path. Yellow means keyed here, green animated elsewhere, orange modified from the evaluated curve. Axes use red / green / blue. The red record toggle auto-keys changed transforms; other properties are keyed explicitly, as in Blender.

**Space** plays/pauses. Drag the ruler to scrub. Click diamonds to select, Shift-click to extend, drag to move, Alt-drag to duplicate, and X/Delete to remove. Timeline's menu provides the same actions for touch, frame range, FPS, interpolation, pan and zoom. Shift-D duplicates selected keys using the menu's frame offset. Each curve uses Babylon `Animation`; numeric curves support auto-clamped cubic tangents, linear, or constant interpolation. Boolean/string/enum channels use constant interpolation. This is a keyframe editor, not a full Blender Graph Editor, NLA editor, constraint or driver implementation.

Every `workbench.controls` scalar property is automatically addressable and keyable (`animatable:false` opts out). Playback writes through `store.set`, preserving validation, effects, and scheduling. Choose immediate or frame effects for responsive motion; debounce/manual scheduling remains intentional. Geometry construction dialogs and application preferences are not animation channels. Expensive geometry/text changes can be exposed through a controls store with an explicit effect and scheduling policy.

```js
const lightControls = workbench.controls({
  id: 'lighting',
  schema: { intensity: { default: 0.7, min: 0, max: 2 } },
  connect: store => store.effect(['intensity'], values => {
    light.intensity = values.intensity;
  }, { mode: 'immediate' })
});
workbench.animation.insert(lightControls.ref('intensity'), 1, 0.2);
workbench.animation.insert(lightControls.ref('intensity'), 48, 1.5);
```

For direct Babylon properties, one declaration generates the UI and channels. Vector/color properties expand into independently addressable scalar components:

```js
const lighting = workbench.animate(light, {
  id: 'key-light', title: 'Key light',
  properties: { intensity: { min: 0, max: 4 }, diffuse: {} }
});
workbench.animation.insert(lighting.ref('intensity'), 1, 0.5);
workbench.animation.insert(lighting.ref('intensity'), 48, 2);
```

Addresses are `animation.ref(stableTargetId, propertyPath)` (an encoded pair, avoiding delimiter ambiguity). Editable transforms use `object:<stable wbId>` plus `position.x`, `rotation.y`, `scaling.z`; controls use `store:<id>` plus the schema key. Rotation curve values are radians; the UI displays degrees. Renames retain object identities. Deleted or missing targets retain their curves as unresolved channels.

Animation actions are project data: autosaved, versioned, undoable, forked, zipped and shared even when transform overrides are excluded. Objects created only as optional overrides still require those overrides to resolve their animation targets. Runtime `animation.toAnimationGroup(scene)` returns a native Babylon AnimationGroup with live property adapters; pause the editor transport before starting it and dispose the group when done. The group is a runtime adapter, not a standalone serialization of custom store effects.

## Properties and modifiers

Properties follows Blender's Object / Modifiers / Scene context structure. Add an array from **Modifiers → Add Modifier → Generate → Array**, or the object context menu. The modifier stack is independent of the original mesh, animatable, undoable, and retained with **Remember Scene Edits**. `Apply` writes evaluated geometry to the source; removing a modifier restores the input geometry.

```js
workbench.addModifier(sphere, 'ARRAY', {
  count: 5,
  'offset.x': 1.2,
  realizeInstances: false
});

workbench.curve(pathObject, BABYLON.Curve3.CreateCatmullRomSpline(points, 32));
workbench.addModifier(sphere, 'ARRAY', {
  shape: 'Curve', curveObject: pathObject.metadata?.wbId || pathObject.name, count: 12
});
```

Use stable `workbench.editable(node, { id })` identities for referenced objects. Curve points are local-space evaluated samples; they can be updated by calling `workbench.curve` again. Modifiers expose scalar addresses as `animation.ref('modifier:'+objectId+':'+modifier.id, propertyPath)` where `objectId` is the object's stable `wbId` (without the `object:` prefix).

New modifier modules register a schema and evaluator with `registerModifier`; new Properties contexts/panels register with `registerPropertiesContext` / `registerPropertiesPanel`. Both code and UI use the same modifier values. `src/properties/primitives.js` provides panels, subpanels and field rows. `src/layout/dock.js` provides editor factories with persistent area instances. Babylon Node Geometry handles generated topology; thin instances avoid realizing geometry until requested.

See [interface assessment](docs/blender-interface-assessment.md) for reference coverage, architectural decisions and explicit Blender compatibility limits. Blender SVG icons are distributed under their upstream terms in `public/icons/blender/`.
