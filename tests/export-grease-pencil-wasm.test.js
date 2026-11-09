// Grease Pencil objects in the JavaScript export: each layer is an IR entity whose keyed drawings are in scene.bin, and
// the page shows at each frame the drawing Main draws there: its strokes and its fills, their points and colors. The
// app's own stroke meshes, which evaluating the frames redraws, stay out of the package.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { POINT_FLOATS } from '../src/io_scene_babylon/runtime/grease-pencil.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, scene, sync } = openExample('bouncing-ball');
sync.view();
const files = await exportModule(world, { live: true });
const ir = JSON.parse(files['scene.ir.json']);
const layers = Object.entries(ir.entities).filter(([, e]) => e.type === 'grease_pencil:LAYER');
assert.deepEqual(layers.map(([key]) => key.split('/').at(-1)).sort(), ['Ball', 'Ground', 'Shadow'], 'one entity per layer');
assert.ok(layers.every(([, e]) => e.implementation === 'grease_pencil' && e.inputs.drawings.every((d) => d === null || 'buffer' in d.points)), 'drawings are scene.bin buffers');
assert.ok(files['scene.js'].includes('"name":"Grease Pencil"'), 'a scene animated by its drawings alone plays');

const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const page = blend.scene, group = page.animationGroups[0], node = scene.transformNodes.find((n) => sync.objectOf(n) && n.metadata?.wbType === 'GREASEPENCIL');
const shown = (layer) => page.getTransformNodeById(`${node.name}/grease_pencil/${layer}`)?.getChildMeshes(true).filter((m) => m.isEnabled()) ?? [];
group.pause();
let checked = 0;
for (const frame of [1, 2, 5, 12, 13, 24]) {
  group.goToFrame(frame);
  page.render();
  await blend.settled();
  sync.frameChanged(frame);
  for (const draw of sync.blender.greasePencil({ onion: false, repack: true }).filter((d) => d.ob === sync.objectOf(node))) {
    const meshes = shown(draw.layer), fill = meshes.find((m) => m.name.endsWith(' fill'));
    assert.equal(meshes.some((m) => m.getClassName() === 'GreasedLineMesh'), draw.curves.some((_, i) => i % 5 === 2 && draw.curves[i] & 2), `frame ${frame} layer ${draw.layer}: strokes`);
    assert.equal(!!fill, draw.triangles.length > 0, `frame ${frame} layer ${draw.layer}: fills`);
    if (fill) {
      const positions = fill.getVerticesData('position'), colors = fill.getVerticesData('color');
      for (let p = 0; p < draw.points.length / POINT_FLOATS; p++) for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(positions[p * 3 + c] - draw.points[p * POINT_FLOATS + c]) < 1e-6, `frame ${frame} layer ${draw.layer}: point ${p}`);
        assert.ok(Math.abs(colors[p * 4 + c] - draw.points[p * POINT_FLOATS + 8 + c]) < 1e-6, `frame ${frame} layer ${draw.layer}: fill color ${p}`);
      }
    }
    checked++;
  }
}
assert.ok(checked >= 12, `${checked} layer drawings checked`);
blend.dispose();
written.remove();
console.log(`Export Grease Pencil: each layer's drawing at ${checked / 3} frames is Main's, strokes and fills, points and colors`);
