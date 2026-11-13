# Data flow

How an edit, undo or redo in the app reaches the preview and an open exported page, and how each layer learns that
what it holds is stale. The live loop (an edit seen within a frame or two, without a reload) is built on these rules.

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
