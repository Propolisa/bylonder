// SPDX-License-Identifier: MIT OR Apache-2.0
// Template of a modifier unit (docs/escaping-the-gpl.md). Rename the type key to the modifier's (units.json lists the
// package's, with each input's form), write `run`, then check it against the shipped unit:
//   node tests/export-parity/unit-oracle.mjs <package> <this file>
//
// Inputs, as units.json's `interface.inputs` names them for the entity:
//   mesh      the IR mesh before this modifier (docs/ir.md Geometry): vert_positions, edges, face_offsets,
//             corner_verts, corner_edges, uvs?, attributes?, vertex_groups? ({ name, verts, weights }), in Blender's axes
//   <setting> each of the modifier's settings by its RNA name, as plain values (an enum as its identifier, a vector as
//             an array), already set to the control's current value
//   kernel    the shipped kernel's own layout; a unit ignores it
// Output: { mesh }, an IR mesh. It may answer later (return a Promise).
export default {
  'modifier:EXAMPLE': {
    run({ mesh, kernel: _, ...settings }, { frame }) {
      // Stub: the mesh passes through unchanged.
      return { mesh };
    },
  },
};
