# Modifier units: complete interfaces

Roadmap entry: [Modifier units with complete interfaces](../roadmap.md#modifier-units-with-complete-interfaces).

A modifier already exports as an entity (`modifier:<TYPE>`, `docs/ir.md` Entities) that runs on a unit
(`docs/ir.md` Units): Blender's code in `modifiers.wasm`, one modifier per call, or a replacement registered for the
same type key (`docs/escaping-the-gpl.md`). `units.json` lists each unit's licence, files and interface. This entry
makes every modifier's interface complete and exact, so that any unit can be replaced by one with the same interface and
nothing reaches a unit except through the IR.

## What changes

1. **Every input is an IR input.** A unit sees the mesh and its settings today. Some modifiers also read what Blender
   finds through the depsgraph: another object's evaluated mesh or matrix (Boolean, Array's offset object and caps,
   Shrinkwrap, Mirror's mirror object, Hook, Lattice, Curve), the object's own matrix, and layers by name (vertex
   groups, UV maps, attributes). Each becomes an input in the entity and in the unit's interface, by IR key.
2. **Bind data is data.** Surface Deform, Mesh Deform, Laplacian Deform and Corrective Smooth bind once and keep the
   result. The bind result is an IR buffer, and the unit deforms with it.
3. **Outputs are exact, element order included.** Vertex groups, shape keys, UVs and the next modifier read by index,
   so a replacement must give Blender's order, not only Blender's shape. The interface states this, and the check in
   `docs/escaping-the-gpl.md` compares element order over the named scenes.
4. **Stateful modifiers have their own contract.** Simulations (Cloth, Soft Body, Fluid, Dynamic Paint, particles) keep
   state between frames: a unit is a step (state and inputs in, state and outputs out), or the result is baked.
   Modifiers that need OpenVDB (Remesh in Voxel mode, the volume modifiers) are baked.
5. **Packaging stays small.** Blender's modifiers share a mesh core (custom data, mesh utilities, BMesh). A package
   carries that core once with the units it uses, within the few MB of WebAssembly a package may ship.
6. **The licence rule is a test.** The IR holds data and unit references only, never code, and a package carries
   GPL files only for the units it does not replace.

## Done when

Every modifier type in the inventory (`docs/licence-free-live.md` Modifiers) has a complete interface in `units.json`,
or is marked baked with its reason; one replacement unit per category (pure, other-object input, bind data) passes the
check against Blender's unit; and the licence test runs in `npm test`.
