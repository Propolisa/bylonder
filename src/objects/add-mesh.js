import { createTextEditor } from "../text/editor.js";
import { Pane } from "tweakpane";
import { meshCatalog, buildMesh, rebuildMesh } from "./mesh-catalog.js";
import { apply, snapshot } from "../storage.js";
export function createAddMesh(
  world,
  editor,
  history,
  commands,
  config,
  notify,
) {
  const textEditor = createTextEditor(world, editor, history, commands);
  const catalog = [...meshCatalog(config), {id:"text",title:"Text"}],
    menu = document.querySelector("#add-menu"),
    search = document.querySelector("#add-search"),
    list = document.querySelector("#add-list"),
    panel = document.querySelector("#creation-panel");
  let pane, pending, lastOperation;
  const close = () => {
    menu.close();
    world.engine.getRenderingCanvas()?.focus();
  };
  const finish = (commit = true) => {
    if (textEditor.pending) textEditor.finish(commit);
    if (!pending) return;
    if (commit) {
      history.commit();
      lastOperation = {
        node: pending.node,
        preset: pending.preset,
        revision: history.revision,
      };
    } else apply(world.objects, pending.before);
    pending = null;
    pane?.dispose();
    pane = null;
    panel.hidden = true;
    editor.reconcile();
  };
  const controls = (node, preset, before) => {
    pending = { node, preset, before };
    panel.hidden = false;
    panel.replaceChildren();
    pane = new Pane({ container: panel, title: "Add " + preset.title });
    const values = { ...node.metadata.wbCreation.options };
    for (const [key, def] of Object.entries(preset.schema)) {
      const options = {
        label: def.label || key,
        ...Object.fromEntries(
          ["min", "max", "step", "options"]
            .filter((k) => def[k] !== undefined)
            .map((k) => [k, def[k]]),
        ),
      };
      pane.addBinding(values, key, options).on("change", () => {
        try {
          rebuildMesh(node, {
            builder: preset.builder,
            options: { ...values },
          });
          editor.reconcile();
        } catch (e) {
          notify(e.message);
        }
      });
    }
    for (const axis of ["x", "y", "z"])
      pane
        .addBinding(node.position, axis, {
          label: "Location " + axis.toUpperCase(),
          step: 0.1,
        })
        .on("change", () => editor.reconcile());
    pane.addButton({ title: "Apply" }).on("click", () => finish());
    pane.addButton({ title: "Cancel" }).on("click", () => finish(false));
  };
  const add = (preset) => {
    finish();
    close();
    if (preset.id === "text") { textEditor.show(); return; }
    editor.finish(false);
    const before = snapshot(world.objects);
    const recipe = {
      builder: preset.builder,
      options: Object.fromEntries(
        Object.entries(preset.schema).map(([key, def]) => [key, def.default]),
      ),
    };
    const node = buildMesh(
      world.scene,
      commands.unique(preset.title.replace(/\s/g, "")),
      recipe,
    );
    node.metadata = {
      editable: true,
      wbId: crypto.randomUUID(),
      wbCreation: recipe,
    };
    world.objects.push(node);
    editor.selection.replace([node]);
    editor.reconcile();
    controls(node, preset, before);
  };
  const render = () => {
    list.replaceChildren();
    for (const preset of catalog.filter((p) =>
      p.title.toLowerCase().includes(search.value.toLowerCase()),
    )) {
      const b = document.createElement("button");
      b.textContent = preset.title;
      b.onclick = () => add(preset);
      list.append(b);
    }
  };
  search.oninput = render;
  search.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      list.querySelector("button")?.click();
    }
  };
  document.querySelector("#add-close").onclick = close;
  return {
    catalog,
    add(preset) {
      finish();
      add(preset);
    },
    get pending() {
      return pending || textEditor.pending;
    },
    get open() {
      return menu.open || textEditor.open;
    },
    show() {
      finish();
      render();
      menu.showModal();
      search.value = "";
      render();
      search.focus();
    },
    finish,
    editText(node) { finish(); textEditor.show(node); },
    reopen() {
      if (
        lastOperation &&
        lastOperation.revision === history.revision &&
        !lastOperation.node.metadata?.wbDeleted
      ) {
        controls(
          lastOperation.node,
          lastOperation.preset,
          snapshot(world.objects),
        );
      } else
        notify(
          "Creation settings are available immediately after adding a mesh.",
        );
    },
    dispose() {
      finish();
      pane?.dispose();
      textEditor.dispose();
    },
  };
}
