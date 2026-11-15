// The player: a Character that walks on the Move stick. Use hands a held cup to the nearest waiting rock, or asks the
// machine for one: one key, one owner, so a press never both serves and pours.
import { defineBehavior } from 'bylonder';
import Rock from './rock.js';
import Machine from './machine.js';

export default defineBehavior({
  name: 'Barista',
  requires: ['Character'], // only offered on armatures with a Character
  create({ entity, input, game }) {
    entity.character.input = () => ({ move: input.stick('Move') });
    game.camera.follow(entity, { pitch: 1, distance: 5 }); // high over the shoulder: the counter and the rocks in view
    return {
      holding: null,
      update() {
        if (!input.pressed('Use')) return;
        const rock = this.holding && game.near(entity, 2, Rock, (r) => r.state.mood === 'waiting');
        if (rock) {
          game.emit(rock, 'served', { cup: this.holding });
          this.holding = null;
        } else if (!this.holding) {
          const machine = game.near(entity, 1.6, Machine);
          if (machine) game.emit(machine, 'pour', { barista: this });
        }
      },
    };
  },
});
