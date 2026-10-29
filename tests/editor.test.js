import assert from "node:assert/strict";
import {
  NullEngine,
  Scene,
  MeshBuilder,
} from "@babylonjs/core";
import { createSelection } from "../src/editors/object/selection.js";
import { snapshot, apply, createHistory } from "../src/editors/undo/storage.js";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const engine = new NullEngine();
const scene = new Scene(engine);
const a = MeshBuilder.CreateBox("A", {}, scene),
  b = MeshBuilder.CreateBox("B", {}, scene);
a.position.x = -2;
b.position.x = 2;
const objects = [a, b];
const selection = createSelection(scene, objects);
const history = createHistory(objects, () => {});
selection.toggle(a);
assert.equal(selection.size, 1);
assert.deepEqual(selection.outlined(), [a]);
selection.toggle(a);
assert.equal(selection.size, 0);
assert.deepEqual(selection.outlined(), []);
selection.toggle(a);
selection.toggle(b, true);
assert.equal(selection.size, 2);
assert.equal(selection.nodes.at(-1), b);
selection.begin();
selection.pivot.position.y = 3;
selection.update();
close(a.position.y, 3);
close(b.position.y, 3);
history.commit();
selection.sync();
selection.begin();
selection.pivot.scaling.setAll(2);
selection.update();
close(a.position.x, -4);
close(b.position.x, 4);
history.commit();
const before = snapshot(objects);
const group = selection.group();
assert.equal(group.getClassName(), "TransformNode");
assert.equal(a.parent, group);
a.computeWorldMatrix(true);
close(a.getAbsolutePosition().x, -4);
assert.deepEqual(selection.outlined(), []);
history.commit();
const grouped = snapshot(objects);
selection.begin();
selection.pivot.position.y += 2;
selection.update();
a.computeWorldMatrix(true);
close(a.getAbsolutePosition().y, 5);
history.commit();
selection.ungroup();
assert.equal(a.parent, null);
a.computeWorldMatrix(true);
close(a.position.y, 5);
history.commit();
history.undo();
assert.equal(a.parent?.metadata.group, true);
history.undo();
a.computeWorldMatrix(true);
close(a.getAbsolutePosition().y, 3);
history.undo();
assert.equal(a.parent, null);
assert.deepEqual(snapshot(objects).filter(row=>!row.deleted), before);
apply(objects, grouped);
assert.equal(a.parent?.metadata.group, true);
a.computeWorldMatrix(true);
close(a.getAbsolutePosition().x, -4);
selection.replace([a.parent]);
selection.begin();
selection.pivot.rotation.z = Math.PI / 2;
selection.update();
a.computeWorldMatrix(true);
close(a.getAbsolutePosition().y, -1);
selection.dispose();

scene.dispose();
engine.dispose();
console.log(
  "Selection outlines/toggle, multi-transform, grouping, undo and hierarchy restore passed",
);
