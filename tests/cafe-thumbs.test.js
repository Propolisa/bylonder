// Rock Hard Café's two thumbs (examples/rock-hard-cafe/src/systems/touch.js): each finger is followed by its pointer id
// from its landing, so a grab right after a drag is taken at once, a drag goes on while the other thumb holds Grab, and
// Grab holds until the last finger on it lifts.
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./fixtures/example-loader.mjs', import.meta.url);
const { thumbs } = await import('../examples/rock-hard-cafe/src/systems/touch.js');

const grabs = [], drags = [];
const hands = thumbs(() => 400, { grab: (on) => grabs.push(on), drag: (from, to) => drags.push([from.x, to.x]) });

// A drag on the right half, then at once a grab on the left.
hands.down(1, 300, 600);
hands.move(1, 280, 580);
hands.up(1);
hands.down(2, 60, 800);
assert.deepEqual(drags, [[300, 280]], 'the right thumb drags');
assert.deepEqual(grabs, [true], 'a grab right after a drag is taken at once');

// The right thumb drags while the left holds; a drag's finger lifting leaves Grab held.
hands.down(3, 300, 600);
hands.move(3, 320, 600);
hands.up(3);
assert.deepEqual(drags.at(-1), [300, 320]);
assert.deepEqual(grabs, [true], 'Grab still held');
// A finger that never lifted (a lost pointerup) does not keep the next one from grabbing or dragging.
hands.up(2);
assert.deepEqual(grabs, [true, false], 'lifting the left thumb lets go');
hands.down(4, 300, 600);
hands.down(5, 50, 700);
hands.up(5);
hands.down(6, 50, 700);
assert.deepEqual(grabs, [true, false, true, false, true], 'each landing on the left grabs');
console.log('café thumbs: a grab right after a drag, a drag while Grab is held, each finger by its own id');
