// The HUD region's Adjust Last Operation panel (ED_area_type_hud, hud_panel_operator_redo_draw): the last operator's
// properties drawn by the layout renderer as uiTemplateOperatorRedoProperties draws them (property split, no
// decorators, hidden properties left out), re-running the operator when one changes.
import { createApp, h, reactive, markRaw } from 'vue';
import { RegionView, panelState } from './layout-view.js';
import { UILayout } from './layout.js';
import { rna, operatorStruct } from '../../makesrna/rna.js';
import rnaOperators from '../../makesrna/rna-operators.json' with { type: 'json' };
import './layout-view.css';
import './components/tailwind.css';

// An operator's properties the panel shows, in RNA's order.
export const redoProperties = (idname) => Object.entries(rnaOperators[idname]?.properties ?? {}).filter(([, p]) => !p.hidden).map(([name]) => name);

export function createHud(host) {
  const state = reactive({ revision: 0, open: {}, panel: null });
  const panels = panelState(state);
  let operator = null;
  const ui = markRaw({
    get revision() { return state.revision; },
    // A finished edit re-runs the operator, as ED_undo_operator_repeat does.
    undoPush: () => { operator.apply({ ...operator.values }); draw(); },
    report: (error) => console.warn(error.message),
    isOpen: panels.isOpen,
    toggle: (id, event) => { panels.toggle(id, event); draw(); },
    ids: () => [],
  });
  const draw = () => {
    const { struct, names, values, title } = operator;
    const data = {};
    for (const name of names) Object.defineProperty(data, name, { enumerable: true, get: () => values[name], set: (value) => { values[name] = value; state.revision++; } });
    const ptr = rna(struct, data);
    const body = new UILayout('root', null);
    body.use_property_split = true;
    body.use_property_decorate = false;
    for (const name of names) body.prop(ptr, name);
    state.panel = markRaw({ id: 'hud', label: title, body, open: panels.isOpen('hud'), children: [] });
    state.revision++;
  };
  const app = createApp({ render: () => state.panel && (state.revision, h(RegionView, { panels: [state.panel], ui })) });
  app.mount(host);
  return {
    // `struct` names the operator's properties (an operator's MESH_OT_subdivide, or a struct of defined properties),
    // `names` those shown, `values` their values and `apply(values)` re-runs the operator with them.
    show({ idname, struct = operatorStruct(idname), title = rnaOperators[idname]?.name ?? idname, names = redoProperties(idname), values, apply }) {
      operator = { struct, title, names, values: { ...values }, apply };
      draw();
      host.hidden = false;
    },
    hide() {
      operator = null;
      state.panel = null;
      host.hidden = true;
    },
    get open() { return !!operator; },
    dispose: () => app.unmount(),
  };
}
