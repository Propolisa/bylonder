import assert from 'node:assert/strict';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { blendData, setContextPointer } from '../src/python/bpy_rna.js';
import { AnimArea, RGN_TYPE_WINDOW, RGN_TYPE_HEADER } from '../src/editors/animation/anim-area.js';
import { regionPanels, regionHeader, menuTree, buttonMenu, buttonPress, buttonApplied, panelClosedSet } from '../src/editors/interface/ui-tree.js';

// Blender's Properties editor laid out by Blender's uiLayout in the module, its panels Blender's Python registered as
// Blender's panel types, drawing Main's data; the trees the browser draws (ui-tree.cc).
const SPACE_PROPERTIES = 4;
const blender = new BlenderMain();
const cube = blender.add('MESH', 'Cube');
blender.setBase(cube, { select: true, active: true });
setContextPointer(blender.C);
const ob = blendData().objects.get('Cube');

const area = new AnimArea(blender, SPACE_PROPERTIES);
area.layout(RGN_TYPE_WINDOW, 0, 0, 400, 800);
area.layout(RGN_TYPE_HEADER, 0, 800, 400, 26);
const panels = () => area.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C));
const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));
const panelButtons = (panel) => panel.parts.flatMap((part) => buttons(part.layout));
const find = (list, id) => list.find((panel) => panel.id === id);

// The Object tab: Blender's panels in its order, the Transform panel's property split and number buttons.
let drawn = panels();
assert.deepEqual(drawn.slice(0, 3).map((panel) => panel.id), ['PROPERTIES_PT_context', 'OBJECT_PT_context_object', 'OBJECT_PT_transform']);
const transform = find(drawn, 'OBJECT_PT_transform');
const location = panelButtons(transform).filter((b) => b.rna?.prop === 'location');
assert.deepEqual(location.map((b) => [b.type, b.rna.index, b.display]), [['NUM', 0, '0 m'], ['NUM', 1, '0 m'], ['NUM', 2, '0 m']]);
assert.ok(panelButtons(transform).some((b) => b.type === 'LABEL' && b.text === 'Location X'), 'property split labels');
assert.equal(location[0].rna.owner, 'Object');

// A value set through RNA, then the button's functions: Blender shows it with its unit.
ob.location[0] = 2;
area.inContext(RGN_TYPE_WINDOW, (C) => buttonApplied(C, location[0]));
drawn = panels();
assert.equal(panelButtons(find(drawn, 'OBJECT_PT_transform')).find((b) => b.rna?.prop === 'location').display, '2 m');

// A toggle pressed as Blender applies it, in a panel opened as Blender keeps it open (Panel.flag).
assert.equal(find(drawn, 'OBJECT_PT_visibility').closed, true);
area.inContext(RGN_TYPE_WINDOW, (C) => panelClosedSet(C, 'OBJECT_PT_visibility', false));
const visibility = find(panels(), 'OBJECT_PT_visibility');
const selectable = panelButtons(visibility).find((b) => b.rna?.prop === 'hide_select');
assert.ok(selectable, 'Visibility shows Selectable');
const before = ob.hide_select;
area.inContext(RGN_TYPE_WINDOW, (C) => buttonPress(C, selectable));
assert.equal(ob.hide_select, !before);

area.inContext(RGN_TYPE_WINDOW, (C) => panelClosedSet(C, 'OBJECT_PT_transform', true));
drawn = panels();
assert.equal(find(drawn, 'OBJECT_PT_transform').closed, true);
assert.ok(!find(drawn, 'OBJECT_PT_transform').parts.some((part) => part.part === 'body'));

// The header (PROPERTIES_HT_header) and a menu of Blender's Python, its items operators with their properties.
const header = area.inContext(RGN_TYPE_HEADER, (C) => regionHeader(C));
assert.ok(header.length && buttons(header[0]).length, 'the header lays out');
const menu = area.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'OBJECT_MT_modifier_add'));
assert.equal(menu.kind, 'menu');
const enumMenu = buttons(header[0]).find((b) => b.opens);
if (enumMenu) assert.equal(area.inContext(RGN_TYPE_HEADER, (C) => buttonMenu(C, enumMenu)).kind, 'menu');
console.log(`Blender's uiLayout: ${drawn.length} panels, the header and menus as trees`);
