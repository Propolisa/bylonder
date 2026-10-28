import assert from "node:assert/strict";
import { createMouseCapture } from "../src/windowmanager/mouse-capture.js";
const doc = new EventTarget(),
  win = new EventTarget();
globalThis.document = doc;
globalThis.window = win;
const canvas = {
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300 }),
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
const sum = (dx, dy) => {
  x += dx;
  y += dy;
};

// Inside the viewport, moves are client deltas and nothing is locked.
capture.begin({ x: 100, y: 100 }, sum, () => lost++, canvas);
send("pointermove", { clientX: 160, clientY: 120, movementX: -677, movementY: -402 });
assert.deepEqual([x, y, doc.pointerLockElement], [60, 20, undefined]);
// Near the edge the pointer locks; the lock's first move (Chromium's jump from its origin) is dropped, then deltas are
// unbounded.
send("pointermove", { clientX: 390, clientY: 120, movementX: 0, movementY: 0 });
assert.equal(doc.pointerLockElement, canvas);
assert.deepEqual([x, y], [290, 20]);
send("pointermove", { clientX: 0, clientY: -24, movementX: -677, movementY: -402 });
assert.deepEqual([x, y], [290, 20]);
for (let i = 0; i < 10; i++) send("pointermove", { clientX: 0, clientY: -24, movementX: 500, movementY: -200 });
assert.deepEqual([x, y], [5290, -1980]);
capture.release();
assert.equal(lost, 0);
assert.equal(capture.active, false);

// A number field locks at its area's edge (the window's), not its own.
const field = {
  getBoundingClientRect: () => ({ left: 100, top: 100, right: 160, bottom: 120 }),
  requestPointerLock() {
    doc.pointerLockElement = field;
    doc.dispatchEvent(new Event("pointerlockchange"));
    return Promise.resolve();
  },
};
capture.begin({ x: 130, y: 110 }, sum, () => lost++, field, canvas);
send("pointermove", { clientX: 200, clientY: 110, movementX: 0, movementY: 0 });
assert.equal(doc.pointerLockElement, null);
send("pointermove", { clientX: 395, clientY: 110, movementX: 0, movementY: 0 });
assert.equal(doc.pointerLockElement, field);
capture.release();

// A lock the browser ends (Escape) ends the session.
capture.begin({ x: 0, y: 0 }, () => {}, () => lost++, canvas);
send("pointermove", { clientX: 5, clientY: 5, movementX: 0, movementY: 0 });
doc.exitPointerLock();
assert.equal(lost, 1);
assert.equal(capture.active, false);

// A denied lock keeps client deltas.
canvas.requestPointerLock = () => Promise.reject(Error("denied"));
capture.begin({ x: 10, y: 20 }, (dx, dy) => { x = dx; y = dy; }, () => lost++, canvas);
send("pointermove", { clientX: 5, clientY: 25, movementX: 0, movementY: 0 });
await Promise.resolve();
send("pointermove", { clientX: 2, clientY: 30, movementX: 0, movementY: 0 });
assert.deepEqual([x, y], [-3, 5]);
win.dispatchEvent(new Event("blur"));
assert.equal(lost, 2);
capture.dispose();
console.log("Pointer capture: client deltas, a lock at its area's edge without its first jump, Escape/loss, denied-lock fallback and blur passed");
