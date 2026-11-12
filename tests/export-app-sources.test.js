// File > Export > JavaScript in the app ships every file of Blender's code a package can carry: export.js's SOURCES
// (and the modules' URLs) name each src/ file runtime-files.js can ask for, as a rig on Blender's constraint kernels
// asked for bylonder-constraints/ and the export stopped there (Robot Arm, Desk Lamp, Rigged Character).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVALUATOR_FILES, noticeFiles } from '../src/io_scene_babylon/runtime-files.js';

const source = ['export.js', 'module-files.js'].map((f) => readFileSync(new URL(`../src/io_scene_babylon/${f}`, import.meta.url), 'utf8')).join('\n');
const asked = [...Object.values(EVALUATOR_FILES).flatMap((e) => Object.values(e.files ?? {})), ...noticeFiles('folder').map(([, from]) => from)];
const missing = asked.filter((from) => !source.includes(`'${from}'`));
assert.deepEqual(missing, [], 'the app has a source for each file a package ships');
console.log(`Export: the app has the sources of all ${asked.length} files of Blender's code a package ships`);
