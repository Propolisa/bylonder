// The scene's export settings Bylonder keeps in the .blend (`scene.bylonder`, a custom property desktop Blender keeps):
// which modifier stack a package evaluates. File > Export > JavaScript and the Game area's header show and set the one
// value.
import { __class__, __kwargtrans__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { defineAssignedProperties, registerClass } from '../python/bpy_rna.js';
import { sceneOf } from './controls-export.js';

// [identifier, name, description], as an EnumProperty's items.
export const EVALUATIONS = [
  ['RENDER', 'Render', 'As Blender renders: what Disable in Viewports leaves off (a rig\'s render meshes, face lattices) is evaluated too'],
  ['VIEWPORT', 'Viewport', 'As the viewport shows: what Disable in Viewports leaves off stays off'],
];

const kw = (keywords) => __kwargtrans__(keywords);

/** Registers `scene.bylonder`, once Blender's Python is loaded. */
export function registerExportSettings() {
  const types = globalThis.__py_modules['_bpy.types'], props = globalThis.__py_modules['_bpy.props'];
  const Group = __class__('BYLONDER_PG_scene', [types.PropertyGroup], {
    __annotations__: {
      export_evaluation: props.EnumProperty(kw({ name: 'Modifier Stack', description: 'Which modifier stack a package evaluates', items: EVALUATIONS, default: 'RENDER', options: new Set() })),
    },
  });
  registerClass(Group);
  types.Scene.bylonder = props.PointerProperty(kw({ type: Group, name: 'Bylonder', description: "Bylonder's settings of the scene" }));
  defineAssignedProperties();
}

/** The scene's modifier stack for packages: Render where the setting is not registered. */
export const exportEvaluation = (world) => (world.mainSync && sceneOf(world.mainSync).bylonder?.export_evaluation) || 'RENDER';

/** Sets the scene's modifier stack for packages, where Main holds the scene. */
export function setExportEvaluation(world, value) {
  const settings = world.mainSync && sceneOf(world.mainSync).bylonder;
  if (settings) settings.export_evaluation = value;
}
