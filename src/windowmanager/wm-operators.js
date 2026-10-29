// Bylonder's implementations of Blender's operators, by idname, and the draw functions added to Blender's menus.
// Operators Blender lacks (Bylonder's project and code features) are registered as `bylonder.*` and become Blender's
// operator types (python/bpy_interface.js), and appendMenu adds them to Blender's menus, as add-ons extend Blender.
import { operatorKeys, setProperties } from './input/keymap.js';
import { blenderKeys } from './keyconfig.js';
import rnaOperators from '../makesrna/rna-operators.json' with { type: 'json' };
import { operatorFinished } from './wm-reports.js';

const operators = new Map(), spaceOperators = new Map();
// Who is told of each registration (bpy_interface.js, which makes Blender's types of Bylonder's operators).
const registrations = new Set();
export const onRegister = (fn) => { registrations.add(fn); for (const idname of new Set([...operators.keys(), ...[...spaceOperators.values()].flatMap((m) => [...m.keys()])])) fn(idname); };

// An operator: run(props, event), optionally poll(props, event) (the event when a key or click ran it), keys(props) for its shortcut when no keymap binds it, supports(props) when Bylonder runs it
// with some properties only and enumItems(prop) for its enum properties' items where they differ from Blender's
// (src/makesrna/rna-operators.json), as [identifier, name, description, icon]. One registered for a space type
// ('GRAPH_EDITOR') runs when the context area is of that space, as Blender's operators act on the context area's space
// (transform in a Graph Editor moves keys); elsewhere the operator registered without one runs.
export function registerOperator(idname, operator, space = null) {
  if (space) (spaceOperators.get(space) ?? spaceOperators.set(space, new Map()).get(space)).set(idname, operator);
  else operators.set(idname, operator);
  registrations.forEach((fn) => fn(idname));
}

// Registers Blender's own operator behind one Bylonder registered: Bylonder's runs the calls it supports and polls
// (object.mode_set into a mesh's Edit Mode), Blender's the others (an armature's Pose Mode), and the enum items are
// Blender's. Bylonder's runs it in Blender's window too.
export function registerFallback(idname, fallback) {
  const own = operators.get(idname);
  if (!own) return registerOperator(idname, fallback);
  const takes = (props, event) => (own.supports?.(props) ?? true) && (own.poll?.(props, event) ?? true);
  registerOperator(idname, {
    ...fallback,
    blender: false,
    poll: (props, event) => takes(props, event) || (fallback.poll?.(props, event) ?? true),
    run: (props, event) => (takes(props, event) ? own : fallback).run(props, event),
    enumItems: (prop) => fallback.enumItems?.(prop) ?? own.enumItems?.(prop),
  });
}

export function registerOperators(table, space = null) {
  for (const [idname, operator] of Object.entries(table)) registerOperator(idname, operator, space);
}

const operatorFor = (idname) => (area?.space && spaceOperators.get(area.space)?.get(idname)) ?? operators.get(idname);
// Whether Bylonder's registry runs an operator (its own way, or Blender's with the scene made current around it).
export const runsOperator = (idname) => !!operatorFor(idname);

// A finished operator reports its call (wm-reports.js).
const finished = (idname, props, result) => {
  if ((result ?? 'FINISHED') === 'FINISHED') operatorFinished(idname, props);
  return result;
};
export const runOperator = (idname, props = {}) => finished(idname, props, operatorFor(idname).run(props));
export const hasOperator = (idname) => operators.has(idname);
export const operatorIds = () => [...operators.keys()];
// The operators Bylonder runs as Blender's own code (registered with `blender: true`), which Blender's window may run.
export const blenderOperatorIds = () => [...operators].filter(([, operator]) => operator.blender).map(([idname]) => idname);
export const spaceOperatorIds = () => Object.fromEntries([...spaceOperators].map(([space, table]) => [space, [...table.keys()]]));
// Whether an operator is registered and can run now with those properties (WM_operator_poll).
export const pollOperator = (idname, props = {}) => { const operator = operatorFor(idname); return !!operator && (operator.supports?.(props) ?? true) && (operator.poll?.(props) ?? true); };

