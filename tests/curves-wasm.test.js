import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CurveObject, evaluateCurve } from '../src/blenkernel/curve/curve.js';

// Blender's Curve and Text objects evaluated, edited and laid out by Blender's code in the module, against Blender
// 5.2's results (tools/blender-reference/curve-fixtures.py): splines after Edit Mode operators and the evaluated mesh.
const dir = new URL('./fixtures/curves/', import.meta.url);
// Results known to differ, with the reason.
const KNOWN = {};

const TYPES = { 'object.text_add': 'FONT' };
// What an Add operator does for a new object that adding to the edit object does not (curvesurf_prim_add).
const NEW_OBJECT = { 'curve.primitive_nurbs_path_add': { use_path: true, dimensions: '3D' } };

// An object as a case adds it: a curve primitive by its operator in Edit Mode, then the case's settings and text.
function add(c, objects) {
  const object = new CurveObject(TYPES[c.add] ?? 'CURVE');
  if (!TYPES[c.add]) {
    object.enter();
    const { status, report } = object.run(c.add);
    assert.equal(status, 4, `${c.add}: ${report}`);
    object.exit();
    object.settings = NEW_OBJECT[c.add] ?? {};
  }
  if (c.body !== undefined) object.text = { ...object.text, body: c.body, format: null };
  if (c.format) {
    const text = object.text;
    object.text = { ...text, format: text.format.map(([flag, mat, kern]) => [flag | (c.format.use_underline ? 4 : 0) | (c.format.use_small_caps ? 16 : 0) | (c.format.use_bold ? 1 : 0), mat, kern]) };
  }
  for (const [path, value] of Object.entries(c.set ?? {})) object.setPath(path, value);
  return object;
}

const selectOnly = (object, pairs) => {
  const data = object.data;
  data.splines.forEach((s, i) => (s.bezier_points ?? s.points).forEach((p, j) => {
    const on = pairs.some(([a, b]) => a === i && b === j);
    if (s.bezier_points) Object.assign(p, { select_left_handle: on, select_control_point: on, select_right_handle: on });
    else p.select = on;
  }));
  object.data = data;
};

const close = (a, b) => Math.abs(a - b) <= 1e-4;
const sameNumbers = (a, b) => a.length === b.length && a.every((v, i) => close(v, b[i]));

function compareSplines(actual, expected) {
  if (actual.length !== expected.length) return `${actual.length} splines, Blender ${expected.length}`;
  for (const [i, s] of expected.entries()) {
    const a = actual[i], points = a.bezier_points ?? a.points;
    if (a.type !== s.type) return `spline ${i} is ${a.type}, Blender ${s.type}`;
    if (!!(a.flagu & 1) !== s.use_cyclic_u) return `spline ${i} cyclic differs`;
    if (points.length !== s.points.length) return `spline ${i} has ${points.length} points, Blender ${s.points.length}`;
    for (const [j, p] of s.points.entries()) {
      const q = points[j];
      for (const key of ['co', 'handle_left', 'handle_right']) if (p[key] && !sameNumbers(q[key].slice(0, p[key].length), p[key])) return `spline ${i} point ${j} ${key} differs`;
      for (const key of ['handle_left_type', 'handle_right_type', 'select_control_point', 'select_left_handle', 'select_right_handle', 'select'])
        if (key in p && q[key] !== p[key]) return `spline ${i} point ${j} ${key} is ${q[key]}, Blender ${p[key]}`;
      if (!close(q.radius, p.radius) || !close(q.tilt, p.tilt)) return `spline ${i} point ${j} radius or tilt differs`;
    }
  }
  return null;
}

function compareMesh(mesh, expected) {
  if (!expected) return mesh && mesh.verts_num ? `a mesh of ${mesh.verts_num} verts, Blender none` : null;
  if (!mesh) return 'no mesh';
  const differs = (key, a, b) => JSON.stringify(Array.from(a)) !== JSON.stringify(b) && `${key} differ`;
  return (mesh.verts_num !== expected.positions.length && `${mesh.verts_num} verts, Blender ${expected.positions.length}`) ||
    differs('edges', mesh.edges, expected.edges.flat()) || differs('faces', mesh.face_offsets, expected.face_offsets) ||
    differs('corners', mesh.corner_verts, expected.corner_verts) ||
    (!sameNumbers(Array.from(mesh.vert_positions), expected.positions.flat()) && 'positions differ');
}

const failed = [], known = [];
for (const file of fs.readdirSync(dir).sort()) {
  const { case: c, curve, mesh } = JSON.parse(fs.readFileSync(new URL(file, dir)));
  const made = [];
  try {
    const targets = {};
    if (c.target) {
      const target = add(c.target, made);
      made.push(target);
      targets.TARGET = { data: target.data };
    }
    const object = add(c, made);
    made.push(object);
    if (c.select || c.edit) {
      object.enter();
      if (c.select) selectOnly(object, c.select);
      for (const [idname, props] of c.edit ?? []) {
        const { status, report } = object.run(idname, props);
        if (!(status & 4)) throw new Error(`${idname} did not finish: ${report ?? status}`);
      }
      object.exit();
    }
    const data = object.data;
    const problem = (curve.body !== undefined && data.text.body !== curve.body && `body is ${JSON.stringify(data.text.body)}`) ||
      compareSplines(data.splines, curve.splines) ||
      (data.settings.dimensions !== curve.dimensions && `dimensions ${data.settings.dimensions}`) ||
      compareMesh(evaluateCurve(data, { targets, modifiers: (c.modifiers ?? []).map(([type, values]) => {
        const { object: target, ...rest } = values;
        return { type, values: rest, targets: target ? { object: target } : {} };
      }) }), mesh);
    if (problem) (KNOWN[file] ? known : failed).push(`${file}: ${problem}`);
  } catch (error) {
    failed.push(`${file}: ${error.message}`);
  } finally {
    made.forEach((o) => o.free());
  }
}
assert.deepEqual(failed, [], 'Curve and text results that differ from Blender');
assert.equal(known.length, Object.keys(KNOWN).length, 'A known difference is gone: remove it from KNOWN');
