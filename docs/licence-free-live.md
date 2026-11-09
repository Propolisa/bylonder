# Licence-free live exports

The goal: an exported page that keeps the scene as interactive as in Blender (short of structural edits such as adding
entities), feature-complete with today's export, driven by Bylonder's own IR (`docs/ir.md`), with Blender's code only
as atomic implementations behind a type key. Computed entities (a modifier's mesh, a node tree's outputs, a generated
texture) stay computable in the page; each can later move to a licence-free unit by registering it, and nothing else.

Owner's direction, 2026-11-09: no porting yet; first the IR and the framework that lets units land one at a time.

## The model

1. **The IR is the database.** Scene structure, references, properties and computed entities in Bylonder's own schema,
   written at export, read by the page. It replaces the controls list, the bindings, the dependency table and the
   metadata paths with one model. Controls keep Blender's RNA paths as their names.
2. **The scheduler walks the IR.** When a property is set it runs the entities that read it, in `order`, each through
   the registry. Graph evaluators (materials, Geometry Nodes, compositor) walk an IR graph and resolve each node the
   same way.
3. **The registry picks an implementation per type key**, in this order:
   1. a clean unit (MIT OR Apache-2.0; today the clean-room driver units);
   2. Babylon-native, where verified against Blender like a unit;
   3. a Blender atomic kernel: Blender's code for that one thing, GPL, shipped as its own file, loaded when first used;
   4. baked: the snapshot's evaluated result, not tunable.
