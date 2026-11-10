# Bylonder IR

An exported scene described in Bylonder's own schema: its datablocks with all their data, how they reference each
other, the properties a page can set, and what is computed from them. The IR alone describes the scene; Babylon is one
renderer of it. The page's scheduler walks it and runs each computed entity through the unit registry
(`docs/licence-free-live.md`). The schema is Bylonder's design and is MIT OR Apache-2.0. It uses Blender's identifiers
(RNA paths, property, node and modifier type names) only as names; it holds no Blender code and needs none to be read.

A package ships it as data, `scene.ir.json` beside `scene.js`, which reads it. The schema is defined once, in Zod
(`zod/mini`) in `src/io_scene_babylon/runtime/ir.js`; its JSON Schema `runtime/ir.schema.json` is generated from it
(`node scripts/ir-runtime.mjs`), and its types (`IR`, `Entity`, `Mesh` and the rest) are inferred from it into
`runtime/ir.d.ts`. Packages carry Zod's bundled copy, `bylonder/zod.js` (MIT). Version 1.

```json
{
  "schema": "bylonder-ir",
  "version": 1,
  "ids": {
    "OB:Cube": { "type": "OBJECT", "name": "Cube", "path": "objects[\"Cube\"]", "node": "Cube",
      "data": { "location": [0, 0, 1], "parent": null, "data": { "id": "ME:Cube" },
        "modifiers": [{ "name": "Bevel", "type": "BEVEL", "width": 0.1, "segments": 3 }] } }
  },
  "references": [{ "from": "OB:Cube", "path": "data", "to": "ME:Cube" }],
  "properties": {
    "objects[\"Cube\"].modifiers[\"Bevel\"].width": { "id": "OB:Cube", "type": "FLOAT", "default": 0.1, "soft_min": 0,
      "soft_max": 1, "unit": "LENGTH", "bind": { "node": "Cube", "channel": "0:width" } }
  },
  "graphs": {},
  "entities": {
    "OB:Cube/modifier/Bevel": { "type": "modifier:BEVEL", "id": "OB:Cube", "implementation": "modifiers",
      "inputs": { "mesh": { "vert_positions": { "buffer": 4 }, "edges": { "buffer": 5 }, "...": "..." }, "width": { "property": "objects[\"Cube\"].modifiers[\"Bevel\"].width" },
        "kernel": { "type": 17, "layouts": { "...": "..." } } },
      "outputs": { "mesh": { "draw": "Cube" } } }
  },
  "order": ["OB:Cube/modifier/Bevel"]
}
```

## IDs

`ids` maps a stable key to each datablock the export carries: its ID code and name (`OB:Cube`, `ME:Cube`, `MA:Lava`,
`NT:Planet`, `SC:Scene`, `AC:CubeAction`, `GR:Trees`, `WO:World`); a linked ID's key adds its library
(`OB:Cube@lib.blend`). Each has its `type`, `name`, `path` from `bpy.data`, `node` (the Babylon node or material it
draws as, when it has one) and `data`: its properties as Blender's RNA holds them, read at export, settable or not,
leaving out values equal to their RNA default and runtime-only and UI-only properties.
Nested structs are objects, collections arrays (each item with its `name` where it has one), an ID pointer
`{ "id": key }` or null, and bulk arrays (vertices, keyframes of a long F-Curve) `{ "buffer": n }` into `scene.bin`.
So a scene's collections and their hierarchy, view layers and their visibility flags, render and view settings, world,
active camera, actions with their F-Curves, keyframes, easing and modifiers, NLA tracks, and the compositor's node
group are all in `ids`. An object a Geometry Nodes graph reads (directly or through a collection) also has `evaluated`:
its world matrix (`matrix_world`, 4x4 by columns) and its geometry (`{ mesh }` of buffers, with its attributes) as
Blender evaluated them at export.

## References

`references` lists every ID pointer between the carried IDs, `{ from, path, to }`, `path` being the pointer's RNA path
in `from` (`parent`, `data`, `material_slots[0].material`, `modifiers["Array"].offset_object`,
`animation_data.drivers[0].driver.variables[0].targets[0].id`). They come from the same walk as `data`. Relations that
are not pointers come from Blender's depsgraph, `{ from, to, relation }`: `from` depends on `to` (`time` for the
scene's time), `relation` naming it as Blender does (`Nodes Modifier`, `Time Source -> Modifier`). What neither shows is
named in `docs/licence-free-live.md` (Relation gaps).

## Properties

