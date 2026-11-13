// An exported package served by a bundler's dev server (Vite, as the docs demos are) finds its files: its scene.js
// names its own folder in a way Vite leaves alone. Before, Vite rewrote new URL('./', import.meta.url) to the folder
// without its trailing slash, so scene.bin resolved one folder up, and the page stayed black.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world } = openExample('rigged-character');
const written = writePackage(await exportModule(world));
const server = await createServer({ root: written.dir, configFile: false, logLevel: 'silent', server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true } });
const { code } = await server.transformRequest('/scene.js');
await server.close();
written.remove();
const line = code.split('\n').find((l) => /\bconst ROOT\b/.test(l));
assert.ok(line, 'scene.js names its folder');
const root = new Function('meta', `${line.replace(/import\.meta/g, 'meta')} return ROOT;`)({ url: 'http://localhost/demo/world/scene.js' });
assert.equal(root, 'http://localhost/demo/world/', 'as its own folder, with its trailing slash, after Vite transforms it');
console.log('Export under Vite: a package served by Vite finds scene.bin and its images beside its scene.js');
process.exit(0);
