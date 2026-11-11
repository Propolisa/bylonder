// Node functions shared across materials (node-material-export.js nodeFunction) are told apart by what their
// parameters take as well as by their code: an Attribute node reading a mesh attribute in one material and an object's
// property in another has the same code, and each material must get its own (Snow's eye highlights fell back to their
// own code reading the hair's Col_detail attribute).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExample } from './open-example.js';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

// Two of the example's materials, each an Emission whose Strength an Attribute node gives: a mesh attribute (the UV
// map, which every mesh has) in one, an object's property in the other; saved as a .blend in a process of its own.
const READS = [['OBJECT', 'Glow'], ['GEOMETRY', 'UVMap']];
if (process.argv[2] === '--make') {
  const { sync } = openExample('shader-gallery');
  const data = blendData(), used = [...new Set([...data.objects].flatMap((ob) => [...ob.material_slots].map((s) => s.material?.name)).filter(Boolean))];
  READS.forEach(([type, name], i) => {
    const tree = data.materials.get(used[i]).node_tree;
    const attribute = tree.nodes.new('ShaderNodeAttribute'), emission = tree.nodes.new('ShaderNodeEmission');
    Object.assign(attribute, { attribute_type: type, attribute_name: name });
    tree.links.new(attribute.outputs.get('Fac'), emission.inputs.get('Strength'));
    tree.links.new(emission.outputs[0], [...tree.nodes].find((n) => n.bl_idname === 'ShaderNodeOutputMaterial').inputs[0]);
  });
  writeFileSync(process.argv[3], sync.writeBlend('/pieces.blend'));
  writeFileSync(`${process.argv[3]}.json`, JSON.stringify(used.slice(0, READS.length)));
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'node-pieces-')), file = join(dir, 'pieces.blend');
try {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--make', file], { stdio: 'ignore' });
  const { world, sync } = openExample(file);
  sync.view();
  const warnings = [], warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  await exportModule(world);
  console.warn = warn;
  assert.deepEqual(warnings.filter((w) => /own code/.test(w)), [], 'both materials build from the IR');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("Export node pieces: a node's shared function is told apart by what its parameters take");
process.exit(0);
