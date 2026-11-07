// Relationship lines as Blender's overlay draws them (overlay_relation.hh, the Relations overlay): dashed lines from an
// object to its parent, its hooks and its constraint targets. Blender's overlay syncs them in the module
// (relations-draw.cc) from Main's evaluated scene; Babylon draws them as the armature overlay draws its own.
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { relationLinesMesh } from './overlay-armature.js';

const { exports: x } = blenderModule;
// The overlay's lines (relations_draw: their floats and count), as a copy; none from a module without them.
export function relationsDraw(C) {
  if (!x.relations_draw) return new Float32Array();
  const [lines, count] = new Int32Array(x.memory.buffer, x.relations_draw(C) >>> 0, 2);
  return new Float32Array(x.memory.buffer, lines >>> 0, count).slice();
}

// sync(): the scene's Main sync (createMainSync); wake(): the views draw again.
export function createRelationsOverlay(scene, { sync, wake }) {
  let mesh = null, dirty = true, subscribed = null, shown = true;
  const frame = scene.getEngine().onBeginFrameObservable.add(() => {
    const main = sync();
    if (!main) return;
    if (subscribed !== main) { subscribed = main; main.onEvaluated(() => { dirty = true; }); dirty = true; }
    if (!dirty) return;
    dirty = false;
    mesh?.dispose();
    const lines = relationsDraw(main.blender.C);
    mesh = lines.length ? relationLinesMesh(scene, lines) : null;
    mesh?.setEnabled(shown);
    wake();
  });
  return {
    // Called per view right before it renders.
    setEnabled(value) { shown = value; mesh?.setEnabled(value); },
    dispose() { scene.getEngine().onBeginFrameObservable.remove(frame); mesh?.dispose(); },
  };
}
