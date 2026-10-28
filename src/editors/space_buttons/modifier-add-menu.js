// Blender's Add Modifier menu (properties_data_modifier.py, in Blender's Python tree), showing the
// entries whose modifier Bylonder has.
import { menus } from '../../python/bpy_interface.js';
import { drawMenu, menuCoverage } from '../interface/ui-layout.js';
import { modifierDefinitions } from '../../modifiers/stack.js';

// Blender's node group assets that are Bylonder modifiers, by asset name.
const ASSETS = { Array: 'GN_ARRAY' };
const modifierType = (idname, props) =>
  idname === 'object.modifier_add' ? props.type : ASSETS[props.relative_asset_identifier?.split('/').at(-1)];

const modifierAddUI = (world, node, added) => ({
  menus,
  context: () => ({ object: { py_metatype: 'MESH' } }),
  supported: (idname, props) => world.modifiers.definitions.has(modifierType(idname, props)),
  poll: () => true,
  keys: () => undefined,
  run: (idname, props) => added(world.modifiers.add(node, modifierType(idname, props))),
});

export const modifierAddMenu = (world, node, added) => drawMenu('OBJECT_MT_modifier_add', modifierAddUI(world, node, added));

// The menus and entries Bylonder shows, for the Blender coverage view.
export const modifierMenuCoverage = () =>
  menuCoverage('OBJECT_MT_modifier_add', modifierAddUI({ modifiers: { definitions: modifierDefinitions } }, null, () => {}));
