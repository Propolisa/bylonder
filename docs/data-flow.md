# Data flow

How an edit, undo or redo in the app reaches the preview and an open exported page, and how each layer learns that
what it holds is stale. The live loop (an edit seen within a frame or two, without a reload) is built on these rules.

## From .blend to the game views

Five hops, each with one writer. Views into the WASM module's memory are borrowed for one call and never kept: a call
that grows the memory detaches them (`src/bmesh/bmesh-wasm.js` `floatsView`); what is kept is copied out (`meshData`).

| Hop | Copied, referenced | Owner, single writer | Stale when, detected by | Code |
| --- | --- | --- | --- | --- |
| 1. .blend file into Main | The file's bytes are copied into the module and read into Main; nothing refers back to the file | Blender's file reader, once | The file changes on disk: not watched, opened again | `main-sync.js` `readBlend`, `bmesh-wasm.js` `readBlend`, `sdk.js` `openBlend` |
| 2. Main, then the depsgraph's evaluated copies | Evaluated copies are Blender's own copies of Main's IDs | Blender's code (operators, RNA setters, undo steps); the depsgraph for evaluated data | An RNA update, undo or frame change tags IDs (`ID_RECALC_*`) | Blender's code in the module |
| 3. The editor's Babylon scene (3D View) | Values and evaluated geometry copied out of the module into Babylon objects, linked by `bylonder_id` | `main-view.js` after Blender's code ran; the exception is `main-sync.js` `flush`, which writes Babylon-side edits back into Main before Blender's code runs (undo steps, commits, saves) | Update tags after `run()`, `view()` or `undoLoad`; hooks on Babylon's setters mark what `flush` writes | `main-view.js` `createMainView`, `main-sync.js` `flush` |
| 4. IR and package | Copied into JSON (`scene.ir.json`, scene.js tables) and `scene.bin` arrays named by their content; a scoped export copies the selected objects only | The exporter | A tagged ID marks its entries; an entry whose hash is unchanged is not sent; the package's version is the hash of its tables | `ir-export.js` `exportIR`, `js-export.js` `exportPackage`, `scene-patch.js` `tablesPatch` |
| 5. The game views' scenes (runs) | Package data read once per version and referenced by every run (`sharedPackage`, `sharedIR`); in the app, the export's own IR and arrays, frozen; static vertex streams uploaded once per engine (`sharedGeometry`); each run copies into its own Babylon objects and live buffers | Each run's table loader and controls; the cache for shared data, which no run writes | A patch names its base version: a mismatch or a failure loads the run again (Reset does the same); an edit brings arrays of new names, never a write into shared ones | `runtime/shared-resources.js`, `runtime/scene-tables.js` `sceneTables`, `runtime/blend-scene.js` `patch` |

What flows, from Snow's package (Character Controller demo; scene.bin 9.5 MB gzipped, scene.ir.json 11.6 MB), with
the Bar Scene and the Noodle Shop street for scale. Static: authored, unchanged while a run plays. Baked: computed at
export from evaluated data. Live: changes per frame or per run.

| Kind | Snow (others) | Class | Package as | Across runs |
| --- | --- | --- | --- | --- |
| Vertex streams | 71 meshes; position, normal, UV, colors, tangents 6.5 MB (Bar 177, street 146 meshes) | Static, or baked with modifiers applied | `GEOMETRIES`, scene.bin | Shared on the GPU and the CPU |
| Index buffers | 0.5 MB | Static | scene.bin | CPU arrays shared, GPU buffer per run |
| Skin weights | 0.75 MB | Static | scene.bin | Shared |
| CPU-deformed positions and normals | 36 streams per run (body, head, eyes, clothes) | Live | Made at run time from rest data | Per run, updated in place |
| Shape keys | 6 targets, 1.9 MB (Bar 50 keys, 18.5 MB) | Static targets, live weights | `MORPH_TARGETS`, scene.bin | Arrays shared; Babylon's morph texture per run |
| Skeletons and bones | 2 skeletons, 2799 and 91 bones; table 2 MB | Static rest, live pose | `SKELETONS` | Table shared (module); bone matrices per run |
| Rig solve data | 1 `constraints` entity, 4825 arrays, 34 MB | Baked | IR entity, scene.bin | Arrays shared; the rig's state per run |
| Actions and clips | 51 actions, 24 groups, 0.3 MB tracks plus 3.2 MB in the IR (Bar 22.6 MB, street 9.5 MB of tracks) | Static or baked; play state live | `ANIMATION_GROUPS`, `ANIMATIONS`, scene.bin | Arrays shared; animation groups per run |
| Materials and node trees | 26 materials, table 0.8 MB (street 130, 2 MB) | Static; control values live | `MATERIALS`, IR graphs | Effects shared by the engine; materials per run |
| Images | 42 files, 12.9 MB | Static | `images/` | Shared by URL in the engine's texture cache |
| Drivers and constraints | 366 drivers, 1 rig solve (Bar 45 drivers, 12 modifiers) | Static definitions, live outputs | IR entities | Definitions shared; outputs per run |
| Custom properties and controls | 7826 properties, 2 MB | Static defaults, live values | IR properties | Defaults shared; values per run |
| Lights | 4 lights, 3 shadow generators (street 16) | Static | `LIGHTS`, `SHADOW_GENERATORS` | Per run, shadow maps too |
| World and probes | 1 world, no probes | Static | IR, `SCENE` | Per run |
| Sounds | 1 file, 0.2 MB | Static | `sounds/` | Fetched by URL, decoded per run |
| Particles, instances | 6 thin-instance sets (street 5 particle settings) | Static matrices; particles live | scene.bin, `PARTICLE_SYSTEMS` | Matrices per run (Babylon owns them) |
| The IR itself | 11.6 MB JSON: IDs 6.8 MB, properties 2 MB, entities 1.6 MB | Static | `scene.ir.json` | Read, validated and frozen once per version; in the app, the export's object, frozen, never read again |

