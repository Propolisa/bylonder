// The coffee machine: a slap on its orange button starts a brew, when it is idle and its tray is empty. A brew grinds,
// pumps and pours (a mug appears on the tray as the pour starts), steams and rings its bell when the mug is ready. The
// button glows the colour of what the machine is doing, with a small light: orange ready, pulsing amber grinding, blue
// pouring, white steaming, green done until the mug is lifted, dim red when a mug on the tray keeps it from starting.
// Its sounds are made in code (sounds.js), seeded from the run.
import { Color3, PointLight, Vector3 } from '@babylonjs/core';
import { defineBehavior, collection, object } from 'bylonder';
import Cup from './cup.js';
import Impact from './impact.js';
import { BREW, createSounds } from '../sounds.js';

const GLOW = { idle: [1, 0.45, 0.05], blocked: [0.35, 0.03, 0.02], grinding: [1, 0.7, 0.1], pouring: [0.15, 0.45, 1], steaming: [1, 1, 1], done: [0.2, 1, 0.3] };

export default defineBehavior({
  name: 'Machine',
  props: { cup: collection('Cup'), tray: object('Tray Spot'), button: object('Machine Button') },
  create({ props, game, time, babylon }) {
    const scene = babylon.scene, audio = game.audio, sounds = audio && createSounds(audio, time.random());
    const tray = () => scene.getTransformNodeByName(props.tray);
    const onTray = () => game.all(Cup).some((cup) => Vector3.Distance(cup.entity.node.getAbsolutePosition(), tray().getAbsolutePosition()) < 0.12);
    const button = () => game.all(Impact).find((i) => i.entity.name === props.button)?.entity;
    const light = new PointLight('Machine Glow', Vector3.Zero(), scene);
    light.range = 0.6;
    let state = 'idle', since = 0;
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
    game.on(Impact, 'hit', ({ entity }) => {
      if (entity.name === props.button && state === 'idle') brew();
    });
    return {
      /** What it is doing: idle, blocked, grinding, pouring, steaming or done. */
      get doing() { return state; },
      update() {
        if (state === 'idle' || state === 'blocked') become(onTray() ? 'blocked' : 'idle');
        else if (state === 'done' && !onTray()) become('idle');
        // The glow: the state's colour, the grinding pulsing.
        const pulse = state === 'grinding' ? 0.6 + 0.4 * Math.sin((time.now - since) * 12) : 1, glow = GLOW[state].map((c) => c * pulse);
        const pressed = button();
        pressed?.material().set('emissionColor', glow);
        if (pressed) light.position.copyFrom(pressed.node.getAbsolutePosition());
        light.diffuse = Color3.FromArray(glow);
        light.intensity = state === 'blocked' ? 0.15 : 0.6;
      },
    };
  },
});
