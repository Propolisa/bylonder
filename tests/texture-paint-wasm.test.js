// UV unwrapping, Texture Paint and Vertex Paint as in Blender 5.2 (tools/blender-reference/texture-paint-fixtures.py): a
// grid facing the view gets Blender's UVs from UV > Unwrap and Smart UV Project; in Texture Paint Mode a Base Color
// slot's image takes a left drag through Blender's window with Blender's pixels, and the image's Babylon texture follows
// the stroke by its changed regions only (imbuf/image-textures.js); in Vertex Paint Mode the same drag gives the color
// attribute Blender's colors; undo takes a stroke back, which the view draws (extracted_color). The image's sampling runtime (runtimes/image.js)
// samples with Babylon's settings once switched.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NullEngine, Scene, Texture } from '@babylonjs/core';
import { BlenderMain, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { blendData, contextStruct, setContextPointer, pointerStruct, structFind, inPythonContext } from '../src/python/bpy_rna.js';
import { module } from '../src/python/bpy_interface.js';
import { defaultKeymaps } from '../src/windowmanager/keyconfig.js';
import { Window, loadKeyconfig, SPACE_VIEW3D, RGN_TYPE_WINDOW } from '../src/windowmanager/wm-window.js';

const SPACE_IMAGE = 6, RGN_TYPE_UI = 4;
import { imageTexture, updateImageTextures } from '../src/imbuf/image-textures.js';
import { registerRuntimeTypes, evaluated } from '../src/runtimes/runtimes.js';
import '../src/runtimes/image.js';
import { bylonderIcon, BYLONDER_ICON } from '../src/python/bpy_icons.js';
import { regionPanels, categorySet } from '../src/editors/interface/ui-tree.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/texture-paint/grid.json', import.meta.url), 'utf8'));
await datafiles;
const main = new BlenderMain();
setContextPointer(main.C);
registerRuntimeTypes(bylonderIcon());
main.view = fixture.view;

const near = (a, b, tolerance) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const worst = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const uvs = (mesh) => [...mesh.uv_layers.active.data].flatMap((loop) => [...loop.uv]);

main.run('mesh.primitive_grid_add', { x_subdivisions: 4, y_subdivisions: 4, size: 2, rotation: [1.5707963, 0, 0] });
const grid = blendData().objects.get('Grid');
const unwrapped = (idname, props) => {
  main.run('object.mode_set', { mode: 'EDIT' });
  main.run('mesh.select_all', { action: 'SELECT' });
  assert.equal(main.run(idname, props).status, 4, `${idname} runs`);
  main.run('object.mode_set', { mode: 'OBJECT' });
  return uvs(grid.data);
};
assert.ok(near(unwrapped('uv.unwrap', { method: 'CONFORMAL', margin: 0 }), fixture.unwrap, 1e-3), 'UV > Unwrap gives Blender\'s UVs');
assert.ok(near(unwrapped('uv.smart_project', { island_margin: 0 }), fixture.smart_project, 1e-3), 'Smart UV Project gives Blender\'s UVs');
unwrapped('uv.unwrap', { method: 'CONFORMAL', margin: 0 });

assert.equal(main.run('paint.texture_paint_toggle').status, 4);
assert.equal(main.run('paint.add_texture_paint_slot', { type: 'BASE_COLOR', slot_type: 'IMAGE', name: 'Paint', color: [0, 0, 0, 1], width: fixture.size, height: fixture.size }).status, 4);
const settings = contextStruct().tool_settings;
settings.image_paint.unified_paint_settings.color = [1, 1, 1];
const image = blendData().images.get('Paint');

// The image's texture, before the stroke: then the stroke's changed regions only reach the GPU.
const engine = new NullEngine(), scene = new Scene(engine);
const texture = imageTexture(image, scene, { interpolation: 'Linear', extension: 'REPEAT' });
assert.ok(texture, 'the image has a Babylon texture');
const uploads = [];
// A NullEngine has no GL: the uploads are only recorded.
engine.updateTextureData = (...args) => { uploads.push(['region', args[4], args[5]]); };
engine.updateRawTexture = () => { uploads.push(['whole']); };
engine.generateMipmaps = () => {};

const window = new Window(main);
const { winx, winy } = fixture.view;
// The 3D View on the left, the Image Editor on the right.
window.size = { width: winx * 2, height: winy };
loadKeyconfig(main.C, defaultKeymaps());
window.allow(['paint.image_paint', 'paint.vertex_paint']);
const view = window.area(SPACE_VIEW3D);
const rect = { x: 0, y: 0, width: winx, height: winy };
view.layout(rect, { [RGN_TYPE_WINDOW]: rect });
view.view3d = fixture.view;
const send = (events) => {
  for (const [type, value, x, y] of events) {
    window.event('pointermove', [x, winy - 1 - y]);
    if (type === 'LEFTMOUSE') window.event(value === 'PRESS' ? 'buttondown' : 'buttonup', [0]);
  }
};
main.undoInit();
const before = main.undoPush('Before Stroke');
send(fixture.stroke);
const stroke = main.undoStep;
assert.notEqual(stroke, before, 'the stroke pushes its own undo step');
const pixels = [...image.pixels];
assert.ok(near(pixels, fixture.pixels, 0.02), `the stroke paints Blender's pixels (worst ${worst(pixels, fixture.pixels)})`);
assert.ok(pixels.some((v, i) => i % 4 !== 3 && v > 0.5), 'the stroke paints white');

