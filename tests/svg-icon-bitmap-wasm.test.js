// Blender's SVG icons as bitmaps (BLF_svg_icon_bitmap, region-draw.cc): the File Browser's thumbnails show a folder as
// the folder icon Blender rasterizes from its SVG (filelist.cc's special file images), as alerts and Help > About do,
// where the module used to lack the function and threw.
import assert from 'node:assert/strict';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { pointerStruct, setContextPointer, structFind } from '../src/python/bpy_rna.js';
import { loadKeyconfig, configureWindow, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';
import { blenderWindow, tick } from '../src/windowmanager/wm-areas.js';
import { files } from '../src/port/wasm.js';
import '../src/editors/interface/region-draw.js';

const SPACE_FILE = 5, x = blenderModule.exports;
const main = blenderMain();
setContextPointer(main.C);
loadKeyconfig(main.C);
globalThis.innerWidth ??= 1200;
globalThis.innerHeight ??= 800;
const window = blenderWindow();
window.size = { width: innerWidth, height: innerHeight };
configureWindow(window);
files.set('/thumbs/Folder/empty.txt', new Uint8Array(0));
files.set('/thumbs/notes.txt', new TextEncoder().encode('notes'));

const { op } = main.invoke('wm.open_mainfile', { filepath: '/thumbs/' }, {});
const area = window.area(SPACE_FILE);
x.fileselect_area_set(area.pointer, op);
const space = pointerStruct(structFind('Area'), 0, area.pointer).spaces.active;
space.params.directory = '/thumbs/';
space.params.display_type = 'THUMBNAIL';
area.layout({ x: 0, y: 0, width: 800, height: 600 }, { [RGN_TYPE_WINDOW]: { x: 0, y: 0, width: 800, height: 600 } });
for (let i = 0; i < 3; i++) { area.draw(RGN_TYPE_WINDOW); tick(); }
const drawn = area.draw(RGN_TYPE_WINDOW).draw;
const images = drawn.filter((op) => op.op === 'image');
assert.ok(drawn.some((op) => op.op === 'text' && op.text === 'Folder'), 'the File Browser lists the folder');
assert.ok(images.length > 0, `the folder's thumbnail is drawn as a bitmap (${drawn.map((op) => op.op).join(',').slice(0, 200)})`);
area.free();
console.log("SVG icon bitmaps: the File Browser's thumbnails draw Blender's folder icon rasterized from its SVG");
