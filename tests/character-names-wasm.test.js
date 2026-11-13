// A package's types name each armature's character (runtime/character/names.d.ts, augmented by scene.d.ts): its
// actions, markers, bone collections, roles and keyed properties as string-literal unions, so a page type-checks
// `hero.action('RigAction')` and fails on a name the armature lacks, on the line that uses it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { packageRuntime } from '../src/io_scene_babylon/runtime-files.js';

if (process.argv[2] === '--plain') {
  const files = await exportModule(openExample('lava').world);
  console.log(JSON.stringify({ exports: String(files['scene.js']).includes('character/api.js') || String(files['scene.d.ts']).includes('character/api.js'),
    ships: packageRuntime(files).some(([path]) => path.includes('/character/')) }));
  process.exit(0);
}
const { world } = openExample('rigged-character');
const files = await exportModule(world, { animations: 'BOTH' });
const types = String(files['scene.d.ts']);
assert.match(types, /'Rig': \{ actions: 'RigAction'/, 'the armature Rig is named with its actions');
const written = writePackage(files);
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const check = (body) => {
  writeFileSync(join(written.dir, 'page.ts'), `import { load, Character } from './scene.js';\nconst blend = await load({} as any);\nconst hero = new Character(blend, 'Rig');\n${body}\nexport {};\n`);
  try {
    execFileSync(process.execPath, [tsc, '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', '--allowJs', 'false', join(written.dir, 'page.ts')], { encoding: 'utf8', cwd: written.dir });
    return '';
  } catch (error) { return String(error.stdout); }
};
assert.equal(check("hero.action('RigAction');"), '', 'an action the armature has type-checks');
assert.match(check("hero.action('Walk');"), /page\.ts\(4,13\).*'"Walk"'/s, 'one it lacks fails on that line');
written.remove();

// A scene without an armature neither exports nor ships the character system (in a process of its own: one Main a process).
{
  const plain = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--plain'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } }).trim().split(String.fromCharCode(10)).at(-1));
  assert.ok(!plain.exports, 'no character exports without an armature');
  assert.ok(!plain.ships, 'and no character files ship');
}
console.log('Character names: a package types the actions of each armature, a missing one fails the build where it is used, and a scene without an armature ships no character system');
process.exit(0);
