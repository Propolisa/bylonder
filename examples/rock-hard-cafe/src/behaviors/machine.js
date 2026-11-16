// The coffee machine: a slap on its orange button (or the palm pressed on it) starts a brew, when it is idle and its
// tray is empty. A brew grinds, pumps and pours (a mug appears on the tray as the pour starts), steams and rings its bell when the mug is ready. The
// button glows the colour of what the machine is doing, with a small light: orange ready (breathing until its first
// slap), pulsing amber grinding, blue pouring, white steaming, green done until the mug is lifted, dim red when a mug
// on the tray keeps it from starting.
// Its sounds are made in code (sounds.js), seeded from the run.
import { PointLight, Vector3 } from '@babylonjs/core';
import { defineBehavior, collection, object } from 'bylonder';
import Barista from './barista.js';
import Cup from './cup.js';
import Impact from './impact.js';
import { BREW, createSounds } from '../sounds.js';

const GLOW = { idle: [1, 0.45, 0.05], blocked: [0.35, 0.03, 0.02], grinding: [1, 0.7, 0.1], pouring: [0.15, 0.45, 1], steaming: [1, 1, 1], done: [0.2, 1, 0.3] };
const glow = [0, 0, 0];
/** How near the palm's middle comes to the button's when it presses it (m). */
const PRESS = 0.09;

export default defineBehavior({
  name: 'Machine',
  props: { cup: collection('Cup'), tray: object('Tray Spot'), button: object('Machine Button') },
  create({ props, game, time, babylon }) {
    const scene = babylon.scene, audio = game.audio, sounds = audio && createSounds(audio, time.random());
    const tray = () => scene.getTransformNodeByName(props.tray);
    const onTray = () => game.all(Cup).some((cup) => Vector3.Distance(cup.entity.node.getAbsolutePosition(), tray().getAbsolutePosition()) < 0.12);
    let pressable = null, lit = null;
    const button = () => (pressable ??= game.all(Impact).find((i) => i.entity.name === props.button)?.entity ?? null);
    const light = new PointLight('Machine Glow', Vector3.Zero(), scene);
    light.range = 0.6;
    let state = 'idle', since = 0, slapped = false;
    const become = (next) => { state = next; since = time.now; };

    async function brew() {
      become('grinding');
      const start = audio ? audio.context.currentTime + 0.05 : 0;
      if (sounds) for (const [part, at] of Object.entries(BREW)) sounds[part](start + at);
      await time.wait(BREW.pour);
      become('pouring');
      game.spawn(props.cup, { at: { node: tray() } }); // owned by the run: gone on Reset
      await time.wait(BREW.steam - BREW.pour);
      become('steaming');
      await time.wait(BREW.ding - BREW.steam);
      become('done');
    }
    const press = () => {
      slapped = true;
      if (state === 'idle') brew();
    };
    game.on(Impact, 'hit', ({ entity }) => { if (entity.name === props.button) press(); });
    return {
      /** What it is doing: idle, blocked, grinding, pouring, steaming or done. */
      get doing() { return state; },
      update() {
        if (state === 'idle' || state === 'blocked') become(onTray() ? 'blocked' : 'idle');
        // A palm pressed on the button presses it too, however slowly it came.
        const palm = game.all(Barista)[0]?.palm, at = button()?.node.getAbsolutePosition();
        if (state === 'idle' && palm && at && Vector3.Distance(palm.getAbsolutePosition(), at) < PRESS) press();
        else if (state === 'done' && !onTray()) become('idle');
        // The glow: the state's colour, the grinding pulsing, and the button breathing until its first slap.
        const pulse = state === 'grinding' ? 0.6 + 0.4 * Math.sin((time.now - since) * 12) : state === 'idle' && !slapped ? 1.2 + 0.5 * Math.sin(time.now * 4) : 1;
        GLOW[state].forEach((c, i) => { glow[i] = c * pulse; });
        const pressed = button();
        if (pressed) (lit ??= pressed.material()).set('emissionColor', glow);
        if (pressed) light.position.copyFrom(pressed.node.getAbsolutePosition());
        light.diffuse.set(glow[0], glow[1], glow[2]);
        light.intensity = state === 'blocked' ? 0.15 : 0.6;
      },
    };
  },
});
