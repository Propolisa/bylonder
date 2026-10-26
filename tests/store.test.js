import assert from "node:assert/strict";
import { createStore } from "../src/runtime/store.js";
let jobs = new Map(),
  id = 0,
  calls = 0;
const options = {
  scheduleFrame: (fn) => {
    jobs.set(++id, fn);
    return id;
  },
  cancelFrame: (id) => jobs.delete(id),
  onError: (e) => {
    throw e;
  },
};
const schema = { a: { default: 1, min: 0, max: 10 } };
const s = createStore(schema, options),
  other = createStore(schema, options);
s.effect(["a"], () => {
  calls++;
});
s.set("a", 2);
s.set("a", 3);
assert.equal(calls, 1);
assert.equal(jobs.size, 1);
s.flush();
assert.equal(calls, 2);
assert.equal(jobs.size, 0);
assert.equal(other.values.a, 1);
s.set("a", Infinity);
assert.equal(s.values.a, 3);
s.set("a", 99);
assert.equal(s.values.a, 10);
s.flush();
assert.equal(calls, 3);
let manual = 0;
s.effect(["a"], () => manual++, { mode: "manual" });
s.set("a", 4);
assert.equal(manual, 1);
s.flush();
assert.equal(manual, 2);
let cleaned = 0;
const stop = s.effect(["a"], () => () => cleaned++);
s.invalidate("a");
s.flush();
assert.equal(cleaned, 1);
stop();
assert.equal(cleaned, 2);
let debounced = 0;
s.effect(
  ["a"],
  () => {
    debounced++;
  },
  { mode: "debounce", delay: 10 },
);
s.set("a", 5);
s.set("a", 6);
await new Promise((r) => setTimeout(r, 25));
assert.equal(debounced, 2);
s.dispose();
other.dispose();
assert.equal(jobs.size, 0);
console.log(
  "Store: isolation, validation, coalescing, debounce, manual flush and cleanup passed",
);
