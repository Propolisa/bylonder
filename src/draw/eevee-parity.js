// EEVEE Parity, a Bylonder render setting of the Scene (Properties > Render, its panel marked with the Bylonder icon):
// Bylonder's extensions of Babylon's materials that draw as EEVEE does. On (the default), a material lights each
// reflection lobe on its own and takes an orthographic view's direction; off, materials draw as plain Babylon PBR, as
// an export without the option loads anywhere. Saved in the .blend as `scene.bylonder_render.use_eevee_parity`, a
// custom property desktop Blender keeps.
import { Constants, Observable } from '@babylonjs/core';
import { __class__, __kwargtrans__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { defineAssignedProperties, idStruct, registerClass } from '../python/bpy_rna.js';

const parity = new WeakMap();
// Told with the Babylon scene whose setting changed: its node materials build again.
export const eeveeParityChanged = new Observable();
export const eeveeParity = (scene) => parity.get(scene) ?? true;
export function setEeveeParity(scene, value) {
  if (eeveeParity(scene) === value) return;
  parity.set(scene, value);
  scene.markAllMaterialsAsDirty(Constants.MATERIAL_MiscDirtyFlag);
  eeveeParityChanged.notifyObservers(scene);
}
// The setting of Blender's scene (an ID pointer) for the Babylon scene drawing it.
export const pullEeveeParity = (scene, sce) => setEeveeParity(scene, idStruct(sce).bylonder_render?.use_eevee_parity ?? true);

export const EEVEE_PARITY_DESCRIPTION = 'Draw materials as EEVEE does with Bylonder\'s extensions of Babylon\'s materials: each glossy lobe lit on its own '
  + 'and an orthographic view\'s direction. Off draws them as plain Babylon PBR';

const kw = (keywords) => __kwargtrans__(keywords);
const types = () => globalThis.__py_modules['_bpy.types'];
const props = () => globalThis.__py_modules['_bpy.props'];

// The property and its panel, once Blender's Python is loaded; `icon` is the Bylonder icon's icon_value.
export function registerEeveeParityTypes(icon) {
  const Group = __class__('BYLONDER_PG_scene_render', [types().PropertyGroup], {
    __annotations__: { use_eevee_parity: props().BoolProperty(kw({ name: 'EEVEE Parity', description: EEVEE_PARITY_DESCRIPTION, default: true, options: new Set() })) },
  });
  registerClass(Group);
  types().Scene.bylonder_render = props().PointerProperty(kw({ type: Group, name: 'Bylonder Render', description: "Bylonder's render settings of the scene" }));
  defineAssignedProperties();
  registerClass(__class__('RENDER_PT_bylonder_eevee_parity', [types().Panel], {
    bl_label: 'EEVEE Parity', bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: 'render',
    draw_header(context) { this.layout.label(kw({ text: '', icon_value: icon })); },
    draw(context) {
      const { layout } = this;
      layout.use_property_split = true;
      layout.use_property_decorate = false;
      layout.prop(context.scene.bylonder_render, 'use_eevee_parity', kw({ text: 'Materials as EEVEE' }));
      layout.label(kw({ text: context.scene.bylonder_render.use_eevee_parity ? 'Lobes and orthographic view as EEVEE' : 'Plain Babylon PBR', icon: 'INFO' }));
    },
  }));
}
