// An area's own render loop (editors/screen/area-shown.js): it runs while the area is shown and wanted, stops when the
// area folds or hides, starts again when it shows, and moves to a new engine.
import assert from 'node:assert/strict';
import { areaRenderLoop, watchShown } from '../src/editors/screen/area-shown.js';

const fakeEngine = () => ({ loops: new Set(), runRenderLoop(fn) { this.loops.add(fn); }, stopRenderLoop(fn) { this.loops.delete(fn); } });

{
  let engine = fakeEngine(), wanted = false;
  const render = () => {};
  const loop = areaRenderLoop(render, { engine: () => engine, wanted: () => wanted });
  loop.update();
  assert.equal(engine.loops.size, 0, 'not running before it is wanted');
  wanted = true;
  loop.update();
  assert.ok(engine.loops.has(render) && loop.running, 'runs once wanted on a shown area');
  loop.shown(false);
  assert.equal(engine.loops.size, 0, 'a hidden area draws nothing');
  loop.shown(true);
  assert.ok(engine.loops.has(render), 'shown again, it draws again');
  const old = engine;
  engine = fakeEngine();
  loop.update();
  assert.ok(!old.loops.size && engine.loops.has(render), 'moves to a new engine');
  wanted = false;
  loop.update();
  assert.ok(!engine.loops.size && !loop.running, 'stopped when no longer wanted');
  engine = null;
  wanted = true;
  loop.update();
  assert.ok(!loop.running, 'no engine, no loop');
}

{
  let callback;
  class Observer { constructor(fn) { callback = fn; } observe() {} disconnect() { callback = null; } }
  const seen = [];
  const remove = watchShown({}, (shown) => seen.push(shown), Observer);
  const size = (width, height) => callback([{ contentRect: { width, height } }]);
  size(300, 200);
  size(320, 200);
  size(0, 0);
  size(0, 0);
  size(300, 0);
  size(300, 200);
  assert.deepEqual(seen, [true, false, true], 'only changes of shown are reported');
  remove();
  assert.equal(callback, null);
}
