// The subtitles: the café's Ink story, which picks each line with the run's seeded random, drawn over the game with
// Babylon's GUI in the café's look, a pill under the board (made in create, so the run disposes it with the system).
import { defineSystem } from 'bylonder';
import { Compiler } from 'inkjs/full';
import { AdvancedDynamicTexture, Control } from '@babylonjs/gui';
import { look, pill, px } from '../look.js';

export default defineSystem({
  name: 'Subtitles',
  create({ assets, time, babylon }) {
    let story = null, shown = null, until = 0;
    assets.text('content/dialogue/cafe.ink').then((source) => {
      story = new Compiler(source).Compile();
      story.state.storySeed = Math.floor(time.random() * 100000);
    });
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Subtitles', true, babylon.scene), engine = babylon.scene.getEngine();
    const line = pill('Line', { italic: true, wrap: true });
    Object.assign(line.panel, { width: 0.8, verticalAlignment: Control.VERTICAL_ALIGNMENT_TOP });
    screen.addControl(line.panel);
    let scaled = null;
    return {
      /** The text a knot gives (an Ink shuffle's pick), not shown. */
      tell(knot) {
        if (!story) return null;
        story.ChoosePathString(knot);
        return story.ContinueMaximally().trim();
      },
      /** The text a knot says, shown for a few seconds. */
      say(knot) {
        if (!story) return null;
        story.ChoosePathString(knot);
        shown = story.ContinueMaximally().trim();
        until = time.now + 2.5;
        return shown;
      },
      /** The line on screen now, if any. */
      get line() { return time.now < until ? shown : null; },
      update() {
        if (scaled !== engine.getHardwareScalingLevel()) {
          scaled = engine.getHardwareScalingLevel();
          line.sized(engine);
          line.panel.top = px(engine, 2 * look.edge + look.pill);
        }
        const now = time.now < until ? shown : '';
        if (line.text.text !== now) line.text.text = now;
        line.panel.isVisible = !!now;
      },
    };
  },
});
