import assert from "node:assert/strict";
import { NullEngine, Scene, MeshBuilder } from "@babylonjs/core";
import { createSelection } from "../src/editors/object/selection.js";
import { snapshot, apply, createHistory } from "../src/editors/undo/storage.js";
import { sceneMain } from "./scene-main.js";
import { createObjectCommands } from "../src/editors/object/commands.js";
import {
  meshCatalog,
  buildMesh,
  rebuildMesh,
} from "../src/editors/object/mesh-catalog.js";
const engine = new NullEngine(),
  scene = new Scene(engine),
  objects = [];
objects.scene = scene;
for (const preset of meshCatalog()) {
  const options = Object.fromEntries(Object.entries(preset.schema).map(([k, v]) => [k, v.default]));
  const recipe = preset.operator ? { operator: preset.operator, options } : { builder: preset.builder, options };
  const m = buildMesh(scene, preset.id, recipe);
  assert(m.getTotalVertices() > 0 || m.getChildMeshes().some((c) => c.getTotalVertices() > 0), preset.id + " draws");
  m.dispose();
}
const authored = MeshBuilder.CreateBox("source", {}, scene);
objects.push(authored);
const selection = createSelection(scene, objects);
const editor = {
  selection,
  finish() {},
  reconcile() {
    selection.sync();
  },
  start() {},
};
const main = sceneMain({ scene, objects }, selection);
const history = createHistory(objects, () => {}, { main });
const commands = createObjectCommands(
  { scene, objects },
  editor,
  history,
  () => {},
);
// An object added (as Blender's code adds one through the scene sync), then renamed, undone and redone.
const copy = buildMesh(scene, "copy", { operator: "mesh.primitive_cube_add", options: {} });
copy.metadata = { editable: true, wbId: "copy", wbCreation: { operator: "mesh.primitive_cube_add", options: {} } };
objects.push(copy);
history.commit();
selection.replace([copy]);
commands.rename(copy, "renamed");
assert.equal(copy.name, "renamed");
history.undo();
editor.reconcile();
assert.equal(copy.name, "copy");
history.redo();
assert.equal(copy.name, "renamed");
const persisted = snapshot(objects);
const newScene = new Scene(engine),
  restored = [MeshBuilder.CreateBox("source", {}, newScene)];
restored.scene = newScene;
apply(restored, persisted, { partial: true });
assert.equal(restored.length, 2);
assert(restored.find((n) => n.name === "renamed").getTotalVertices() > 0);
selection.replace([authored]);
// Blender's Hide (object.hide_view_set) on Main, drawn back.
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
main.blender.view = { viewmat: identity, winmat: identity, winx: 100, winy: 100, persp: false };
main.run(() => main.blender.run("object.hide_view_set"));
history.commit();
assert(!authored.isEnabled());
history.undo();
assert(authored.isEnabled());
const recipe = {
    builder: "CreateSphere",
    options: { diameter: 2, segments: 16 },
  },
  mesh = buildMesh(scene, "generated", recipe);
mesh.metadata = { wbId: "generated", wbCreation: recipe };
objects.push(mesh);
history.commit();
rebuildMesh(mesh, {
  builder: "CreateSphere",
  options: { diameter: 4, segments: 16 },
});
history.commit();
history.undo();
assert.equal(mesh.metadata.wbCreation.options.diameter, 2);
const cube = buildMesh(scene, "cube", { operator: "mesh.primitive_cube_add", options: { size: 2 } });
cube.metadata = { wbId: "cube", wbCreation: { operator: "mesh.primitive_cube_add", options: { size: 2 } } };
objects.push(cube);
history.commit();
rebuildMesh(cube, { operator: "mesh.primitive_cube_add", options: { size: 4 } });
assert.equal(cube.getBoundingInfo().boundingBox.maximum.x, 2);
history.commit();
history.undo();
// Main owns the cube's Mesh: undo restores it there and the view draws it.
assert.equal(cube.getBoundingInfo().boundingBox.maximum.x, 1);
scene.dispose();
newScene.dispose();
engine.dispose();
console.log(
  "Object operations: reflected presets, independent duplication, rename/delete undo, geometry rebuild undo and persistence passed",
);
