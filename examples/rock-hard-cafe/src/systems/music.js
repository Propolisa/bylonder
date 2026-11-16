// The café's music: one track, looped quietly under the game with Babylon's audio engine; the Music key or the board's
// button mutes it. Its
// file is content/music/cafe.ogg; without one the café plays without music.
import { CreateAudioEngineAsync, CreateStreamingSoundAsync } from '@babylonjs/core';
import { defineSystem, float } from 'bylonder';

const TRACK = 'content/music/cafe.ogg';

export default defineSystem({
  name: 'Music',
  props: { volume: float(0.2, { min: 0, max: 1 }) },
  create({ assets, input, props }) {
    let audio = null, sound = null, muted = false, track = null, gone = false;
    if (typeof AudioContext !== 'undefined') {
      (async () => {
        if (!(await fetch(assets.url(TRACK), { method: 'HEAD' }).then((r) => r.ok, () => false)) || gone) return;
        audio = await CreateAudioEngineAsync();
        sound = await CreateStreamingSoundAsync('Music', assets.url(TRACK), { loop: true, volume: muted ? 0 : props.volume, autoplay: true }, audio);
        if (gone) audio.dispose();
        else track = TRACK;
      })().catch((error) => console.warn(`The café's music did not play: ${error?.message ?? error}`));
    }
    const toggle = () => {
      muted = !muted;
      if (sound) sound.volume = muted ? 0 : props.volume;
    };
    return {
      /** The track playing, if any. */
      get track() { return track; },
      get muted() { return muted; },
      /** Mutes the music, or plays it again. */
      toggle,
      update() {
        if (input.pressed('Music')) toggle();
      },
      dispose() { gone = true; audio?.dispose(); },
    };
  },
});
