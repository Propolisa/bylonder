import { Matrix, Quaternion } from "@babylonjs/core";
import { meshCatalog, buildMesh, rebuildMesh } from "./mesh-catalog.js";
import { apply, snapshot } from "../undo/storage.js";
import { defineStructProperties } from "../../makesrna/rna.js";
import { eulO_to_mat3, mat3_normalized_to_eulO } from "../../blenlib/math-rotation.js";
import { unit_m3 } from "../../blenlib/math-matrix.js";
import { cursorRotationMatrix } from "../../blenkernel/scene/cursor.js";
import { viewProjection } from "../space_view3d/view3d-project.js";
import { toBabylon } from "../space_view3d/view3d-project.js";

const recipeOf = (preset, options) => (preset.operator ? { operator: preset.operator, options } : { builder: preset.builder, options });
// The operator's properties that place the object rather than build its mesh.
const PLACEMENT = ["align", "location", "rotation"];
const XYZ = (name, subtype, unit, step) => ({ identifier: name, name: name[0].toUpperCase() + name.slice(1), type: "F", default: [0, 0, 0], array: 3, subtype, unit, step, precision: 3 });

// A Babylon builder's options as an operator's properties (BYLONDER_OT_knot_add), for its Adjust Last Operation panel.
function defineBuilderProperties(preset) {
  const struct = `BYLONDER_OT_${preset.id}_add`;
  defineStructProperties(struct, {
    ...Object.fromEntries(Object.entries(preset.schema).map(([key, def]) => [key, {
      identifier: key, name: def.label ?? key[0].toUpperCase() + key.slice(1).replace(/([A-Z])/g, " $1"), default: def.default, array: 0,
      ...(def.options ? { type: "E", items: Object.entries(def.options).map(([label, value]) => [value, label, "", "NONE"]) }
        : typeof def.default === "boolean" ? { type: "B" }
        : { type: def.step === 1 ? "I" : "F", min: def.min, max: def.max, soft_min: def.min, soft_max: def.max, step: def.step === 1 ? 1 : def.step * 100, precision: 3 }),
    }])),
    location: XYZ("location", "XYZ_LENGTH", "LENGTH", 1),
    rotation: XYZ("rotation", "EULER", "ROTATION", 10),
  });
  return { struct, title: preset.title, names: [...Object.keys(preset.schema), "location", "rotation"] };
}

// A rotation of Blender's (an XYZ Euler) as the node's.
const babylonRotation = (euler) => {
  const m = eulO_to_mat3(euler, 1);
  return Quaternion.FromRotationMatrix(Matrix.FromArray([0, 2, 1].flatMap((c) => [...toBabylon(m[c]).asArray(), 0]).concat([0, 0, 0, 1]))).toEulerAngles();
};

export function createAddMesh(world, editor, history, commands, config, notify) {
  const catalog = meshCatalog(config), hud = world.hud;
  const panels = new Map(catalog.filter((preset) => !preset.operator).map((preset) => [preset, defineBuilderProperties(preset)]));
  // ED_object_rotation_from_view and the cursor's: the rotation an Add operator's Align gives.
  const ALIGN = {
    WORLD: unit_m3,
    CURSOR: () => cursorRotationMatrix(world.sceneSettings.state.cursor),
    VIEW: () => { const { right, up, back } = viewProjection(world.views.input).viewinv; return [right, up, back]; },
  };
  let pending, lastOperation;
  const finish = (commit = true) => {
    if (!pending) return;
    if (commit) {
      history.commit();
      lastOperation = { ...pending, revision: history.revision };
    } else apply(world.objects, pending.before);
    pending = null;
    hud.hide();
    editor.reconcile();
  };
  // Places and rebuilds the node from the operator's properties, as redoing an Add operator does.
  const place = (node, preset, values) => {
    const options = Object.fromEntries(Object.entries(values).filter(([key]) => !PLACEMENT.includes(key)));
    rebuildMesh(node, recipeOf(preset, options));
    node.position.set(values.location[0], values.location[2], values.location[1]);
    node.rotationQuaternion = null;
    node.rotation.copyFrom(babylonRotation(values.rotation));
    editor.reconcile();
  };
  // Adjust Last Operation: the HUD shows the operator's properties; a change rebuilds the node.
  const adjust = (node, preset, before, values) => {
    pending = { node, preset, before, values };
    let align = values.align;
    const apply = (next) => {
      // view_align_update: a new Align sets the rotation it gives.
      if (next.align !== align) next.rotation = mat3_normalized_to_eulO(1, ALIGN[next.align]());
      align = next.align;
      Object.assign(values, next);
      try { place(node, preset, values); } catch (e) { notify(e.message); }
      adjust(node, preset, before, values);
    };
    if (preset.operator) hud.show({ idname: preset.operator, values, apply });
    else hud.show({ ...panels.get(preset), values, apply });
  };
  // `options` override the preset's defaults; `location` (Blender world) and `rotation` (Blender's XYZ Euler) place
  // the object, as an Add operator's properties do, at the 3D cursor by default.
  const add = (preset, { options = {}, location = world.sceneSettings?.state.cursor.location ?? [0, 0, 0], rotation = [0, 0, 0] } = {}) => {
    finish();
    const before = snapshot(world.objects);
    const defaults = Object.fromEntries(Object.entries(preset.schema).map(([key, def]) => [key, def.default]));
    const recipe = recipeOf(preset, { ...defaults, ...options });
    const node = buildMesh(world.scene, commands.unique(preset.name ?? preset.title.replace(/\s/g, "")), recipe);
    node.metadata = { editable: true, wbId: crypto.randomUUID(), wbCreation: recipe };
    world.objects.push(node);
    const values = { ...recipe.options, ...(preset.operator ? { align: "WORLD" } : {}), location: [...location], rotation: [...rotation] };
    node.position.set(location[0], location[2], location[1]);
    node.rotation.copyFrom(babylonRotation(rotation));
    editor.selection.replace([node]);
    editor.reconcile();
    adjust(node, preset, before, values);
  };
  return {
    catalog,
    add,
    get pending() {
      return pending;
    },
    finish,
    // screen.redo_last: the last Add's panel again, while it is the last undo step.
    reopen() {
      if (lastOperation && lastOperation.revision === history.revision && !lastOperation.node.metadata?.wbDeleted) {
        const { node, preset, values } = lastOperation;
        adjust(node, preset, snapshot(world.objects), values);
      } else notify("Creation settings are available immediately after adding a mesh.");
    },
    dispose: () => finish(),
  };
}