// Runs an operator from an event (a keymap item's) when Bylonder runs it with these properties and it polls. Returns
// false when it did not run, else what run returned, as Blender's operators do: 'FINISHED' (or nothing),
// 'CANCELLED' or 'PASS_THROUGH', after which the event goes on to the next handler. run and poll get the event too.
// An operator with `confirm: { title, button }` asks first, as WM_operator_confirm_ex does, unless its confirm property
// (default from Blender's RNA) is off.
export function invokeOperator(idname, props, event) {
  const operator = operatorFor(idname);
  if (!operator || !(operator.supports?.(props) ?? true) || !(operator.poll?.(props, event) ?? true)) return false;
  const confirm = operator.confirm && (props.confirm ?? rnaOperators[idname]?.properties.confirm?.default ?? true);
  if (!confirm) return finished(idname, props, operator.run(props, event)) ?? 'FINISHED';
  import('../editors/interface/menu.js').then(({ openMenu }) =>
    openMenu([{ label: operator.confirm.button, run: () => finished(idname, props, operator.run(props, event)) }], event, operator.confirm.title));
  return 'FINISHED';
}

// The area an event is handled in, Blender's context area: an editor sets it while its keymaps run, so operators act
// on that editor. An area is { menu(idname): a Blender menu's popup opener, or null when the area has none, space: its
// Blender space type when operators are registered for it, ... }.
let area = null;
export function inArea(handled, run) {
  const outer = area;
  area = handled;
  try {
    return run();
  } finally {
    area = outer;
  }
}
export const contextArea = () => area;

// wm.call_menu: one of Blender's menus as a popup, from the area that has it.
registerOperator('wm.call_menu', {
  supports: ({ name }) => !!area?.menu(name),
  run: ({ name }, event) => area.menu(name)(event),
});

// Menu.append and Menu.prepend: draw(self, context), drawing into self.layout; given to Blender's menu types once
// Blender's Python has loaded (extendMenus, bpy_interface.js).
let extend = null;
const pending = [];
export const appendMenu = (idname, draw) => (extend ? extend(idname, 'append', draw) : pending.push([idname, 'append', draw]));
export const prependMenu = (idname, draw) => (extend ? extend(idname, 'prepend', draw) : pending.push([idname, 'prepend', draw]));
export function extendMenus(fn) {
  extend = fn;
  pending.splice(0).forEach((args) => fn(...args));
}

// Python keyword arguments for a layout call from JS, as Transcrypt passes them.
export const kw = (keywords) => ({ ...keywords, __kwargtrans__: null });

// An operator's own keys(props) as a binding of the properties it reads: a button setting others has no shortcut.
function ownKeys(operator, props) {
  if (!operator?.keys) return undefined;
  const read = new Set(), keys = operator.keys(new Proxy(props, { get: (target, name) => (read.add(name), target[name]) }));
  return Object.keys(props).every((name) => read.has(name)) ? keys : undefined;
}

// What drawMenu needs (see ui-layout.js), from the menus (classes by idname), the context the scripts read, the
// properties Bylonder binds (prop(data, name) giving { label, get, set }) and the Blender keymaps whose shortcuts the
// menus show where Bylonder binds none (keymaps() giving their names, in the order Blender's handlers run).
export const menuUI = ({ menus, context, prop, keymaps = () => ['Window', 'Screen'] }) => ({
  menus,
  context,
  prop,
  supported: (idname, props) => !!operatorFor(idname) && (operatorFor(idname).supports?.(props) ?? true),
  poll: (idname, props) => operatorFor(idname)?.poll?.(props) ?? true,
  run: runOperator,
  // An operator button's shortcut, as Blender's buttons find it: a binding whose properties are the ones the button sets.
  keys: (idname, props) => ownKeys(operatorFor(idname), setProperties(idname, props)) ?? operatorKeys(idname, props) ?? blenderKeys(keymaps(), idname, props, true),
  enumItems: (idname, prop) => operatorFor(idname)?.enumItems?.(prop) ?? rnaOperators[idname]?.properties[prop]?.items ?? [],
});

// A script's menu classes by idname (the module's exports named *_MT_*).
export const menuClasses = (...modules) =>
  Object.fromEntries(modules.flatMap((module) => Object.entries(module)).filter(([name]) => name.includes('_MT_')));
