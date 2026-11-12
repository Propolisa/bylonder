// The scene's sequencer sound strips in a package (runtime/ir.js SoundSchema): each strip's timing, volume and mute in
// the IR's scene time, and its sound's file under sounds/, as the browser plays it. A compressed file every browser
// plays (MP3, AAC) ships as it is; another (WAV, FLAC, AIFF, Ogg...) is transcoded to AAC in .m4a where ffmpeg is at
// hand (Node), its encoder's delay recorded, else ships as it is.
import { fileBytes } from '../blenkernel/packed-file.js';

// The compressed formats every browser plays, by their files' first bytes.
const WEB_FORMATS = [
  ['mp3', (b) => tag(b, 0).startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)],
  ['m4a', (b) => tag(b, 4) === 'ftyp'],
];
const tag = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));
// ffmpeg's AAC encoder primes each file with one frame of 1024 samples, at the rate it is given.
const AAC_RATE = 48000, AAC_PRIMING = 1024;

/**
 * A sound's file as the browser plays it: its extension, bytes and the seconds of encoder delay its decoded sound
 * starts with (null when its file does not tell), or null when it has none.
 * @returns {Promise<{ ext: string, bytes: Uint8Array, delay: number | null } | null>}
 */
export async function webSound(bytes, transcode = ffmpegAac) {
  if (!bytes?.length) return null;
  const format = WEB_FORMATS.find(([, test]) => test(bytes))?.[0];
  if (format) return { ext: format, bytes, delay: (format === 'mp3' ? lameDelay : itunesDelay)(bytes) };
  const aac = await transcode(bytes).catch(() => null);
  if (aac) return { ext: 'm4a', bytes: aac, delay: AAC_PRIMING / AAC_RATE };
  return { ext: tag(bytes, 0) === 'RIFF' ? 'wav' : 'bin', bytes, delay: tag(bytes, 0) === 'RIFF' ? 0 : null };
}

// An MP3's encoder delay in seconds, from its LAME header (in the Xing or Info frame): the encoder's delay plus the 529
// samples an MP3 decoder adds; null without one.
const MP3_RATES = [44100, 48000, 32000];
export function lameDelay(bytes) {
  let at = tag(bytes, 0).startsWith('ID3') ? 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]) : 0;
  while (at < bytes.length - 4 && !(bytes[at] === 0xff && (bytes[at + 1] & 0xe0) === 0xe0)) at++;
  const version = (bytes[at + 1] >> 3) & 3, mono = bytes[at + 3] >> 6 === 3, mpeg1 = version === 3;
  const rate = MP3_RATES[(bytes[at + 2] >> 2) & 3] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const xing = at + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17));
  if (!['Xing', 'Info'].includes(tag(bytes, xing)) || !rate) return null;
  const flags = bytes[xing + 7];
  const lame = xing + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
  if (!/^(LAME|Lavc|Lavf)/.test(tag(bytes, lame))) return null;
  const delay = (bytes[lame + 21] << 4) | (bytes[lame + 22] >> 4);
  return (delay + 529) / rate;
}

// An AAC file's encoder delay in seconds, from its iTunSMPB tag (its second number, in samples at the track's rate);
// null without one.
export function itunesDelay(bytes) {
  const text = new TextDecoder('latin1').decode(bytes), smpb = text.indexOf('iTunSMPB'), sample = text.indexOf('mp4a');
  const fields = smpb < 0 ? null : /data.{8}\s*([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)/s.exec(text.slice(smpb, smpb + 200));
  const rate = sample < 0 ? 0 : (bytes[sample + 28] << 8) | bytes[sample + 29];
  return fields && rate ? parseInt(fields[2], 16) / rate : null;
}

// A sound transcoded to AAC in .m4a by the ffmpeg bundled with the dev dependencies, where Node runs the export: read
// from a file, as some formats need to seek.
async function ffmpegAac(bytes) {
  if (!globalThis.process?.versions?.node) return null;
  const [{ execFileSync }, fs, os, path, { default: ffmpeg }] = await Promise.all(['node:child_process', 'node:fs', 'node:os', 'node:path', 'ffmpeg-static'].map((m) => import(m)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bylonder-sound-')), input = path.join(dir, 'sound'), output = path.join(dir, 'sound.m4a');
  try {
    fs.writeFileSync(input, bytes);
    // No edit list, which some decoders apply and some do not: every browser decodes the priming, which delay skips.
    execFileSync(ffmpeg, ['-loglevel', 'error', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', String(AAC_RATE), '-use_editlist', '0', output]);
    return new Uint8Array(fs.readFileSync(output));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The scene's sound strips (RNA Scene `scene`) as the IR's scene time holds them, and their files by package path; a
 * sound shared by strips is one file.
 */
export async function exportSounds(scene) {
  const strips = [...(scene.sequence_editor?.strips_all ?? [])].filter((strip) => strip.type === 'SOUND' && strip.sound);
  const files = {}, paths = new Map(), sounds = [];
  const ship = async (/** @type {any} */ sound) => {
    const web = await webSound(fileBytes(sound));
    if (!web) return void console.warn(`Export: sound ${sound.name} has no file`), null;
    const stem = `sounds/${sound.name.replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_')}`;
    let file = `${stem}.${web.ext}`;
    for (let n = 1; file in files; n++) file = `${stem}_${n}.${web.ext}`;
    files[file] = web.bytes;
    if (web.delay === null) console.warn(`Export: sound ${sound.name} does not tell its encoder delay; it plays as if it had none`);
    return { file, delay: web.delay ?? 0 };
  };
  for (const strip of strips) {
    if (!paths.has(strip.sound.name)) paths.set(strip.sound.name, await ship(strip.sound));
    const sound = paths.get(strip.sound.name);
    if (!sound) continue;
    const { name, channel, frame_start, frame_final_start, frame_final_end, frame_offset_start, frame_offset_end, volume, mute } = strip;
    sounds.push({ name, ...sound, channel, frame_start, frame_final_start, frame_final_end, frame_offset_start, frame_offset_end, volume, mute });
  }
  return { sounds, files };
}
