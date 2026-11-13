// Copies the character runtime (src/io_scene_babylon/runtime/character), the rig's solvers, the materials, the world and
// the overrides they import into an exported package, their imports made as an export makes them, so a change is tried
// without exporting again; then checks that every relative import of what it wrote resolves inside the package.
//   usage: node tools/docs/sync-character-runtime.mjs [package folder]  (default docs/demos/character-controller/world)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepImports } from '../../src/io_scene_babylon/babylon-modules.js';
import { packagedRuntime } from '../../src/io_scene_babylon/runtime-files.js';

const source = fileURLToPath(new URL('../../src/io_scene_babylon/runtime/character/', import.meta.url));
const target = join(process.argv[2] ?? fileURLToPath(new URL('../../docs/demos/character-controller/world/', import.meta.url)), 'bylonder', 'character');
const names = readdirSync(source, { recursive: true }).map(String).filter((n) => n.endsWith('.js'));
// Files the runtime no longer has go, so the package matches it.
for (const name of readdirSync(target, { recursive: true }).map(String).filter((n) => n.endsWith('.js') && !names.includes(n))) rmSync(join(target, name));
const packaged = (/** @type {string} */ file) => packagedRuntime(deepImports(readFileSync(file, 'utf8')));
const written = [...names.map((name) => [join(source, name), join(target, name)]),
  // The runtime's other files a package uses, where it ships them; the native rig's solve only beside the native runtime.
  ...['native-solve.js', 'pose-constraints.js', 'materials.js', 'ready.js', 'world.js'].filter((name) => existsSync(join(target, '..', name))
    && (name !== 'native-solve.js' || existsSync(join(target, '..', 'native'))))
    .map((name) => [join(source, '..', name), join(target, '..', name)])];
for (const [from, to] of written) {
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, packaged(from));
}
// The overrides of Babylon they import, as the export carries them.
const overrides = new Set(written.flatMap(([, to]) => [...readFileSync(to, 'utf8').matchAll(/overrides\/([\w/-]+)\.js'/g)].map(([, name]) => name)));
for (const name of overrides) {
  const to = join(target, '..', 'overrides', `${name}.js`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, packaged(fileURLToPath(new URL(`../../src/overrides/${name}.js`, import.meta.url))));
}
// Every static import of a written file names a file inside the package.
const root = resolve(target, '..', '..');
const outside = written.flatMap(([, to]) => [...readFileSync(to, 'utf8').matchAll(/(?:\bfrom|^import)\s*'(\.[^']+)'/gm)]
  .map(([, path]) => resolve(dirname(to), path)).filter((path) => !path.startsWith(root) || !existsSync(path)).map((path) => `${to}: ${path}`));
if (outside.length) throw new Error(`Imports that leave the package or name no file:\n${outside.join('\n')}`);
console.log(`character runtime copied to ${target}`);
