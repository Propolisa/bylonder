// Rock Hard Café: only composition. Behaviours are found by being added to objects in the .blend.
import { defineGame } from 'bylonder';
import Shift from './systems/shift.js';
import Subtitles from './systems/subtitles.js';

export default defineGame({
  start: 'Rock Hard Café',
  systems: [Shift.with({ length: 30 }), Subtitles],
  input: {
    Move: ['WASD'],
    Use: ['E', 'Space'],
  },
});
