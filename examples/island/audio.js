// The film's sound, in Babylon's spatial audio heard from the camera. Beds loop under it all, each as loud as the
// story makes it: the sea, the wind, the eruption and its steam, insects on warm nights, the forest fire. Over them
// cues play where they happen: the family's calls from where each bird is, the egg cracking, the flock, the whales,
// the tree falling, and the asteroid's roar travelling with it, each impact heard as late as its shock reaches the
// camera. Sounds play with the timeline and stop when it stops; a render or the Video Sequencer's Scene Audio strip
// mixes them down the same way.
import { BEAT, NEST, STRIKE, IMPACTS, SHOCK_SPEED, FRAMES, smoothstep, eruption, days, seconds, filmAt, rateAt, burning, gust } from './story.js';
import { createSounds } from './sounds.js';
import { fireballAt, fireLight } from './meteor.js';
import { whereIs } from './family.js';
import { flockAt, WHALES } from './life.js';

const { Vector3 } = BABYLON;

// The second the day first reaches `day`.
const secondOfDay = (day) => { let frame = 1; while (frame < FRAMES && days(frame) < day) frame++; return seconds(frame); };
const night = (day) => 1 - smoothstep(-0.25, 0, Math.sin(2 * Math.PI * (day + 0.05)));
const TREE = new Vector3(NEST.x, NEST.ground + 1, NEST.z);

// The family's calls: [sound, who, second, loudness].
const CALLS = [
  // She finds the island; he follows; they court, and settle.
  ['mother', 'mother', 39.6], ['mother', 'mother', 41.6], ['mother', 'mother', 43.4], ['father', 'father', 46.6], ['father', 'father', 48.3],
  ['mother', 'mother', 48.9], ['father', 'father', 51.3], ['mother', 'mother', 51.9], ['father', 'father', 54.1], ['mother', 'mother', 54.8],
  ['coo', 'mother', 55.8], ['coo', 'father', 56.3], ['father', 'father', 59.4, 0.6], ['father', 'father', 62.4, 0.6], ['coo', 'mother', 64.5],
  ['coo', 'mother', 72.1, 0.7],
  // It hatches and is fed.
  ['crack', 'chick', 81.7], ['crack', 'chick', 82.2], ['peep', 'chick', 82.8], ['coo', 'mother', 83.3], ['peep', 'chick', 83.6], ['peep', 'chick', 84.4],
  ['father', 'father', 87.4], ['peep', 'chick', 87.9], ['peep', 'chick', 88.4], ['peep', 'chick', 88.9], ['peep', 'chick', 89.5], ['coo', 'father', 90.2],
  ['mother', 'mother', 96.6, 0.7], ['peep', 'chick', 97.3], ['peep', 'chick', 97.8],
  // The lesson; it tries and fails; she comforts it.
  ['mother', 'mother', 99.7], ['mother', 'mother', 101.1], ['mother', 'mother', 102.4], ['peep', 'chick', 103.1], ['peep', 'chick', 103.6],
  ['peep', 'chick', 105.6], ['sad', 'chick', 106.4], ['coo', 'mother', 107.5], ['coo', 'mother', 108.3],
  // The star's last nights; he cannot settle; it comes.
  ['father', 'father', 113.2, 0.7], ['coo', 'mother', 115], ['father', 'father', 118.4, 0.7], ['father', 'father', 124.9], ['alarm', 'father', 126.2],
  ['alarm', 'father', 129.6], ['mother', 'mother', 131], ['sad', 'chick', 132.6], ['alarm', 'father', 134.9], ['peep', 'chick', 135.3],
  ['peep', 'chick', 136.2], ['coo', 'mother', 138.2],
  // The fire comes down to them; the chick fails again.
  ...[144, 146.2, 148.1, 150, 151.8, 153.4, 154.4].map((second) => ['alarm', 'father', second]), ['peep', 'chick', 145.3], ['mother', 'mother', 147.2],
  ['peep', 'chick', 148.8], ['peep', 'chick', 150.6], ['sad', 'chick', 151.3], ['mother', 'mother', 152.7], ['peep', 'chick', 153.9],
  // She pushes it; it falls, and flies; her last call as the tree goes.
  ['mother', 'mother', 154.85], ['sad', 'chick', 155.15], ['peep', 'chick', 155.5], ['mother', 'mother', 156.0], ['father', 'father', 156.6], ['peep', 'chick', 157.2],
  // It calls for her from the beach, and nothing answers; the father's low call.
  ['peep', 'chick', 158.3], ['peep', 'chick', 159.1], ['sad', 'chick', 160.9], ['peep', 'chick', 162.4], ['peep', 'chick', 164.9, 0.8],
  ['sad', 'chick', 167.1, 0.8], ['coo', 'father', 168], ['peep', 'chick', 169.9, 0.5], ['coo', 'father', 171.3],
  // Morning: a faint call from the cave, and again; she comes out; they huddle.
  ['mother', 'mother', 174.1, 0.25], ['peep', 'chick', 174.6], ['mother', 'mother', 175.3, 0.45], ['peep', 'chick', 175.9], ['father', 'father', 176.4],
  ['mother', 'mother', 176.9, 0.8], ['peep', 'chick', 177.4], ['peep', 'chick', 177.8], ['peep', 'chick', 178.2], ['coo', 'mother', 179],
  ['coo', 'chick', 179.6], ['coo', 'father', 180.4], ['coo', 'mother', 181.8, 0.7], ['peep', 'chick', 183.1, 0.5], ['coo', 'mother', 184.6, 0.6],

];

