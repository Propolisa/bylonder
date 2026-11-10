// File > Export's options dialog, in the scene window: EEVEE Parity and, for a JavaScript package, its own options, then
// its settings as a tree (components/ExportDialog.vue). A setting left unset inherits from the level above it.
import { DEV_TOOLS, NAVIGATION, TARGETS } from './export-options.js';
import { RUNTIMES, exportChoices, exportIssue } from '../runtimes/runtimes.js';
import { contextStruct } from '../python/bpy_rna.js';
import { sceneUnits } from './unit-manifest.js';

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

// A row's inherited value where no level above sets it.
const DEFAULT = (value) => () => ({ value, source: 'Default' });

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

// A unit's state: Blender's code (GPL) shipped, or replaced by the page's own unit (docs/escaping-the-gpl.md).
const UNIT_ITEMS = [['BLENDER', 'Blender (GPL)', "Blender's code, GPL-3.0-or-later, ships in the package"],
  ['REPLACED', 'Replaced', 'The page registers its own unit for it: the package ships none of its code']];
const UNIT_CATEGORIES = { modifiers: ['Modifiers', 'MODIFIER'], shader: ['Shader Nodes', 'NODE_MATERIAL'], geometry: ['Geometry Nodes', 'GEOMETRY_NODES'], blocks: ['Blocks', 'LIGHT_AREA'] };
const unitStateOf = (packageState, category, key) => category.units[key] ?? category.state ?? packageState ?? 'BLENDER';
// The Units tree (docs/escaping-the-gpl.md): the scene's units by category, each Blender's (GPL) or replaced, unset
// inheriting from its category and the package; a unit's icon is its code's: Blender's, or the page's own.
function unitsTree(values) {
  values.units = {};
  values.unitState = null;
  const fromAbove = () => (values.unitState ? { value: values.unitState, source: 'Inherited from Units' } : DEFAULT('BLENDER')());
  const categories = Object.entries(sceneUnits()).filter(([, units]) => units.length).map(([id, units]) => {
    values.units[id] = { state: null, units: Object.fromEntries(units.map(({ key }) => [key, null])) };
    // Read back through the reactive values, as the tree's rows watch them.
    const [label, icon] = UNIT_CATEGORIES[id], category = values.units[id];
    const children = units.map(({ key, label: name }) => Object.defineProperty(setting(category.units, key, { label: name, items: UNIT_ITEMS,
      inherited: () => (category.state ? { value: category.state, source: `Inherited from ${label}` } : fromAbove()) }),
    'icon', { get: () => (unitStateOf(values.unitState, category, key) === 'REPLACED' ? 'FILE_SCRIPT' : 'BLENDER') }));
    return Object.assign(setting(category, 'state', { label, icon, items: UNIT_ITEMS, children, inherited: fromAbove }), { key: id });
  });
  return setting(values, 'unitState', { label: 'Units', icon: 'BYLONDER', items: UNIT_ITEMS, children: categories, inherited: DEFAULT('BLENDER') });
}

const BUNDLE_ITEMS = [[true, 'Bundled', "One bundle per package with the Babylon.js modules its scene uses: no CDN or bundler needed, Blender's code (GPL) still in its own files"],
  [false, 'Modules', 'ES modules importing Babylon.js module by module, for an import map or a bundler of your own']];
const MINIFY_ITEMS = [[true, 'Minified', "The bundle minified, its files' notices kept"], [false, 'Readable', 'The bundle as written, for reading or debugging']];
// A JavaScript package's Bundle, and whether the bundle is minified.
const bundleTree = (values) => setting(values, 'bundle', { label: 'Bundle', icon: 'BYLONDER', items: BUNDLE_ITEMS, inherited: DEFAULT(true),
  children: [setting(values, 'minify', { label: 'Minify', icon: 'BYLONDER', items: MINIFY_ITEMS, inherited: DEFAULT(true),
    issue: (value) => (value && values.bundle === false ? 'Only a bundle is minified' : null) })] });

