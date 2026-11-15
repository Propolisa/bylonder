// A full export takes the rig judgement an earlier export made of the same content (rig-verdicts.js), and judges again
// once the content changes: the rig of tools/blender-reference/skin-check-fixture.py, whose tube the judgement keeps on
// the native rig runtime. Its kept verdict, made to say Babylon's skin matches the tube, is what the next export
// follows (it skins the tube, no checks run); a moved vertex of the tube judges again and puts it back on the runtime.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { verdicts } from '../src/io_scene_babylon/rig-verdicts.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample(fileURLToPath(new URL('./fixtures/skin-check-rig.blend', import.meta.url)));
sync.view();
const runtimeMeshes = async () => {
  const pose = Object.values(JSON.parse((await exportModule(world))['scene.ir.json']).entities).find((e) => e.type === 'constraints:POSE');
  return Object.keys(pose?.inputs.native?.meshes ?? {});
};

assert.ok((await runtimeMeshes()).includes('Tube'), 'judged, the tube deforms on the native rig runtime');
assert.equal(verdicts.size, 1, 'the judgement is kept by its content');
const [kept] = verdicts.values();
kept.skinDeviation = kept.skinDeviation.map(([name, distance]) => [name, name === 'Tube' ? 0 : distance]);
assert.ok(!(await runtimeMeshes()).includes('Tube'), 'the next export of the same content follows the kept verdict');
assert.equal(verdicts.size, 1, 'and judges nothing again');

const tube = blendData().objects.get('Tube').data, co = tube.vertices[0].co;
tube.vertices[0].co = [co[0] + 0.01, co[1], co[2]];
sync.view();
assert.ok((await runtimeMeshes()).includes('Tube'), 'a changed mesh is judged again');
assert.equal(verdicts.size, 2, 'its judgement kept by its new content');
console.log('Export rig verdicts: a rig judged once is not judged again until its content changes');
process.exit(0);
