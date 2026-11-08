// A view composites the part of its render Blender's viewport compositor does (draw/engines/compositor
// compositor_engine.cc Context::get_camera_region): in camera view the camera's frame within the view, else all of it.
import assert from 'node:assert/strict';
import { compositedRegion } from '../src/compositor/compositor.js';

assert.deepEqual(compositedRegion(null, 1311, 834), { x: 0, y: 0, width: 1311, height: 834 }, 'the whole view outside camera view');
// The camera frame as main-sync.js viewCamera gives it: parts of the view from its top left.
assert.deepEqual(compositedRegion({ x: 0.25, y: 0.25, width: 0.5, height: 0.4 }, 1000, 800), { x: 250, y: 280, width: 500, height: 320 },
  "the camera frame's pixels from the bottom left");
// A frame partly outside the view composites where they meet.
assert.deepEqual(compositedRegion({ x: -0.25, y: 0.1, width: 0.75, height: 1.2 }, 1000, 800), { x: 0, y: 0, width: 500, height: 720 });
console.log("Compositor region: views in camera view composite the camera's frame, as Blender's viewport compositor");
