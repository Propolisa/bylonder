// Builds the noodle shop demo's sounds (docs/demos/noodle-shop/sounds/) from their CC0 and CC BY sources: downloads
// each source, cuts, fades, loops and loudness-matches it, encodes Opus (.ogg) and MP3, and writes CREDITS.md.
// Freesound's originals need an account, so its sounds come from its public high-quality previews.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpeg } from '../media.mjs';

const out = fileURLToPath(new URL('../../docs/demos/noodle-shop/sounds/', import.meta.url));
const cache = join(tmpdir(), 'bylonder-noodle-sounds');

const CC0 = ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'];
const BY4 = ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'];
const freesound = (user, id, preview) => ({ page: `https://freesound.org/people/${user}/sounds/${id}/`, url: `https://cdn.freesound.org/previews/${preview}-hq.mp3`, author: decodeURIComponent(user) });

const sources = {
  tea: { title: 'A cup of tea (lofi Compilation)', author: 'TAD', page: 'https://opengameart.org/content/lofi-compilation', url: 'https://opengameart.org/sites/default/files/A%20cup%20of%20tea_0.mp3', license: CC0 },
  rain: { title: 'Light Rain Falls on Awning', ...freesound('ultradust', 168034, '168/168034_1037961'), license: BY4 },
  steps: { title: 'boots on wet path.wav', ...freesound('cybergrrl', 334519, '334/334519_5875655'), license: CC0 },
  chair: { title: 'Chair sitting_1(creak, wood).WAV', ...freesound('o_ciz', 475493, '475/475493_7009965'), license: CC0 },
  coins: { title: 'Coin sounds', ...freesound('Breviceps', 458399, '458/458399_9159316'), license: CC0 },
  pour: { title: 'Tea Pouring', ...freesound('mdayalan', 240125, '240/240125_1061768'), license: CC0 },
  cup: { title: 'Tea cup set down 2.mp3', ...freesound('TheHiraHira', 460241, '460/460241_9117851'), license: CC0 },
  sip: { title: 'Sipping.ogg', ...freesound('Psychic5', 620093, '620/620093_11162745'), license: CC0 },
  door: { title: 'Japanese Wooden Sliding Door with Frosted Glass - Opening and Closing', ...freesound('KoimeMatsuchiya', 874658, '874/874658_19256798'), license: CC0 },
  furin: { title: 'Furin japanese wind chime.wav', ...freesound('ayustat2001', 501168, '501/501168_4648939'), license: CC0 },
  sigh: { title: 'Relief sigh', ...freesound('AgusIvan', 724232, '724/724232_15402948'), license: CC0 },
};

// name: source, start and length (s), loudness (LUFS), channels, Opus and MP3 bitrates, extra filters, loop crossfade (s).
const sounds = [
  { name: 'music', from: 'tea', start: 14, length: 54.857, lufs: -18, ch: 2, opus: 64, mp3: 96, loop: 0.08 },
  { name: 'rain', from: 'rain', start: 40, length: 30, lufs: -20, ch: 2, opus: 48, mp3: 80, loop: 2 },
  ...[9.43, 15.76, 17.0, 18.18].map((t, i) => ({ name: `step-${i + 1}`, from: 'steps', start: t - 0.06, length: 0.42, fadeOut: 0.15 })),
  { name: 'stool', from: 'chair', start: 12.4, length: 1.0, fadeOut: 0.3 },
  { name: 'coins', from: 'coins', start: 0, length: 1.0, fadeOut: 0.3 },
  { name: 'pour', from: 'pour', start: 0.3, length: 3.4, fadeIn: 0.15, fadeOut: 0.8 },
  { name: 'cup', from: 'cup', start: 1.85, length: 0.8, fadeOut: 0.3 },
  { name: 'sip', from: 'sip', start: 1.1, length: 0.75, fadeOut: 0.2 },
  { name: 'door', from: 'door', start: 0, length: 1.9, fadeIn: 0.1, fadeOut: 0.4, filters: 'lowpass=f=7000' },
  { name: 'chime', from: 'furin', start: 0.33, length: 2.8, fadeOut: 1.5, lufs: -22 },
  { name: 'exhale', from: 'sigh', start: 2.1, length: 1.8, fadeOut: 0.6 },
];

