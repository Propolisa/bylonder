// The Package View's core (docs/sdk-model.md, Previews; docs/data-flow.md): the scene written as File > Export >
// JavaScript writes it, remembered as its last export's tables. After each change, once idle, what Blender's depsgraph
// updated since is exported alone (scoped-export.js) and its patch against them goes to the page showing it, which
// applies it (BlendScene.patch) or loads the package again.
import { exportPackage } from '../../io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../../io_scene_babylon/scene-patch.js';
import { exportChanged } from '../../io_scene_babylon/scoped-export.js';

/**
 * `publish(files)` puts an export's files where the page loads them and gives the page's URL; `post(patch)` sends a
 * patch to the page; `idle(run)` runs once the app is idle; `report(status)` tells what the view shows.
 */
export function createPackagePreview({ world, options = {}, publish, post, idle = (run) => setTimeout(run, 400), report = () => {} }) {
  let last = null, pending = false, exporting = false, sending = Promise.resolve();
  // The IDs Blender's depsgraph updated since the last export; an export's own evaluation of the frames is not a change.
  const updated = new Set();
  world.mainSync?.onEvaluated((updates) => { if (!exporting) for (const id of updates.keys()) updated.add(id); });
  const whileExporting = async (run) => { exporting = true; try { return await run(); } finally { exporting = false; } };
  const exported = () => whileExporting(async () => {
    updated.clear();
    const made = await exportPackage(world, options);
    return { made, state: packageState(made) };
  });
  const send = async () => {
    const ids = new Set(updated);
    updated.clear();
    const state = await whileExporting(() => exportChanged(world, last, ids, options)), patch = tablesPatch(last, state), changed = Object.keys(patch.tables).length;
    last = state;
    if (changed) post(patch);
    report(changed ? `Patched: ${Object.keys(patch.tables).join(', ')}` : 'Up to date');
  };
  return {
    /** Writes the package again and gives where its page is. */
    async reload() {
      report('Exporting');
      const { made, state } = await exported(), url = await publish(made.files);
      last = state;
      report('Loaded');
      return url;
    },
    /** The scene changed (an edit, undo or redo): once idle, the page gets its patch. */
    changed() {
      if (!last || pending) return;
      pending = true;
      idle(() => {
        pending = false;
        sending = sending.then(send).catch((error) => report(`Not patched: ${error.message}`));
      });
    },
    /** Resolves once the patches asked for are sent. */
    settled: () => sending,
    /** The tables the page holds now: packageState's, as a whole export would make them. */
    get state() { return last; },
  };
}

/** The page a package shows in the Package View: its scene, patched from the app by `channel`'s messages. */
export const previewPage = (channel) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html, body, canvas { margin: 0; width: 100%; height: 100%; display: block; overflow: hidden; background: #000; }</style></head>
<body><canvas id="view"></canvas>
<script type="module">
import { createEngine, load } from './scene.js';
const canvas = document.getElementById('view'), engine = await createEngine(canvas);
let blend = await load(engine), paused = false;
engine.runRenderLoop(() => { if (!paused) blend.scene.render(); });
addEventListener('resize', () => engine.resize());
// A patch applied; paused, the game's frame held; reset, the package loaded again and patched to the app's tables.
let patching = Promise.resolve();
const take = async ({ patch, paused: hold, reset }) => {
  if (hold !== undefined) paused = hold;
  if (reset) { blend.dispose(); blend = await (await load(engine)).patch(reset); paused = false; }
  if (patch) blend = await blend.patch(patch);
};
new BroadcastChannel(${JSON.stringify(channel)}).onmessage = ({ data }) => { patching = patching.then(() => take(data)); };
// The scene the page shows, for tests.
Object.defineProperty(window, 'blend', { get: () => blend });
</script></body></html>
`;
