// The stand's board over the game, drawn with Babylon's GUI in the café's look (look.js): the rocks served and those
// that left thirsty in one pill at the top left, the mute and settings buttons beside it (the settings: the view's
// Orientation, Auto, Portrait or Landscape, and its Quality, Auto, Mobile or Full), and how to play in a pill at the bottom,
// for the mouse and keys until the first rock is served, or for touch beside the Grab button until the first reach.
import { defineSystem } from 'bylonder';
import { AdvancedDynamicTexture, Control, Ellipse, StackPanel, TextBlock } from '@babylonjs/gui';
import Shift from './shift.js';
import Music from './music.js';
import Touch from './touch.js';
import Orientation, { ORIENTATIONS } from './orientation.js';
import Quality, { QUALITIES } from './quality.js';
import { look, pill, px } from '../look.js';

const HELP = {
  keys: 'Mouse: reach. Hold Space: grab. WASD: walk. Slap the orange button for a coffee.',
  touch: 'Drag on the right: reach, and walk past your reach. Hold the left: grab.',
};

export default defineSystem({
  name: 'Hud',
  create({ game, input, babylon }) {
    const engine = babylon.scene.getEngine();
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Hud', true, babylon.scene);
    const top = Object.assign(new StackPanel('Board'), { isVertical: false, horizontalAlignment: Control.HORIZONTAL_ALIGNMENT_LEFT, verticalAlignment: Control.VERTICAL_ALIGNMENT_TOP, isPointerBlocker: false });
    const score = pill('Score');
    // The mute button: a round panel with a note, struck through while muted.
    const mute = Object.assign(new Ellipse('Mute'), { thickness: 0, background: look.panel, isPointerBlocker: true });
    const note = Object.assign(new TextBlock('Mute Note', '♪'), { color: look.text, fontFamily: look.font });
    mute.addControl(note);
    mute.onPointerClickObservable.add(() => game.get(Music)?.toggle());
    // The settings button and its menu under the board: a row a setting, the choice in use lit.
    const gear = Object.assign(new Ellipse('Settings'), { thickness: 0, background: look.panel, isPointerBlocker: true });
    const dots = Object.assign(new TextBlock('Settings Dots', '⋯'), { color: look.text, fontFamily: look.font });
    gear.addControl(dots);
    const menu = Object.assign(new StackPanel('Settings Menu'), { horizontalAlignment: Control.HORIZONTAL_ALIGNMENT_LEFT, verticalAlignment: Control.VERTICAL_ALIGNMENT_TOP, isPointerBlocker: false, isVisible: false });
    gear.onPointerClickObservable.add(() => { menu.isVisible = !menu.isVisible; });
    const row = (/** @type {string} */ name, /** @type {string[]} */ values, /** @type {any} */ system, /** @type {string} */ prop) => {
      const panel = Object.assign(new StackPanel(`${name} Row`), { isVertical: false, horizontalAlignment: Control.HORIZONTAL_ALIGNMENT_LEFT, isPointerBlocker: false });
      const label = pill(name);
      label.text.text = name;
      const choices = values.map((value) => {
        const choice = pill(`${name} ${value}`);
        choice.text.text = value;
        choice.panel.isPointerBlocker = true;
        choice.panel.onPointerClickObservable.add(() => { const setting = game.get(system); if (setting) setting[prop] = value; });
        return { value, ...choice };
      });
      for (const item of [label, ...choices]) panel.addControl(item.panel);
      menu.addControl(panel);
      return { panel, items: [label, ...choices], choices, system, prop };
    };
    const rows = [row('Orientation', ORIENTATIONS, Orientation, 'orientation'), row('Quality', QUALITIES, Quality, 'quality')];
    top.addControl(score.panel);
    top.addControl(mute);
    top.addControl(gear);
    const help = pill('Help', { wrap: true });
    Object.assign(help.panel, { verticalAlignment: Control.VERTICAL_ALIGNMENT_BOTTOM });
    for (const control of [top, menu, help.panel]) screen.addControl(control);
    let scaled = null, text = '';
    const size = () => {
      Object.assign(top, { left: px(engine, look.edge), top: px(engine, look.edge), height: px(engine, look.pill) });
      score.sized(engine);
      Object.assign(menu, { left: px(engine, look.edge), top: px(engine, look.edge + look.pill + look.gap) });
      for (const { panel, items } of rows) {
        Object.assign(panel, { height: px(engine, look.pill + look.gap), paddingBottom: px(engine, look.gap) });
        for (const item of items) { item.sized(engine); item.panel.paddingRight = px(engine, look.gap / 2); }
      }
      help.sized(engine);
      for (const round of [mute, gear]) Object.assign(round, { width: px(engine, look.pill), height: px(engine, look.pill), paddingLeft: px(engine, look.gap / 2) });
      note.fontSize = dots.fontSize = px(engine, look.size.line);
      // By touch, in the bottom row beside the Grab button, clear of the play area; else across the bottom.
      const width = engine.getRenderWidth() * engine.getHardwareScalingLevel(), beside = look.thumb + 4 * look.edge;
      Object.assign(help.panel, input.touch
        ? { width: px(engine, width - beside - look.edge), left: px(engine, beside / 2), top: px(engine, -3 * look.edge) }
        : { width: 0.86, left: 0, top: px(engine, -2 * look.edge) });
    };
    return {
      update() {
        const shape = `${engine.getHardwareScalingLevel()} ${engine.getRenderWidth()} ${!!input.touch}`;
        if (scaled !== shape) { scaled = shape; size(); }
        const { served = 0, walkouts = 0 } = game.get(Shift)?.save() ?? {};
        const next = `Served ${served}${walkouts ? `   Left thirsty ${walkouts}` : ''}`;
        if (next !== text) score.text.text = text = next;
        const music = game.get(Music);
        mute.isVisible = !!music?.track;
        note.alpha = music?.muted ? 0.4 : 1;
        gear.isVisible = rows.some(({ system }) => !!game.get(system));
        for (const { panel, choices, system, prop } of rows) {
          const setting = /** @type {any} */ (game.get(system));
          panel.isVisible = !!setting;
          for (const choice of choices) choice.panel.background = choice.value === setting?.[prop] ? look.accent : look.panel;
        }
        const how = input.touch ? (game.get(Touch)?.dragged ? '' : HELP.touch) : served ? '' : HELP.keys;
        if (help.text.text !== how) { help.text.text = how; size(); }
        help.panel.isVisible = !!how;
      },
    };
  },
});
