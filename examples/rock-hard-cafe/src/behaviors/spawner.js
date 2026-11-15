// The trailhead: once the stand is free (no rock arriving, waiting or admiring), the next rock comes up the path a few
// seconds later, one at a time, a rock of one of the rock collections, picked by the run's seeded random.
import { defineBehavior, float, collection } from 'bylonder';
import Rock from './rock.js';

const AT_THE_STAND = ['arriving', 'waiting', 'admiring'];

export default defineBehavior({
  name: 'Spawner',
  props: { prefabs: collection(['Rock A', 'Rock B', 'Rock C']), every: float(3, { unit: 's' }) },
  create({ entity, props, game, time }) {
    let free = 0;
    return {
      update(dt) {
        if (game.all(Rock).some((rock) => AT_THE_STAND.includes(rock.state.mood))) { free = 0; return; }
        if ((free += dt) < props.every) return;
        free = 0;
        game.spawn(time.pick(props.prefabs), { at: entity }); // owned by the run: gone on Reset
      },
    };
  },
});
