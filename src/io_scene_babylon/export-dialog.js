// File > Export's options dialog, in the scene window: EEVEE Parity and, for a JavaScript package, its own options, then
// its settings as a tree (components/ExportDialog.vue). A setting left unset inherits from the level above it.
import { TARGETS } from './export-options.js';
import { RUNTIMES, exportChoices, exportIssue } from '../runtimes/runtimes.js';
import { contextStruct } from '../python/bpy_rna.js';

const PARITY_NOTE = "Lights materials as Blender's EEVEE does (view vector, second reflection as clearcoat). Off: Babylon's own lighting; Blender's texture nodes still export as one custom block.";
const BAKE_NOTE = "Samples every animated value the page cannot play as its F-Curve at each frame, as Babylon keys. Off: F-Curves Babylon plays exactly stay its keys and the others run as F-Curves in the page; what the page cannot run yet is still sampled, each named in the Info editor.";
const HOST_NOTE = "scene.bin uncompressed, for a host that serves it with Brotli (most CDNs): about half the size there, about four times it elsewhere. Off: gzipped in the file, the same size on any host.";

// A package's Geometry Nodes kernels, with their size where the server states it.
async function geometryNodesNote() {
  const { geometryNodesKernelsSize } = await import('./module-files.js');
  const bytes = await geometryNodesKernelsSize();
  const size = bytes ? ` (${(bytes / 1e6).toFixed(1)} MB as this site serves it)` : '';
  return `With Geometry Nodes, the package ships Blender's Geometry Nodes kernels${size} in bylonder-geometry-nodes/, GPL-3.0-or-later.`;
}

// A tree row of a setting kept at `key` of `holder` (null: unset). `inherited()`: { value, label?, source, issue? } it
// shows while unset; `issue(value)`: why a value set here is not exported as chosen, or null.
const setting = (holder, key, { label, icon, items, inherited, issue = () => null, children = [] }) => ({
  key, label, icon, items, children, issue, inherited,
  get: () => holder[key] ?? null,
  set: (value) => { holder[key] = value; },
});

const RUNTIME_ITEMS = Object.entries(RUNTIMES).map(([id, [label, description]]) => [id, label, description]);
const OWN = { label: 'Per Instance', source: "Each instance's runtime, set in its Runtime panel" };
// The runtimes tree (docs/runtimes.md): the package's, each feature's with instances in the scene, each instance's. Unset,
// a level takes the one above's; unset everywhere, an instance exports with its own runtime.
function runtimesTree(values) {
  values.runtimes = {};
  const packageRuntime = () => values.runtime ?? null;
  const features = exportChoices(contextStruct()).map(({ feature, instances }) => {
    values.runtimes[feature.id] = { runtime: null, instances: {} };
    const set = values.runtimes[feature.id];
    const items = RUNTIME_ITEMS.filter(([id]) => feature.runtimes.includes(id));
    const issue = (value) => exportIssue(feature, value);
    const children = instances.map(({ name, label, own }) => setting(set.instances, name, {
      label, icon: feature.icon, items, issue,
      inherited: () => {
        const from = set.runtime ? { value: set.runtime, source: `Inherited from ${feature.label}` } : packageRuntime() ? { value: packageRuntime(), source: 'Inherited from Runtime' } : { value: own, source: "The instance's runtime, set in its Runtime panel" };
        return { ...from, label: RUNTIMES[from.value][0], issue: issue(from.value) };
      },
    }));
    return setting(set, 'runtime', { label: feature.label, icon: feature.icon, items, issue, children,
      inherited: () => (packageRuntime() ? { value: packageRuntime(), label: RUNTIMES[packageRuntime()][0], source: 'Inherited from Runtime', issue: issue(packageRuntime()) } : OWN) });
  });
  return setting(values, 'runtime', { label: 'Runtime', icon: 'BYLONDER', items: RUNTIME_ITEMS, children: features, inherited: () => OWN });
}

// The settings tree: the package's GPU engine (a JavaScript package's), then the runtimes.
function settingsTree(values, js) {
  const target = setting(values, 'target', { label: 'GPU Engine', icon: 'BYLONDER', items: TARGETS, inherited: () => ({ value: 'BOTH', source: 'Default' }) });
  return [...(js ? [target] : []), runtimesTree(values)];
}

// Asks for a format's export options: resolves to them (export-options.js ExportOptionsSchema), or null when cancelled.
export async function exportDialog(world, format, title) {
  const [{ createApp, h, reactive }, { default: ExportDialog }] = await Promise.all([
    import('vue'),
    import('../editors/interface/components/ExportDialog.vue'),
    import('../editors/interface/components/tailwind.css'),
  ]);
  const js = format !== 'babylon';
  const values = reactive({ eeveeParity: false, hostCompression: false, bakeAnimation: false });
  const fields = [{ name: 'eeveeParity', label: 'EEVEE Parity', note: PARITY_NOTE },
    ...(js ? [{ name: 'hostCompression', label: 'Host Compresses Geometry', note: HOST_NOTE }, { name: 'bakeAnimation', label: 'Bake Animation', note: BAKE_NOTE }] : [])];
  const tree = settingsTree(values, js);
  const note = js ? await geometryNodesNote() : undefined;
  const host = document.body.appendChild(document.createElement('div'));
  return new Promise((resolve) => {
    const app = createApp({ render: () => h(ExportDialog, { title, fields, values, tree, note,
      onDone: (ok) => { app.unmount(); host.remove(); resolve(ok ? JSON.parse(JSON.stringify(values, (key, value) => (value === null ? undefined : value))) : null); } }) });
    app.mount(host);
  });
}
