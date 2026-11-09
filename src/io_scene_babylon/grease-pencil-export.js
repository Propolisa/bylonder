// Grease Pencil objects in a package: one IR entity per layer (`OB:Ball/grease_pencil/Ball`, `grease_pencil:LAYER`)
// whose inputs are the layer's keyed frames and the drawing each key shows, as Main draws it (strokes, fills and their
// materials' colors, runtime/grease-pencil.js), in scene.bin; the page shows the drawing of the last key at or before
// the frame (runtime/grease-pencil.js), under the object's node.
import { Matrix } from '@babylonjs/core';
import { idStruct } from '../python/bpy_rna.js';
import { babylonMatrix } from '../blenkernel/main-evaluated.js';
import { meanScale } from './runtime/grease-pencil.js';
import { idKey } from './ir-export.js';

// A drawing copied out of the module's memory into scene.bin, by reference.
const binDrawing = (bin, { curves, points, triangles }) => ({ curves: { buffer: bin.add(Int32Array.from(curves)) },
  points: { buffer: bin.add(Float32Array.from(points)) }, triangles: { buffer: bin.add(Uint32Array.from(triangles)) } });

// The Grease Pencil objects the export holds, each with its node and its layers' keyed frames.
function greasePencilObjects(world, nodes) {
  const sync = world.mainSync;
  return nodes.map((node) => ({ node, pointer: sync.objectOf(node) })).filter(({ pointer }) => pointer && idStruct(pointer).type === 'GREASEPENCIL')
    .map(({ node, pointer }) => {
      const ob = idStruct(pointer);
      return { node, pointer, ob, layers: [...ob.data.layers].map((layer) => ({ name: layer.name, frames: [...layer.frames].map((f) => f.frame_number).sort((a, b) => a - b) })) };
    });
}

// Each exported Grease Pencil layer as an entity, its drawings packed by Main at each of its keys; the frame shown is
// evaluated again after. `nodes`: the exported nodes, `time`: the frame's property.
export function greasePencilEntities(world, nodes, bin, time) {
  const sync = world.mainSync, objects = sync ? greasePencilObjects(world, nodes) : [];
  if (!objects.length) return {};
  const frames = [...new Set(objects.flatMap(({ layers }) => layers.flatMap((l) => l.frames)))].sort((a, b) => a - b);
  const current = world.animation.time.frame, drawn = new Map();
  for (const frame of frames) {
    sync.frameChanged(frame);
    for (const draw of sync.blender.greasePencil({ onion: false, repack: true })) if (!draw.onion) drawn.set(`${draw.ob}:${draw.layer}:${frame}`, draw.curves.length ? binDrawing(bin, draw) : null);
  }
  // The layers' matrices and blend modes as the frame shown has them.
  sync.frameChanged(current);
  const shown = new Map(sync.blender.greasePencil({ onion: false, repack: true }).map((draw) => [`${draw.ob}:${draw.layer}`, {
    blend: draw.blend, matrix: babylonMatrix(draw.layerToWorld), scale: meanScale(draw.layerToWorld) }]));
  const entities = {};
  for (const { node, pointer, ob, layers } of objects) {
    const objectToWorld = sync.worldMatrix(node) ?? Matrix.Identity(), toObject = objectToWorld.clone().invert();
    layers.forEach(({ name, frames: keys }, layer) => {
      const placed = shown.get(`${pointer}:${layer}`);
      const drawings = keys.map((frame) => drawn.get(`${pointer}:${layer}:${frame}`) ?? null);
      if (!placed && drawings.every((d) => d === null)) return;
      const { blend = 0, matrix = objectToWorld, scale = 1 } = placed ?? {};
      entities[`${idKey(ob)}/grease_pencil/${name}`] = { type: 'grease_pencil:LAYER', id: idKey(ob), implementation: 'grease_pencil',
        inputs: { layer, blend, matrix: Array.from(matrix.multiply(toObject).m), scale, frames: keys, drawings,
          ...(time && { frame: { property: time } }) },
        outputs: { geometry: { draw: node.id } } };
    });
  }
  return entities;
}
