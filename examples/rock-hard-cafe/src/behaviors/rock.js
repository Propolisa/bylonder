// A customer: waits at the counter, admires a coffee it is served, spills it on itself and rolls out.
import { defineBehavior, float, action, sound, color, knot } from 'bylonder';
import Subtitles from '../systems/subtitles.js';

export default defineBehavior({
  name: 'Rock',
  props: {
    patience: float(8, { min: 1, unit: 's' }),
    admire: action('Wobble'),
    noises: sound(['Grind', 'Rumble', 'Clack']),
    reaction: knot('rock_reaction'),
    stain: color([0.24, 0.14, 0.07]),
  },
  events: ['left'],

  create({ entity, props, game, time, state }) {
    state.mood ??= 'waiting'; // survives saving rock.js, not Reset
    state.waited ??= 0;
    const leave = (served) => { state.mood = 'leaving'; this.emit('left', { served }); };
    return {
      async served({ cup }) {
        state.mood = 'admiring';
        entity.play(props.admire);
        game.play(time.pick(props.noises), { at: entity });
        game.get(Subtitles)?.say(props.reaction, { speaker: entity });
        await time.wait(1.5);
        entity.material().set('baseColor', props.stain); // the run's copy: the .blend keeps a clean rock
        cup?.hide();
        await time.wait(0.5);
        leave(true);
      },
      update(dt) {
        if (state.mood === 'waiting' && (state.waited += dt) > props.patience) leave(false);
        if (state.mood === 'leaving') entity.position.x += dt * 1.5; // rolls out on the runtime layer
      },
    };
  },
});
