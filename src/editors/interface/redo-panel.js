// Mounts the redo panel into a host element; `show` replaces what it shows, `hide` empties it.
import { createApp, h, reactive } from "vue";
import RedoPanel from "./components/RedoPanel.vue";

export function createRedoPanel(host) {
  const current = reactive({ operator: null, state: { closed: [], panels: ['redo'] } });
  const app = createApp({
    render: () => current.operator && h(RedoPanel, { ...current.operator, state: current.state, onChange: () => current.operator.apply({ ...current.operator.values }) }),
  });
  app.mount(host);
  return {
    // `values` are the operator's properties; `apply(values)` re-runs it.
    show({ title, schema, values, apply }) {
      current.operator = { title, schema, values: reactive({ ...values }), apply };
      host.hidden = false;
    },
    hide() {
      current.operator = null;
      host.hidden = true;
    },
    get open() { return !!current.operator; },
    dispose: () => app.unmount(),
  };
}
