// The headless SDK (docs/controllable-exports.md, step 8): a package exported in Node, without a page, and the docs'
// script (docs/examples/headless-sdk.mjs) run on it in a process of its own, which loads nothing of Bylonder but the
// package. Set by Blender path there, the Steam Engine's drivers and the dish's live Solidify give Main's transforms
// and evaluated meshes; the Framed Print's export writes each image's own file, byte for byte, and an image without a
// file browsers load as a PNG of Blender's pixels.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { blendData, idStruct } from '../src/python/bpy_rna.js';
import { files as moduleFiles } from '../src/port/wasm.js';
import { babylonMatrix } from '../src/blenkernel/main-view.js';

const SCRIPT = fileURLToPath(new URL('../docs/examples/headless-sdk.mjs', import.meta.url));
const near = (a, b, tolerance) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tolerance);

// The docs' script on a package: its controls set, the named objects read back.
function headless(written, controls, names) {
  const out = execFileSync(process.execPath, [SCRIPT, fileURLToPath(written.url), JSON.stringify(controls), ...names], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return JSON.parse(out.trim().split('\n').at(-1));
}

const SCENARIOS = {
  async 'drivers-and-graph-editor'() {
    const { world, sync, node } = openExample('drivers-and-graph-editor');
    sync.view();
    const written = writePackage(await exportModule(world)), angle = 1.3;
    const driven = ['Crosshead', 'Connecting Rod', 'Piston Rod', 'Governor Arm'];
    const objects = headless(written, { 'objects["Flywheel"].rotation_euler[1]': angle }, driven);
    idStruct(sync.objectOf(node('Flywheel'))).rotation_euler[1] = angle;
    sync.view();
    for (const name of driven) {
      const main = Array.from(babylonMatrix(sync.blender.transform(sync.objectOf(node(name))).matrix_world).m);
      assert.ok(near(objects[name].matrix_world, main, 1e-4), `${name}: ${objects[name].matrix_world} in Node, Main ${main}`);
    }
    written.remove();
    console.log(`drivers: the flywheel set by path in a script moves ${driven.length} driven parts as Main does`);
  },

  async 'texture-paint'() {
    const { world, sync, node } = openExample('texture-paint');
    sync.view();
    const written = writePackage(await exportModule(world, { live: true }));
    const { Dish } = headless(written, { 'objects["Dish"].modifiers["Solidify"].thickness': 0.1 }, ['Dish']);
    blendData().objects.get('Dish').modifiers.get('Solidify').thickness = 0.1;
    sync.view();
    const app = Array.from(node('Dish').getVerticesData('position'));
    assert.ok(near(Dish.positions, app, 1e-5), `the dish's ${Dish.positions.length / 3} vertices in Node are the app's ${app.length / 3}`);
    written.remove();
    console.log(`modifiers: the dish's Solidify thickness set by path in a script gives the app's ${app.length / 3} vertices`);
  },

  async 'framed-print'() {
    const { world, sync } = openExample('framed-print');
    const fixture = (name) => new Uint8Array(readFileSync(new URL(`fixtures/images/${name}`, import.meta.url)));
    // The floor's image read from a JPEG file instead, and the paper's grain from an OpenEXR one, which browsers do not
    // load.
    for (const [name, file] of [['Oak Boards', 'ramp.jpg'], ['Paper Grain', 'ramp-zip.exr']]) {
      moduleFiles.set(`/images/${file}`, fixture(file));
      const image = blendData().images.get(name);
      image.unpack({ method: 'REMOVE' });
      image.filepath = `/images/${file}`;
      image.reload();
    }
    sync.view();
    const files = await exportModule(world), written = writePackage(files);
    const images = Object.entries(files).filter(([path]) => path.startsWith('images/'));
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const [jpg] = images.find(([, file]) => same(file, fixture('ramp.jpg'))) ?? [];
    assert.ok(jpg, 'a JPEG image ships its file');
    // Blender's reader on each written file gives the image's own pixels: the packed one's, and the EXR's straight
    // at 8 bits, which is what its PNG holds.
    const packed = [...blendData().images.get('Dusk Print').pixels];
    const exr = Array.from(blendData().images.get('Paper Grain').pixels, (v) => Math.trunc(Math.min(1, Math.max(0, v)) * 255) / 255);
    const reread = (path, bytes) => {
      moduleFiles.set(`/written/${path}`, bytes);
      return [...blendData().images.load(`/written/${path}`).pixels];
    };
    const writtenAs = (pixels) => images.find(([path, bytes]) => near(reread(path, bytes), pixels, 1e-6))?.[0];
    const [print, grain] = [writtenAs(packed), writtenAs(exr)];
    assert.ok(print, "the print's packed image is written with its pixels");
    assert.ok(grain?.endsWith('.png'), 'the EXR is written as a PNG of its straight pixels');
    assert.equal(images.length, 3, `3 image files: ${images.map(([path]) => path)}`);

    // loadBlendScene on the package's file URL: each image is a texture of its file, whose rows are top first.
    const { loadBlendScene } = await import(new URL('bylonder/blend-scene.js', written.url).href);
    const blend = await loadBlendScene(new NullEngine(), written.url);
    const texture = (path) => blend.scene.textures.find((t) => t.url?.split('?')[0].endsWith(path));
    assert.deepEqual([jpg, print, grain].map((path) => texture(path)?.invertY), [true, true, true], 'each image is a texture of its file, its rows top first');
    blend.dispose();
    written.remove();
    console.log(`images: a headless export of the Framed Print writes ${images.length} image files, packed and JPEG files as they are and an EXR as a PNG of Blender's pixels`);
  },
};

const scenario = process.argv[2];
if (scenario) await SCENARIOS[scenario]();
else {
  for (const name of Object.keys(SCENARIOS)) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n') + '\n');
  console.log('Headless SDK: scripts set controls by Blender path and read Main\'s transforms and meshes; headless exports write image files');
}
