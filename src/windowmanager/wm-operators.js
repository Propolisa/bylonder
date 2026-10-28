// Bylonder's implementations of Blender's operators, by idname, and the draw functions added to Blender's menus, for
// the menus and headers drawn from Blender's own scripts (src/bl_ui, drawn by editors/interface/ui-layout.js).
// Operators Blender lacks (Bylonder's project and code features) are registered as `bylonder.*`, and added to Blender's
// menus with appendMenu, as add-ons extend Blender.
import { operatorKeys } from './input/keymap.js';
import { blenderKeys } from './keyconfig.js';
import rnaOperators from '../makesrna/rna-operators.json' with { type: 'json' };

const operators = new Map(), extensions = new Map();

// An operator: run(props, event), optionally poll(props, event) (the event when a key or click ran it), keys(props) for its shortcut when no keymap binds it, supports(props) when Bylonder runs it
// with some properties only and enumItems(prop) for its enum properties' items where they differ from Blender's
// (src/makesrna/rna-operators.json), as [identifier, name, description, icon].
export function registerOperator(idname, operator) {
  operators.set(idname, operator);
}

export function registerOperators(table) {
  for (const [idname, operator] of Object.entries(table)) registerOperator(idname, operator);
}

export const runOperator = (idname, props = {}) => operators.get(idname).run(props);

// Runs an operator from an event (a keymap item's) when Bylonder runs it with these properties and it polls; returns
// whether it ran. run and poll get the event too. An operator with `confirm: { title, button }` asks first, as
// WM_operator_confirm_ex does, unless its confirm property (default from Blender's RNA) is off.
export function invokeOperator(idname, props, event) {
  const operator = operators.get(idname);
  if (!operator || !(operator.supports?.(props) ?? true) || !(operator.poll?.(props, event) ?? true)) return false;
  const confirm = operator.confirm && (props.confirm ?? rnaOperators[idname]?.properties.confirm?.default ?? true);
  if (confirm) {
    import('../editors/interface/menu.js').then(({ openMenu }) =>
      openMenu([{ label: operator.confirm.button, run: () => operator.run(props, event) }], event, operator.confirm.title));
  }
  else operator.run(props, event);
  return true;
}

const extension = (idname) => extensions.get(idname) ?? extensions.set(idname, { prepend: [], append: [] }).get(idname);
// Menu.append and Menu.prepend: draw(self, context), drawing into self.layout.
export const appendMenu = (idname, draw) => extension(idname).append.push(draw);
export const prependMenu = (idname, draw) => extension(idname).prepend.push(draw);

// Python keyword arguments for a layout call from JS, as Transcrypt passes them.
export const kw = (keywords) => ({ ...keywords, __kwargtrans__: null });

// What drawMenu needs (see ui-layout.js), from the menus (classes by idname), the context the scripts read, the
// properties Bylonder binds (prop(data, name) giving { label, get, set }) and the Blender keymaps whose shortcuts the
// menus show where Bylonder binds none (keymaps() giving their names, in the order Blender's handlers run).
export const menuUI = ({ menus, context, prop, keymaps = () => ['Window', 'Screen'] }) => ({
  menus,
  context,
  prop,
  extensions: (idname) => extensions.get(idname),
  supported: (idname, props) => !!operators.get(idname) && (operators.get(idname).supports?.(props) ?? true),
  poll: (idname, props) => operators.get(idname)?.poll?.(props) ?? true,
  run: runOperator,
  keys: (idname, props) => operators.get(idname)?.keys?.(props) ?? operatorKeys(idname, props) ?? blenderKeys(keymaps(), idname, props),
  enumItems: (idname, prop) => operators.get(idname)?.enumItems?.(prop) ?? rnaOperators[idname]?.properties[prop]?.items ?? [],
});

// A script's menu classes by idname (the module's exports named *_MT_*).
export const menuClasses = (...modules) =>
  Object.fromEntries(modules.flatMap((module) => Object.entries(module)).filter(([name]) => name.includes('_MT_')));
