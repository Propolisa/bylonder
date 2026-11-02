// Grease Pencil on Main as in Blender 5.2: Add > Grease Pencil makes the object, Draw Mode activates the Essentials Pencil
// brush, a left drag through Blender's window runs its grease_pencil.brush_stroke, Edit Mode's operators change the
// strokes, and the drawing extraction (grease-pencil-api.cc) packs each visible drawing once, then again only when it
// changes, with only the strokes that changed hashing differently.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlenderMain, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { contextStruct, setContextPointer } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';
import { CURVE_INTS, POINT_FLOATS, CURVE_STROKE, CURVE_FILL } from '../src/draw/grease-pencil.js';

await datafiles;
const { view: fixtureView } = JSON.parse(await readFile(new URL('./fixtures/sculpt/suzanne-draw.json', import.meta.url), 'utf8'));
const main = new BlenderMain();
main.evaluate();
main.undoInit();
setContextPointer(main.C);
const C = () => contextStruct();

const window = new Window(main);
const { winx, winy } = fixtureView;
window.size = { width: winx, height: winy };
loadKeyconfig(main.C);
window.allow(['grease_pencil.brush_stroke']);
const view = window.area(SPACE_VIEW3D);
const rect = { x: 0, y: 0, width: winx, height: winy };
view.layout(rect, { [RGN_TYPE_WINDOW]: rect });
view.view3d = fixtureView;

assert.ok(main.run('object.grease_pencil_add', { type: 'STROKE' }).status & 4, 'Add > Grease Pencil > Stroke');
const ob = C().object;
assert.equal(ob.type, 'GREASEPENCIL');
assert.deepEqual([...ob.data.layers].map((layer) => layer.name), ['Color', 'Lines'], "the Stroke template's layers");

const curvesOf = (draws) => draws.reduce((n, d) => n + d.curves.length / CURVE_INTS, 0);
const first = main.greasePencil();
assert.ok(first.every((d) => d.changed) && curvesOf(first) === 1, 'every visible drawing is packed once: the template stroke');
const stroke = first.find((d) => d.curves.length);
assert.ok(stroke.curves[2] & CURVE_STROKE, 'its line is drawn');
assert.ok(stroke.points.length / POINT_FLOATS > 100 && stroke.points.every(Number.isFinite), "its points, radii and colors");
const hashes = Array.from({ length: stroke.curves.length / CURVE_INTS }, (_, c) => stroke.curves[c * CURVE_INTS + 4]);
assert.ok(main.greasePencil().every((d) => !d.changed), 'unchanged drawings are not packed again');

assert.ok(main.run('object.mode_set', { mode: 'PAINT_GREASE_PENCIL' }).status & 4, 'Draw Mode');
const { brush } = C().tool_settings.gpencil_paint;
assert.equal(brush.name, 'Pencil', 'the Essentials Pencil brush is active');
assert.equal(C().workspace.tools.from_space_view3d_mode('PAINT_GREASE_PENCIL').idname, 'builtin.brush');
// The mode is drawn (Draw Mode shows vertex colors): every drawing is packed again once.
main.evaluate();
main.greasePencil();

// A left drag in region pixels from the top: one new stroke on the active layer.
window.event('pointermove', [winx * 0.3, winy * 0.5]);
assert.ok(window.event('buttondown', [0]).modal, 'the stroke runs modally');
for (let i = 1; i <= 30; i++) window.event('pointermove', [winx * (0.3 + i * 0.01), winy * (0.5 - 0.1 * Math.sin(i / 5))]);
const released = window.event('buttonup', [0]);
assert.equal(released.modal, false, 'the stroke ends with the button');
assert.ok(released.redraw.some(([area, region]) => area === view.pointer && region === RGN_TYPE_WINDOW), "the stroke's end tags the 3D View's window region for redrawing");
main.evaluate();
const drawn = main.greasePencil(), changed = drawn.filter((d) => d.changed);
assert.equal(changed.length, 1, 'only the drawing drawn into is packed again');
const after = changed[0], count = after.curves.length / CURVE_INTS;
assert.equal(count, 2, 'the drag drew one stroke');
assert.equal(after.curves[4], hashes[0], "the earlier stroke's hash is unchanged, so the view keeps its mesh");
assert.ok(after.curves[CURVE_INTS + 1] > 5, `the new stroke has its points (${after.curves[CURVE_INTS + 1]})`);

assert.ok(main.run('object.mode_set', { mode: 'EDIT' }).status & 4, 'Edit Mode');
const edited = main.greasePencil().filter((d) => d.changed && d.curves.length);
assert.ok(edited.every((d) => d.pointsShown), "Edit Mode's points are drawn");
main.run('grease_pencil.select_all', { action: 'SELECT' });
assert.ok(main.run('grease_pencil.stroke_subdivide', { number_cuts: 1 }).status & 4, 'Subdivide');
main.evaluate();
const subdivided = main.greasePencil().find((d) => d.changed && d.curves.length);
assert.ok(subdivided.points.length > after.points.length, 'Subdivide adds points the view draws');
assert.ok(main.run('object.mode_set', { mode: 'OBJECT' }).status & 4, 'Object Mode');

assert.ok(main.run('object.grease_pencil_add', { type: 'MONKEY' }).status & 4, 'Add > Grease Pencil > Monkey');
main.evaluate();
const monkey = main.greasePencil().filter((d) => d.ob === main.ids(0x424f).at(-1) || d.changed);
assert.ok(monkey.some((d) => d.triangles.length && Array.from({ length: d.curves.length / CURVE_INTS }, (_, c) => d.curves[c * CURVE_INTS + 2]).some((f) => f & CURVE_FILL)),
  "the Monkey's fills come with Blender's triangles");
console.log(`grease pencil: a drawn stroke of ${after.curves[CURVE_INTS + 1]} points repacks one drawing, Edit Mode subdivides it, the Monkey's fills are triangulated`);
