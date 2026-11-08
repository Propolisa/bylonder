// Bylonder's own preferences: the AddonPreferences of Bylonder as a built-in add-on ('bylonder', enabled as Blender
// enables its default add-ons), so they are part of Blender's Preferences, saved and loaded with them
// (windowmanager/wm-userdef.js). The Preferences editor shows them in the System section's Bylonder panel.
import { __class__, __kwargtrans__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { registerClass } from '../python/bpy_rna.js';
import { preferences as userdef } from '../windowmanager/wm-userdef.js';

const ADDON = 'bylonder';
const kw = (keywords) => __kwargtrans__(keywords);
const types = () => globalThis.__py_modules['_bpy.types'];
const props = () => globalThis.__py_modules['_bpy.props'];

// Each setting: [name, label, description, default], booleans.
const SETTINGS = [
  ['keep_scenes_loaded', 'Keep Scenes Loaded', 'Scenes stay loaded after switching away, so switching back is instant. Uses more memory and graphics contexts', true],
  ['ask_sequencer_setup', 'Ask to Set Up for Video Editing', 'When the Video Sequencer opens on an empty edit, offer to render video and add the scene; off uses the remembered choice', true],
  ['sequencer_setup_video', 'Video Output', 'Remembered choice: render the edit as MPEG-4 video', true],
  ['sequencer_setup_scene', 'Scene Strip', 'Remembered choice: add the active scene as a strip', true],
  ['sequencer_setup_audio', 'Scene Audio', "Remembered choice: add the scene's sound beside its strip", true],
];

// Bylonder's AddonPreferences ('bylonder') and its panel, once Blender's Python is loaded; `icon` is the Bylonder
// icon's icon_value. The add-on is enabled once, as addon_utils.enable adds it to the Preferences.
export function registerBylonderPreferences(icon) {
  registerClass(__class__('BYLONDER_AP_preferences', [types().AddonPreferences], {
    bl_idname: ADDON,
    __annotations__: {
      ...Object.fromEntries(SETTINGS.map(([name, label, description, value]) => [name, props().BoolProperty(kw({ name: label, description, default: value }))])),
      gpu_backend: props().EnumProperty(kw({ name: 'GPU Backend', description: 'The graphics API the views draw with, used from the next start',
        items: [['WEBGL2', 'WebGL 2', "Babylon's WebGL 2 engine"], ['WEBGPU', 'WebGPU (Preview)', "Babylon's WebGPU engine, where the browser has it; WebGL 2 otherwise"]], default: 'WEBGL2' })),
    },
    draw(context) { drawSettings(this.layout, this); },
  }));
  registerClass(__class__('USERPREF_PT_bylonder', [types().Panel], {
    bl_label: 'Bylonder', bl_space_type: 'PREFERENCES', bl_region_type: 'WINDOW', bl_context: 'system',
    draw_header(context) { this.layout.label(kw({ text: '', icon_value: icon })); },
    draw(context) { drawSettings(this.layout, bylonderPreferences()); },
  }));
  if (!userdef().addons.get(ADDON)) userdef().addons.py_new().module = ADDON;
}

function drawSettings(layout, settings) {
  layout.use_property_split = true;
  layout.use_property_decorate = false;
  layout.prop(settings, 'gpu_backend');
  layout.prop(settings, 'keep_scenes_loaded');
  layout.prop(settings, 'ask_sequencer_setup');
  const remembered = layout.column(kw({ heading: 'Video Editing Setup', align: true }));
  remembered.active = !settings.ask_sequencer_setup;
  for (const name of ['sequencer_setup_video', 'sequencer_setup_scene', 'sequencer_setup_audio']) remembered.prop(settings, name);
}

export const bylonderPreferences = () => userdef().addons.get(ADDON)?.preferences ?? null;
