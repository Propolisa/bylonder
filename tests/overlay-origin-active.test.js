// Object origins as Blender's overlay draws them (overlay_origin.hh): the active object's in the active color whether it
// is selected or not, a selected object's in the selected color, and none for the rest. Mandelbrot Grow's active plane,
// not selected, showed no origin.
import assert from 'node:assert/strict';
import { originColor } from '../src/draw/overlay-origin.js';
import { view_3d as theme } from '../src/editors/interface/userdef-default-theme.js';

const active = { name: 'Plane' }, selected = { name: 'Cube' }, other = { name: 'Light' };
const selection = { selected: new Set([selected]), active };
assert.deepEqual(originColor(active, selection), theme.object_active, 'the active object, not selected');
assert.deepEqual(originColor(selected, selection), theme.object_selected, 'a selected object');
assert.equal(originColor(other, selection), null, 'no origin for the rest');
console.log('Object origins: the active object always, selected ones in their color');
