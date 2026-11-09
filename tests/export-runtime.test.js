// The page runtime (src/io_scene_babylon/runtime/), which JavaScript packages carry: MIT OR Apache-2.0, so it holds
// no code derived from Blender and imports only Babylon and its own files; its JSDoc types check, its committed .d.ts
// files are what tsc writes from them, and a package's scene.d.ts makes `set` and `get` take only the scene's paths and
// their value types.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { controlTypes } from '../src/io_scene_babylon/controls-export.js';
import { BLENDER_FILES, BLOCK_FILES, DRIVER_FILES, RUNTIME_FILES } from '../src/io_scene_babylon/runtime-files.js';

const runtime = fileURLToPath(new URL('../src/io_scene_babylon/runtime/', import.meta.url));
const tsc = (args) => execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), ...args], { encoding: 'utf8' });

const sources = readdirSync(runtime).filter((name) => name.endsWith('.js'));
for (const name of sources) {
  const text = readFileSync(join(runtime, name), 'utf8');
  assert.doesNotMatch(text, /blender-port|port-override/i, `${name} holds no code derived from Blender`);
  assert.match(text, /SPDX-License-Identifier: MIT OR Apache-2\.0/, `${name} carries its license`);
  for (const [, specifier] of text.matchAll(/(?:import|from)\s*\(?\s*'([^']+)'/g)) {
    assert.ok(specifier === '@babylonjs/core' || specifier === 'node:fs/promises' || specifier.startsWith('./'), `${name} imports ${specifier}`);
  }
}
// The clean-room driver units (drivers/): MIT OR Apache-2.0, written from Blender's observed behavior only
// (docs/clean-room/), and importing only each other.
for (const name of readdirSync(join(runtime, 'drivers')).filter((n) => n.endsWith('.js'))) {
  const text = readFileSync(join(runtime, 'drivers', name), 'utf8');
  assert.doesNotMatch(text, /blender-port|port-override/i, `drivers/${name} holds no code derived from Blender`);
  assert.match(text, /SPDX-License-Identifier: MIT OR Apache-2.0/, `drivers/${name} carries its license`);
  for (const [, specifier] of text.matchAll(/(?:import|from)\s*\(?\s*'([^']+)'/g)) assert.ok(specifier.startsWith('./'), `drivers/${name} imports ${specifier}`);
}
// Every file ships: the runtime with each package, the blocks library and extensions when its scene.js imports them
// (their .d.ts files are checked below).
const blocks = Object.values(BLOCK_FILES).flatMap((name) => [name, name.replace(/\.js$/, '.d.ts')]);
const files = readdirSync(runtime, { recursive: true }).map((name) => String(name).split(sep).join('/')).filter((name) => name !== 'tsconfig.json' && name !== 'drivers');
assert.deepEqual(files.sort(), [...RUNTIME_FILES, ...blocks, ...DRIVER_FILES, ...BLENDER_FILES].sort(), 'every file of runtime/ ships');

// Types: the JSDoc checks, and the declarations are current.
tsc(['-p', join(runtime, 'tsconfig.json'), '--noEmit']);
const out = mkdtempSync(join(tmpdir(), 'bylonder-runtime-types-'));
tsc(['-p', join(runtime, 'tsconfig.json'), '--outDir', out]);
for (const name of readdirSync(out)) {
  assert.equal(readFileSync(join(out, name), 'utf8'), readFileSync(join(runtime, name), 'utf8'), `${name} is out of date: run npx tsc -p src/io_scene_babylon/runtime/tsconfig.json`);
}
rmSync(out, { recursive: true });

// A package's scene.d.ts: paths complete, wrong paths and value types do not compile.
const pkg = mkdtempSync(join(tmpdir(), 'bylonder-scene-types-'));
writeFileSync(join(pkg, 'scene.d.ts'), controlTypes([
  { path: 'objects["Cube"].location[0]', type: 'FLOAT', default: 0 },
  { path: 'objects["Cube"].hide_render', type: 'BOOLEAN', default: false },
]));
mkdirSync(join(pkg, 'bylonder'));
copyFileSync(join(runtime, 'blend-scene.d.ts'), join(pkg, 'bylonder/blend-scene.d.ts'));
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(pkg, 'use.ts'), `import { load } from './scene.js';
export async function use(engine: import('@babylonjs/core').AbstractEngine) {
  const blend = await load(engine);
  blend.set('objects["Cube"].location[0]', 2);
  const hidden: boolean = blend.get('objects["Cube"].hide_render');
  // @ts-expect-error a path the scene lacks
  blend.set('objects["Sphere"].location[0]', 2);
  // @ts-expect-error a value of the wrong type
  blend.set('objects["Cube"].hide_render', 1);
  return hidden;
}
`);
writeFileSync(join(pkg, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', lib: ['ES2022', 'DOM'], skipLibCheck: true, types: [],
    baseUrl: '.', paths: { '@babylonjs/core': [fileURLToPath(new URL('../node_modules/@babylonjs/core/index.d.ts', import.meta.url))] } },
  files: ['use.ts'],
}));
try {
  tsc(['-p', join(pkg, 'tsconfig.json')]);
} catch (error) {
  assert.fail(`scene.d.ts: ${error.stdout}`);
} finally {
  rmSync(pkg, { recursive: true });
}
console.log('Export runtime: MIT OR Apache-2.0 with nothing derived from Blender, typed by its JSDoc, and scene.d.ts types each scene\'s controls');