// How loud each sound is against the others: tones carry far more than rumbles of the same peak.
const LEVEL = { eruption: 2, steam: 1, insects: 1, fire: 1.2, mother: 0.3, father: 0.3, alarm: 0.3, coo: 0.3, peep: 0.22, sad: 0.28, flock: 0.25, crack: 0.4,
  song: 0.25, spout: 0.5, creak: 0.6, crash: 1.4, roar: 1.6, boom: 3.2, thud: 1.8, surf: 1 };
// Every sound: a one-shot plays once from `at` (seconds) where `place(time)` puts it; a bed loops as loud as
// `volume(day, time)` says. `near` is the distance it is heard at full loudness; with no place it is all around.
export function cues() {
  const at = (sound, second, place, volume = 1, near = 3) => ({ sound, at: second, place, volume: volume * LEVEL[sound], near });
  const flockIn = secondOfDay(4.9), flock = (second, volume = 0.6) => at('flock', second, flockAt, volume, 8);
  return [
    { sound: 'sea', bed: true, volume: () => 0.35 },
    { sound: 'wind', bed: true, volume: (day, time) => 0.12 + 0.6 * gust(time) },
    { sound: 'eruption', bed: true, place: () => new Vector3(0, 4, 0), near: 12, volume: (day) => LEVEL.eruption * eruption(day) * smoothstep(0.1, 0.4, day) },
    { sound: 'steam', bed: true, place: () => new Vector3(0, 0.3, 0), near: 8, volume: (day) => 0.6 * smoothstep(1.45, 1.65, day) * (1 - smoothstep(2.4, 2.9, day)) },
    { sound: 'insects', bed: true, place: () => new Vector3(0, 1, 0), near: 8,
      volume: (day, time) => 0.35 * night(day) * smoothstep(5.6, 6.2, day) * (1 - smoothstep(BEAT.streak - 2, BEAT.streak, time)) },
    { sound: 'fire', bed: true, place: (time) => fireLight(time).position, near: 6, volume: (day, time) => (time >= BEAT.embers ? LEVEL.fire * burning(time) : 0) },
    ...CALLS.map(([sound, who, second, volume = 1]) => at(sound, second, (time) => whereIs(who, time), volume)),
    flock(flockIn), flock(flockIn + 3.5), ...Array.from({ length: Math.floor((BEAT.leave - flockIn - 8) / 9) }, (_, k) => flock(flockIn + 9 * (k + 1), 0.35)),
    flock(BEAT.leave), flock(BEAT.leave + 1.4), flock(BEAT.leave + 3),
    ...WHALES.flatMap(({ start, at: place, size }) => [at('song', start + 0.2, () => place, size, 10), at('spout', start + 0.9, () => place, size, 10)]),
    at('creak', BEAT.fall - 0.25, () => TREE, 0.8), at('crash', BEAT.fall + 0.5, () => TREE, 1, 4),
    at('roar', BEAT.impact - 6.2, (time) => fireballAt(Math.min(time, BEAT.impact - 0.01)), 1, 30),
    ...IMPACTS.map(({ x, z, time, size }) => ({ ...at(size >= 0.75 ? 'boom' : 'thud', time, () => new Vector3(x, 1, z), size, 25), shock: true })),
    at('surf', BEAT.impact + 1.5, () => new Vector3(STRIKE.x * 0.8, 0.5, STRIKE.z * 0.8), 0.7, 15),
  ];
}

