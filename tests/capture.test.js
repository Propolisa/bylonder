import assert from "node:assert/strict";
import { createMouseCapture } from "../src/windowmanager/mouse-capture.js";
const doc = new EventTarget(),
  win = new EventTarget();
globalThis.document = doc;
globalThis.window = win;
const canvas = {
  requestPointerLock() {
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event("pointerlockchange"));
    return Promise.resolve();
  },
};
doc.exitPointerLock = () => {
  doc.pointerLockElement = null;
  doc.dispatchEvent(new Event("pointerlockchange"));
};
let x = 0,
  y = 0,
  lost = 0;
const capture = createMouseCapture(() => {});
const send = (type, values) => {
  const e = new Event(type);
  Object.assign(e, values);
  doc.dispatchEvent(e);
};
capture.begin(
  { x: 100, y: 100 },
  (dx, dy) => {
    x += dx;
    y += dy;
  },
  () => lost++,
  canvas,
);
for (let i = 0; i < 10; i++)
  send("mousemove", {
    clientX: 100,
    clientY: 100,
    movementX: 500,
    movementY: -200,
  });
assert.equal(x, 5000);
assert.equal(y, -2000);
capture.release();
assert.equal(lost, 0);
assert.equal(capture.active, false);
capture.begin(
  { x: 0, y: 0 },
  () => {},
  () => lost++,
  canvas,
);
doc.exitPointerLock();
assert.equal(lost, 1);
assert.equal(capture.active, false);
canvas.requestPointerLock = () => Promise.reject(Error("denied"));
capture.begin(
  { x: 10, y: 20 },
  (dx, dy) => {
    x = dx;
    y = dy;
  },
  () => lost++,
  canvas,
);
await Promise.resolve();
send("mousemove", { clientX: 30, clientY: 25, movementX: 0, movementY: 0 });
assert.equal(x, 20);
assert.equal(y, 5);
win.dispatchEvent(new Event("blur"));
assert.equal(lost, 2);
capture.dispose();
console.log(
  "Pointer capture: unbounded deltas, release, Escape/loss, denied-lock fallback and blur passed",
);
