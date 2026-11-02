// Sculpt Mode on Main as in Blender 5.2 (tools/blender-reference/sculpt-fixtures.py): entering it on Suzanne activates
// the Essentials Draw brush with Blender's tool and settings, and a left drag through Blender's window runs its Sculpt
// keymap's sculpt.brush_stroke, whose stroke moves the mesh as Blender's did.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BlenderMain, datafiles, meshFromFaces } from '../src/bmesh/bmesh-wasm.js';
import { contextStruct, setContextPointer } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/sculpt/suzanne-draw.json', import.meta.url), 'utf8'));
await datafiles;

const main = new BlenderMain();
const ob = main.add('MESH', 'Suzanne');
const { vert_positions, face_offsets, corner_verts } = fixture.start;
main.setMesh(ob, meshFromFaces(vert_positions, face_offsets, corner_verts));
main.setBase(ob, { select: true, active: true });
main.evaluate();
// Sculpt Mode pushes its undo steps on the window manager's undo stack.
main.undoInit();

const window = new Window(main);
const { winx, winy } = fixture.view;
window.size = { width: winx, height: winy };
loadKeyconfig(main.C);
window.allow(['sculpt.brush_stroke']);
const view = window.area(SPACE_VIEW3D);
const rect = { x: 0, y: 0, width: winx, height: winy };
view.layout(rect, { [RGN_TYPE_WINDOW]: rect });
view.view3d = fixture.view;

assert.ok(main.run('object.mode_set', { mode: 'SCULPT' }).status & 4, 'Sculpt Mode is entered');
assert.equal(main.mode(ob), 'SCULPT');
setContextPointer(main.C);
const { tool_settings, workspace } = contextStruct();
const { brush, unified_paint_settings: ups } = tool_settings.sculpt;
const library = brush.library?.filepath.split('/').at(-1) ?? null;
assert.deepEqual({ name: brush.name, library, size: brush.size, strength: brush.strength, direction: brush.direction,
  sculpt_brush_type: brush.sculpt_brush_type, curve_distance_falloff_preset: brush.curve_distance_falloff_preset }, fixture.brush,
'the Essentials Draw brush is active, as Blender links it');
assert.deepEqual({ size: ups.size, strength: ups.strength, use_unified_size: ups.use_unified_size, use_unified_strength: ups.use_unified_strength },
  fixture.unified_paint_settings, "the tool settings' unified size and strength are Blender's");
assert.equal(workspace.tools.from_space_view3d_mode('SCULPT').idname, fixture.tool, "Sculpt Mode's tool is Blender's");

// The fixture's events in region pixels from the bottom, as page pixels from the top (GHOST's y is the window's height - 1 - y).
const KINDS = { MOUSEMOVE: 'pointermove', PRESS: 'buttondown', RELEASE: 'buttonup' };
let modal = false;
for (const [type, value, x, y] of fixture.events) modal = window.event(KINDS[type === 'MOUSEMOVE' ? type : value], type === 'MOUSEMOVE' ? [x, winy - 1 - y] : [0]).modal;
assert.equal(modal, false, 'the stroke ends with the button');

// Each vertex where Blender's stroke left it, within single-precision rounding across compilers.
const positions = main.mesh(ob).vert_positions, expected = fixture.mesh.vert_positions;
const start = Float32Array.from(vert_positions);
const moved = (p) => Array.from({ length: p.length / 3 }, (_, v) => Math.hypot(p[v * 3] - start[v * 3], p[v * 3 + 1] - start[v * 3 + 1], p[v * 3 + 2] - start[v * 3 + 2]) > 1e-6).filter(Boolean).length;
assert.ok(moved(expected) > 0 && moved(positions) === moved(expected), `the stroke moves ${moved(expected)} vertices, as Blender's (${moved(positions)})`);
const error = Math.max(...Array.from(expected, (value, i) => Math.abs(positions[i] - value)));
assert.ok(error < 1e-5, `vertex positions are Blender's within ${error}`);
console.log(`sculpt: the Draw brush's stroke moves ${moved(positions)} of Suzanne's vertices as Blender's does (within ${error.toExponential(1)})`);
