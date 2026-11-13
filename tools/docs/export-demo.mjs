// Writes the live demo of an exported page to docs/demos/<example>/, which the site publishes (vite.config.js): the
// example's File > Export > JavaScript package with the control panel, as ES modules loading Babylon.js from its CDN,
// pinned to the exported version, so the committed files hold only the scene and Bylonder's runtime. WebGL 2 only, so it
// shows where a WebGPU device fails to start. A game (GAMES) gets its packages instead, which its own page (index.html,
// game.js) loads: its player's objects with Scope Selected Objects and their actions as clips, then the scene without
// them, with its world, camera, view transform and compositor.
//   usage: node tools/docs/export-demo.mjs [example or game]  (default compositor)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExample } from '../../tests/open-example.js';
import { packageFiles } from '../../tests/export-package.js';
import { exportModule } from '../../src/io_scene_babylon/js-export.js';
import { blendData, idStruct } from '../../src/python/bpy_rna.js';

// The tea break's woman, as the noodle shop's player, and the lane she walks.
const GAMES = { 'noodle-shop': { example: 'compositor', player: ['girl', ['Tea Break', 'Tea Cup', 'Tea Steam Card', 'Tea Steam Emitter']], scene: 'street' },
  // Snow on his ground, one package with his actions as clips, which the character controller plays, and only the bones
  // that skin him or that his rig's runtime reads.
  'character-controller': { example: 'character-controller', scene: 'world', animations: 'CLIPS' },
  // Quaternius' mannequin, the character animation guide's basic path, in one package with its actions as clips.
  'basic-character': { example: 'basic-character', scene: 'world', animations: 'CLIPS' } };

const NAME = process.argv[2] ?? 'compositor', game = GAMES[NAME];
// The files the app serves from public/ that a package ships (its area lights' LTC table), fetched where missing.
execFileSync(process.execPath, ['scripts/babylon-assets.mjs'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), stdio: 'inherit' });
const dir = fileURLToPath(new URL(`../../docs/demos/${NAME}/`, import.meta.url));
// BLEND: another file of the example to export (one with extra actions, kept out of git).
const { world, sync } = openExample(process.env.BLEND ?? game?.example ?? NAME);
// Armatures skin on Babylon, so a game poses their bones.
if (game) sync.view();
const OPTIONS = { target: 'WEBGL2', controlPanel: !game, devTools: 'CDN', ...(process.env.CLIP_COMPRESSION && { clipCompression: process.env.CLIP_COMPRESSION }), ...(game && { runtimes: { ARMATURE: { runtime: 'MAPPED', instances: {} } } }) };

// Type declarations and package.json are for code importing the package, not for the page.
function write(folder, files) {
  const page = Object.entries(files).filter(([path]) => !path.endsWith('.d.ts') && path !== 'package.json');
  const empty = page.find(([, data]) => !data.length);
  if (empty) throw Error(`${empty[0]} is empty`);
  rmSync(folder, { recursive: true, force: true });
  for (const [path, data] of page) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), data);
  }
  return files;
}

if (game && !game.player) {
  write(join(dir, game.scene), packageFiles(await exportModule(world, { ...OPTIONS, animations: game.animations })));
} else if (game) {
  const [player, names] = game.player, selected = world.objects.filter((n) => names.includes(n.name));
  write(join(dir, player), packageFiles(await exportModule(world, { ...OPTIONS, scope: 'SELECTED', selected, animations: 'CLIPS' })));
  // The scene with the player's objects deleted, as she brings her own.
  const data = blendData(sync.blender.C), rigs = selected.map((n) => idStruct(sync.objectOf(n)).parent?.name).filter(Boolean);
  for (const name of new Set([...names, ...rigs])) data.objects.remove(data.objects.get(name));
  sync.view();
  write(join(dir, game.scene), packageFiles(await exportModule(world, OPTIONS)));
} else {
  const files = write(dir, packageFiles(await exportModule(world, OPTIONS)));
  const babylon = String(files['scene.js']).match(/"(https:\/\/cdn\.jsdelivr\.net\/npm\/@babylonjs\/core@[\d.]+\/)"/)[1];
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${NAME} - Bylonder export</title>
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
`);
}
console.log(dir);
process.exit(0);
