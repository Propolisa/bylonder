import assert from 'node:assert/strict';
import { createSequenceEditor, strips } from '../src/sequencer/sequence-editor.js';

// The slice keeps the engine's edit; undo applies it back and notifies the engine.
let commits = 0;
const editor = createSequenceEditor({ commit: () => commits++ });
assert.equal(editor.capture(), undefined, 'no edit saves nothing');
const events = [];
editor.subscribe((source) => events.push(source));
const edit = { engine: 'kubeezcut', edit: { schemaVersion: 1, timeline: {
  tracks: [{ id: 'v1', order: 1 }, { id: 'v2', order: 0 }],
  items: [
    { id: 'a', type: 'video', trackId: 'v1', from: 1, durationInFrames: 48 },
    { id: 'b', type: 'scene', trackId: 'v2', from: 10, durationInFrames: 100, scene: 'intro', camera: 'Cam', sourceStart: 5 },
  ],
} } };
editor.set(edit);
assert.equal(commits, 1);
assert.deepEqual(editor.capture(), edit);
editor.apply(edit);
editor.apply(undefined);
assert.deepEqual(events, ['edit', 'apply'], 'applying the same state is silent');

// Blender-shaped view: channel 1 is the bottom track.
assert.deepEqual(strips(edit), [
  { name: 'a', type: 'MOVIE', channel: 1, frameStart: 1, frameFinalDuration: 48 },
  { name: 'b', type: 'SCENE', channel: 2, frameStart: 10, frameFinalDuration: 100, scene: 'intro', camera: 'Cam', sceneFrameStart: 5 },
]);
assert.deepEqual(strips(undefined), []);

console.log('Sequencer: edit slice and Blender strip view passed');
