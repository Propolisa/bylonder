import { Pane } from "tweakpane";
import { meshCatalog, buildMesh, rebuildMesh } from "./mesh-catalog.js";
import { apply, snapshot } from "../undo/storage.js";

const recipeOf = (preset, options) => (preset.operator ? { operator: preset.operator, options } : { builder: preset.builder, options });
export function createAddMesh(
  world,
  editor,
  history,
  commands,
  config,
  notify,
) {
  const catalog = meshCatalog(config),
    panel = document.querySelector("#creation-panel");
  let pane, pending, lastOperation;
  const finish = (commit = true) => {
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
          rebuildMesh(node, recipeOf(preset, { ...values }));
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
  // `options` override the preset's defaults; `location` (Blender world) and `rotation` (a Babylon quaternion) place
  // the object, as an Add operator's properties do, at the 3D cursor by default.
  const add = (preset, { options = {}, location = world.sceneSettings?.state.cursor.location, rotation } = {}) => {
    finish();
    editor.finish(false);
    const before = snapshot(world.objects);
    const recipe = recipeOf(preset, { ...Object.fromEntries(Object.entries(preset.schema).map(([key, def]) => [key, def.default])), ...options });
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
    if (location) node.position.set(location[0], location[2], location[1]);
    if (rotation) node.rotation.copyFrom(rotation.toEulerAngles());
    world.objects.push(node);
    editor.selection.replace([node]);
    editor.reconcile();
    controls(node, preset, before);
  };
  return {
    catalog,
    add(preset, placement) {
      finish();
      add(preset, placement);
    },
    get pending() {
      return pending;
    },
    finish,
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
    },
  };
}
