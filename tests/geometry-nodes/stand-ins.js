// Pure-JS stand-in units for a few Geometry Nodes, for testing the evaluator's structure (fields, domains, instances,
// groups, zones) before Blender's kernels exist. Each runs as its node does on the cases the tests use; none is a port.
import { domainSize, positions, copyGeometry, writeAttribute, LAYOUTS, POINT_DOMAIN } from '../../src/io_scene_babylon/runtime/geometry-nodes/geometry.js';

const MATH = {
  ADD: (a, b) => a + b, SUBTRACT: (a, b) => a - b, MULTIPLY: (a, b) => a * b, DIVIDE: (a, b) => (b === 0 ? 0 : a / b),
  MAXIMUM: (a, b) => Math.max(a, b), MINIMUM: (a, b) => Math.min(a, b), POWER: (a, b) => a ** b, SINE: (a) => Math.sin(a),
};
const zip = (size, fn) => Array.from({ length: size }, (_, i) => fn(i));

/** A 4x4 matrix by columns from translation, Euler XYZ rotation and scale. */
export function compose([tx, ty, tz], [rx, ry, rz], [sx, sy, sz]) {
  const [cx, cy, cz, snx, sny, snz] = [Math.cos(rx), Math.cos(ry), Math.cos(rz), Math.sin(rx), Math.sin(ry), Math.sin(rz)];
  // R = Rz * Ry * Rx, columns scaled.
  const r = [
    [cy * cz, cy * snz, -sny],
    [snx * sny * cz - cx * snz, snx * sny * snz + cx * cz, snx * cy],
    [cx * sny * cz + snx * snz, cx * sny * snz - snx * cz, cx * cy],
  ];
  return [...r[0].map((v) => v * sx), 0, ...r[1].map((v) => v * sy), 0, ...r[2].map((v) => v * sz), 0, tx, ty, tz, 1];
}
export const multiply = (a, b) => zip(16, (i) => [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + (i % 4)] * b[Math.floor(i / 4) * 4 + k], 0));
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);

const concat = (lists) => lists.flatMap((list) => Array.from(list ?? []));
function joinAttributes(parts, sizeOf) {
  const names = new Set(parts.flatMap((p) => Object.keys(p.attributes ?? {})));
  return Object.fromEntries([...names].map((name) => {
    const { domain, type } = parts.find((p) => p.attributes?.[name]).attributes[name], [Type, width] = LAYOUTS[type];
    return [name, { domain, type, data: Type.from(parts.flatMap((p) => Array.from(p.attributes?.[name]?.data ?? Array(sizeOf(p, domain) * width).fill(0)))) }];
  }));
}

export const STAND_INS = {
  'node:ShaderNodeMath': {
    run({ Value, Value_001 }, { settings, size }) {
      const op = MATH[settings.operation];
      return { Value: zip(size, (i) => op(Value[i], Value_001?.[i])) };
    },
  },
  'node:ShaderNodeCombineXYZ': { run: ({ X, Y, Z }, { size }) => ({ Vector: zip(size, (i) => [X[i], Y[i], Z[i]]) }) },
  'node:GeometryNodeInputPosition': { run: (_, { geometry, component, domain }) => ({ Position: domain === POINT_DOMAIN[component] ? positions(geometry, component) : [] }) },
  'node:GeometryNodeInputIndex': { run: (_, { size }) => ({ Index: zip(size, (i) => i) }) },
  'node:GeometryNodeInputID': { run: (_, { geometry, component, size }) => ({ ID: geometry[component].attributes?.id?.data ?? zip(size, (i) => i) }) },
  'node:GeometryNodeSetPosition': {
    async run({ Geometry, Selection, Position, Offset }, { field }) {
      const out = copyGeometry(Geometry);
      for (const component of ['mesh', 'points']) {
        if (!out[component]) continue;
        const [selected, position, offset] = await Promise.all([Selection, Position, Offset].map((v) => field(v, out, component, 'POINT')));
        const result = positions(out, component).map((p, i) => (selected[i] ? position[i].map((v, k) => v + offset[i][k]) : p));
        writeAttribute(out, component, 'position', 'POINT', 'FLOAT_VECTOR', result);
      }
      return { Geometry: out };
    },
  },
  'node:GeometryNodeJoinGeometry': {
    run({ Geometry: parts }) {
      const out = {};
      const meshes = parts.map((g) => g.mesh).filter(Boolean);
      if (meshes.length) {
        let verts = 0, corners = 0, edges = 0;
        const offset = (list, by) => Array.from(list, (v) => v + by);
        const shifted = meshes.map((m) => {
          const s = { edges: offset(m.edges, verts), corner_verts: offset(m.corner_verts, verts), corner_edges: offset(m.corner_edges ?? [], edges), face_offsets: offset(m.face_offsets.slice(0, -1), corners) };
          verts += m.vert_positions.length / 3; corners += m.corner_verts.length; edges += m.edges.length / 2;
          return s;
        });
        out.mesh = {
          vert_positions: new Float32Array(concat(meshes.map((m) => m.vert_positions))), edges: concat(shifted.map((s) => s.edges)),
          face_offsets: [...concat(shifted.map((s) => s.face_offsets)), corners], corner_verts: concat(shifted.map((s) => s.corner_verts)),
          corner_edges: concat(shifted.map((s) => s.corner_edges)),
          attributes: joinAttributes(meshes, (m, domain) => domainSize({ mesh: m }, 'mesh', domain)),
        };
      }
      const points = parts.map((g) => g.points).filter(Boolean);
      if (points.length) out.points = { positions: new Float32Array(concat(points.map((p) => p.positions))), attributes: joinAttributes(points, (p) => p.positions.length / 3) };
      const instances = parts.map((g) => g.instances).filter(Boolean);
      if (instances.length) {
        out.instances = { references: instances.flatMap((i) => i.references), transforms: concat(instances.map((i) => i.transforms)), attributes: joinAttributes(instances, (i) => i.transforms.length / 16) };
        let base = 0;
        out.instances.reference_indices = instances.flatMap((i) => { const r = Array.from(i.reference_indices ?? [], (v) => v + base); base += i.references.length; return r; });
      }
      return { Geometry: out };
    },
  },
  'node:GeometryNodeTransform': {
    run({ Geometry, Translation, Rotation, Scale }) {
      const m = compose(Translation, Rotation, Scale), out = copyGeometry(Geometry);
      for (const component of ['mesh', 'points']) if (out[component]) writeAttribute(out, component, 'position', 'POINT', 'FLOAT_VECTOR', positions(out, component).map((p) => apply(m, p)));
      if (out.instances) {
        const t = out.instances.transforms, n = t.length / 16;
        out.instances.transforms = new Float32Array(zip(n, (i) => multiply(m, Array.from(t).slice(i * 16, i * 16 + 16))).flat());
      }
      return { Geometry: out };
    },
  },
};
