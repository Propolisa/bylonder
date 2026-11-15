// The subtitles: the café's Ink story, which picks each line with the run's seeded random, drawn over the game with
// Babylon's GUI (made in create, so the run disposes it with the system).
import { defineSystem } from 'bylonder';
import { Compiler } from 'inkjs/full';
import { AdvancedDynamicTexture, Control, TextBlock } from '@babylonjs/gui';

export default defineSystem({
  name: 'Subtitles',
  create({ assets, time, babylon }) {
    let story = null, shown = null, until = 0;
    assets.text('content/dialogue/cafe.ink').then((source) => {
      story = new Compiler(source).Compile();
      story.state.storySeed = Math.floor(time.random() * 100000);
    });
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Subtitles', true, babylon.scene);
    const text = Object.assign(new TextBlock('Line'), {
      color: 'white', fontSize: 30, fontStyle: 'italic', outlineWidth: 5, outlineColor: 'black',
      textWrapping: true, resizeToFit: true, paddingBottom: '8%', verticalAlignment: Control.VERTICAL_ALIGNMENT_BOTTOM,
    });
    screen.addControl(text);
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
      update() { text.text = this.line ?? ''; },
    };
  },
});
