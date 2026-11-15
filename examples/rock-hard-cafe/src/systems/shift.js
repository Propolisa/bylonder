// The café's day, endless: the rocks served and those that left thirsty.
import { defineSystem } from 'bylonder';
import Rock from '../behaviors/rock.js';

export default defineSystem({
  name: 'Shift',
  create({ game, saved }) {
    let served = saved?.served ?? 0, walkouts = saved?.walkouts ?? 0;
    game.on(Rock, 'left', ({ served: happy }) => (happy ? served++ : walkouts++));
    return { save() { return { served, walkouts }; } };
  },
});
