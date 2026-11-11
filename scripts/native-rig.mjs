// Copies the clean room's rig runtime (babylon-blender-rig, MIT OR Apache-2.0) into src/io_scene_babylon/runtime/native/,
// which exported pages run as the `native-rig` implementation (runtime/native-solve.js): its src/ as it is, each file
// marked with its licence and left out of the runtime's type check, and the list of its files (files.json).
// usage: node scripts/native-rig.mjs <babylon-blender-rig checkout>
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const [from] = process.argv.slice(2), to = new URL('../src/io_scene_babylon/runtime/native/', import.meta.url);
if (!from) throw Error('usage: node scripts/native-rig.mjs <babylon-blender-rig checkout>');
rmSync(to, { recursive: true, force: true });
cpSync(join(from, 'src'), to, { recursive: true });
const files = readdirSync(to, { recursive: true }).map((f) => String(f).split(sep).join('/')).filter((f) => f.endsWith('.js')).sort();
for (const file of files) writeFileSync(new URL(file, to), `// @ts-nocheck\n// SPDX-License-Identifier: MIT OR Apache-2.0\n// From babylon-blender-rig (scripts/native-rig.mjs).\n${readFileSync(new URL(file, to), 'utf8')}`);
const { version } = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
writeFileSync(new URL('files.json', to), JSON.stringify({ version, files }, null, 1) + '\n');
console.log(`runtime/native/: babylon-blender-rig ${version}, ${files.length} files`);
