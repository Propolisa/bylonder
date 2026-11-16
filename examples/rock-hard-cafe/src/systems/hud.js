// The stand's board over the game, drawn with Babylon's GUI in the café's look (look.js): the rocks served and those
// that left thirsty in one pill at the top left, the mute button beside it, and how to play in a pill at the bottom,
// for the mouse and keys until the first rock is served, or for touch beside the Grab button until the first reach.
import { defineSystem } from 'bylonder';
import { AdvancedDynamicTexture, Control, Ellipse, StackPanel, TextBlock } from '@babylonjs/gui';
import Shift from './shift.js';
import Music from './music.js';
import Touch from './touch.js';
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
    top.addControl(score.panel);
    top.addControl(mute);
    const help = pill('Help', { wrap: true });
    Object.assign(help.panel, { verticalAlignment: Control.VERTICAL_ALIGNMENT_BOTTOM });
    for (const control of [top, help.panel]) screen.addControl(control);
    let scaled = null, text = '';
    const size = () => {
      Object.assign(top, { left: px(engine, look.edge), top: px(engine, look.edge), height: px(engine, look.pill) });
      score.sized(engine);
      help.sized(engine);
      Object.assign(mute, { width: px(engine, look.pill), height: px(engine, look.pill), paddingLeft: px(engine, look.gap / 2) });
      note.fontSize = px(engine, look.size.line);
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
        const how = input.touch ? (game.get(Touch)?.dragged ? '' : HELP.touch) : served ? '' : HELP.keys;
        if (help.text.text !== how) { help.text.text = how; size(); }
        help.panel.isVisible = !!how;
      },
    };
  },
});
