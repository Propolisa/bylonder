// tags: behaviors
// The scene camera's own controls (a page's mouse orbit, attached when the page loads) are off while a game plays,
// since the mouse and keys are the game's; a game turns them back on with `game.camera.controls = true`. A scene that
// plays no game keeps them.
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Vector3 } from '@babylonjs/core';
import { createWorld } from '../src/io_scene_babylon/runtime/game/world.js';

const canvas = Object.assign(new EventTarget(), { style: {}, tabIndex: 0, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 400 }), focus() {} });
const engine = Object.assign(new NullEngine(), { getRenderingCanvas: () => canvas, getInputElement: () => canvas });
const scene = new Scene(engine);
const camera = new ArcRotateCamera('Camera', 0, 1, 5, Vector3.Zero(), scene);
const attached = () => camera.inputs.attachedToElement;
camera.attachControl(canvas, true);
assert.ok(attached(), 'the page attaches the camera\'s controls, as a scene without a game keeps them');
const world = createWorld({ host: { scene, objects: () => [], value: () => undefined }, behaviors: [] });
world.start();
assert.ok(!attached(), 'a playing game has the mouse: the camera\'s controls are off');
world.game.camera.controls = true;
assert.ok(attached() && world.game.camera.controls, 'a game that wants orbiting turns them on');
world.game.camera.controls = false;
assert.ok(!attached());
world.dispose();
console.log('game camera controls: off while a game plays, on when the game asks');
process.exit(0);
