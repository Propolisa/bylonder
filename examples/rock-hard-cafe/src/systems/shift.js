// The shift: 30 seconds, counting the rocks served and those that left thirsty.
import { defineSystem, float } from 'bylonder';
import Rock from '../behaviors/rock.js';

export default defineSystem({
  name: 'Shift',
  props: { length: float(30, { unit: 's' }) },
  create({ game, time, props, saved }) {
    let served = saved?.served ?? 0, walkouts = saved?.walkouts ?? 0;
    game.on(Rock, 'left', ({ served: happy }) => (happy ? served++ : walkouts++));
    return {
      update() { if (time.now >= props.length) game.end({ served, walkouts }); },
      get left() { return Math.max(0, props.length - time.now); },
      save() { return { served, walkouts }; },
    };
  },
});
