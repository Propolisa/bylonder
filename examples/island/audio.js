// The film's sound, in Babylon's spatial audio heard from the camera: the asteroid's roar travelling with it, each
// impact's boom or thud from where it lands, reaching the camera as late as its shock does, and the surf where the wave
// breaks on the island. Sounds play with the timeline and stop when it stops; renders are silent.
import { BEAT, STRIKE, IMPACTS, SHOCK_SPEED } from './story.js';
import { createSounds } from './sounds.js';
import { fireballAt } from './meteor.js';

const { Vector3 } = BABYLON;

// The cues: a sound, the second it starts at its source, where it is (a point, or one that moves with time), how loud,
// and the distance it is heard at full loudness.
function cues() {
  const surf = new Vector3(STRIKE.x * 0.8, 0.5, STRIKE.z * 0.8);
  return [
    { sound: 'roar', at: BEAT.impact - 6.2, place: (time) => fireballAt(Math.min(time, BEAT.impact - 0.01)), volume: 1, near: 30, moving: true },
    ...IMPACTS.map(({ x, z, time, size }) => ({ sound: size >= 0.75 ? 'boom' : 'thud', at: time, place: () => new Vector3(x, 1, z), volume: size, near: 25 })),
    { sound: 'surf', at: BEAT.impact + 1.5, place: () => surf, volume: 0.7, near: 15 },
  ];
}

export function createAudio(scene, camera, time) {
  // Silent where there is no Web Audio (headless runs).
  if (typeof AudioContext === 'undefined') return () => {};
  const list = cues(), playing = new Map();
  let engine = null, sounds = null, last = null;
  (async () => {
    engine = await BABYLON.CreateAudioEngineAsync();
    engine.listener.attach(camera);
    const made = createSounds();
    sounds = await Promise.all(list.map(async (cue, k) => {
      const { samples, sampleRate } = made[cue.sound], buffer = new AudioBuffer({ length: samples[0].length, numberOfChannels: 1, sampleRate });
      buffer.copyToChannel(samples[0], 0);
      return BABYLON.CreateSoundAsync(`${cue.sound} ${k}`, buffer, { volume: cue.volume, spatialEnabled: true, spatialDistanceModel: 'inverse', spatialMinDistance: cue.near, spatialRolloffFactor: 1 });
    }));
  })();
  scene.onDisposeObservable.add(() => engine?.dispose());

  // Where in a cue the camera hears it now, in seconds (negative before it is heard), given the shock's way to it.
  const heard = (cue, now) => now - cue.at - (cue.moving ? 0 : Vector3.Distance(cue.place(now), camera.globalPosition) / SHOCK_SPEED);
  const stop = () => { for (const sound of playing.values()) sound.stop(); playing.clear(); };
  return (day, now) => {
    if (!sounds) return;
    // A jump or a pause stops every sound; playing on starts each the moment the camera hears it, from where it is.
    if (!time.playing || last === null || now < last || now - last > 0.5) stop();
    if (time.playing) list.forEach((cue, k) => {
      const sound = sounds[k], offset = heard(cue, now);
      sound.spatial.position = cue.place(now);
      if (offset >= 0 && offset < sound.buffer.duration && !playing.has(k)) { sound.play({ startOffset: offset }); playing.set(k, sound); }
    });
    last = time.playing ? now : null;
  };
}