// Where in a one-shot the camera hears it now, in story seconds (negative before it is heard): an impact's shock takes
// its time to reach the camera.
export const heard = (cue, now, ear) => now - cue.at - (cue.shock ? Vector3.Distance(cue.place(now), ear) / SHOCK_SPEED : 0);
// A one-shot heard in slow motion plays slower and lower, as a slowed recording would, not as slowly as the picture.
const pitchAt = (second) => Math.sqrt(rateAt(second));

// Plays the cue sheet; resolves once every sound is ready, with the frame update. Live it plays to the speakers; in a
// render context Babylon's engine plays into the job's offline audio context, so the update moves every source and
// the listener itself rather than leaving it to the browser's animation frames.
export async function createAudio(scene, camera, time) {
  // Silent where there is no Web Audio (headless runs).
  if (typeof AudioContext === 'undefined') return () => {};
  const list = cues(), playing = new Set();
  const engine = await BABYLON.CreateAudioEngineAsync({ volume: 0.6 });
  scene.onDisposeObservable.add(() => engine.dispose());
  engine.listener.attach(camera);
  const buffers = {};
  for (const [name, { samples, sampleRate }] of Object.entries(createSounds())) {
    const pcm = new AudioBuffer({ length: samples[0].length, numberOfChannels: 1, sampleRate });
    pcm.copyToChannel(samples[0], 0);
    buffers[name] = await BABYLON.CreateSoundBufferAsync(pcm);
  }
  // Babylon makes a sound spatial if it is given any spatial option, so only placed sounds get them.
  const spatial = (cue) => (cue.place ? { spatialEnabled: true, spatialDistanceModel: 'inverse', spatialMinDistance: cue.near, spatialRolloffFactor: 1 } : {});
  const sounds = await Promise.all(list.map((cue, k) => BABYLON.CreateSoundAsync(`${cue.sound} ${k}`, buffers[cue.sound], { volume: cue.bed ? 0 : cue.volume, loop: !!cue.bed, ...spatial(cue) })));

  let last = null;
  const stop = () => { for (const k of playing) sounds[k].stop(); playing.clear(); };
  return (day, now) => {
    // A jump or a pause stops every sound; playing on starts each where the camera hears it now.
    if (!time.playing || last === null || now < last || now - last > 0.5) stop();
    last = time.playing ? now : null;
    if (!time.playing) return;
    engine.listener.update();
    list.forEach((cue, k) => {
      const sound = sounds[k];
      if (cue.place) { sound.spatial.position = cue.place(now); sound.spatial.update(); }
      if (cue.bed) {
        sound.volume = cue.volume(day, now);
        if (!playing.has(k)) { sound.play({ startOffset: now % sound.buffer.duration }); playing.add(k); }
        return;
      }
      const start = now - heard(cue, now, camera.globalPosition), pitch = pitchAt(start), offset = (filmAt(now) - filmAt(start)) * pitch;
      if (offset >= 0 && offset < sound.buffer.duration && !playing.has(k)) { sound.playbackRate = pitch; sound.play({ startOffset: offset }); playing.add(k); }
    });
  };
}
