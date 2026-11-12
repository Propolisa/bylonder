// Runtimes (docs/runtimes.md): for a feature Babylon also has a class for, which settings define each instance and which
// code evaluates it. A feature joins with registerRuntime from its own module (armature.js); the rest of Bylonder
// touches only this registry: the view asks it whether a runtime other than Blender evaluates an object
// (`evaluates`) and hands every evaluation to it (`evaluated`), export asks it for the mapping (`exportRuntimes`), and
// the runtime panels and the Scene tab's Runtimes panel are drawn from it by Blender's Properties editor
// (`registerRuntimeTypes`). The choice is `<struct>.bylonder.runtime`, saved in the .blend as a custom property.
import { __class__, __kwargtrans__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { registerClass, defineAssignedProperties, pointerOf, contextStruct } from '../python/bpy_rna.js';
import { report } from '../windowmanager/wm-reports.js';
import { exportSampling } from '../io_scene_babylon/sampling.js';
import { appliedRests } from './applied-rest.js';

export const RUNTIMES = {
  BLENDER: ['Blender', "Blender's settings, evaluated by Blender"],
  MAPPED: ['Babylon (mapped)', "Blender's settings mapped to Babylon's class, evaluated by Babylon"],
  NATIVE: ['Babylon (native)', "Babylon's settings, evaluated by Babylon"],
};
export const APPROXIMATION = 'APPROXIMATION', FALLBACK = 'FALLBACK';

// Each feature: { id, label, struct (the RNA type it lives on), context (its Properties tab, a panel's bl_context), or
// sidebar ({ space, category }: its panel's place in an editor's sidebar instead), owner (the context member holding it,
// or a function of the context giving it),
// runtimes (the identifiers it offers), settings (its Babylon-only settings, bpy.props by name), poll(struct),
// issues(struct): [{ kind, setting, message }], instances(context): the structs it evaluates, evaluates(entry),
// evaluate(view), instanceLabel(struct) (its name in lists, default the struct's), exported (the runtimes its export writes as such; default all it offers), export(world, { bake,
// runtime(struct): the runtime an instance exports with, sampling: the frames it samples at (sampling.js) }): { issues,
// animations, curves?, gaps?, clip?(sampling, owns), restore } }, `clip` sampling the animations of the instances whose
// owner ID `owns` holds over another sampling (an action's, clip-export.js) and giving a function that returns them. What
// a feature samples it reads in the sampling's one pass over the frames (sampling.sample): its animations, curves, gaps
// and constraints are read after that pass.
const features = [];
export function registerRuntime(feature) {
  features.push(feature);
}
export const runtimeOf = (struct) => struct?.bylonder?.runtime ?? 'BLENDER';
export const featureOf = (struct) => features.find((feature) => feature.poll(struct)) ?? null;

// The view's hooks (main-view.js drawEvaluated): whether a runtime other than Blender evaluates an object's geometry,
// and what each feature does after Main is evaluated. `view`: { world, scene, blender, entries, updates, drawGeometry,
// drawMesh }. A feature switched to a runtime with issues reports them to the Info editor.
export const evaluates = (entry) => features.some((feature) => feature.evaluates(entry));
const seen = new Map();
export function evaluated(view) {
  for (const feature of features) {
    for (const struct of feature.evaluate(view)) {
      const key = feature.id + ':' + pointerOf(struct)[2], runtime = runtimeOf(struct), before = seen.get(key);
      seen.set(key, runtime);
      if (before !== undefined && before !== runtime && runtime !== 'BLENDER') reportIssues(`${struct.name}: ${feature.label} on ${RUNTIMES[runtime][0]}`, feature.issues(struct));
    }
  }
}
function reportIssues(title, issues) {
  for (const { kind, message } of issues) report(kind === FALLBACK ? 'WARNING' : 'INFO', `${title}: ${kind === FALLBACK ? 'evaluated as Blender' : 'approximated'}, ${message}`);
}

// Export (io_scene_babylon): every feature's instances mapped into Babylon for the file (those in Blender for its
// duration), their issues reported, and Babylon animations of what Blender's animation system drives that the mapping
// makes (a skeleton's bones). Without `bake`, F-Curves a package's page runs instead (live-curves.js) go in `curves`,
// and what is still sampled in `gaps`; `sampling`, the frames it samples at (io_scene_babylon/sampling.js). `choice`: File > Export's runtime options (export-options.js), each instance on its
// own runtime where they choose none. Returns { animations: [{ animation, target }], curves, gaps, constraints (an armature's bone constraints the page runs), clip(sampling, owns), restore() }.
export function exportRuntimes(world, { bake = true, sampling = world.animation && exportSampling(world.animation.time.state), ...choice } = {}) {
  const rests = appliedRests(), results = features.map((feature) => feature.export(world, { bake, sampling, rests, runtime: exportedRuntime(feature, choice) }));
  for (const { title, issues } of results.flatMap((r) => r.reports)) reportIssues(title, issues);
  const all = (key) => results.flatMap((r) => r[key] ?? []);
  return { get animations() { return all('animations'); }, get curves() { return all('curves'); }, get gaps() { return all('gaps'); }, get constraints() { return all('constraints'); },
    clip(clipSampling, owns) {
      const clips = results.map((r) => r.clip?.(clipSampling, owns));
      return () => clips.flatMap((animations) => animations?.() ?? []);
    },
    boneParent: (ob) => results.map((r) => r.boneParent?.(ob)).find(Boolean) ?? null,
    settle: () => results.forEach((r) => r.settle?.()),
    restore: () => { results.forEach((r) => r.restore()); rests.dispose(); } };
}

// The runtime File > Export's options (export-options.js) choose for an instance of a feature: set on the instance, else
// its feature, else the package; null: its own.
export function chosenRuntime({ runtime = null, runtimes = {} }, feature, instance) {
  const set = runtimes[feature];
  return set?.instances?.[instance] ?? set?.runtime ?? runtime;
}
// Why a feature's instance cannot export with a runtime, or null.
const exports = (feature, runtime) => (feature.exported ?? feature.runtimes).includes(runtime);
export const exportIssue = (feature, runtime) => (!feature.runtimes.includes(runtime) ? `${RUNTIMES[runtime][0]} is not offered`
  : !exports(feature, runtime) ? `its export does not carry ${RUNTIMES[runtime][0]} yet` : null);
// The runtime each instance of a feature exports with: the one the export chooses for it, else its own. One its feature
// does not offer or does not export as such is reported to the Info editor, and the instance exports with its own (or
// Blender, if its own is not exported either).
function exportedRuntime(feature, choice) {
  const runtimes = new Map();
  for (const struct of feature.instances(contextStruct())) {
    const own = runtimeOf(struct), chosen = chosenRuntime(choice, feature.id, struct.name) ?? own;
    const runtime = exports(feature, chosen) ? chosen : exports(feature, own) ? own : 'BLENDER';
    if (runtime !== chosen) report('WARNING', `${struct.name}: ${feature.label} exported on ${RUNTIMES[runtime][0]}, ${exportIssue(feature, chosen)}`);
    runtimes.set(struct.name, runtime);
  }
  return (struct) => runtimes.get(struct.name) ?? runtimeOf(struct);
}

// File > Export's runtime tree (export-dialog.js): each feature with instances in the context, and its instances' own
// runtimes.
export const exportChoices = (context) => features.map((feature) => ({ feature, instances: feature.instances(context).map((struct) => ({ name: struct.name, label: feature.instanceLabel?.(struct) ?? struct.name, own: runtimeOf(struct) })) }))
  .filter(({ instances }) => instances.length);

// ---- Blender's side: `bylonder` on each struct a feature lives on, as an add-on registers its properties, and the panels.
const kw = (keywords) => __kwargtrans__(keywords);
const types = () => globalThis.__py_modules['_bpy.types'];
const props = () => globalThis.__py_modules['_bpy.props'];

// The PropertyGroup of a struct's features: their runtime (the identifiers they offer), their Babylon settings and,
// read only, their issues.
function propertyGroup(struct, list) {
  const offered = Object.keys(RUNTIMES).filter((id) => list.some((feature) => feature.runtimes.includes(id)));
  const Babylon = __class__(`BYLONDER_PG_${struct.toLowerCase()}_babylon`, [types().PropertyGroup], {
    __annotations__: Object.assign({}, ...list.map((feature) => feature.settings(props(), kw))),
  });
  registerClass(Babylon);
  const Group = __class__(`BYLONDER_PG_${struct.toLowerCase()}`, [types().PropertyGroup], {
    __annotations__: {
      runtime: props().EnumProperty(kw({ name: 'Runtime', description: 'Which settings define this feature and which code evaluates it',
        items: offered.map((id) => [id, ...RUNTIMES[id]]), default: 'BLENDER', options: new Set() })),
      babylon: props().PointerProperty(kw({ type: Babylon, name: 'Babylon', description: "Babylon's settings of the feature" })),
    },
    get issues() { return featureOf(this.id_data)?.issues(this.id_data) ?? []; },
  });
  registerClass(Group);
  types()[struct].bylonder = props().PointerProperty(kw({ type: Group, name: 'Bylonder', description: "Bylonder's runtime of this data's features" }));
}

const ISSUE_ICONS = { APPROXIMATION: 'INFO', FALLBACK: 'ERROR' };
// A feature's runtime panel in its Properties tab or editor sidebar: the runtime, its Babylon settings, then its issues.
function runtimePanel(feature, icon) {
  const owner = (context) => (typeof feature.owner === 'function' ? feature.owner(context) : context[feature.owner]);
  const place = feature.sidebar ? { bl_space_type: feature.sidebar.space, bl_region_type: 'UI', bl_category: feature.sidebar.category }
    : { bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: feature.context };
  return __class__(`${feature.context.toUpperCase()}_PT_bylonder_${feature.id.toLowerCase()}_runtime`, [types().Panel], {
    bl_label: 'Runtime', ...place,
    poll: (context) => !!owner(context) && feature.poll(owner(context)),
    draw_header(context) { this.layout.label(kw({ text: '', icon_value: icon })); },
    draw(context) {
      const { layout } = this, struct = owner(context), settings = struct.bylonder, runtime = settings.runtime;
      layout.use_property_split = true;
      layout.use_property_decorate = false;
      layout.prop(settings, 'runtime');
      const babylon = layout.column();
      babylon.active = runtime !== 'BLENDER';
      for (const name of Object.keys(feature.settings(props(), kw))) babylon.prop(settings.babylon, name);
      if (runtime === 'BLENDER') return;
      const note = feature.note?.(struct);
      if (note) layout.label(kw({ text: note, icon: 'INFO' }));
      const issues = feature.issues(struct);
      for (const [kind, heading] of [[APPROXIMATION, 'Approximated'], [FALLBACK, 'Evaluated as Blender']]) {
        const listed = issues.filter((i) => i.kind === kind);
        if (!listed.length) continue;
        const column = layout.column(kw({ align: true }));
        column.label(kw({ text: heading + ':' }));
        for (const { message } of listed) column.label(kw({ text: message, icon: ISSUE_ICONS[kind] }));
      }
    },
  });
}

// The Scene tab's list of what runs on Babylon: each instance not on Blender, with its runtime and issue count.
function scenePanel(icon) {
  const listed = (context) => features.flatMap((feature) => feature.instances(context).filter((struct) => runtimeOf(struct) !== 'BLENDER').map((struct) => [feature, struct]));
  return __class__('SCENE_PT_bylonder_runtimes', [types().Panel], {
    bl_label: 'Runtimes', bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: 'scene', bl_options: new Set(['DEFAULT_CLOSED']),
    draw_header(context) { this.layout.label(kw({ text: '', icon_value: icon })); },
    draw(context) {
      const rows = listed(context);
      if (!rows.length) this.layout.label(kw({ text: 'Everything evaluates as Blender' }));
      for (const [feature, struct] of rows) {
        const issues = feature.issues(struct).length;
        this.layout.label(kw({ text: `${struct.name}: ${feature.label}, ${RUNTIMES[runtimeOf(struct)][0]}${issues ? `, ${issues} issue${issues > 1 ? 's' : ''}` : ''}`, icon: feature.icon }));
      }
    },
  });
}

// Registers every feature's properties and panels as Blender's types, once Blender's Python is loaded
// (python/bpy_interface.js); `icon` is the Bylonder icon's icon_value.
export function registerRuntimeTypes(icon) {
  const byStruct = Map.groupBy(features, (feature) => feature.struct);
  for (const [struct, list] of byStruct) propertyGroup(struct, list);
  defineAssignedProperties();
  for (const feature of features) registerClass(runtimePanel(feature, icon));
  registerClass(scenePanel(icon));
}

// How Babylon draws a struct a feature lives on, where its runtime is not Blender (a feature's `look`), else null.
export const look = (struct) => (runtimeOf(struct) === 'BLENDER' ? null : featureOf(struct)?.look?.(struct) ?? null);
