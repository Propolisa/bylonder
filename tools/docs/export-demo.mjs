// Writes the live demo of an exported page to docs/demos/<example>/, which the site publishes (vite.config.js): the
// example's File > Export > JavaScript package with the control panel, as ES modules loading Babylon.js from its CDN,
// pinned to the exported version, so the committed files hold only the scene and Bylonder's runtime. WebGL 2 only, so it
// shows where a WebGPU device fails to start.
//   usage: node tools/docs/export-demo.mjs [example]  (default compositor)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExample } from '../../tests/open-example.js';
import { packageFiles } from '../../tests/export-package.js';
import { exportModule } from '../../src/io_scene_babylon/js-export.js';

const EXAMPLE = process.argv[2] ?? 'compositor';
const dir = fileURLToPath(new URL(`../../docs/demos/${EXAMPLE}/`, import.meta.url));

const { world } = openExample(EXAMPLE);
const files = packageFiles(await exportModule(world, { target: 'WEBGL2', controlPanel: true, devTools: 'CDN' }));
const babylon = String(files['scene.js']).match(/"(https:\/\/cdn\.jsdelivr\.net\/npm\/@babylonjs\/core@[\d.]+\/)"/)[1];

const PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${EXAMPLE} - Bylonder export</title>
<link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%;outline:0;touch-action:none}</style>
<script type="importmap">{ "imports": { "@babylonjs/core/": "${babylon}" } }</script>
<canvas id="c"></canvas>
<script type="module">
import { createEngine, load } from './scene.js';
const canvas = document.getElementById('c'), engine = await createEngine(canvas);
const blend = await load(engine);
addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => blend.scene.render());
</script>
`;

rmSync(dir, { recursive: true, force: true });
// Type declarations and package.json are for code importing the package, not for the page.
for (const [path, data] of Object.entries(files).filter(([path]) => !path.endsWith('.d.ts') && path !== 'package.json')) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), data);
}
writeFileSync(join(dir, 'index.html'), PAGE);
console.log(dir);
process.exit(0);
