// The subtitles: the café's Ink story, which picks each line with the run's seeded random, shown over the game.
import { defineSystem } from 'bylonder';
import { Compiler } from 'inkjs/full';

export default defineSystem({
  name: 'Subtitles',
  create({ assets, time, babylon }) {
    let story = null, shown = null, until = 0;
    assets.text('content/dialogue/cafe.ink').then((source) => {
      story = new Compiler(source).Compile();
      story.state.storySeed = Math.floor(time.random() * 100000);
    });
    return {
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
        const canvas = babylon.engine.getRenderingCanvas?.();
        if (canvas) canvas.title = this.line ?? '';
      },
    };
  },
});
