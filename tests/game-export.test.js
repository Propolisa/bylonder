// tags: behaviors, export
// A project's game code as a package ships it (io_scene_babylon/game-export.js): game.js under the project's licence,
// importing Babylon and bylonder from the page and inlining the libraries it uses, whose notices THIRD-PARTY.md lists;
// the project's content/ beside it; no game.js without a stated licence, nor with an import a package cannot ship.
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderLibrary, gameFiles, GAME_LIBRARIES } from '../src/io_scene_babylon/game-export.js';

const esbuild = await import('esbuild-wasm');
const babylon = (path) => readFile(new URL(`../node_modules/@babylonjs/core/${path}`, import.meta.url), 'utf8');
const library = folderLibrary((path) => readFile(new URL(`../node_modules/${path}`, import.meta.url), 'utf8'));
const cafe = fileURLToPath(new URL('../examples/rock-hard-cafe/', import.meta.url));
const filesIn = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesIn(join(dir, name)) : [join(dir, name)]));
const folder = (dir) => ({ files: filesIn(dir).map((path) => relative(dir, path).replaceAll('\\', '/')), read: (path) => readFile(join(dir, path)) });
// A project in memory: its files by path.
const memory = (files) => ({ files: Object.keys(files), read: async (path) => files[path] });

const shipped = await gameFiles(folder(cafe), { esbuild, library, babylon });
assert.deepEqual(Object.keys(shipped).sort(), ['THIRD-PARTY.md', 'content/dialogue/cafe.ink', 'game.js']);
const game = shipped['game.js'];
assert.match(game.split('\n')[0], /rock-hard-cafe's game code, licensed MIT/);
const imports = [...game.matchAll(/\bimport\s*\{[^}]*\}\s*from\s*"([^"]+)"/g)].map((m) => m[1]);
assert.ok(imports.every((path) => path === './bylonder/game/define.js' || path.startsWith('@babylonjs/core/')), `imports only the page's Babylon and bylonder: ${[...new Set(imports)]}`);
assert.ok(!/from\s*"(inkjs|@babylonjs\/gui)/.test(game), 'the libraries are inlined');
assert.ok(!imports.includes('@babylonjs/core/index.js'), "no import of Babylon's index: each class from its own module");
assert.ok(imports.includes('@babylonjs/core/Maths/math.vector.js'), "rock.js's Vector3 and Quaternion from Babylon's math.vector.js");
for (const name of Object.keys(GAME_LIBRARIES)) assert.match(shipped['THIRD-PARTY.md'], new RegExp(`## ${name.replace('/', '\\/')} \\d`), `THIRD-PARTY.md lists ${name}`);
assert.match(shipped['THIRD-PARTY.md'], /Apache License/);
assert.match(shipped['THIRD-PARTY.md'], /MIT License|Permission is hereby granted/);

// A game using no library lists none; one without a licence, or importing what a package cannot ship, is refused.
const plain = { 'package.json': '{ "license": "MIT" }', 'src/game.js': "import { defineGame } from 'bylonder';\nexport default defineGame({});\n" };
assert.match((await gameFiles(memory(plain), { esbuild, library, babylon }))['THIRD-PARTY.md'], /None\./);
await assert.rejects(gameFiles(memory({ ...plain, 'package.json': '{}' }), { esbuild, library, babylon }), /add "license" to its package\.json/);
await assert.rejects(gameFiles(memory({ ...plain, 'src/game.js': "import _ from 'lodash';\nexport default _;\n" }), { esbuild, library, babylon }), /imports lodash/);
await assert.rejects(gameFiles(memory({ ...plain, 'src/game.js': "import * as BABYLON from '@babylonjs/core';\nexport default BABYLON;\n" }), { esbuild, library, babylon }), /import its classes by name/);
console.log('game export: game.js under the project\'s licence, its libraries inlined and listed in THIRD-PARTY.md');