4. **Blender's code only as atomic kernels**: compiled shader code inside graph blocks, modifier kernels
   (`modifiers.wasm`: a mesh and settings in, a mesh out), per-node Geometry Nodes kernels. Nothing structural comes
   from Blender at run time. The interim whole-scene fallback (`scene.blend` opened in Blender's Main) is retired.

A unit's interface is the IR's: `register('modifier:BEVEL', { run(inputs, { frame }) { return { mesh }; } })`, inputs
as plain values and IR geometry, outputs by name (`runtime/units.js`). A page, a script or a later package registers
units; the scheduler prefers them to what the package ships.

## Work order

1. **IR schema and export** covering what today's export covers: ids, references, properties with bindings,
   entities for drivers, modifiers and Geometry Nodes modifiers, graphs for materials, worlds, the compositor and
   Geometry Nodes. Check: each example exports to the IR and its page matches the app.
2. **Registry and scheduler over the IR**, with today's atomic pieces registered: driver units (clean), modifier
   kernels (`modifiers.wasm`, one modifier per call), shader GLSL blocks. Check: the Steam Engine, a modifier example
   and the Geometry Nodes example evaluate with each entity on its shipped implementation; a stand-in unit registered
   in a test for one type key takes over that entity with no other change (`tests/ir-units.test.js`).
3. **Geometry Nodes on the IR**: Bylonder's graph evaluator with fields, attributes and instances on IR geometry, each
   node a kernel call (brief below). Done.
4. **Retire the scene.blend fallback** (brief below). Done.

Materials move onto the IR graph alongside step 3 (brief below).

Status: steps 1 to 4 are built. Every package ships `scene.ir.json`; `scene.js` holds no controls or table. The
scheduler (`runtime/scheduler.js`) runs drivers on the clean-room units, a Live Modifiers stack as one entity per
modifier run in one `modifiers.wasm` call, each Geometry Nodes modifier on Bylonder's evaluator with Blender's per-node
kernels (`geometry-nodes.wasm`), leaves F-Curves Babylon plays exactly to its AnimationGroup (`native`), and runs an
object's transform F-Curves it cannot (rotations, easings, other extrapolations, Cycles it cannot repeat) on the
clean-room F-Curve unit (`fcurve`), their keys in `scene.bin`, unless the export's Bake Animation option samples them.
Pose bones run on `fcurve` the same way where their F-Curves alone give the pose. An object's NLA track that replaces
at full influence plays as Babylon's keys, its strips' keys moved, scaled and repeated; other NLA (blend in and out,
other blend modes, several tracks) waits for a clean-room NLA unit. F-modifiers but Cycles, other NLA, drivers on
transforms and constraints (and IK) still leave a transform or a bone's pose sampled, each named in the Info editor.
No package ships `scene.blend`. Until the kernels have a module of their own, `geometry-nodes.wasm` is the scene module
(`runtime-files.js` `GEOMETRY_NODES_KERNELS`), the page calling only its per-node entry points. Known limits: where a
unit takes over a modifier mid-stack, the mesh passed across carries positions, topology and UVs only (the module's
mesh input takes no more). Geometry Nodes in the page:

- simulation zones are not evaluated, nor dynamic-item nodes (Capture Attribute items, Index and Menu Switch items)
  inside kernel fragments; JS units inside fields fed to kernel nodes evaluate on the POINT and INSTANCE domains only;
- a stack with a Geometry Nodes modifier stays live only when all its shown modifiers are Geometry Nodes; others stay
  baked;
- the objects a graph reads (Object Info, Collection Info) give their world matrix and mesh as evaluated at export, so
  moving one in the page does not change the result;
- meshes are drawn with flat or smooth normals per face (`sharp_face`); sharp edges and custom normals are not drawn,
  and point clouds draw as points, not spheres.

## Relation gaps

v1 reads references by walking each ID's RNA pointers. It misses relations that are not ID pointers:

- time: drivers whose expression reads `frame`, and nodes that read the scene time (Scene Time, a frame-dependent
  image sequence);
- the scene's active camera when a node or driver reads it through the context;
- view-layer-dependent data (a collection excluded in one view layer, a Geometry Nodes Is Viewport input);
- Geometry Nodes' Object Info and Collection Info inputs given by a link rather than a socket's own value, and
  Self Object.

The IR records time as an input where it can see it (a driver's expression, an F-Curve). The export also reads the
depsgraph's relations between IDs (`deg_relations`, `tools/blender-port/wasm/deg-relations.cc`) and adds each one the
pointer walk missed as a reference with its `relation` name (`to` is `time` for the scene's time). That closes time,
the active camera, Object and Collection Info given by a link, and Self Object. What only the view layer says (a
collection excluded in it, Is Viewport) is not a relation between IDs and stays open; `tests/ir-relations.test.js`
lists it per example.

## Inventory and later units

Counted on 53 scenes: the 34 example `.blend` files and Blender's 19 demo files the splash lists (`.tools/demo/`),
nodes in distinct trees, used materials and objects in scenes. Twelve examples build their scenes in JavaScript; their
modifiers (Wireframe, Array, Mirror, Screw, Solidify, Subdivision, Bevel, Simple Deform, Wave) are counted by source.
The ranking is for later ports: reach is the scenes a unit appears in; size is a guess at a clean-room unit's work.
Native means Babylon has an equivalent worth verifying against the oracle.

### Modifiers

| Type | Count | Scenes | Size | Native |
|---|---|---|---|---|
| `NODES` | 219 | 15 | Graph evaluator | |
| `SUBSURF` | 1113 | 13 (+2 JS) | L (Catmull-Clark with creases, UV smoothing) | |
| `SOLIDIFY` | 954 | 11 (+4 JS) | M (simple mode), L (complex) | |
| `BEVEL` | 344 | 10 (+3 JS) | XL | |
| `ARMATURE` | 7 | 6 | | Babylon Skeleton (in use) |
| `DISPLACE` | 54 | 5 | S, plus the legacy Clouds texture (53 uses) | |
| `MIRROR` | 50 | 4 (+1 JS) | S (merge, clipping) | |
| `ARRAY` | 4 | 2 (+1 JS) | M (offsets, merge, caps) | Thin instances, without merge |
| `SCREW`, `WIREFRAME`, `WAVE`, `SIMPLE_DEFORM`, `EDGE_SPLIT`, `SMOOTH`, `LATTICE`, `REMESH`, `CURVE`, `HOOK` | 1 to 33 | 1 each (+JS) | S to L | |

### Shader and texture nodes

| Type | Count | Scenes | Size | Native |
|---|---|---|---|---|
| `ShaderNodeBsdfPrincipled` | 659 | 50 | L | PBRMaterial (in use) |
| `ShaderNodeTexCoord`, `ShaderNodeMapping`, `ShaderNodeSeparateXYZ`, `ShaderNodeCombineXYZ` | 200, 152, 33, 14 | 26, 17, 10, 7 | S | NodeMaterial blocks |
| `ShaderNodeValToRGB` (Color Ramp) | 237 | 23 | S | GradientBlock, verify interpolation modes |
| `ShaderNodeMix`, `ShaderNodeMath`, `ShaderNodeVectorMath`, `ShaderNodeMapRange` | 269, 159, 115, 66 | 16, 16, 9, 11 | S each operation | NodeMaterial math blocks for some operations |
| `ShaderNodeTexNoise` (fBm) | 178 | 15 | M (Blender's Perlin variant and fBm) | |
| `ShaderNodeBsdfDiffuse`, `ShaderNodeMixShader`, `ShaderNodeEmission`, `ShaderNodeBsdfTransparent` | 133, 107, 43, 60 | 15, 13, 11, 9 | S to M | |
| `ShaderNodeBump` | 47 | 10 | M | |
| `ShaderNodeTexWave`, `ShaderNodeTexGradient`, `ShaderNodeTexVoronoi`, `ShaderNodeTexWhiteNoise` | 18, 46, 27, 6 | 9, 7, 6, 4 | M | |
| `ShaderNodeHueSaturation`, `ShaderNodeInvert`, `ShaderNodeLayerWeight`, `ShaderNodeLightPath` | 43, 13, 12, 29 | 7, 5, 6, 7 | S | |

### Geometry Nodes

182 node types across 15 scenes. The most reached: Compare (13 scenes), Boolean Math (11), Join Geometry (11), Math
(10), Vector Math (10), Named Attribute (10), Combine XYZ (10), Set Shade Smooth (10), Set Position (9), Switch (8),
Random Value (8), Instance on Points (8), Store Named Attribute (7), Noise Texture (7), Transform Geometry (7), Set
Material (7), Collection Info (7), Distribute Points on Faces (7), Realize Instances (7). Function nodes (math,
compare, mix, noise) are the cheapest units and are shared with shader nodes.

## Geometry Nodes kernel seams

Seam source in `tools/blender-port/wasm/` (`geometry-nodes-api.cc`), marshalling IR geometry in and out, built into
the scene module, which exported pages load as `geometry-nodes.wasm` until a module of its own is linked:

- `fn_node_eval(idname, settings, inputs)`: a function node's multi-function (Math, Compare, Noise Texture, Random
  Value, Mix, Map Range, Color Ramp) over arrays of inputs, giving arrays of outputs.
- `field_input_eval(idname, settings, geometry, domain)`: a field input that reads its geometry (Position, Normal,
  Index, Edge Angle, Named Attribute, Shade Smooth) on a domain of a geometry.
- `geo_node_eval(fragment, geometries, values)`: one geometry node with the field-only nodes feeding it (the fragment,
  in IR graph form), on IR geometries, giving geometries and values. Fields stay inside Blender's evaluation, so each
  node evaluates them on the domains it chooses.
- `deg_relations()`: the depsgraph's relations between IDs, for the IR's references (done).

## Briefs

### Materials on the IR

Write each material and world node tree into the IR's `graphs` (nodes, settings, links, unlinked inputs as properties)
and build the page's NodeMaterial from it, resolving each node by `node:<idname>`: a unit's GLSL or WGSL block, a
Babylon block where verified, else Blender's GLSL for that node made at export (the `NODES_PER_NODE` form of
`controllable-exports.md`), shipped as its own GPL file. Files: `node-material-export.js`, a new `runtime/materials.js`.
Checks: Lava, Shader Gallery and Blue Planet pages match the app in a browser check (ask for the GPU slot); a stand-in
unit for `node:ShaderNodeTexNoise` takes over in a test.

### Geometry Nodes evaluator (done)

Bylonder's evaluator over an IR graph of type `GEOMETRY`: lazy fields, attributes on the four domains, instances,
node groups, repeat zones; each node through the registry, Blender's kernels through the seams above. Files: a new
`runtime/geometry-nodes/`, the seams in `tools/blender-port/wasm/`. Checks: the Geometry Nodes and Geometry Node Editor
examples' meshes and instances equal the app's for several input values, with no `scene.blend`; a stand-in unit for
`node:ShaderNodeMath` takes over.

### Retire the scene.blend fallback (done)

Once the evaluator lands: remove `blender-evaluator.js`, `blender-fallback.js` and its bundle, Include Source .blend
and the `Live` level's dependency on them; `modifier:NODES` resolves to the evaluator. Checks:
`tests/export-blender-wasm.test.js` rewritten on the evaluator; no package ships `scene.blend`, and the scene module
only as the Geometry Nodes kernels.
