// The café's day, endless: the rocks served, those that left thirsty, and how many of them left angry.
import { defineSystem } from 'bylonder';
import Rock from '../behaviors/rock.js';

export default defineSystem({
  name: 'Shift',
  create({ game, saved }) {
    let served = saved?.served ?? 0, walkouts = saved?.walkouts ?? 0, angry = saved?.angry ?? 0;
    game.on(Rock, 'left', ({ served: happy, angry: mad }) => {
      if (happy) served++; else walkouts++;
      if (!happy && mad) angry++;
    });
    return { save() { return { served, walkouts, angry }; } };
  },
});
