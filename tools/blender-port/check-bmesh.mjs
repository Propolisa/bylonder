// The scene module's check (manifest `check`, run by wasm_module.py after linking): the unit tests that drive
// bmesh.wasm, run on the given build of it (BYLONDER_BMESH_WASM). Together they start Blender's types and Main, add
// every primitive, enter and leave Edit Mode and run its operators and tools, evaluate modifier stacks, run Object Mode
// operators, draw the Outliner, run the animation editors' operators, evaluate curves and text, run armatures and handle input in
// Blender's window manager. Prints each test's result; the build runs it on the module and on copies with their data
// moved, which must print the same.
// usage: node tools/blender-port/check-bmesh.mjs MODULE.wasm
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const TESTS = ['editmesh-wasm', 'editmesh-menus', 'tools-wasm', 'objects-wasm', 'modifiers-wasm', 'outliner', 'anim-wasm', 'curves-wasm', 'armature-wasm', 'wm-wasm'];
const repo = new URL('../..', import.meta.url).pathname;
const env = { ...process.env, BYLONDER_BMESH_WASM: resolve(process.argv[2]) };
// What a test prints, without Babylon's banner and timings, which vary from run to run.
const stable = (text) => text.split('\n').filter((line) => !line.startsWith('BJS')).map((line) => line.replace(/\d+(\.\d+)? ?ms\b/g, 'ms')).join('\n');

const results = await Promise.all(TESTS.map((test) => promisify(execFile)('node', [`tests/${test}.test.js`], { cwd: repo, env, maxBuffer: 1 << 26 })
  .then(({ stdout }) => `${test}: ${stable(stdout).trim()}`, (error) => ({ test, error }))));
const failed = results.filter((result) => result.error);
for (const { test, error } of failed) console.error(`${test} fails:\n${error.stdout}${error.stderr}`);
if (failed.length) process.exit(1);
console.log(results.join('\n'));