const run = (...args) => execFileSync(ffmpeg, ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const stderr = (...args) => spawnSync(ffmpeg, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8' }).stderr;

function download(key) {
  const file = join(cache, `${key}.mp3`);
  if (!existsSync(file)) execFileSync('curl', ['-sfL', '-o', file, sources[key].url]);
  return file;
}

// The cut as 48 kHz WAV: trimmed, faded, short sounds denoised (quiet recordings gain up to 30 dB), and for loops the tail crossfaded (equal power) into the head.
function cut({ name, from, start, length, ch = 1, fadeIn = 0.005, fadeOut = 0.05, filters, loop }) {
  const wav = join(cache, `${name}.wav`), pre = `aresample=48000,aformat=channel_layouts=${ch === 1 ? 'mono' : 'stereo'},highpass=f=50${loop ? '' : ',afftdn=nr=18:tn=1'}${filters ? `,${filters}` : ''}`;
  const graph = loop
    ? `[0:a]${pre},atrim=0:${length + loop},asetpts=N/SR/TB,asplit=3[a][b][c];` +
      `[a]atrim=0:${loop},afade=t=in:d=${loop}:curve=qsin[head];[b]atrim=${length}:${length + loop},asetpts=N/SR/TB,afade=t=out:d=${loop}:curve=qsin[tail];` +
      `[head][tail]amix=inputs=2:normalize=0[seam];[c]atrim=${loop}:${length},asetpts=N/SR/TB[body];[seam][body]concat=v=0:a=1[o]`
    : `[0:a]${pre},atrim=0:${length},asetpts=N/SR/TB,afade=t=in:d=${fadeIn},afade=t=out:st=${length - fadeOut}:d=${fadeOut}[o]`;
  run('-ss', String(start), '-i', download(from), '-filter_complex', graph, '-map', '[o]', '-c:a', 'pcm_f32le', wav);
  return wav;
}

// Gain to the target loudness, held under -1.5 dB peak; short sounds use their momentary maximum as their loudness.
function gain(wav, lufs) {
  const log = stderr('-i', wav, '-af', 'ebur128=peak=sample', '-f', 'null', '-');
  const integrated = +log.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0];
  const momentary = Math.max(...[...log.matchAll(/ M:\s*(-?[\d.]+)/g)].map((m) => +m[1]));
  const peak = +log.match(/Peak:\s+(-?[\d.]+) dBFS/g).pop().match(/-?[\d.]+/)[0];
  const loudness = Number.isFinite(integrated) && integrated > -70 ? integrated : momentary;
  return Math.min(lufs - loudness, -1.5 - peak);
}

mkdirSync(cache, { recursive: true });
mkdirSync(out, { recursive: true });
for (const sound of sounds) {
  const { name, lufs = -18, ch = 1, opus = 32, mp3 = 64 } = sound;
  const wav = cut(sound), db = gain(wav, lufs).toFixed(2);
  run('-i', wav, '-af', `volume=${db}dB`, '-c:a', 'libopus', '-b:a', `${opus}k`, '-ac', String(ch), join(out, `${name}.ogg`));
  run('-i', wav, '-af', `volume=${db}dB`, '-c:a', 'libmp3lame', '-b:a', `${mp3}k`, '-ac', String(ch), '-ar', '44100', join(out, `${name}.mp3`));
  console.log(name, `${db} dB`);
}

const used = (key) => sounds.filter((s) => s.from === key).map((s) => `\`${s.name}\``).join(', ');
writeFileSync(join(out, 'CREDITS.md'), `# Sound credits

The noodle shop demo's sounds, each as \`.ogg\` (Opus) and \`.mp3\`, cut and loudness-matched from these recordings by
\`tools/docs/noodle-shop-sounds.mjs\`.

| Files | Title | Author | Source | License |
| --- | --- | --- | --- | --- |
${Object.entries(sources).map(([key, s]) => `| ${used(key)} | ${s.title} | ${s.author} | ${s.page} | [${s.license[0]}](${s.license[1]}) |`).join('\n')}
`);