In the app, the Game area runs the package in-process (`space_game/game-run.js`), on an engine of its own made by
scene.js's createEngine, so Babylon's per-engine state (effects, input, size) stays the app's or the game's; the app's
Babylon-wide extensions (material plugins, prototype overrides) skip a game's scenes (`runtime/app-scene.js`
`isAppScene`). A full export's scene.js is linked to
the app's own modules (`space_game/package-link.js`, by `runtime-files.js` `appSource`, the table packaging copies from),
so Babylon and the page runtime are the app's, one of each by construction, and an import it cannot map throws. The
run is given the export's IR and arrays by reference, frozen (`sharedPackage`), with no JSON, parse or schema; an edit's
patch reaches it as the new version's entries. The schema (`readSceneIR`, `readPatch`) runs only where data comes from
outside: a package's files and the Package View's messages. A patch the run does not take, or one that asks to load the
package again, drops the run and loads it fresh at the live version; the header says so. Next step: scene.js becomes
imports plus data, its template body a runtime module, and the linker goes away.

Large and per run today: Babylon's morph target textures (18.5 MB of targets in the Bar Scene), animation groups
built from the shared tracks, and the rig's state built from its 34 MB of arrays. Every kind fits the three classes;
shape keys and skeletons hold static data and live weights or poses side by side.

## Layers

| Layer | Holds, keyed by | Sole writer | Derived from | Learns it is stale |
| --- | --- | --- | --- | --- |
| Blender Main | Datablocks, by ID (`OB:Cube`) | Blender's code: operators, RNA setters, undo steps loaded (`main-sync.js` `flush` writes Babylon-side edits through RNA) | Nothing: the source of authoring data | Never stale |
| Evaluated data | Each ID's evaluated copy (meshes, matrices, poses), by ID | Blender's depsgraph | Main | Depsgraph update tags (`ID_RECALC_*`) set by RNA updates, memfile undo (IDs it read again) and frame changes |
| IR | `ids`, `properties` (RNA path), `graphs`, `entities` (`<id>/<kind>/<name>`), `references` | The exporter (`ir-export.js`) | Main and evaluated data | The datablock index: a tagged ID marks the IR entries built from it |
| Package tables and buffers | Tables of entries by datablock key (`runtime/scene-tables.js`), buffers by content hash | The exporter (`scene-tables.js`, `js-export.js`) | The IR, evaluated data, Babylon's serialization | The same index; an entry whose content hash is unchanged is not sent |
| Scheduler and bindings | Control values by RNA path; entity outputs by entity key | The scheduler (`runtime/scheduler.js`); `blend.set` is its only input | Control values, entity inputs, the frame | A set control or a replaced entity marks its readers |
| Babylon objects | Meshes, materials, skeletons, animation groups, by table and key | Per property, one of: the table loader (`runtime/scene-tables.js`) or the binding of a control (`runtime/blend-scene.js`) | Package tables, control values, entity outputs | A patch naming the key |
| Characters | Each character's layers, whose sources name actions by key, its clocks, movement and play state (`docs/character-animation.md`) | The character runtime (`runtime/character/`) | Its skeleton and the actions' animation groups, by key | A replaced action is a new source for the layers playing it: an inertialized switch, clock and play state kept |
| Rig solve | The rig's constraints as the solver holds them (step 6 of a character's frame) | The native rig runtime (`runtime/native-solve.js`) | The `constraints:POSE` entity's inputs | A replaced entity: the scheduler reruns it |

