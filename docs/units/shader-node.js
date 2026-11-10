// SPDX-License-Identifier: MIT OR Apache-2.0
// Template of a shader node unit (docs/escaping-the-gpl.md). The key is the node's (`node:<idname>`, units.json lists
// the package's with their sockets and the parameters of the shipped piece). `shader(node)` gives the node's GLSL as a
// piece: one function, called with its parameters in order, each of these kinds:
//   { type, input }     a node input by socket identifier: its link, else its value; `fallback` GLSL when neither
//   { type, output }    an output by socket identifier, an `out` parameter
//   { type, geometry }  a value of the drawn point: __position, __normal, __uv, __tangent, __world, __view, ...
//   { type, mesh }      a per-mesh value: $model, $texspace_location, $texspace_size
//   { type, texture }   the node's texture by index (sampler2D)
// Types are GLSL's: float, vec2, vec3, vec4, mat4, sampler2D, or BlClosure for a shader socket. `functions` are helper
// functions by key, written once per material. `node.settings` holds the node's own values, so the code can depend on
// them. Unique function names avoid clashes with other pieces. Check that it builds in the package's graphs:
//   node tests/export-parity/unit-oracle.mjs <package> <this file>
// and compare the page's picture on the GPU (tests/export-parity/look.mjs).
export default {
  'node:ShaderNodeInvert': {
    shader: () => ({
      functions: {},
      call: 'my_invert',
      code: 'void my_invert(float fac, vec4 color, out vec4 result) {\n  result = mix(color, vec4(vec3(1.0) - color.rgb, color.a), fac);\n}',
      params: [{ type: 'float', input: 'Fac' }, { type: 'vec4', input: 'Color' }, { type: 'vec4', output: 'Color' }],
    }),
  },
};
