// tags: behaviors
// Object properties > Behaviors (editors/space_buttons/behaviors-panel.js), laid out by Blender's uiLayout in the
// module: Add Behavior lists the project's behaviours with their user counts and adds one with its props' defaults;
// the panel draws each behaviour's name (Edit Source), its user count with its users as the tooltip, and its props as
// Blender properties, an enum Blender's dropdown with stable item values; an enum value set, a user selected, a behaviour removed; Shift D copies them.
import assert from 'node:assert/strict';
import { BlenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { blendData, contextStruct, setContextPointer } from '../src/python/bpy_rna.js';
import { AnimArea, RGN_TYPE_WINDOW, OPERATOR_FINISHED } from '../src/editors/animation/anim-area.js';
import { regionPanels, menuTree } from '../src/editors/interface/ui-tree.js';
import { editSource, operatorTip } from '../src/windowmanager/wm-operators.js';
import { registerBehaviorTypes } from '../src/editors/space_buttons/behaviors-panel.js';
import { behaviorNames } from '../src/blenkernel/behaviors.js';
import { defineBehavior, float, color, enumOf, enumValue, propValue } from '../src/io_scene_babylon/runtime/game/define.js';

const SPACE_PROPERTIES = 4;
const blender = new BlenderMain();
const rock = blender.add('MESH', 'Rock'), stone = blender.add('MESH', 'Stone');
blender.setBase(rock, { select: true, active: true });
setContextPointer(blender.C);
const Rock = defineBehavior({ name: 'Rock', props: { patience: float(8, { min: 1 }), stain: color([0.24, 0.14, 0.07]), mood: enumOf(['grumpy', 'content']) }, create: () => ({}) });
const Spin = defineBehavior({ name: 'Spin', requires: ['Rock'], create: () => ({}) });
const edits = [], selected = [], changes = [];
registerBehaviorTypes({ icon: 0, code: () => ({ behaviors: [Rock, Spin], sourceOf: (name) => `src/behaviors/${name.toLowerCase()}.js` }),
  editSource: (path, name) => edits.push([path, name]), select: (ob) => selected.push(ob.name), changed: () => changes.push(1) });

const area = new AnimArea(blender, SPACE_PROPERTIES);
area.layout(RGN_TYPE_WINDOW, 0, 0, 400, 1600);
const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));
const panel = () => area.inContext(RGN_TYPE_WINDOW, (C) => regionPanels(C)).panels.find((p) => p.id === 'OBJECT_PT_bylonder_behaviors');
const panelButtons = () => panel().parts.flatMap((part) => buttons(part.layout));

// Add Behavior: the project's behaviours; one that requires another is offered once the object has it.
let menu = buttons(area.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'OBJECT_MT_bylonder_behavior_add')));
assert.deepEqual(menu.filter((b) => b.operator).map((b) => [b.text, !!b.disabled]), [['Rock', false], ['Spin', true]]);
assert.equal(blender.run('bylonder.behavior_add', { name: 'Rock' }).status, OPERATOR_FINISHED);
const ob = blendData().objects.get('Rock');
assert.deepEqual(behaviorNames(ob), ['Rock']);
menu = buttons(area.inContext(RGN_TYPE_WINDOW, (C) => menuTree(C, 'OBJECT_MT_bylonder_behavior_add')));
assert.deepEqual(menu.filter((b) => b.operator).map((b) => [b.text, !!b.disabled]), [['Rock  1', true], ['Spin', false]], 'counts, and Spin offered now');

// The panel: name, user count, remove, the props as Blender properties.
let drawn = panelButtons();
assert.deepEqual(drawn.filter((b) => b.operator).slice(0, 4).map((b) => [b.operator, b.text]),
  [['bylonder.behavior_edit_source', 'Rock'], ['bylonder.behavior_users', '1'], ['bylonder.behavior_remove', undefined]]);
assert.deepEqual(drawn.filter((b) => b.rna).map((b) => [b.rna.prop, b.type]), [['patience', 'NUM'], ['stain', 'COLOR'], ['mood', 'MENU']]);
assert.equal(drawn.find((b) => b.rna?.prop === 'mood').text, 'Grumpy', 'the enum a dropdown showing its item');
assert.equal(operatorTip('bylonder.behavior_users', { name: 'Rock' }), 'Used by Rock. Click to select one');

// An enum value set; Edit Source; a user selected.
const group = ob.get('behaviors').get('Rock');
group['["mood"]'] = enumValue('content');
assert.equal(propValue(Rock.props.mood, group.get('mood')), 'content', 'the run reads the item by its value');
assert.equal(panelButtons().find((b) => b.rna?.prop === 'mood').text, 'Content');
// Reordered options in code keep what objects chose: values are the items' own.
assert.equal(propValue(enumOf(['content', 'grumpy']), group.get('mood')), 'content');
blender.run('bylonder.behavior_edit_source', { name: 'Rock' });
assert.deepEqual(edits, [['src/behaviors/rock.js', 'Rock']]);
// Blender's Edit Source (ui.editsource) in a button's context menu, with Developer Extras: on a prop of the behaviour,
// its code; on a button Bylonder has no source for, nothing.
const contextMenu = (b) => area.inContext(RGN_TYPE_WINDOW, (C) => blenderModule.exports.ui_button_context_menu(C, b.id)
  && buttons(JSON.parse(blenderModule.cString(blenderModule.exports.operator_popup_text()))).map((item) => item.operator));
const moodButton = () => panelButtons().find((b) => b.rna?.prop === 'mood');
assert.ok(!contextMenu(moodButton()).includes('ui.editsource'), 'no Edit Source without Developer Extras');
contextStruct(blender.C).preferences.view.show_developer_ui = true;
assert.ok(contextMenu(moodButton()).includes('ui.editsource'), 'Edit Source with Developer Extras');
assert.ok(editSource(moodButton()), 'Edit Source on a prop opens its behaviour');
assert.deepEqual(edits.at(-1), ['src/behaviors/rock.js', 'Rock']);
assert.ok(!editSource(panelButtons().find((b) => b.operator === 'bylonder.behavior_users')), 'none for a button without a source');
blender.run('bylonder.behavior_select_user', { name: 'Rock' });
assert.deepEqual(selected, ['Rock']);

// Shift D: the copy carries the behaviour and its props, Blender copying the custom properties.
blender.run('object.duplicate');
const copy = [...blendData().objects].find((o) => o.name.startsWith('Rock.'));
assert.ok(copy, 'duplicated');
assert.deepEqual(behaviorNames(copy), ['Rock']);
assert.equal(copy.get('behaviors').get('Rock').get('mood'), enumValue('content'));
assert.equal(operatorTip('bylonder.behavior_users', { name: 'Rock' }), `Used by Rock, ${copy.name}. Click to select one`);

// Removed from the active object, the copy; the original keeps it.
assert.equal(blender.run('bylonder.behavior_remove', { name: 'Rock' }).status, OPERATOR_FINISHED);
assert.deepEqual(behaviorNames(copy), []);
assert.deepEqual(behaviorNames(ob), ['Rock']);
assert.equal(changes.length, 2, 'the add and the remove are followed');
assert.ok(blendData().objects.get('Stone') && !behaviorNames(blendData().objects.get('Stone')).length);
console.log('Behaviors panel: Add Behavior with user counts, props as Blender properties, enum, Edit Source, users, Shift D, remove');
