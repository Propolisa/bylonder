// The coffee machine: whenever its tray is empty, it brews a cup onto it.
import { Vector3 } from '@babylonjs/core';
import { defineBehavior, float, collection, object } from 'bylonder';
import Cup from './cup.js';

export default defineBehavior({
  name: 'Machine',
  props: { cup: collection('Cup'), tray: object('Tray Spot'), brew: float(0.6, { unit: 's' }) },
  create({ props, game, time, babylon }) {
    let brewing = false;
    const tray = () => babylon.scene.getTransformNodeByName(props.tray);
    const onTray = (at) => game.all(Cup).some((cup) => Vector3.Distance(cup.entity.node.getAbsolutePosition(), at) < 0.12);
    return {
      async update() {
        const spot = tray();
        if (brewing || !spot || onTray(spot.getAbsolutePosition())) return;
        brewing = true;
        await time.wait(props.brew);
        game.spawn(props.cup, { at: { node: spot } }); // owned by the run: gone on Reset
        brewing = false;
      },
    };
  },
});