updateImageTextures(engine);
assert.ok(uploads.length && uploads.every(([kind]) => kind === 'region'), 'the texture follows the stroke by its changed regions');
// Undo takes the stroke back and redo paints it again, with the texture following.
assert.ok(main.undoLoad(before), 'undo');
assert.ok([...image.pixels].every((v, i) => i % 4 === 3 || v === 0), 'undo takes the stroke back');
assert.ok(main.undoLoad(stroke), 'redo');
assert.ok(near([...image.pixels], pixels, 0), 'redo paints it again');
updateImageTextures(engine);

// Sampling: Blender's (Preferences' anisotropic filter), then Babylon's own settings once the image's runtime is native.
const anisotropy = Number(contextStruct().preferences.system.anisotropic_filter.replace('FILTER_', ''));
assert.equal(texture.anisotropicFilteringLevel, Math.max(1, anisotropy), 'Blender\'s anisotropic filter');
image.bylonder.runtime = 'NATIVE';
Object.assign(image.bylonder.babylon, { anisotropic_filtering: 8, use_mipmaps: false });
evaluated({});
assert.equal(texture.anisotropicFilteringLevel, 8, 'Babylon\'s anisotropic filtering');
assert.equal(texture.samplingMode, Texture.BILINEAR_SAMPLINGMODE, 'Babylon\'s sampling without mipmaps');
image.bylonder.runtime = 'BLENDER';
evaluated({});

// Its Runtime panel in the Image Editor's sidebar, Image tab, with the Bylonder icon.
const imageArea = window.area(SPACE_IMAGE);
const imageRect = { ...rect, x: winx };
imageArea.layout(imageRect, { [RGN_TYPE_WINDOW]: imageRect, [RGN_TYPE_UI]: { x: winx * 2 - 300, y: 0, width: 300, height: winy } });
pointerStruct(structFind('Area'), 0, imageArea.pointer).spaces.active.image = image;
imageArea.inContext(RGN_TYPE_UI, (C) => { regionPanels(C); categorySet(C, 'Image'); });
const sidebar = imageArea.inContext(RGN_TYPE_UI, (C) => regionPanels(C));
const runtimePanel = sidebar.panels.find((panel) => panel.id === 'IMAGE_PT_bylonder_runtime');
const nodes = (tree) => [tree, ...(tree.children ?? []).flatMap(nodes)];
assert.ok(runtimePanel, 'the Image Editor\'s sidebar has the image\'s Runtime panel');
assert.ok(runtimePanel.parts.flatMap((part) => nodes(part.layout)).some((b) => b.icon === BYLONDER_ICON), 'with the Bylonder icon');

// A stroke in the Image Editor in Paint mode, with its default tool (the Brush) as Blender sets it, paints the image.
const imageSpace = pointerStruct(structFind('Area'), 0, imageArea.pointer).spaces.active;
imageSpace.mode = 'PAINT';
imageArea.inContext(RGN_TYPE_WINDOW, (C) => inPythonContext(C, () => module('bl_ui.space_toolsystem_common').activate_by_id(contextStruct(), 'IMAGE_EDITOR', 'builtin.brush')));
const white = () => [...image.pixels].filter((v, i) => i % 4 === 0 && v > 0.5).length, painted2d = white();
const row = Math.round(winy * 0.8);
const at = (dx) => winx + 50 + dx;
send([['MOUSEMOVE', 'NOTHING', at(0), row], ['LEFTMOUSE', 'PRESS', at(0), row], ...Array.from({ length: 10 }, (_, i) => ['MOUSEMOVE', 'NOTHING', at((i + 1) * 30), row]), ['LEFTMOUSE', 'RELEASE', at(300), row]]);
assert.ok(white() > painted2d, 'a stroke in the Image Editor paints the image');
assert.equal(texture.samplingMode, Texture.TRILINEAR_SAMPLINGMODE, 'back to Blender\'s sampling');

main.run('object.mode_set', { mode: 'OBJECT' });
const colors = grid.data.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER');
grid.data.color_attributes.active_color = colors;
for (const value of colors.data) value.color = [0, 0, 0, 1];
assert.equal(main.run('paint.vertex_paint_toggle').status, 4);
settings.vertex_paint.unified_paint_settings.color = [1, 1, 1];
send(fixture.stroke);
const painted = [...colors.data].flatMap((value) => [...value.color]);
assert.ok(near(painted, fixture.colors, 0.02), `the stroke paints Blender's colors (worst ${worst(painted, fixture.colors)})`);

const ob = main.ids(0x424f).find((id) => main.name(id) === 'Grid');
const mesh = main.evaluatedMesh(ob), drawn = main.paintColors(mesh.corners_num);
assert.ok(drawn && drawn.some((v, i) => i % 4 !== 3 && v > 0.5), 'the view draws the painted colors');

// The painted image drives a Displace modifier through an Image texture: the grid moves where the stroke painted.
main.run('object.mode_set', { mode: 'OBJECT' });
const displaceTexture = blendData().textures.new('Painted', 'IMAGE');
displaceTexture.image = image;
const displace = grid.modifiers.new('Displace', 'DISPLACE');
Object.assign(displace, { texture: displaceTexture, texture_coords: 'UV', strength: 1, mid_level: 0 });
const offsets = [...main.evaluatedMesh(ob).vert_positions].map((v, i) => v - grid.data.vertices[Math.floor(i / 3)].co[i % 3]);
assert.ok(offsets.some((d) => Math.abs(d) > 0.5) && offsets.some((d) => Math.abs(d) < 1e-6), 'Displace moves the painted vertices only');
console.log('texture paint: Blender\'s UVs, pixels and colors; the texture follows strokes by region; image sampling runtime; Displace by the image');
