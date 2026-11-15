// The coffee machine: Use near it pours a cup into the barista's hands.
import { defineBehavior, float, sound, collection } from 'bylonder';
import Barista from './barista.js';

export default defineBehavior({
  name: 'Machine',
  props: { cup: collection('Cup'), brew: float(0.6, { unit: 's' }), hiss: sound('Steam') },
  create({ entity, props, game, input, time }) {
    let brewing = false;
    return {
      async update() {
        const barista = game.near(entity, 1.2, Barista);
        if (brewing || !barista || barista.holding || !input.pressed('Use')) return;
        brewing = true;
        game.play(props.hiss, { at: entity });
        await time.wait(props.brew);
        barista.holding = game.spawn(props.cup, { attachTo: barista.entity }); // owned by the run: gone on Reset
        barista.holding?.position.set(0.3, 0.35, 0);
        brewing = false;
      },
    };
  },
});
