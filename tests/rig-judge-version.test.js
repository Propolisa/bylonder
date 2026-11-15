// The rig judgement's version (pose-export.js JUDGE_VERSION) names its code: the verdicts kept by content
// (rig-verdicts.js) are taken while it stays, so a change of the judge, or of the runtime deform it compares with
// Blender's, must bump it. This fails when those files change while the version stays: bump it and record the hash.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { JUDGE_VERSION } from '../src/io_scene_babylon/pose-export.js';

// The hash of the judge's files at each version.
const RECORDED = { 1: '5b029c8c90f50151', 2: 'a7cf94cc4e187634', 3: '60e17e9f7a8e014f' };
const src = new URL('../src/', import.meta.url);
const tree = (dir) => readdirSync(new URL(dir, src), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `${dir}${f.replaceAll('\\', '/')}`);
const FILES = ['io_scene_babylon/pose-export.js', 'io_scene_babylon/rig-description.js', 'io_scene_babylon/runtime/native-solve.js',
  'io_scene_babylon/runtime/dual-quaternion-skinning.js', 'runtimes/armature.js', ...tree('io_scene_babylon/runtime/native/')].sort();
const hash = createHash('sha256');
for (const file of FILES) hash.update(`${file}\n`).update(readFileSync(new URL(file, src), 'utf8').replaceAll('\r\n', '\n'));
const now = hash.digest('hex').slice(0, 16);
assert.equal(RECORDED[JUDGE_VERSION], now, `the judge's files changed: bump JUDGE_VERSION in pose-export.js to ${JUDGE_VERSION + 1} and record { ${JUDGE_VERSION + 1}: '${now}' } here`);
console.log(`Rig judge version ${JUDGE_VERSION}: its ${FILES.length} files as recorded`);