const PANEL_ITEMS = [[true, 'On', "The page shows a panel of the scene's controls behind a button at its canvas's top right corner, loaded when first opened"],
  [false, 'Off', 'No panel: the page sets its controls from its own code']];
const OFFER_ITEMS = [[true, 'Offered', 'The panel offers this navigation'], [false, 'Not Offered', 'The panel leaves this navigation out']];
// The navigation the page opens with, and those the panel offers.
function navigationTree(values) {
  values.navigationModes = Object.fromEntries(NAVIGATION.filter(([id]) => id !== 'FIXED').map(([id]) => [id, null]));
  const modes = values.navigationModes;
  return setting(values, 'navigation', { label: 'Navigation', icon: 'BYLONDER', items: NAVIGATION, inherited: DEFAULT('FIXED'),
    issue: (value) => (modes[value] === false ? 'The panel does not offer it' : null),
    children: NAVIGATION.filter(([id]) => id !== 'FIXED').map(([id, label]) => setting(modes, id, { label, icon: 'BYLONDER', items: OFFER_ITEMS, inherited: DEFAULT(true) })) });
}
// A JavaScript package's Control Panel: where its links load Babylon's editors from, and its navigation.
const panelTree = (values) => setting(values, 'controlPanel', { label: 'Control Panel', icon: 'BYLONDER', items: PANEL_ITEMS, inherited: DEFAULT(true),
  children: [setting(values, 'devTools', { label: 'Editors', icon: 'BYLONDER', items: DEV_TOOLS, inherited: DEFAULT('CDN'),
    issue: (value) => (value === 'PACKAGE' && values.controlPanel === false ? 'Only the control panel links to the editors' : null) }), navigationTree(values)] });

// The settings tree: a JavaScript package's GPU engine, bundle and control panel, the runtimes, then its units.
function settingsTree(values, js) {
  const target = setting(values, 'target', { label: 'GPU Engine', icon: 'BYLONDER', items: TARGETS, inherited: DEFAULT('BOTH') });
  return [...(js ? [target, bundleTree(values), panelTree(values)] : []), runtimesTree(values), ...(js ? [unitsTree(values)] : [])];
}

// The dialog's values as export options: unset settings left out, the Units tree as the type keys replaced.
const options = ({ units, unitState, ...values }) => ({ ...JSON.parse(JSON.stringify(values, (key, value) => (value === null ? undefined : value))),
  ...(units && { replace: [...new Set(Object.values(units).flatMap((category) => Object.keys(category.units).filter((key) => unitStateOf(unitState, category, key) === 'REPLACED')))] }) });

// Asks for a format's export options: resolves to them (export-options.js ExportOptionsSchema), or null when cancelled.
export async function exportDialog(world, format, title) {
  const [{ createApp, h, reactive }, { default: ExportDialog }] = await Promise.all([
    import('vue'),
    import('../editors/interface/components/ExportDialog.vue'),
    import('../editors/interface/components/tailwind.css'),
  ]);
  const js = format !== 'babylon';
  const values = reactive({ eeveeParity: false, hostCompression: false, bakeAnimation: false, target: null, bundle: null, minify: null, controlPanel: null, devTools: null, navigation: null });
  const fields = [{ name: 'eeveeParity', label: 'EEVEE Parity', note: PARITY_NOTE },
    ...(js ? [{ name: 'hostCompression', label: 'Host Compresses Geometry', note: HOST_NOTE }, { name: 'bakeAnimation', label: 'Bake Animation', note: BAKE_NOTE }] : [])];
  const tree = settingsTree(values, js);
  const note = js ? await geometryNodesNote() : undefined;
  const host = document.body.appendChild(document.createElement('div'));
  return new Promise((resolve) => {
    const app = createApp({ render: () => h(ExportDialog, { title, fields, values, tree, note,
      onDone: (ok) => { app.unmount(); host.remove(); resolve(ok ? options(values) : null); } }) });
    app.mount(host);
  });
}
