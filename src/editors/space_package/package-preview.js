// The Package View's and the Game area's core (docs/sdk-model.md, Previews; docs/data-flow.md): the scene written as
// File > Export > JavaScript writes it, remembered as its last export's tables. A value edit reaches the runs on the
// next frame: each ID Blender's depsgraph updates gives its controls' values, read by their RNA paths, which the runs
// set where they differ (the binds the package carries do the rest). Behind it, once idle, what the depsgraph updated is
// exported alone (scoped-export.js) and its patch goes to the runs, which apply it or load the package again; a patch
// that disagrees with a value set before it says the runs load fresh.
import { exportPackage } from '../../io_scene_babylon/js-export.js';
import { packageState, tablesPatch } from '../../io_scene_babylon/scene-patch.js';
import { exportChanged, keyOfPointer } from '../../io_scene_babylon/scoped-export.js';
import { float32 } from '../../io_scene_babylon/ir-export.js';
import { blendData } from '../../python/bpy_rna.js';

/** A control's value as an export reads it: its RNA path's from bpy.data, a float at its float32 text; else undefined. */
function controlValue(path) {
  try {
    const value = blendData().path_resolve(path);
    return typeof value === 'number' ? float32(value) : typeof value === 'boolean' || typeof value === 'string' ? value : undefined;
  } catch { return undefined; }
}

/**
 * The controls a value edit sets fast, by the IR key of their ID (as properties name it, `OB:Cube`): those that bind
 * to the scene, less what the page computes (an F-Curve's or driver's output) and the scene's frame, which is the run's.
 */
function fastControls(state) {
  const written = new Set(Object.values(state.tables.entities ?? {}).flatMap((entity) => Object.values(entity?.outputs ?? {}).map((output) => output?.property)));
  const byID = new Map();
  for (const [path, property] of Object.entries(state.tables.properties ?? {})) {
    if (!property?.bind || property.bind.frame || written.has(path)) continue;
    (byID.get(property.id) ?? byID.set(property.id, []).get(property.id)).push(path);
  }
  return byID;
}

/**
 * `publish(made, state)` puts an export (exportPackage's, its tables `state`) where the page loads it and gives the
 * page's URL; `set(changes)` sets controls (`[path, value]` pairs) on the runs where they differ; `post(patch, fresh)`
 * sends a patch to the runs, `fresh` when they load the package fresh at it instead; `idle(run)` runs once the app is
 * idle; `report(status)` tells what the view shows.
 */
export function createPackagePreview({ world, options = {}, publish, post, set = () => {}, idle = (run) => setTimeout(run, 400), report = () => {} }) {
  let last = null, controls = new Map(), changes = 0, exporting = false, sending = Promise.resolve();
  // The IDs Blender's depsgraph updated since the last export; an export's own evaluation of the frames is not a change.
  const updated = new Set();
  // The values set fast since the last export, which its patch must agree with.
  const setFast = new Map();
  const remember = (state) => { last = state; controls = fastControls(state); };
  const setChanged = (pointers) => {
    const changes = [...pointers].flatMap((pointer) => controls.get(keyOfPointer(pointer)?.replace(/@.*$/, '')) ?? [])
      .map((path) => [path, controlValue(path)]).filter(([, value]) => value !== undefined);
    if (!changes.length) return;
    for (const [path, value] of changes) setFast.set(path, value);
    set(changes);
  };
  world.mainSync?.onEvaluated((updates) => {
    if (exporting) return;
    for (const id of updates.keys()) updated.add(id);
    if (last) setChanged(updates.keys());
  });
  const whileExporting = async (run) => { exporting = true; try { return await run(); } finally { exporting = false; } };
  const exported = () => whileExporting(async () => {
    updated.clear();
    setFast.clear();
    const made = await exportPackage(world, options);
    return { made, state: packageState(made) };
  });
  const send = async () => {
    const ids = new Set(updated), fast = new Map(setFast);
    updated.clear();
    setFast.clear();
    report('Exporting the change');
    const state = await whileExporting(() => exportChanged(world, last, ids, options)), patch = tablesPatch(last, state), changed = Object.keys(patch.tables).length;
    remember(state);
    // A value set fast that the export does not give: the runs load fresh rather than keep a state no export makes.
    const differs = [...fast].find(([path, value]) => state.tables.properties?.[path]?.default !== value && setFast.get(path) === undefined);
    if (changed || differs) post(patch, !!differs);
    report(differs ? `Loaded fresh: ${differs[0]} differed from the export` : changed ? `Edited live, not re-verified: ${Object.keys(patch.tables).join(', ')}` : 'Up to date');
  };
  return {
    /** Writes the package again and gives where its page is. */
    async reload() {
      report('Exporting');
      const { made, state } = await exported(), url = await publish(made, state);
      remember(state);
      report('Loaded');
      return url;
    },
    /** The scene changed (an edit, undo or redo): once idle after the last change, the page gets its patch. */
    changed() {
      if (!last) return;
      const asked = ++changes;
      // The export holds the app's thread: it waits for a pause in the edits, which reach the runs meanwhile.
      idle(() => { if (asked === changes) sending = sending.then(send).catch((error) => report(`Not patched: ${error.message}`)); });
    },
    /** Resolves once the patches asked for are sent. */
    settled: () => sending,
    /** The tables the page holds now: packageState's, as a whole export would make them. */
    get state() { return last; },
  };
}

/** The page a package shows in the Package View: its scene, patched and set from the app by `channel`'s messages. */
export const previewPage = (channel) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html, body, canvas { margin: 0; width: 100%; height: 100%; display: block; overflow: hidden; background: #000; }</style></head>
<body><canvas id="view"></canvas>
<script type="module">
import { createEngine, load, readPatch } from './scene.js';
const canvas = document.getElementById('view'), engine = await createEngine(canvas);
let blend = await load(engine);
engine.runRenderLoop(() => blend.scene.render());
addEventListener('resize', () => engine.resize());
// A patch applied, read as it comes in; one it cannot read leaves the scene as it was.
let patching = Promise.resolve();
const take = async ({ patch }) => {
  try { blend = await blend.patch(readPatch(patch)); } catch (error) { console.warn(\`Bylonder: a patch is not applied, the scene stays as it was: \${error.message}\`); }
};
// Values set where they differ, the scene's own controls only.
const has = (path) => { try { blend.get(path); return true; } catch { return false; } };
const set = (changes) => { for (const [path, value] of changes) if (has(path) && blend.get(path) !== value) blend.set(path, value); };
new BroadcastChannel(${JSON.stringify(channel)}).onmessage = ({ data }) => { patching = patching.then(() => (data.set ? set(data.set) : take(data))); };
// The scene the page shows, for tests.
Object.defineProperty(window, 'blend', { get: () => blend });
</script></body></html>
`;
