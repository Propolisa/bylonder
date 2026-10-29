import assert from 'node:assert/strict';
import { BlenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { blendData, setContextPointer, pointerStruct, structFind } from '../src/python/bpy_rna.js';
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
const spaceOf = (a) => pointerStruct(structFind('SpaceProperties'), 0, blenderModule.exports.anim_area_space(a.pointer) >>> 0);
area.layout(RGN_TYPE_WINDOW, 0, 0, 400, 800);
area.layout(RGN_TYPE_HEADER, 0, 800, 400, 26);
const panels = () => area.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C)).panels;
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

// The Modifiers tab: Blender's template_modifiers lays out each modifier of Main's object as its instanced panel
// (panel_draw in MOD_*.cc), sub-panels with their header's checkbox.
const array = ob.modifiers.new('Array', 'ARRAY');
array.use_relative_offset = false;
spaceOf(area).context = 'MODIFIER';
const modifierPanels = panels().filter((panel) => /array/i.test(panel.id));
assert.equal(modifierPanels.length, 1, 'one instanced panel per modifier');
const part = (panel, name) => buttons(panel.parts.find((p) => p.part === name).layout).filter((b) => b.rna).map((b) => b.rna.prop);
assert.deepEqual(part(modifierPanels[0], 'body').slice(0, 2), ['fit_type', 'count'], 'MOD_array.cc panel_draw');
assert.ok(part(modifierPanels[0], 'header').includes('show_viewport'), 'modifier_panel_header');
const relative = modifierPanels[0].children.find((child) => child.id.endsWith('relative_offset'));
assert.ok(relative, 'the Relative Offset sub-panel');
assert.equal(panelButtons(relative).find((b) => b.type === 'CHECKBOX')?.rna.prop, 'use_relative_offset');

// The Displace panel: its texture's selector with Blender's New operator, its coordinates active once it has one.
const displace = ob.modifiers.new('Displace', 'DISPLACE');
const displaceButtons = () => panels().filter((panel) => /displace/i.test(panel.id)).flatMap(panelButtons);
assert.ok(displaceButtons().some((b) => b.operator === 'texture.new'), 'template_ID offers New');
assert.equal(displaceButtons().find((b) => b.rna?.prop === 'texture_coords').inactive, true);
displace.texture = blendData().textures.new('Texture', 'CLOUDS');
assert.ok(!displaceButtons().find((b) => b.rna?.prop === 'texture_coords').inactive, 'active with a texture');

// The header (PROPERTIES_HT_header) and a menu of Blender's Python, its items operators with their properties.
const header = area.inContext(RGN_TYPE_HEADER, (C) => regionHeader(C));
assert.ok(header.length && buttons(header[0]).length, 'the header lays out');
const menu = area.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'OBJECT_MT_modifier_add'));
assert.equal(menu.kind, 'menu');
const enumMenu = buttons(header[0]).find((b) => b.opens);
if (enumMenu) assert.equal(area.inContext(RGN_TYPE_HEADER, (C) => buttonMenu(C, enumMenu)).kind, 'menu');
console.log(`Blender's uiLayout: ${drawn.length} panels, the header and menus as trees`);
