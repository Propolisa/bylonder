// Blender's Grease Pencil offscreen rendering on Babylon (tools/blender-port/wasm/grease-pencil-render.cc): what the
// Fill tool's pixel solver draws (its strokes in its boundary colors, the click's seed dot, gap extensions) rendered
// into a render target at the size and with the projection Blender asks for, and read back synchronously into the
// module's image, as Blender's GPU offscreen gives it. The lines are GreasedLine meshes as the view draws strokes, in the
// colors Blender gives (raw, as Blender's offscreen stores them), alpha blended. Their two materials (widths in world
// units and in pixels) are compiled when the page first draws Grease Pencil, so a render needs no compilation.
import { Scene } from '@babylonjs/core/scene.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { GreasedLineMesh } from '@babylonjs/core/Meshes/GreasedLine/greasedLineMesh.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import '@babylonjs/core/Engines/Extensions/engine.readTexture.js';
import { provided } from '../port/wasm.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { colorsTexture, greasedLineMaterial } from '../io_scene_babylon/runtime/grease-pencil.js';

const { exports: x } = blenderModule;
// grease-pencil-render.cc's kinds of lines and the floats of a point (view-space position, width, RGBA).
const LINE_WORLD = 0, DOTS = 2, DOTS_WORLD = 3, POINT_FLOATS = 8;
// The lines a recording holds, split into those of world widths and those of pixel widths; a dot is a line as long as
// it is wide (GreasedLine has no caps), `viewPerPixel(z)` converting a pixel width at a view depth to view units.
function readLines(lineData, pointData, viewPerPixel) {
  const world = [], pixels = [];
  for (let l = 0; l < lineData.length; l += 3) {
    const [first, count, kind] = lineData.subarray(l, l + 3);
    const at = (i) => pointData.subarray((first + i) * POINT_FLOATS, (first + i + 1) * POINT_FLOATS);
    const target = kind === LINE_WORLD || kind === DOTS_WORLD ? world : pixels;
    const line = () => ({ positions: [], widths: [], colors: [] });
    const add = (into, p, offset = 0) => { into.positions.push(p[0] + offset, p[1], p[2]); into.widths.push(p[3], p[3]); into.colors.push(...p.subarray(4, 8)); };
    if (kind === DOTS || kind === DOTS_WORLD || count === 1) for (let i = 0; i < count; i++) {
      const dot = line(), p = at(i), half = 0.5 * Math.max(p[3], 1e-6) * (target === world ? 1 : viewPerPixel(p[2]));
      add(dot, p, -half);
      add(dot, p, half);
      target.push(dot);
    } else {
      const strip = line();
      for (let i = 0; i < count; i++) add(strip, at(i));
      target.push(strip);
    }
  }
  return { world, pixels };
}

// The module's grease_pencil_render import, rendering on `engine`; on a WebGL 2 engine of its own beside WebGPU, which
// reads back only asynchronously.
export function provideGreasePencilRender(engine) {
  if (provided.grease_pencil_render) return;
  if (engine.isWebGPU) engine = new Engine(document.createElement('canvas'));
  const scene = new Scene(engine, { virtual: true });
  scene.useRightHandedSystem = true;
  const camera = new Camera('__grease_pencil_render', Vector3.Zero(), scene);
  camera.getViewMatrix = () => Matrix.Identity();
  const materials = [false, true].map((pixels) => {
    const material = Object.assign(greasedLineMaterial(scene, pixels ? 'pixels' : 'world', pixels), { depthFunction: Constants.ALWAYS });
    const sample = new GreasedLineMesh('sample', scene, { points: [[0, 0, 0, 1, 0, 0]] });
    sample.material = material;
    material.forceCompilation(sample, () => sample.dispose());
    return material;
  });
  // Lines of one kind as one GreasedLine mesh in its material.
  const linesMesh = (lines, material, resolution) => {
    if (!lines.length) return null;
    let pointer = 0;
    const points = lines.map(({ positions }) => positions);
    const colorPointers = points.flatMap((p) => Array.from({ length: p.length / 3 }, () => [pointer, pointer++]).flat());
    const plugin = material.pluginManager.getPlugin('GreasedLinePluginMaterial');
    Object.assign(plugin, { colorsTexture: colorsTexture(scene, Float32Array.from(lines.flatMap(({ colors }) => colors))), resolution, width: 1 });
    const mesh = new GreasedLineMesh('lines', scene, { points, widths: lines.flatMap(({ widths }) => widths), colorPointers });
    mesh.material = material;
    return mesh;
  };
  provided.grease_pencil_render = (width, height, winmatPointer, linesPointer, lineCount, pointsPointer, pixelsPointer) => {
    const memory = x.memory.buffer, lineData = new Int32Array(memory, linesPointer >>> 0, lineCount * 3);
    let pointCount = 0;
    for (let l = 0; l < lineCount; l++) pointCount = Math.max(pointCount, lineData[l * 3] + lineData[l * 3 + 1]);
    const projection = Matrix.FromArray(new Float32Array(memory, winmatPointer >>> 0, 16));
    camera.getProjectionMatrix = () => projection;
    // Orthographic or perspective (Blender's winmat, column-major: its [11] is -1 in perspective).
    const viewPerPixel = (z) => (2 / (projection.m[0] * width)) * (projection.m[11] ? -z : 1);
    const { world, pixels } = readLines(lineData, new Float32Array(memory, pointsPointer >>> 0, pointCount * POINT_FLOATS), viewPerPixel);
    const resolution = new Vector2(width, height);
    const meshes = [linesMesh(world, materials[0], resolution), linesMesh(pixels, materials[1], resolution)].filter(Boolean);
    const target = new RenderTargetTexture('__grease_pencil_render', { width, height }, scene, { generateMipMaps: false, generateDepthBuffer: false });
    Object.assign(target, { activeCamera: camera, renderList: meshes, clearColor: new Color4(0, 0, 0, 0) });
    try {
      target.render();
      engine._readTexturePixelsSync(target.getInternalTexture(), width, height, -1, 0, new Uint8Array(x.memory.buffer, pixelsPointer >>> 0, width * height * 4));
    } finally {
      target.dispose();
      for (const mesh of meshes) { mesh.material.pluginManager.getPlugin('GreasedLinePluginMaterial').colorsTexture?.dispose(); mesh.dispose(); }
    }
  };
}
