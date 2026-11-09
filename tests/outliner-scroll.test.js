// The Outliner scrolls as the web does (outliner-scroll.js): a trackpad's pixels at once, a wheel's notch gliding to
// exactly its distance, a finger's drag following it and a flick going on and slowing down.
import assert from 'node:assert/strict';
import { createSmoothScroll } from '../src/editors/space_outliner/outliner-scroll.js';

let now = 0, queued = [];
globalThis.requestAnimationFrame = (fn) => queued.push(fn);
globalThis.cancelAnimationFrame = () => { queued = []; };
const frames = (n) => {
  for (let i = 0; i < n && queued.length; i++) {
    now += 1000 / 60;
    const run = queued;
    queued = [];
    run.forEach((fn) => fn(now));
  }
};
const scroller = () => {
  const moved = { x: 0, y: 0, calls: 0 };
  const scroll = createSmoothScroll((dx, dy) => {
    assert.ok(Number.isInteger(dx) && Number.isInteger(dy), 'pans whole pixels');
    Object.assign(moved, { x: moved.x + dx, y: moved.y + dy, calls: moved.calls + 1 });
  });
  return { scroll, moved };
};

{
  const { scroll, moved } = scroller();
  scroll.by(0, 3.5);
  scroll.by(0, 3.5);
  assert.equal(moved.y, 7, "a trackpad's pixels scroll at once, fractions carried");
}

{
  const { scroll, moved } = scroller();
  scroll.glide(0, 100);
  frames(1);
  assert.ok(moved.y > 0 && moved.y < 100, 'a notch glides');
  frames(120);
  assert.equal(moved.y, 100, 'and ends exactly its distance down');
  assert.equal(queued.length, 0, 'then stops asking for frames');
}

{
  const { scroll, moved } = scroller();
  scroll.drag(0, 300, 0);
  scroll.drag(0, 280, 16);
  scroll.drag(0, 250, 32);
  assert.equal(moved.y, 50, 'a finger moving up 50 px scrolls 50 px down');
  scroll.release(40);
  frames(1);
  assert.ok(moved.y > 50, 'its flick goes on');
  frames(600);
  assert.equal(queued.length, 0, 'and comes to rest');
  const rest = moved.y;
  scroll.drag(0, 100, 5000);
  scroll.drag(0, 90, 5016);
  scroll.release(5400);
  frames(5);
  assert.equal(moved.y, rest + 10, 'a finger held still before it lifts flicks nothing');
}

{
  const { scroll, moved } = scroller();
  scroll.glide(0, 100);
  frames(1);
  const at = moved.y;
  scroll.stop();
  frames(10);
  assert.equal(moved.y, at, 'a press stops a glide');
}

console.log('outliner scroll tests passed');
