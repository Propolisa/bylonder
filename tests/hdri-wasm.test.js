// An HDRI authored in Bylonder: Window Light (examples/rendering) rendered by Cycles through an equirectangular
// panoramic camera, saved as Radiance HDR by Blender's image writer (Image.save_render), the
// file opened again as a float image.
import assert from 'node:assert/strict';

// Cycles renders on threads of its own (its session's).
process.env.BYLONDER_THREADS ??= '4';
const { openExample } = await import('./open-example.js');
const { blendData, pointerStruct, structFind } = await import('../src/python/bpy_rna.js');
const { files } = await import('../src/port/wasm.js');
const { loadCycles } = await import('../src/render/cycles.js');

const OPERATOR_FINISHED = 1 << 2, PATH = '/tmp/window-light.hdr';
const { sync } = openExample('rendering');
await loadCycles();
const { panels } = await import('../src/python/bpy_interface.js');
assert.ok(panels.DATA_PT_lens.COMPAT_ENGINES.includes('CYCLES'), "Cycles shows Blender's camera Lens panel, as its add-on adds it");
assert.ok(!panels.DATA_PT_camera_dof.COMPAT_ENGINES.includes('CYCLES'), 'but not a panel Cycles replaces with its own');
const data = blendData(sync.blender.C), scene = pointerStruct(structFind('Scene'), sync.blender.scene, sync.blender.scene);
scene.render.engine = 'CYCLES';
Object.assign(scene.camera.data, { type: 'PANO', panorama_type: 'EQUIRECTANGULAR' });
// The app's view keeps it (Babylon draws it as a perspective camera, as EEVEE renders one).
sync.view();
assert.equal(scene.camera.data.type, 'PANO', "a panoramic camera stays one through the app's sync");
Object.assign(scene.render, { resolution_x: 64, resolution_y: 32, resolution_percentage: 100 });
scene.render.image_settings.file_format = 'HDR';
scene.cycles.samples = 4;
const { status, report } = sync.blender.run('render.render', {});
assert.ok(status & OPERATOR_FINISHED, `render.render finished: ${report}`);
data.images.get('Render Result').save_render(PATH, scene);
assert.match(Buffer.from(files.get(PATH).slice(0, 10)).toString('latin1'), /^#\?RADIANCE/, 'Blender wrote a Radiance HDR file');

const environment = data.images.load(PATH);
assert.deepEqual([...environment.size], [64, 32], 'the panorama, twice as wide as high');
assert.ok(environment.is_float, 'opened again as a float image, its range kept');
console.log('HDRI: a panoramic Cycles render saved by Blender as Radiance HDR, its range kept');
process.exit(0);