`properties` are the values a page sets and reads, keyed by RNA path: `type` (`FLOAT`, `INT`, `BOOLEAN`, `STRING`),
`default`, `soft_min`, `soft_max`, `subtype` and `unit` as Blender's RNA describes them, `id`, `suggested` (offered to
authors and UIs) and `bind`, where its value lands in Babylon (a node's transform or property, a material input block,
a light, the world, a compositor pass, the frame). Time is the property `scenes["Scene"].frame_current`.

## Inputs

An entity's input is a plain JSON value or a reference:

| Form | Means |
|---|---|
| `{ "property": path }` | the current value of a property |
| `{ "entity": key, "output": name }` | an output of another entity |
| `{ "buffer": n }` | a typed array of `scene.bin` |
| `{ "data": [id, path] }` | a value of an ID's `data`, by RNA path (an action's F-Curve) |
| `{ "graph": key }` | a node graph of `graphs` |

References may nest inside arrays and objects (a driver's variables). The scheduler resolves them before a unit runs:
a unit sees numbers, strings, arrays and IR geometry only.

## Geometry

An IR mesh is `{ vert_positions, edges, face_offsets, corner_verts, corner_edges, uvs?, attributes? }`: flat typed
arrays in Blender's axes (Z up), `face_offsets` with one more entry than there are faces, `uvs` per corner, and
`attributes` as `{ name: { domain: 'POINT' | 'EDGE' | 'FACE' | 'CORNER' | 'INSTANCE', type, data } }`. Geometry in
general is `{ mesh?, points?, instances? }`: points are `{ positions, attributes }`, a radius being the attribute
`radius`; instances are `{ references, reference_indices, transforms, attributes }`, each reference an ID
(`{ "id": "OB:Tree" }`) or a geometry (`{ "geometry": ... }`), and per instance the index of its reference and its 4x4
transform by columns. A Grease Pencil layer's drawing, `grease_pencil`, is `{ layer, blend, matrix, scale, drawing }`: the
layer's index and blend mode, its matrix in its object's space (Babylon's axes and layout) and scale, and `drawing`
`{ curves, points, triangles }` as Main draws it (5 ints per curve: first point, points, flags, material index, hash;
14 floats per point: position in Babylon's axes, radius, stroke and fill colors in display sRGB, selection, weight; the
fills' triangles by point), or null. Curves, `curves`, are what Main draws of a Curves object or a particle system's hair:
`{ pos_rad, indirection, time, length, object_to_world, faces, material, name }`, each evaluated point's position (object
space, Blender's axes) and radius, Blender's indirection from the drawn segments to their curves, each point's time
along its curve, each curve's length, the object's matrix (Blender's), the faces round each segment (the scene's Hair
shape), the material's id and a name unique within the object. `runtime/mesh.js` draws any of them in Babylon: a mesh as draw
buffers (the modifier kernel's draw step where the package ships it, else a fan of each face), instances as thin
instances of their references' meshes, points as a point cloud.

## Graphs

`graphs` holds node trees by key (`NT:Planet`, `MA:Lava/node_tree`, `SC:Scene/compositing`):
`{ type: 'SHADER' | 'GEOMETRY' | 'COMPOSITOR', nodes, links, interface }`, each node
`{ name, type: 'node:<idname>', settings, inputs }`. `settings` are the node's own values (a Math operation, a Color
Ramp's stops), `inputs` map socket identifiers to values or property references, `links` are
`[from node, output, to node, input]`. A graph's evaluator (material builder, Geometry Nodes evaluator, compositor)
resolves each node's type key through the registry as the scheduler resolves an entity's.

## Entities

`entities` are the computed things, keyed `<id>/<kind>/<name>`: a modifier (`OB:Cube/modifier/Bevel`,
`modifier:BEVEL`), a driver (`OB:Crosshead/driver/location[0]`, `driver:SCRIPTED`), an F-Curve
(`OB:Flywheel/animation/rotation_euler[1]`, `animation:FCURVE`, reading the frame and writing a property), a Geometry
Nodes modifier (`modifier:NODES`, its graph an input), a material (`material:NODES`), a Grease Pencil layer
(`OB:Ball/grease_pencil/Ball`, `grease_pencil:LAYER`), curves (`OB:Hill/curves/Grass`, `curves:CURVES`). Each has its `type`, `id`,
`inputs`, `outputs` (where each lands: `{ "property": path }`, `{ "draw": node }`, or nowhere when only other entities
read it) and `implementation`: what the package ships for it (`driver`, `modifiers`, `geometry-nodes`, `animation`
for Babylon's AnimationGroup), or none when only its baked result ships. `order` lists the keys so each runs after what it reads.

What each kind of entity reads and gives:

| Type | Inputs | Outputs |
|---|---|---|
| `driver:<type>` | `driver` (type, expression, variables, a single property's target as `{ value }`), `curve`, `objects` (transform properties and static parts), `frame` when the expression reads it | `value` |
| `modifier:<TYPE>` | `mesh` (the base mesh's buffers, or the previous modifier's output), its settings by name (a vector as an array), `kernel` (the module's type and layouts) | `mesh` |
| `modifier:NODES` | `graph`, `geometry` (`{ mesh }` of the base mesh with its attributes, or the previous modifier's output), the interface's inputs by identifier, `frame` when the graph reads the scene's time (Scene Time) | `geometry` |
| `grease_pencil:LAYER` | `layer`, `blend`, `matrix`, `scale`, `frames` (the layer's keyed frames) and `drawings` (each key's drawing, its arrays buffers, or null), `frame` | `geometry` (the drawing shown at the frame: its last key's at or before it) |
| `curves:CURVES` | Main's curves draw at export (Geometry) | `geometry` (`{ curves }`, drawn once by Blender's curve shape functions in `bylonder-curves/`, GPL) |
| `animation:FCURVE` | its action's RNA path, `data_path` and `array_index` as names, `animation` (the Babylon AnimationGroup and target node that play it, `native`) or `curve` (`extrapolation`, `auto_smoothing`, `cycles`, and `keyframes` as a buffer of 13 floats per key: co, handles, interpolation, easing, handle types, back, amplitude, period; `fcurve`), `frame` | `value` |
| `constraints:OBJECT` | `node`, `constraints` (each `type`, `target` node and its settings: Track To's axes, Copy Location's axes, inversions and offset, Child Of's `inverse_matrix` by rows of Blender's axes), `frame` | none: the node is placed (`constraints`) |

Each frame, the scheduler runs again what reads `frame_current` and is not Babylon's own. What reads no property or
entity (curves) runs once, at load. An F-Curve's keys are not
copied into the IR: Babylon's animation that plays it exactly (`native`) holds them, or, for an object's transform
Babylon cannot play exactly (an Euler rotation, an easing, another extrapolation), they are a buffer of `scene.bin` and
the clean-room F-Curve unit runs it (`fcurve`), writing its property after Babylon's animation, from which blend-scene.js
places the node's location, rotation or scale. A pose bone's location, rotation and scale
(`objects["Rig"].pose.bones["Arm"].rotation_euler[0]`, bound to the Babylon Bone) run the same way where they alone give
its pose, which blend-scene.js composes with the bone's rest matrix; a bone they do not give (constraints, IK, NLA,
drivers, another inheritance, an armature drawn by several skeletons) keeps its sampled pose.
Any other FLOAT property an action animates (a light's power, a material's or
world's node input through its node tree's action, a modifier's setting, a custom property, a Geometry Nodes input, `modifiers["GeometryNodes"]["Socket_2"]` writing `...modifiers["GeometryNodes"].properties.inputs.Socket_2.value`)
runs on `fcurve` too, so what reads it runs each frame. The export option Bake Animation samples those per frame instead. Consecutive modifiers of a
stack on the same shipped implementation run as one call (its `runChain`), so what one writes (sharp edges, creases,
face strengths) reaches the next; a stack is split only where a unit takes over a modifier.

## Units

A unit is `{ inputs?, run(inputs, { frame }) }` returning its outputs by name, or a Promise of them (a kernel in
WebAssembly or a worker), registered by type key (`runtime/units.js` `register`). With `inputs`, a Zod schema, the
scheduler parses the resolved inputs with it first, so a unit's author gets typed inputs with defaults filled, and an
entity it cannot take is reported by path. An entity runs on the unit registered for its type, else on the
implementation its package ships, else stays baked. The scheduler awaits each result before what reads it, and
`settled()` resolves once all have run. A package lists its units in `units.json`, with their licences, files, uses and
interfaces, and File > Export's Replaced Units leaves out the code of those the page registers itself
(`docs/escaping-the-gpl.md`).

## Reading

`readIR` (`runtime/ir.js`) reads a file kindly: an older version is migrated by its step (`MIGRATIONS`), omitted fields
take their defaults, and what can be solved is repaired with a warning: a property without a type takes its default's,
a reference to a property, entity, graph or ID the IR lacks is dropped, an implementation the runtime does not ship
leaves its entity baked, and `order` is remade when it does not list the entities. What cannot be read throws, naming
the path, what was expected and what is there (`ir.entities["OB:Cube/modifier/Bevel"].type: expected string, got 5`).

## Versioning

`version` grows when a field changes meaning; a reader refuses a version it does not know. New fields and new type keys
do not change the version.
