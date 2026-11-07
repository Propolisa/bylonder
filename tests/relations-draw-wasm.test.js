// Relationship lines as Blender's Relations overlay syncs them (overlay_relation.hh in the module, relations-draw.cc):
// a line from a child to its parent and one from a constrained object to its target, in the theme's colors.
import assert from 'node:assert/strict';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import { idStruct } from '../src/python/bpy_rna.js';
import { relationsDraw } from '../src/draw/overlay-relations.js';

if (!blenderModule.exports.relations_draw) {
  console.log('Relationship lines: skipped, this module has no relations-draw.cc');
  process.exit(0);
}
const blender = blenderMain();
const ID_OB = 0x424f;
const added = (op, props) => { const before = new Set(blender.ids(ID_OB)); blender.run(op, props); return blender.ids(ID_OB).find((id) => !before.has(id)); };
const parent = added('object.empty_add', { location: [0, 0, 2] });
const child = added('object.empty_add', { location: [3, 0, 0] });
const target = added('object.empty_add', { location: [0, 4, 0] });
idStruct(child).parent = idStruct(parent);
idStruct(target).constraints.new('TRACK_TO').target = idStruct(parent);
for (const ob of [parent, child, target]) blender.tag(ob);
blender.evaluate();
const lines = relationsDraw(blender.C), vertices = [];
for (let i = 0; i < lines.length; i += 8) vertices.push({ at: [...lines.subarray(i, i + 3)].map((v) => +v.toFixed(3)), color: [...lines.subarray(i + 4, i + 8)] });
const pairs = [];
for (let i = 0; i < vertices.length; i += 2) pairs.push([vertices[i].at, vertices[i + 1].at]);
const has = (a, b) => pairs.some(([p, q]) => JSON.stringify(p) === JSON.stringify(a) && JSON.stringify(q) === JSON.stringify(b));
assert.ok(has([3, 0, 2], [0, 0, 2]), `the child (moved with its parent) to its parent: ${JSON.stringify(pairs)}`);
assert.ok(has([0, 0, 2], [0, 4, 0]), `the constraint's target to the constrained object: ${JSON.stringify(pairs)}`);
console.log('Relationship lines: a parent line and a constraint line as Blender syncs them passed');
