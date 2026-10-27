// Bylonder's implementations of Blender's operators, by idname, and the draw functions added to Blender's menus, for
// the menus and headers drawn from Blender's own scripts (src/bl_ui, drawn by editors/interface/ui-layout.js).
// Operators Blender lacks (Bylonder's project and code features) are registered as `bylonder.*`, and added to Blender's
// menus with appendMenu, as add-ons extend Blender.
const operators = new Map(), extensions = new Map();

// An operator: run(props), optionally poll(), keys(props) for its shortcut and supports(props) when Bylonder runs it
// with some properties only.
export function registerOperator(idname, operator) {
  operators.set(idname, operator);
}

export function registerOperators(table) {
  for (const [idname, operator] of Object.entries(table)) registerOperator(idname, operator);
}

const extension = (idname) => extensions.get(idname) ?? extensions.set(idname, { prepend: [], append: [] }).get(idname);
// Menu.append and Menu.prepend: draw(self, context), drawing into self.layout.
export const appendMenu = (idname, draw) => extension(idname).append.push(draw);
export const prependMenu = (idname, draw) => extension(idname).prepend.push(draw);

// Python keyword arguments for a layout call from JS, as Transcrypt passes them.
export const kw = (keywords) => ({ ...keywords, __kwargtrans__: null });

// What drawMenu needs (see ui-layout.js), from the menus (classes by idname), the context the scripts read, and the
// properties Bylonder binds (prop(data, name) giving { label, get, set }).
export const menuUI = ({ menus, context, prop }) => ({
  menus,
  context,
  prop,
  extensions: (idname) => extensions.get(idname),
  supported: (idname, props) => !!operators.get(idname) && (operators.get(idname).supports?.(props) ?? true),
  poll: (idname) => operators.get(idname)?.poll?.() ?? true,
  run: (idname, props) => operators.get(idname).run(props),
  keys: (idname, props) => operators.get(idname)?.keys?.(props),
  enumItems: () => [],
});

// A script's menu classes by idname (the module's exports named *_MT_*).
export const menuClasses = (...modules) =>
  Object.fromEntries(modules.flatMap((module) => Object.entries(module)).filter(([name]) => name.includes('_MT_')));
