// The Outliner is Blender's in the module (outliner-area.js): its tree, selection, deletion, collections and drag and
// drop run Blender's space_outliner code over a BlenderMain, as Bylonder's Outliner editor runs them.
import assert from 'node:assert/strict';
import '../src/editors/interface/region-draw.js';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { OutlinerArea, KM_SHIFT, OPERATOR_FINISHED } from '../src/editors/space_outliner/outliner-area.js';

const ID_OB = 0x424f, HEIGHT = 300;

function scene() {
  const main = new BlenderMain();
  const cube = main.add('MESH', 'Cube'), camera = main.add('CAMERA', 'Camera'), light = main.add('LIGHT', 'Light');
  const collection = main.addCollection(null, 'Collection');
  main.setCollectionObjects(main.masterCollection, []);
  main.setCollectionObjects(collection, [camera, cube, light]);
  const area = new OutlinerArea(main);
  area.resize(340, HEIGHT);
  return { main, area, cube, camera, light, collection };
}

// The tree's rows top down, and a row's place (region pixels, y up) over its name.
const rows = (area) => area.draw().draw.filter((c) => c.op === 'text' && c.text).map((c) => ({ text: c.text, x: c.at[0], y: c.at[1] }));
const names = (area) => rows(area).map((r) => r.text);
const at = (area, name) => {
  const row = rows(area).find((r) => r.text === name);
  assert.ok(row, `no row ${name}`);
  return [row.x + 5, row.y + 4];
};
const event = (type, value, region, modifier = 0) => ({ type, value, region, modifier });

{
  const { area } = scene();
  assert.deepEqual(names(area), ['Scene Collection', 'Collection', 'Camera', 'Cube', 'Light'], 'View Layer tree, sorted');
}

{
  // Each object's row draws its type's icon between the disclosure arrow and the name, as Blender's rows do.
  const { area } = scene();
  const drawn = area.draw().draw;
  for (const [name, icon] of [['Camera', 'OUTLINER_OB_CAMERA'], ['Cube', 'OUTLINER_OB_MESH'], ['Light', 'OUTLINER_OB_LIGHT']]) {
    const row = drawn.find((c) => c.op === 'text' && c.text === name);
    const before = drawn.find((c) => c.op === 'icon' && c.icon === icon && Math.abs(c.at[1] + 3 - row.at[1]) <= 2);
    assert.ok(before && before.at[0] < row.at[0] && row.at[0] - before.at[0] <= 24, `${name}'s row draws ${icon} before its name`);
  }
}

{
  const { main, area, cube, camera } = scene();
  const { status } = area.run('outliner.item_activate', { deselect_all: true }, event('LEFTMOUSE', 'CLICK', at(area, 'Cube')));
  assert.ok(status & OPERATOR_FINISHED, 'click selects');
  assert.equal(main.base(cube).selected, true);
  assert.equal(main.base(cube).active, true);
  area.run('outliner.item_activate', { extend: true, deselect_all: true }, event('LEFTMOUSE', 'CLICK', at(area, 'Camera')));
  assert.deepEqual([main.base(cube).selected, main.base(camera).selected], [true, true], 'Ctrl click extends');
}

{
  const { main, area, camera } = scene();
  area.run('outliner.item_activate', { deselect_all: true }, event('LEFTMOUSE', 'CLICK', at(area, 'Camera')));
  area.run('outliner.delete', {});
  assert.deepEqual(main.ids(ID_OB).map((ob) => main.name(ob)).sort(), ['Cube', 'Light'], 'X deletes the selected object');
  assert.equal(main.base(camera), null);
  assert.deepEqual(names(area), ['Scene Collection', 'Collection', 'Cube', 'Light'], 'and the tree after');
}

{
  const { main, area, cube, camera } = scene();
  area.run('outliner.item_drag_drop', {}, event('LEFTMOUSE', 'CLICK_DRAG', at(area, 'Camera')));
  assert.ok(area.dragging, 'dragging an object starts a drag');
  const target = at(area, 'Cube');
  assert.match(area.dragUpdate(event('MOUSEMOVE', 'NOTHING', target, KM_SHIFT)), /Parent/, 'Shift over an object parents');
  assert.ok(area.drop(event('LEFTMOUSE', 'RELEASE', target, KM_SHIFT)).status & OPERATOR_FINISHED);
  assert.equal(main.parent(camera), cube, 'Shift drop parents');
  assert.equal(area.dragging, false, 'the drop ends the drag');
}

{
  const { main, area, cube, collection } = scene();
  area.run('outliner.item_drag_drop', {}, event('LEFTMOUSE', 'CLICK_DRAG', at(area, 'Cube')));
  assert.ok(area.drop(event('LEFTMOUSE', 'RELEASE', at(area, 'Scene Collection'))).status & OPERATOR_FINISHED);
  assert.deepEqual(main.collectionObjects(main.masterCollection), [cube], 'a drop on a collection moves the object into it');
  assert.ok(!main.collectionObjects(collection).includes(cube));
}

{
  const { main, area } = scene();
  area.run('outliner.collection_new', { nested: true });
  assert.equal(main.collectionChildren(main.masterCollection).length, 2, 'C adds a collection');
}

{
  // Scrolling by pixels (view2d.pan), and the scroll-bar fading in as the mouse nears it, as Blender's scroll zones do.
  const main = new BlenderMain();
  for (let i = 0; i < 40; i++) main.add('MESH', `Cube ${String(i).padStart(2, '0')}`);
  const area = new OutlinerArea(main);
  area.resize(340, HEIGHT);
  const y = (name) => rows(area).find((r) => r.text === name)?.y;
  const before = y('Cube 05');
  area.pan(0, 37);
  assert.equal(y('Cube 05'), before + 37, 'scrolling 37 px down moves the rows 37 px up');
  assert.equal(rows(area).some((r) => r.text === 'Scene Collection'), false, 'rows scrolled past are not drawn');
  // The scroll-bar's thumb, as [width, opacity]: Blender keeps a thin faint one while the mouse is away.
  const bar = () => area.draw().draw.filter((c) => c.op === 'roundbox' && c.rect[0] > 320).map((c) => [c.rect[2] - c.rect[0], c.inner[3]]).at(-1);
  area.hoverScrollers(100, 150);
  const away = bar();
  assert.ok(away[0] <= 6 && away[1] <= 0.5, `the scroll-bar is thin and faint while the mouse is away: ${away}`);
  area.hoverScrollers(335, 150);
  assert.ok(bar()[0] > away[0] && bar()[1] > 0.8, 'and widens and shows as it comes near');
  area.hoverScrollers(-1, -1);
  assert.deepEqual(bar(), away, 'and goes back once it left');
}

console.log('outliner tests passed');
