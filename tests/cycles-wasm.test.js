// Cycles as the side module cycles.wasm (src/render/cycles.js, src/port/side-modules.js): loaded into Blender's module
// on first use, its add-on enabled, and Blender's render operator rendering Window Light (examples/rendering) with it at
// a few samples into a Render Result read through the view transform (wasm/render-api.cc), as desktop Blender 5.2's
// Cycles renders it on the CPU (tools/blender-reference/cycles-window-light.py), and again the same; and faces of two
// materials each in its own.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Cycles renders on threads of its own (its session's).
process.env.BYLONDER_THREADS ??= '4';
const { blenderMain, blenderModule } = await import('../src/bmesh/bmesh-wasm.js');
await import('../src/python/bpy_interface.js');
const { pointerStruct, setContextPointer, structFind } = await import('../src/python/bpy_rna.js');
const { loadCycles } = await import('../src/render/cycles.js');
const { files } = await import('../src/port/wasm.js');

const { exports: x } = blenderModule;
const OPERATOR_FINISHED = 1 << 2;
const main = blenderMain();
setContextPointer(main.C);
main.readBlend(await readFile(new URL('../examples/rendering/rendering.blend', import.meta.url)));
await loadCycles();
// Every worker of the thread pool, spares too, loaded Cycles before the bytes it loads them from were freed (a page that
// rendered before reuses that memory at once).
const loads = new Int32Array(x.memory.buffer, x.side_modules_list() >>> 0, 1)[0];
assert.equal(loads, blenderModule.workers, `each of the pool's ${blenderModule.workers} workers loaded Cycles, not ${loads}`);
const scene = pointerStruct(structFind('Scene'), main.scene, main.scene);
scene.render.engine = 'CYCLES';
assert.equal(scene.render.engine, 'CYCLES', "Cycles' add-on registered its render engine");
Object.assign(scene.render, { resolution_x: 64, resolution_y: 48, resolution_percentage: 100 });
Object.assign(scene.cycles, { samples: 4, use_denoising: false });
// A render's pixels, as 8-bit RGBA in display space.
const size = x.malloc(8) >>> 0;
function render() {
  const { status, report } = main.run('render.render', {});
  assert.ok(status & OPERATOR_FINISHED, `render.render finished: status ${status}, ${report}`);
  assert.ok(x.render_result_size(main.scene, size), 'a render result');
  const [width, height] = new Int32Array(x.memory.buffer, size, 2);
  assert.deepEqual([width, height], [64, 48]);
  const pixels = x.malloc(width * height * 4) >>> 0;
  x.render_result_pixels(main.scene, pixels);
  const rgba = new Uint8Array(x.memory.buffer, pixels, width * height * 4).slice();
  x.free(pixels);
  return rgba;
}
const rgba = render(), count = rgba.length / 4;
// Lit, shaded and not blank: the pixels' brightness spreads.
const brightness = Array.from({ length: count }, (_, i) => rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]);
const mean = brightness.reduce((a, b) => a + b) / brightness.length;
const spread = Math.sqrt(brightness.reduce((a, b) => a + (b - mean) ** 2, 0) / brightness.length);
assert.ok(mean > 30 && spread > 20, `a lit, shaded image: mean ${mean.toFixed(0)}, spread ${spread.toFixed(0)}`);
// Desktop Blender's pixels for the same samples and seed: each channel's mean difference within a few levels.
const blender = await readFile(new URL('./fixtures/cycles/window-light-64x48.rgba', import.meta.url));
const differences = [0, 1, 2].map((c) => rgba.reduce((sum, v, i) => (i % 4 === c ? sum + Math.abs(v - blender[i]) : sum), 0) / count);
assert.ok(differences.every((d) => d < 2), `the render matches desktop Blender's: mean differences ${differences.map((d) => d.toFixed(2)).join(', ')} of 255`);
// Rendering again (F12 twice) renders the same image: its session's new thread starts clean on the memory the first freed.
for (let again = 0; again < 2; again++) assert.deepEqual(render(), rgba, 'a render again gives the same image');
// Baking again and again, on the page's thread and Cycles' (object.bake into an image of the first mesh with a
// material): the page's thread-locals of Cycles are its own, so no bake overwrites the allocator's state, which a later
// allocation trapped on.
files.set('/bakes.py', new TextEncoder().encode(`import bpy, json
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.active_material)
mat = ob.active_material
node = mat.node_tree.nodes.new('ShaderNodeTexImage')
mat.node_tree.nodes.active = node
for o in bpy.context.view_layer.objects: o.select_set(o == ob)
bpy.context.view_layer.objects.active = ob
done = 0
for i in range(8):
    node.image = bpy.data.images.new(f'Bake {i}', 128, 128, float_buffer=True)
    done += bpy.ops.object.bake(type='COMBINED', margin=2) == {'FINISHED'}
open('/bakes.json', 'w').write(json.dumps(done))
`));
main.run('script.python_file_run', { filepath: '/bakes.py' });
assert.equal(JSON.parse(new TextDecoder().decode(files.get('/bakes.json'))), 8, 'eight bakes in a row finish');
// Each face its own material: eight strips, red and blue by their material index, filling the camera's view across.
// Cycles (the side module) reads the faces' material_index through Blender's attribute API in the module, by C++
// types the two share.
const PATTERN = [0, 1, 1, 0, 1, 0, 0, 1];
files.set('/strips.py', new TextEncoder().encode(`import bpy
scene = bpy.context.scene
for ob in list(scene.objects):
    bpy.data.objects.remove(ob)
mesh = bpy.data.meshes.new('Strips')
mesh.from_pydata([(x, y, 0) for x in range(9) for y in (0, 1)], [], [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) for i in range(8)])
for name, color in (('Red', (1, 0, 0, 1)), ('Blue', (0, 0, 1, 1))):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = color
    mat.node_tree.links.new(emission.outputs[0], nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    mesh.materials.append(mat)
mesh.polygons.foreach_set('material_index', ${JSON.stringify(PATTERN)})
mesh.update()
scene.collection.objects.link(bpy.data.objects.new('Strips', mesh))
camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.type, camera.data.ortho_scale, camera.location = 'ORTHO', 8, (4, 0.5, 5)
scene.collection.objects.link(camera)
scene.camera = camera
`));
main.run('script.python_file_run', { filepath: '/strips.py' });
const strips = render(), at = (x, y) => strips.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3);
const seen = PATTERN.map((_, i) => { const [r, , b] = at(i * 8 + 4, 24); return r > b ? 0 : 1; });
assert.deepEqual(seen, PATTERN, `each strip renders its own material: ${seen.join('')}, not ${PATTERN.join('')}`);
x.free(size);
console.log(`Cycles renders Window Light as desktop Blender does, again too: mean differences ${differences.map((d) => d.toFixed(2)).join(', ')} of 255 per channel; each face its own material`);
process.exit(0);
