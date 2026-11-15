// The door: a rock comes in from the Rock collection every few seconds while the shift runs.
import { defineBehavior, float, int, collection } from 'bylonder';
import Rock from './rock.js';

export default defineBehavior({
  name: 'Spawner',
  props: { prefab: collection('Rock'), every: float(4, { unit: 's' }), max: int(3) },
  create({ entity, props, game, time }) {
    return {
      update() {
        if (time.every(props.every) && game.all(Rock).filter((r) => r.state.mood !== 'leaving').length < props.max)
          game.spawn(props.prefab, { at: entity, jitter: 0.3 }); // owned by the run: gone on Reset
      },
    };
  },
});