In the app, Main is shown by the view (`main-view.js`), which reads only evaluated data and update tags. In a page,
the package tables stand in for Main.

## Invariants

Each is checked by code; the column names where.

| Invariant | Rule | Enforced by |
| --- | --- | --- |
| One source of truth | Main is the source for authoring data, the scheduler for run-time controls. Derived data is rebuilt from its source, never edited | Tables and IR are frozen after load; only the loader replaces an entry |
| Immutable content | An entry is named by its key and the hash of its content; equal hashes are equal entries. Buffers are files named by hash | The exporter computes the hash; the loader skips an entry whose hash it holds |
| Atomic, versioned patches | A patch is `{ base, version, tables: { table: { key: entry or null } } }`. A package's version is the hash of its tables' sorted `[table, key, entry hash]` list; `base` is the version the patch applies to and `version` the one it makes. It applies only to `base`; all its entries are made before any is swapped in; any failure keeps the old scene. A base mismatch or a failure reloads the whole package, never a partial state. A full export is the patch from the empty package's version | The loader's `apply` |
| One writer per Babylon property | Each property of a Babylon object has one writer: the loader or a binding. A property a binding owns is set again from the control's current value right after its object is swapped, within the same apply | The loader's `apply` calls the bindings of the keys it swapped before it returns |
| Dependency closure | The exporter sends every table entry whose inputs changed, found by the datablock index and the IR's `references`. Entity outputs are not sent: the scheduler runs again each replaced entity and what reads it | Exporter: index closure, tested per table. Page: the scheduler's `mark` |
| References valid on apply | No entry may name a key, unique id or buffer the scene will not hold after the patch | The loader checks every reference before swapping |
| One schema per table | Each table has a Zod schema (as `runtime/ir.js` has for the IR) that validates, fills defaults and repairs on read; every repair is logged with its path, none is silent | `readTables`, beside `readIR` |
| Undo and redo are changes | An undo step loaded is an edit like any other: its update tags drive the same export and the same patch. It changes authoring data only | No undo path exists outside the update tags |
| Run-time state survives | A patch never resets control values, the playhead or playing clips, unless the control's property is gone | The scheduler keeps its values by path across patches |
| No authoring copies at run time | Characters and the rig solve read skeletons, entities and groups through the tables by key; an action swap is a new source for the layers playing it, not a copy | They hold keys, not entries |
| Route corrections are patches | A check that fails after the package is written (a rig run live that misses Main) sends an ordinary patch switching that entry to the route the check picks (skinned or baked), with its report. File > Export waits for them, so the package it writes is final | The checks emit patches through the same exporter path |

## Closure per table

| Table | Datablocks it reads | Closure |
| --- | --- | --- |
| `materials` | Its Material or World, their node trees, images | Exporter |
| `geometries` | The object, its Mesh, modifiers, shape keys | Exporter |
| `nodes`, `lights`, `cameras` | The object and its data, its parent | Exporter |
| `skeletons`, `morphTargets` | The armature and its bones; the Key | Exporter |
| `animationGroups` | The actions and NLA strips of each ID they animate, drivers and constraints baked into them | Exporter |
| IR `entities` | Their inputs by reference | Exporter sends the entity; the scheduler reruns it and its readers |
| IR `properties` | Their ID | Exporter; the page keeps the value a page set |
| Buffers | Their entry | By content hash: sent only when new |

## Built

The exporter writes the tables (`scene-tables.js`), and `scene-patch.js` makes a patch by comparing two exports' entry
hashes, so an export is still whole; exporting only what a datablock changed comes next. A page applies a patch with
`blend.patch(patch)`, which resolves to the scene that shows it:

- Tables, IR properties, IDs, collections, graphs and computed entities apply in place: a moved object keeps its node, a
  changed material or geometry is swapped onto the meshes using it, a replaced entity runs again with what reads it.
- A clip made again plays on in its new group from the frame it was at, as it was asked to play.
- A patch from another version, or one changing the scene's own settings (world, pipelines, post-processes, compositor,
  volumes, display), loads the package again, reported.
- A patch naming a key, unique id or buffer the scene would not hold is not applied, reported, and the scene stays.

Tests: `tests/export-patch-wasm.test.js`, `tests/export-patch-apply-wasm.test.js`, `tests/export-patch-entities-wasm.test.js`,
`tests/export-patch-clips-wasm.test.js`. Not yet: the tables' own schemas (each table is read as written), and characters
(`docs/character-animation.md`), which take a patched clip once their layers name actions by key.
