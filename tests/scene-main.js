// Main for a test's objects (main-sync.js), which the undo history needs: Blender's undo holds what Main owns.
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';

export function sceneMain(world, selection = createSelection(world.scene, world.objects)) {
  world.animation ??= createAnimationModel();
  return createMainSync({ rna: createRNA({ world, selection }), ids: world.animation.ids });
}
