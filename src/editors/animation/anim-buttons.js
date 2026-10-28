// The Graph Editor's sidebar, as Blender's C code draws it in the module (graph_buttons.cc's panels, fmodifier_ui.cc's
// instanced F-Modifier panels): each panel type whose poll passes, recorded by panel-layout.cc (anim_sidebar_panels)
// and drawn by the shared panel renderer as drawPanels gives panels. Their properties are read and written through the
// module's RNA (rna-module.js) for the F-Curve structs, and through Bylonder's bindings for the rest (the space, the
// scene); a raw button runs its functions after it sets its value, or when it is pressed.
import { moduleStruct, moduleStructs } from '../../makesrna/rna-module.js';
import { layoutTree } from '../space_buttons/modifier-panel.js';
import { iconName } from './anim-area.js';

const PANEL_TYPE_DEFAULT_CLOSED = 1 << 0, PANEL_TYPE_NO_HEADER = 1 << 1, PANEL_TYPE_HEADER_EXPAND = 1 << 2;

// A recorded node with its icons by name.
const named = (node) => ({
  ...node, ...(node.icon ? { icon: iconName(node.icon) } : {}),
  ...(node.button ? { button: { ...node.button, icon: node.button.icon ? iconName(node.button.icon) : undefined } } : {}),
  children: (node.children ?? []).map(named),
});

// The sidebar's recorded panels: their categories in registration order and, per category, the drawn panels.
// `bound(struct)` gives Bylonder's binding of a struct the module's RNA does not read (SpaceGraphEditor, Scene);
// `changed()` runs after an edit.
export function drawSidebarPanels(area, { isOpen, changed, bound }) {
  const recorded = area.sidebarPanels(), structs = new Map();
  const data = (struct, pointer, button = -1) => {
    if (!moduleStructs.has(struct)) return bound(struct);
    const key = [struct, ...pointer, button].join(':');
    if (!structs.has(key)) {
      const after = button < 0 ? changed : () => { area.panelButtonApplied(button); changed(); };
      structs.set(key, moduleStruct(struct, pointer, { C: area.main.C, changed: after }));
    }
    return structs.get(key);
  };
  const press = (index) => { area.pressPanelButton(index); changed(); };
  const drawn = (node, key, flag, sub) => {
    const part = (kind) => node.children.find((child) => child.kind === kind);
    const tree = (kind) => part(kind) && layoutTree(part(kind), data, key, press);
    const id = `${key}:${node.prop}`, closedByDefault = !!(flag & PANEL_TYPE_DEFAULT_CLOSED) || sub;
    return { id, label: node.text, header: tree('header'), headerExpand: !!(flag & PANEL_TYPE_HEADER_EXPAND), hideHeader: !!(flag & PANEL_TYPE_NO_HEADER),
      body: tree('body'), open: isOpen(id, closedByDefault), closedByDefault,
      children: node.children.filter((child) => child.kind === 'panel').map((child) => drawn(child, key, 0, true)) };
  };
  const panels = recorded.map(({ category, flag, data: owner, panel }) => ({ category, drawn: drawn(named(panel.children[0]), owner || 'sidebar', flag, false) }));
  return { categories: [...new Set(panels.map((p) => p.category))], panels: (category) => panels.filter((p) => p.category === category).map((p) => p.drawn) };
}
