# Escaping the GPL in an exported package

File > Export > JavaScript writes a package that loads in plain Babylon.js. Most of it is Bylonder's own code and data
(MIT OR Apache-2.0): `scene.js`, the runtime in `bylonder/`, the IR in `scene.ir.json` (`docs/ir.md`). What a scene
computes with Blender's code (a modifier, a shader node, a Geometry Nodes node, EEVEE's light specular) ships as a unit
of its own, GPL-3.0-or-later, in a folder with its notice. Bylonder does not rewrite Blender's node suites. A scene uses
only some of them, and each can be replaced on its own: write the units your scene uses, check them against the ones the
package ships, then export without the GPL ones.

## The units of a package

Every package carries `units.json`, one entry per type key the scene computes with:

| Field | Means |
|---|---|
| `kind` | `entity` (a modifier, a driver, an F-Curve), `shader-node`, `geometry-node` or `block` (Blender's code outside entities and graphs) |
| `licence` | `GPL-3.0-or-later` for Blender's code, `MIT OR Apache-2.0` for Bylonder's |
| `files` | the package files it runs from |
| `uses` | the entities or graph nodes that use it, their IDs and the properties (controls) they read |
| `interface` | its inputs and outputs as the IR gives them: an entity's inputs by name with their form (`property`, `entity`, `buffer`, a plain value); a node's sockets, its kind (`function`, `field`, `geometry`) and, for a shader node, the GLSL parameters of the shipped piece |
| `replaced` | whether this export left it out (below) |
| `swappable` | `false` where no unit can take its place yet |

```json
"modifier:SIMPLE_DEFORM": { "kind": "entity", "implementation": "modifiers", "licence": "GPL-3.0-or-later",
  "files": ["bylonder-modifiers/modifiers-worker.js", "bylonder-modifiers/modifiers.wasm"],
  "interface": { "inputs": { "mesh": "object", "angle": "property", "deform_method": "property", "...": "..." }, "outputs": ["mesh"] },
  "uses": [{ "entity": "OB:Kohaku/modifier/Tail Swing", "id": "OB:Kohaku", "properties": ["objects[\"Kohaku\"].modifiers[\"Tail Swing\"].angle", "..."] }],
  "replaced": false }
```

## Writing a unit

A unit is a plain object registered for a type key; it sees IR values only, never Blender's structures. Start from the
template of its kind:

- `docs/units/modifier.js`: `run({ mesh, ...settings })` gives `{ mesh }`, an IR mesh.
- `docs/units/geometry-node.js`: `run(inputs, context)`, called as the node's kind says (arrays per element for a
  function node, geometries for a geometry node).
- `docs/units/shader-node.js`: `shader(node)` gives the node's GLSL as one function and its parameters.

A unit may also give an `inputs` schema (Zod, `bylonder/zod.js` in the package): its inputs are parsed with it first,
defaults filled, and an entity it cannot take reported by path (`docs/ir.md`, Units). EEVEE's light specular is the
block unit `block:area_specular`, `{ apply(material) }` for each of the page's PBR materials; replaced and not registered,
Babylon lights them its own way. The control panel's Collections view draws Blender's icons, the block unit
`block:icons`, `{ icons }` (`{ [name]: [svg, width, height] }`); replaced and not registered, the panel draws its own.

What you write must be your own work or code you may license as you choose. Write from Blender's manual and from
what the shipped unit does (the oracle below), not from Blender's sources: a port of Blender's code stays GPL.

## Checking a unit against the shipped one

The shipped GPL unit is the oracle. Export the package with its GPL units, then run:

```
node tests/export-parity/unit-oracle.mjs <package folder> <your units module>
```

The units module's default export maps type keys to units. The harness loads the package in Node, and for each entity
your units cover runs the shipped implementation and yours on the scene's own inputs: each control the entity reads
at its default and at two other values in its range. A modifier runs alone, on what the units before it give; a
Geometry Nodes node runs inside the modifier whose graph holds it, the modifier's geometry compared; a shader node is
checked to build in each graph that holds it (its look is compared on the GPU by `tests/export-parity/look.mjs`). It
prints `{ units, checked, failures }`, each failure naming the entity, the values and the largest difference, and
exits 1 on a failure.

## Running and shipping it

At page load, register the unit before the scene loads; the page then runs it in place of what the package ships, and
the GPL file is not loaded:

```js
import { register } from './bylonder/units.js';
import units from './my-units/simple-deform.js';
import { createEngine, load } from './scene.js';

for (const [type, unit] of Object.entries(units)) register(type, unit);
const blend = await load(await createEngine(canvas));
```

At export, File > Export > JavaScript's settings tree has a Units branch: the scene's units by category (Modifiers,
Shader Nodes, Geometry Nodes, Blocks), each Blender (GPL) or Replaced, its icon Blender's logo or a script for your
own. A unit left unset inherits from its category, a category from Units, so setting Shader Nodes to Replaced
replaces every shader node and one of them can be set back to Blender (GPL). In Node, `exportModule`'s `replace` takes
the type keys (a key ending in `*` covers every key with that prefix, `node:*`). The package then ships none of the
replaced units' code: their entities
name no implementation, their shader pieces are left out, and a GPL file ships only while a unit not replaced uses it.
A package whose GPL units are all replaced ships no GPL files and no notice. An entity whose unit is not registered
stays as exported (its baked result), and a shader node draws zero, each reported in the console.

## Worked example: Simple Deform

The Vertex and Weight Paint example bends two koi with Simple Deform (Bend about Z, a Tail vertex group, its angle
animated). `docs/units/simple-deform.js` is Simple Deform written from the manual: Twist and Bend about the object's
origin, limits as shares of the object's extent, the vertex group weighing the result.

1. Export the example with File > Export > JavaScript and unzip it. `units.json` lists `modifier:SIMPLE_DEFORM` with
   its two uses, `OB:Kohaku` and `OB:Showa`, and the controls they read.
2. Check the unit: `node tests/export-parity/unit-oracle.mjs <package> docs/units/simple-deform.js` checks both koi at
   22 sets of inputs (angle, limits, locks, the vertex group's inversion) with no difference.
3. Copy the unit into the package (`my-units/simple-deform.js`) and register it in the page as above.
4. Export again with Units > Modifiers > Simple Deform set to Replaced. Its entities run on your unit. The koi's Subdivision
   still runs in `bylonder-modifiers/`; set Units to Replaced (with a Subdivision unit and shader node units of your own),  and the package ships no GPL file (`tests/unit-swap-wasm.test.js`).

## Limits

- Curves draw with Blender's curve shape functions (`bylonder-curves/`), volumes with EEVEE's volume passes
  (`bylonder-volumes/`), the compositor and a material that cannot be built from its graph carry Blender's GLSL in
  `scene.js`: `units.json` lists each with `swappable: false`.
- A Geometry Nodes field node feeding a node that runs in Blender's kernels runs there with it; replace both to run
  either as yours.
- A shader node's oracle in Node checks that it builds; its pixels are compared on the GPU only.
- Simple Deform's Bend takes no lock axes, in the shipped unit as in the app (export parity agrees at every lock), so
  the worked example ignores them too. Its Twist's locks, Taper and Stretch are not written.
- The Units branch is asked at each export and not saved with the project. It lists what the scene's data holds
  (every object's modifiers, every material's and world's nodes, every Geometry Nodes group's); `units.json` lists
  what the package uses.
