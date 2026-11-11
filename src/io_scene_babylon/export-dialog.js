// File > Export's options dialog, in the scene window: EEVEE Parity and, for a JavaScript package, its own options, then
// its settings as a tree (components/ExportDialog.vue). A setting left unset inherits from the level above it.
import { ANIMATIONS, BRANCH_STATES, BRANCHES, DEV_TOOLS, NAVIGATION, SCOPES, TARGETS } from './export-options.js';
import { BRANCH_ROWS, sceneBranches } from './branches.js';
import { RUNTIMES, exportChoices, exportIssue } from '../runtimes/runtimes.js';
import { contextStruct, idStruct } from '../python/bpy_rna.js';
import { sceneUnits } from './unit-manifest.js';

const PARITY_NOTE = "Lights materials as Blender's EEVEE does (view vector, second reflection as clearcoat). Off: Babylon's own lighting; Blender's texture nodes still export as one custom block.";
const BAKE_NOTE = "Samples every animated value the page cannot play as its F-Curve at each frame, as Babylon keys. Off: F-Curves Babylon plays exactly stay its keys and the others run as F-Curves in the page; what the page cannot run yet is still sampled, each named in the Info editor.";
const HOST_NOTE = "scene.bin uncompressed, for a host that serves it with Brotli (most CDNs): about half the size there, about four times it elsewhere. Off: gzipped in the file, the same size on any host.";

