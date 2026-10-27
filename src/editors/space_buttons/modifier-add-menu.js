// Blender's Add Modifier menu (properties_data_modifier.py, compiled into src/bl_ui by tools/blender-ui), showing the
// entries whose modifier Bylonder has.
import * as properties from '../../bl_ui/properties_data_modifier.js';
import { drawMenu } from '../interface/ui-layout.js';
import { modifierDefinitions } from '../../modifiers/stack.js';

const menus = Object.fromEntries(Object.entries(properties).filter(([name]) => name.includes('_MT_')));
// Blender's node group assets that are Bylonder modifiers, by asset name.
const ASSETS = { Array: 'GN_ARRAY' };
const modifierType = (idname, props) =>
  idname === 'object.modifier_add' ? props.type : ASSETS[props.relative_asset_identifier?.split('/').at(-1)];

export function modifierAddMenu(world, node, added) {
  return drawMenu('OBJECT_MT_modifier_add', {
    menus,
    context: () => ({ object: { py_metatype: 'MESH' } }),
    supported: (idname, props) => world.modifiers.definitions.has(modifierType(idname, props)),
    poll: () => true,
    keys: () => undefined,
    run: (idname, props) => added(world.modifiers.add(node, modifierType(idname, props))),
  });
}

// The menus and entries Bylonder shows, for the Blender coverage view.
export function modifierMenuCoverage() {
  const ids = new Set(['OBJECT_MT_modifier_add']);
  const visit = (items) => items.forEach((item) => {
    if (item === '-') return;
    ids.add(item.blender);
    if (item.items) visit(typeof item.items === 'function' ? item.items() : item.items);
  });
  visit(modifierAddMenu({ modifiers: { definitions: modifierDefinitions } }, null, () => {}));
  return [...ids];
}
