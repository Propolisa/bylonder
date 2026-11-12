// The scene's sequencer sound strips in the JavaScript export: the IR's scene time holds each strip's timing, volume and
// mute, the package holds its sound's file as every browser plays it, compressed (the fixture's WAV as AAC in .m4a,
// whose encoder delay the IR records), and the page gives each strip by name with its start, offset (after that delay)
// and duration in seconds.
// tests/fixtures/sound-strips.blend is written by tools/blender-reference/sound-strips-fixture.py.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import ffmpeg from 'ffmpeg-static';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { webSound } from '../src/io_scene_babylon/sound-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample(new URL('./fixtures/sound-strips.blend', import.meta.url));
sync.view();
const files = await exportModule(world, { live: true });
const { sounds } = JSON.parse(files['scene.ir.json']).scene.time;
const DELAY = 1024 / 48000;
assert.deepEqual(sounds.map((s) => [s.name, s.file, s.delay, s.channel, s.frame_final_start, s.frame_final_end, s.frame_offset_start, s.volume, s.mute]),
  [['Tone', 'sounds/tone.m4a', DELAY, 1, 13, 37, 0, 1, false], ['Tone Quiet', 'sounds/tone.m4a', DELAY, 2, 43, 61, 6, 0.5, true]], "the strips' timing, volume and mute");
const shipped = files['sounds/tone.m4a'];
assert.equal(new TextDecoder().decode(shipped.subarray(4, 8)), 'ftyp', 'the tone ships once for both strips, as AAC in .m4a');
assert.ok(shipped.length < 44144 / 2, `compressed: ${shipped.length} bytes of a 44144-byte WAV`);

const written = writePackage(files), blend = await (await import(written.url)).load(new NullEngine());
const { url, ...tone } = blend.sounds.Tone;
assert.deepEqual(tone, { start: 0.5, offset: DELAY, duration: 1, channel: 1, volume: 1, mute: false }, 'the page gives a strip in seconds');
assert.deepEqual(blend.sounds['Tone Quiet'], { url, start: 1.75, offset: DELAY + 0.25, duration: 0.75, channel: 2, volume: 0.5, mute: true }, 'its cut start and its mute');
assert.ok(existsSync(fileURLToPath(url)), "the strip's sound is in the package");

const dir = mkdtempSync(join(tmpdir(), 'bylonder-aiff-')), aiff = join(dir, 'tone.aiff');
execFileSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', aiff]);
const aac = await webSound(new Uint8Array(readFileSync(aiff)));
rmSync(dir, { recursive: true });
assert.equal(aac.ext, 'm4a', 'an AIFF is transcoded too');
// A compressed file ships as it is, with the encoder delay its header tells: an MP3's LAME header (LAME's 576 samples
// and the decoder's 529), an AAC file's iTunSMPB; none from a file without one.
const mp3File = join(mkdtempSync(join(tmpdir(), 'bylonder-mp3-')), 'tone.mp3');
execFileSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-ar', '44100', '-c:a', 'libmp3lame', mp3File]);
const mp3 = new Uint8Array(readFileSync(mp3File));
rmSync(dirname(mp3File), { recursive: true });
assert.deepEqual(await webSound(mp3), { ext: 'mp3', bytes: mp3, delay: (576 + 529) / 44100 }, "an MP3 as it is, its LAME header's delay");
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));
const m4a = Uint8Array.from([0, 0, 0, 16, ...ascii('ftypM4A '), 0, 0, 0, 0, ...ascii('mp4a'), ...Array(24).fill(0), 0xac, 0x44, 0, 0,
  ...ascii('----iTunSMPB'), 0, 0, 0, 40, ...ascii('data'), 0, 0, 0, 1, 0, 0, 0, 0, ...ascii(' 00000000 00000840 000001CA 0000000000002000')]);
assert.equal((await webSound(m4a)).delay, 0x840 / 44100, "an AAC file's iTunSMPB delay");
assert.equal((await webSound(Uint8Array.from([0xff, 0xfb, 0x90, 0x64, ...Array(60).fill(0)]))).delay, null, 'none without a header');
console.log('Export: sound strips ship their sounds and timing, and the page gives them in seconds');
