// Operator buttons show a shortcut only where a binding's properties are the ones the button sets, as Blender's
// buttons find it (ui_but_event_operator_string, WM_key_event_operator_string with is_strict).
import assert from 'node:assert/strict';
import { menus, module } from '../src/python/bpy_interface.js';
import { drawMenu } from '../src/editors/interface/ui-layout.js';
import { menuUI, registerOperators } from '../src/windowmanager/wm-operators.js';
import { createKeymap, operatorKeys } from '../src/windowmanager/input/keymap.js';

// Bylonder's own keys(props) bind the properties they read: wm.read_homefile's Ctrl N reads none.
registerOperators({
  'wm.read_homefile': { keys: () => 'Ctrl N', run() {} },
  'wm.save_as_mainfile': { keys: ({ copy }) => (copy ? undefined : 'Shift Ctrl S'), run() {} },
});
// The topbar's context (workspace/topbar.js).
const context = () => ({
  area: { show_menus: true }, blend_data: { is_saved: true }, view_layer: { has_export_collections: false }, preferences: { view: { show_developer_ui: false } },
  scene: { render: { use_multiview: false } }, sequencer_scene: null, tool_settings: {}, screen: { show_statusbar: true, show_fullscreen: false }, window: {},
});
const ui = menuUI({ menus, context });
assert.equal(ui.keys('wm.read_homefile', {}), 'Ctrl N');
assert.equal(ui.keys('wm.read_homefile', { app_template: 'Still Life' }), undefined, 'a property the binding does not set');
assert.equal(ui.keys('wm.save_as_mainfile', { copy: false }), 'Shift Ctrl S', 'a property at its default is no difference');
assert.equal(ui.keys('wm.save_as_mainfile', { copy: true }), undefined);

// File > New: the templates (app_template set) show none; File's New entry shows Blender's Ctrl N, which opens it.
module('os.path')._mount('/blender/scripts/startup/bl_app_templates_system', ['Default Cube', 'Still Life']);
const fileNew = drawMenu('TOPBAR_MT_file_new', ui);
assert.deepEqual(fileNew.filter((item) => item.label).map((item) => [item.label, item.keys]),
  [['General', undefined], ['Default Cube', undefined], ['Still Life', undefined]]);
assert.equal(drawMenu('TOPBAR_MT_file', ui).find((item) => item.label === 'New').keys, 'Ctrl N');

// Bylonder's keymaps: a binding with properties for a button setting them, one without for a button setting none.
const keymaps = [createKeymap([
  { keys: 'A', blender: 'mesh.select_all', props: { action: 'SELECT' } },
  { keys: 'Alt A', blender: 'mesh.select_all', props: { action: 'DESELECT' } },
  { keys: 'Ctrl I', blender: 'mesh.select_all:INVERT' },
  { keys: 'G', blender: 'transform.translate' },
])];
assert.equal(operatorKeys('mesh.select_all', { action: 'DESELECT' }, keymaps), 'Alt A');
assert.equal(operatorKeys('mesh.select_all', { action: 'INVERT' }, keymaps), 'Ctrl I', 'an enum value in the binding');
assert.equal(operatorKeys('transform.translate', {}, keymaps), 'G');
assert.equal(operatorKeys('transform.translate', { orient_type: 'NORMAL' }, keymaps), undefined, 'a property the binding does not set');
console.log('Shortcuts: operator buttons match bindings by the properties they set');
