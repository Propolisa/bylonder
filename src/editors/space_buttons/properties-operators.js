// The Properties editor's operators (buttons_ops.cc, and the modifier panels' in object_modifier.cc), run by Blender's
// "Property Editor" keymap in the editor's context area (editor.js), and on the operator buttons its panels draw. The
// area is { properties: the editor, modifier(): the modifier panel under the pointer or the active one, ... }.
import { registerOperators, contextArea } from '../../windowmanager/wm-operators.js';
import { templateIDButton } from '../interface/layout-view.js';

const editor = () => contextArea()?.properties;
const modifier = () => contextArea()?.modifier?.();

registerOperators({
  'screen.space_context_cycle': {
    supports: () => !!editor(),
    run: ({ direction = 'NEXT' }) => editor().cycle(direction === 'PREV' ? -1 : 1),
  },
  'buttons.start_filter': { supports: () => !!editor(), run: () => editor().startFilter() },
  'buttons.clear_filter': { supports: () => !!editor(), run: () => editor().clearFilter() },
  'object.add_modifier_menu': {
    supports: () => !!editor()?.canAddModifier(),
    run: (props, event) => contextArea().menu('OBJECT_MT_modifier_add')(event),
  },
  'material.new': { supports: () => !!editor()?.materials(), run: () => editor().materials().newMaterial() },
  // render_shading.cc's TEXTURE_OT_new, for the data-block selector that runs it.
  'texture.new': { supports: () => !!editor(), run: () => editor().newTexture(templateIDButton()) },
  'object.material_slot_add': { supports: () => !!editor()?.materials(), run: () => editor().materials().add() },
  'object.material_slot_remove': { supports: () => !!editor()?.materials()?.count(), run: () => editor().materials().remove() },
  'object.material_slot_move': { supports: () => (editor()?.materials()?.count() ?? 0) > 1, run: ({ direction = 'UP' }) => editor().materials().move(direction === 'UP' ? -1 : 1) },
  'object.modifier_remove': { supports: () => !!modifier(), run: () => modifier().remove() },
  'object.modifier_copy': { supports: () => !!modifier(), run: () => modifier().duplicate() },
  'object.modifier_apply': { supports: () => !!modifier(), run: () => modifier().apply() },
});
