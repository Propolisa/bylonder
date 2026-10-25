import assert from "node:assert/strict";
import { NullEngine, Scene, MeshBuilder } from "@babylonjs/core";
import { createSelection } from "../src/selection.js";
import { snapshot, apply, createHistory } from "../src/storage.js";
import { createObjectCommands } from "../src/objects/commands.js";
import {
  meshCatalog,
  buildMesh,
  rebuildMesh,
} from "../src/objects/mesh-catalog.js";
const engine = new NullEngine(),
  scene = new Scene(engine),
  objects = [];
objects.scene = scene;
for (const preset of meshCatalog()) {
  const recipe = {
    builder: preset.builder,
    options: Object.fromEntries(
      Object.entries(preset.schema).map(([k, v]) => [k, v.default]),
    ),
  };
  const m = buildMesh(scene, preset.id, recipe);
  assert(m.getTotalVertices() > 0);
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
const history = createHistory(objects, () => {});
const commands = createObjectCommands(
  { scene, objects },
  editor,
  history,
  () => {},
);
selection.replace([authored]);
commands.duplicate();
const copy = selection.nodes[0];
assert.notEqual(copy.geometry, authored.geometry);
commands.rename(copy, "renamed");
commands.remove();
assert(copy.metadata.wbDeleted);
history.undo();
editor.reconcile();
assert(!copy.metadata.wbDeleted);
assert.equal(copy.name, "renamed");
history.undo();
assert.notEqual(copy.name, "renamed");
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
commands.remove();
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
scene.dispose();
newScene.dispose();
engine.dispose();
console.log(
  "Object operations: reflected presets, independent duplication, rename/delete undo, geometry rebuild undo and persistence passed",
);
