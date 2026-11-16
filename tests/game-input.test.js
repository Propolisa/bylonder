// A game's mapped input (runtime/game/input.js) from a canvas's events: a mouse points and presses its buttons, a finger
// does neither (the game's own touch controls take it) but says a finger is there.
import assert from 'node:assert/strict';
import { createInput } from '../src/io_scene_babylon/runtime/game/input.js';

const canvas = new EventTarget();
canvas.getBoundingClientRect = () => ({ left: 10, top: 20 });
const pointer = (type, pointerType, x, y) => {
  const event = new Event(type);
  Object.assign(event, { pointerType, button: 0, clientX: x, clientY: y });
  canvas.dispatchEvent(event);
};
const input = createInput({ Grab: ['Space', 'MouseLeft'] }, canvas);

pointer('pointerdown', 'touch', 100, 100);
input.step();
assert.equal(input.held('Grab'), false, 'a finger is not the left mouse button');
assert.equal(input.pointer, null, 'nor the pointer');
assert.equal(input.touch, true, 'it says a finger touched');

pointer('pointermove', 'mouse', 60, 70);
pointer('pointerdown', 'mouse', 60, 70);
input.step();
assert.deepEqual(input.pointer, { x: 50, y: 50 }, 'the mouse points, from the canvas top left');
assert.ok(input.held('Grab') && input.pressed('Grab'), 'its left button grabs');
pointer('pointerup', 'mouse', 60, 70);
assert.equal(input.held('Grab'), false);

input.hold('Grab');
assert.ok(input.held('Grab'), 'a touch control holds an action');
input.hold('Grab', false);
assert.equal(input.held('Grab'), false);
input.dispose();
console.log('game input: a mouse points and grabs, a finger leaves both to the game\'s touch controls');
