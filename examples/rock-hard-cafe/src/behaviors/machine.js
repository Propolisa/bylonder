// The coffee machine: asked to pour (the barista's Use near it), it brews and puts a cup in the barista's hands.
import { defineBehavior, float, sound, collection } from 'bylonder';

export default defineBehavior({
  name: 'Machine',
  props: { cup: collection('Cup'), brew: float(0.6, { unit: 's' }), hiss: sound('Steam') },
  create({ entity, props, game, time }) {
    let brewing = false;
    return {
      async pour({ barista }) {
        if (brewing || barista.holding) return;
        brewing = true;
        game.play(props.hiss, { at: entity });
        await time.wait(props.brew);
        barista.holding = game.spawn(props.cup, { attachTo: barista.entity }); // owned by the run: gone on Reset
        barista.holding?.position.set(0.35, 1.0, 0.1); // held out at the side, where the camera sees it
        brewing = false;
      },
    };
  },
});
