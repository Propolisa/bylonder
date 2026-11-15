// Rock Hard Café: only composition. Behaviours are found by being added to objects in the .blend; what Havok moves is
// each object's rigid body (Physics properties > Rigid Body).
import { defineGame } from 'bylonder';
import Shift from './systems/shift.js';
import Subtitles from './systems/subtitles.js';
import Hud from './systems/hud.js';
import Framing from './systems/framing.js';

export default defineGame({
  start: 'Rock Hard Café',
  systems: [Shift.with({ length: 60 }), Subtitles, Hud, Framing],
  physics: 'havok',
  input: {
    Move: ['WASD', 'LeftStick'],
    Reach: ['RightStick'],
    Grab: ['Space', 'MouseLeft', 'South', 'RightTrigger'],
  },
});
