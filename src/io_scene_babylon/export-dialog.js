// File > Export's options dialog, in the scene window: EEVEE Parity and, for a JavaScript package, its own options, then
// its settings as a tree (components/ExportDialog.vue). A setting left unset inherits from the level above it.
import { TARGETS } from './export-options.js';

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

// A tree row of a setting kept at `key` of `values` (null: unset). `inherited(values)`: { value, source, issue } it shows
// while unset; `issue(value)`: why a value set here is not exported as chosen, or null.
const setting = (key, values, { label, icon, items, inherited, issue = () => null, children = [] }) => ({
  key, label, icon, items, children, issue,
  get: () => values[key] ?? null,
  set: (value) => { values[key] = value; },
  inherited: () => inherited(),
});

// The settings tree of a JavaScript package.
function settingsTree(values) {
  const target = setting('target', values, {
    label: 'GPU Engine', icon: 'BYLONDER', items: TARGETS,
    inherited: () => ({ value: 'BOTH', source: 'Default' }),
  });
  return [target];
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
  const tree = js ? settingsTree(values) : [];
  const note = js ? await geometryNodesNote() : undefined;
  const host = document.body.appendChild(document.createElement('div'));
  return new Promise((resolve) => {
    const app = createApp({ render: () => h(ExportDialog, { title, fields, values, tree, note,
      onDone: (ok) => { app.unmount(); host.remove(); resolve(ok ? JSON.parse(JSON.stringify(values, (key, value) => (value === null ? undefined : value))) : null); } }) });
    app.mount(host);
  });
}
