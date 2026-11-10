// SPDX-License-Identifier: MIT OR Apache-2.0
// Template of a Geometry Nodes node unit (docs/escaping-the-gpl.md). The key is the node's (`node:<idname>`, units.json
// lists the package's with their sockets and kind); the evaluator calls `run` in the way the kind says:
//   function  inputs by socket identifier, each an array of `size` values (one per element); give each output an array
//   field     reads the geometry it is evaluated on: context { geometry, component, domain, size }; give arrays
//   geometry  inputs as single values, IR geometry for geometry sockets (docs/ir.md Geometry); context `field(value,
//             geometry, component, domain)` gives a field input's values on a domain, `resolve(key)` an ID the node reads
// Every context has `settings` (the node's own values, as the IR's graph holds them), `node` and `frame`. Check it
// against the shipped kernels inside the modifier that uses it:
//   node tests/export-parity/unit-oracle.mjs <package> <this file>
export default {
  // A function node: Math, the two-input operations of it this stub covers.
  'node:ShaderNodeMath': {
    run({ Value: a, Value_001: b }, { settings, size }) {
      const operations = { ADD: (x, y) => x + y, SUBTRACT: (x, y) => x - y, MULTIPLY: (x, y) => x * y, MINIMUM: Math.min, MAXIMUM: Math.max };
      const operation = operations[settings.operation];
      if (!operation) throw new Error(`Math: ${settings.operation} is not written yet`);
      return { Value: Array.from({ length: size }, (_, i) => operation(a[i], b[i])) };
    },
  },
};
