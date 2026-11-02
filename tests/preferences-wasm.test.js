// Blender's Preferences in the module (windowmanager/wm-userdef.js): Save Preferences writes userpref.blend into Blender's
// user directory, Load Factory Settings and Revert read as Blender reads them; the key configuration is Blender's own
// preset loaded with the Preferences (wm-window.js), the page's keymaps read its user key configuration, and a rebound
// key is kept with the Preferences.
import assert from 'node:assert/strict';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import { files } from '../src/port/wasm.js';
import '../src/python/bpy_interface.js';
import { setContextPointer, contextStruct } from '../src/python/bpy_rna.js';
import { loadKeyconfig, keyconfigUpdated } from '../src/windowmanager/wm-window.js';
import { keyconfig, blenderKeys } from '../src/windowmanager/keyconfig.js';
import { readPreferences, preferences, inputPreferences, preferencesChanged } from '../src/windowmanager/wm-userdef.js';
import { registerBylonderPreferences, bylonderPreferences } from '../src/workspace/preferences.js';

const blender = blenderMain();
setContextPointer(blender.C);
readPreferences();
registerBylonderPreferences(0);
loadKeyconfig(blender.C);
const prefs = preferences();

// Factory settings: Blender's defaults, and Bylonder's own add-on enabled with its defaults.
assert.equal(prefs.inputs.drag_threshold_mouse, 3);
assert.equal(prefs.inputs.use_mouse_emulate_3_button, false);
assert.equal(bylonderPreferences().keep_scenes_loaded, true);
assert.equal(prefs.addons.get('bylonder').module, 'bylonder');

// Blender's keymaps reach the page: the 3D View's numpad views, the menus' shortcuts, Select With's default.
assert.ok(keyconfig().get('3D View').some(([idname, event, data]) => idname === 'view3d.view_axis' && event.type === 'NUMPAD_1' &&
  data.properties.some(([name, value]) => name === 'type' && value === 'FRONT')));
assert.equal(blenderKeys(['Object Mode'], 'object.delete', { use_global: false }), 'X');
const kc = contextStruct(blender.C).window_manager.keyconfigs;
assert.equal(kc.default.preferences.select_mouse, 'LEFT');

// Emulate 3 Button Mouse reloads the key configuration Blender's way and reaches the page's input.
prefs.inputs.use_mouse_emulate_3_button = true;
preferencesChanged();
assert.equal(inputPreferences().emulate_3_button, true);
assert.ok(prefs.is_dirty);

// A rebound key (Delete in Object Mode on Y) applies to the page's keymaps.
const item = [...kc.user.keymaps.get('Object Mode').keymap_items].find((kmi) => kmi.idname === 'object.delete' && kmi.type === 'X');
item.type = 'Y';
keyconfigUpdated(blender.C);
assert.equal(blenderKeys(['Object Mode'], 'object.delete', { use_global: false }), 'Y');

// Bylonder's own settings are part of the Preferences.
bylonderPreferences().keep_scenes_loaded = false;

// Save Preferences writes Blender's userpref.blend into the user directory, which the page keeps.
assert.equal(blender.run('wm.save_userpref').report, 'Preferences saved');
assert.ok(files.has('/user/5.2/config/userpref.blend'));

// Load Factory Settings: everything back to Blender's defaults.
blender.run('wm.read_factory_userpref');
assert.equal(prefs.inputs.use_mouse_emulate_3_button, false);

// Revert to Saved Preferences reads them back: the input setting, Bylonder's setting and the rebound key.
readPreferences();
assert.equal(prefs.inputs.use_mouse_emulate_3_button, true);
assert.equal(bylonderPreferences().keep_scenes_loaded, false);
loadKeyconfig(blender.C);
assert.equal(blenderKeys(['Object Mode'], 'object.delete', { use_global: false }), 'Y');
console.log('preferences ok');
