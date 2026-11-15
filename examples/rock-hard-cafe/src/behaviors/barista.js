// The player: a Character that walks on the Move stick, and hands a cup to the nearest waiting rock.
import { defineBehavior } from 'bylonder';
import Rock from './rock.js';

export default defineBehavior({
  name: 'Barista',
  requires: ['Character'], // only offered on armatures with a Character
  create({ entity, input, game }) {
    entity.character.input = () => ({ move: input.stick('Move') });
    game.camera.follow(entity);
    return {
      holding: null,
      update() {
        const rock = game.near(entity, 1.5, Rock, (r) => r.state.mood === 'waiting');
        if (rock && this.holding && input.pressed('Use')) {
          game.emit(rock, 'served', { cup: this.holding });
          this.holding = null;
        }
      },
    };
  },
});