// What a Geometry Nodes stack set Live ships: Blender's kernels, with their size where the server states it.
async function geometryNodesNote() {
  const { geometryNodesKernelsSize } = await import('./module-files.js');
  const bytes = await geometryNodesKernelsSize();
  const size = bytes ? ` (${(bytes / 1e6).toFixed(1)} MB as this site serves it)` : '';
  return `With a Geometry Nodes stack Live, the package ships Blender's Geometry Nodes kernels${size} in bylonder-geometry-nodes/, GPL-3.0-or-later.`;
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

// Why an instance defaults to its state, by branch.
const DEFAULT_REASONS = {
  modifiers: { LIVE: 'Live Modifiers runs every stack it can in the page', BAKED: 'JavaScript (.zip) bakes modifier stacks; Live Modifiers runs them' },
  geometryNodes: { LIVE: 'an input or the frame drives it in the page', BAKED: 'nothing in the page drives it, or it is Smooth by Angle' },
};
const stateLabel = (state) => BRANCH_STATES.find(([id]) => id === state)[1];
// The Branches tree: each branch of the scene (`scene`, branches.js sceneBranches) Live, Baked or Off as it offers, and
// under a branch with instances (an object's stack) each instance; unset everywhere, each takes its default. None:
// no row.
function branchesTree(values, scene) {
  values.branches = {};
  values.branchState = null;
  const rows = BRANCH_ROWS.filter(([id]) => scene[id]).map(([id, label, icon]) => {
    const { state: own, instances = [] } = scene[id];
    values.branches[id] = { state: null, instances: Object.fromEntries(instances.map(({ name }) => [name, null])) };
    const set = values.branches[id], items = BRANCH_STATES.filter(([state]) => BRANCHES[id].includes(state));
    const issue = (state) => (BRANCHES[id].includes(state) ? null : `${label} cannot be ${stateLabel(state)}: it keeps its default`);
    const fromAll = () => values.branchState && { value: values.branchState, source: 'Inherited from Branches', issue: issue(values.branchState) };
    const children = instances.map(({ name, state }) => setting(set.instances, name, { label: name, icon: 'OUTLINER_OB_MESH', items, issue,
      inherited: () => (set.state ? { value: set.state, source: `Inherited from ${label}` } : fromAll() || { value: state, source: `Default: ${DEFAULT_REASONS[id][state]}` }) }));
    return Object.assign(setting(set, 'state', { label, icon, items, issue, children,
      inherited: () => fromAll() || (own ? DEFAULT(own)() : { label: 'Per Object', source: "Each object's default" }) }), { key: id });
  });
  return rows.length ? setting(values, 'branchState', { label: 'Branches', icon: 'BYLONDER', items: BRANCH_STATES, children: rows,
    inherited: () => ({ label: 'Per Branch', source: "Each branch's default" }) }) : null;
}

// The rates offered, as multiples of the scene's frame rate.
const RATE_MULTIPLES = [[2, 'Two keys per frame, for slow motion or a page that plays faster than the scene'], [1, 'A key per frame'],
  [1 / 2, 'A key every second frame'], [1 / 4, 'A key every fourth frame']];
// What can be baked: objects with animation data, constraints or animated shape keys.
const animated = (ob) => !!ob.animation_data || ob.constraints.length > 0 || !!ob.data?.shape_keys?.animation_data;
// The Sample Rate tree: keys per second of what is baked (sampling.js), for every object and per animated object; unset,
// the scene's frame rate.
function sampleRateTree(values, world) {
  const { fps } = world.animation.time.state, label = (rate) => `${+rate.toFixed(3)} per Second`;
  const items = RATE_MULTIPLES.map(([multiple, description]) => [fps * multiple, label(fps * multiple), description]);
  values.sampleRate = { rate: null, instances: {} };
  const set = values.sampleRate, scene = () => ({ value: fps, label: label(fps), source: "Default: the scene's frame rate" });
  const fromAll = () => (set.rate ? { value: set.rate, label: label(set.rate), source: 'Inherited from Sample Rate' } : scene());
  const objects = world.objects.filter((node) => world.mainSync?.objectOf(node) && animated(idStruct(world.mainSync.objectOf(node))));
  const children = objects.map((node) => setting(set.instances, node.name, { label: node.name, icon: 'OUTLINER_OB_MESH', items, inherited: fromAll }));
  return setting(set, 'rate', { label: 'Sample Rate', icon: 'BYLONDER', items, children, inherited: scene });
}

const BUNDLE_ITEMS = [[true, 'Bundled', "One bundle per package with the Babylon.js modules its scene uses: no CDN or bundler needed, Blender's code (GPL) still in its own files"],
  [false, 'Modules', 'ES modules importing Babylon.js module by module, for an import map or a bundler of your own']];
const MINIFY_ITEMS = [[true, 'Minified', "The bundle minified, its files' notices kept"], [false, 'Readable', 'The bundle as written, for reading or debugging']];
// A JavaScript package's Bundle, and whether the bundle is minified.
const bundleTree = (values) => setting(values, 'bundle', { label: 'Bundle', icon: 'BYLONDER', items: BUNDLE_ITEMS,
  inherited: () => (values.scope === 'SELECTED' ? { value: false, source: "Default for Selected Objects: they load into your page's Babylon.js" } : DEFAULT(true)()),
  issue: (value) => (value && values.scope === 'SELECTED' ? "Bundled, the objects carry their own Babylon.js: load({ scene }) needs the page's" : null),
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

// The settings tree: a JavaScript package's scope, GPU engine, bundle, control panel and branches, the animations, the sample rate, the runtimes,
// then its units.
function settingsTree(values, js, branches, world) {
  const scope = setting(values, 'scope', { label: 'Scope', icon: 'BYLONDER', items: SCOPES, inherited: DEFAULT('SCENE') });
  const target = setting(values, 'target', { label: 'GPU Engine', icon: 'BYLONDER', items: TARGETS, inherited: DEFAULT('BOTH') });
  const animations = setting(values, 'animations', { label: 'Animations', icon: 'BYLONDER', items: ANIMATIONS, inherited: DEFAULT('TIMELINE') });
  return [...(js ? [scope, target, bundleTree(values), panelTree(values), branchesTree(values, branches)] : []), animations, sampleRateTree(values, world), runtimesTree(values), ...(js ? [unitsTree(values)] : [])].filter(Boolean);
}

// The dialog's values as export options: unset settings left out, the Units tree as the type keys replaced.
const options = ({ units, unitState, ...values }) => ({ ...JSON.parse(JSON.stringify(values, (key, value) => (value === null ? undefined : value))),
  ...(units && { replace: [...new Set(Object.values(units).flatMap((category) => Object.keys(category.units).filter((key) => unitStateOf(unitState, category, key) === 'REPLACED')))] }) });

// Asks for a format's export options (export-options.js ExportOptionsSchema) and exports with them by `run(options)`;
// a failed export keeps the dialog open with its error. Resolves to whether it exported.
export async function exportDialog(world, format, title, run) {
  const [{ createApp, h, reactive }, { default: ExportDialog }] = await Promise.all([
    import('vue'),
    import('../editors/interface/components/ExportDialog.vue'),
    import('../editors/interface/components/tailwind.css'),
  ]);
  const js = format !== 'babylon';
  const values = reactive({ eeveeParity: false, hostCompression: false, bakeAnimation: false, scope: null, target: null, animations: null, bundle: null, minify: null, controlPanel: null, devTools: null, navigation: null });
  const fields = [{ name: 'eeveeParity', label: 'EEVEE Parity', note: PARITY_NOTE },
    ...(js ? [{ name: 'hostCompression', label: 'Host Compresses Geometry', note: HOST_NOTE }, { name: 'bakeAnimation', label: 'Bake Animation', note: BAKE_NOTE }] : [])];
  const branches = js ? sceneBranches(world, { live: format === 'js-live' }) : {};
  const tree = settingsTree(values, js, branches, world);
  const note = branches.geometryNodes ? await geometryNodesNote() : undefined;
  const host = document.body.appendChild(document.createElement('div'));
  const status = reactive({ busy: false, error: '' });
  return new Promise((resolve) => {
    const close = (exported) => { app.unmount(); host.remove(); resolve(exported); };
    const done = async (ok) => {
      if (status.busy) return;
      if (!ok) return close(false);
      Object.assign(status, { busy: true, error: '' });
      try {
        await run(options(values));
        close(true);
      } catch (error) {
        Object.assign(status, { busy: false, error: error.message });
      }
    };
    const app = createApp({ render: () => h(ExportDialog, { title, fields, values, tree, note, status, onDone: done }) });
    app.mount(host);
  });
}
