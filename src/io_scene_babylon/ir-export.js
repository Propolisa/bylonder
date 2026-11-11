// The scene's time as the IR holds it (docs/ir.md, Scene and collections), from the app's scene time (scene/time.js).
const sceneTime = ({ frameCurrent, frameStart, frameEnd, fps, fpsBase, loop }) => ({ frame_current: frameCurrent, frame_start: frameStart, frame_end: frameEnd, fps, fps_base: fpsBase, loop });

// The package's IR (docs/ir.md): the carried IDs with their RNA data and the references between them, the properties,
// the node graphs and the computed entities, as plain data for scene.ir.json.
import { blendData, idStruct, pointerOf } from '../python/bpy_rna.js';
import { writeGraph } from './ir-graphs.js';
import { driverCurve, driverEntities } from './driver-export.js';
import { packKeys } from './runtime/fcurve-evaluator.js';
import { baseMesh, geometryNodesEntities, modifierEntities } from './modifiers-export.js';
import { ID_OB } from '../blenkernel/main-evaluated.js';
import { greasePencilEntities } from './grease-pencil-export.js';
import { curvesEntities } from './curves-export.js';
import { pointCloudEntities } from './pointclouds-export.js';
import { chosenState } from './export-options.js';
import { entityOrder, IR_SCHEMA, IR_VERSION, referencesIn } from './runtime/ir.js';

// Blender's two-letter ID codes, by the bpy.data collection of each ID type.
const CODES = { objects: 'OB', meshes: 'ME', materials: 'MA', node_groups: 'NT', scenes: 'SC', actions: 'AC', collections: 'GR', worlds: 'WO',
  cameras: 'CA', lights: 'LA', curves: 'CU', textures: 'TE', images: 'IM', shape_keys: 'KE', armatures: 'AR', lattices: 'LT', grease_pencils: 'GP',
  hair_curves: 'CV', pointclouds: 'PT', volumes: 'VO', fonts: 'VF', libraries: 'LI', particles: 'PA', palettes: 'PL', brushes: 'BR' };
const COLLECTION_OF = new Map(Object.entries(CODES).map(([collection, code]) => [code, collection]));
// RNA's struct for each ID type, by its identifier's base name.
const TYPE_CODES = { Object: 'OB', Mesh: 'ME', Material: 'MA', Scene: 'SC', Action: 'AC', Collection: 'GR', World: 'WO', Camera: 'CA', Text: 'TX',
  Curve: 'CU', TextCurve: 'CU', SurfaceCurve: 'CU', Image: 'IM', Key: 'KE', Armature: 'AR', Lattice: 'LT', GreasePencil: 'GP', GreasePencilv3: 'GP',
  Curves: 'CV', PointCloud: 'PT', Volume: 'VO', VectorFont: 'VF', Library: 'LI', ParticleSettings: 'PA', Palette: 'PL', Brush: 'BR', Speaker: 'SK',
  LightProbe: 'LP', Mask: 'MSK', MovieClip: 'MC', Sound: 'SO', WindowManager: 'WM', Screen: 'SR', WorkSpace: 'WS' };
const codeOf = (id) => {
  const name = id.rna_type.identifier;
  return TYPE_CODES[name] ?? (name.endsWith('NodeTree') ? 'NT' : name.endsWith('Light') ? 'LA' : name.endsWith('Texture') ? 'TE' : name.slice(0, 2).toUpperCase());
};
const key = (name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
export const idKey = (id) => `${codeOf(id)}:${id.name}${id.library ? '@' + id.library.name : ''}`;

// What the walk leaves out: RNA's own description, runtime and UI state, and each element of a mesh's or a curve's
// bulk data (a mesh's geometry is in scene.bin, an F-Curve's keys in the Babylon animation that plays it).
const SKIP = new Set(['rna_type', 'bl_rna', 'original', 'id_data', 'users_collection', 'users_scene', 'session_uid', 'is_evaluated', 'preview',
  'is_runtime_data', 'tag', 'is_missing', 'override_library', 'asset_data', 'bound_box', 'library_weak_reference', 'matrix_world', 'matrix_local',
  'matrix_basis', 'dimensions', 'name_full', 'is_editable', 'id_type', 'location_absolute', 'width', 'height', 'select', 'hide_select', 'is_active_output', 'users', 'is_editmode']);
// UI-only state: what a panel or a node shows expanded, selected or active.
const UI = /^(show_expanded|.*_expanded|is_active|ui_.*|bl_.*|select_.*|use_custom_color|color_tag)$/;
// Views of what is written elsewhere: an F-Curve group's channels are its action's F-Curves.
const DERIVED = new Set(['ActionGroup.channels']);
// A node tree's nodes, links and interface, which its graph holds.
const GRAPHED = new Set(['nodes', 'links', 'interface']);
// A node's place in its editor, which only the editor reads.
const LAYOUT = new Set(['location', 'color']);
const BULK = /^(Keyframe|FCurveSample|MeshNormalValue|ReadOnlyInteger|Mesh(Vertex|Edge|Polygon|Loop|LoopTriangle|LoopColor|UVLoop|VertColor|Normal)|.*Attribute|.*AttributeValue|FloatVectorValueReadOnly|AttributeGroup.*|BezierSplinePoint|SplinePoint|ShapeKeyPoint|ShapeKeyBezierPoint|ShapeKeyCurvePoint|LatticePoint|Particle|ParticleKey|ChildParticle|ParticleHairKey|CurvePoint|CurveSlice|.*Stroke.*|GreasePencilFrame|GreasePencilDrawing|Depsgraph.*|ViewLayerEEVEE|UIList|Region.*|Area.*|Screen.*|KeyMap.*|Window.*)$/;

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
// An ID, not a struct sharing its ID's data (an Object's display settings): the ID it belongs to is of its own type.
const isID = (v, pointer) => pointer[1] === pointer[2] && pointerOf(v.id_data)?.[0] === pointer[0];
const named = (item) => typeof item?.bl_rna === 'object' && [...item.bl_rna.properties].some((p) => p.identifier === 'name');

// Whether a value is its property's RNA default, which the IR leaves out.
function isDefault(prop, v) {
  if (prop.type === 'POINTER') return v === null;
  if (prop.type === 'COLLECTION') return !v.length;
  const fallback = safe(() => (prop.array_length > 0 ? [...prop.default_array] : prop.default));
  if (fallback === undefined) return false;
  if (Array.isArray(fallback)) return safe(() => [...v].every((x, i) => (typeof x === 'object' ? false : x === fallback[i] || Math.fround(x) === Math.fround(fallback[i])))) ?? false;
  return v === fallback || (typeof v === 'number' && Math.fround(v) === Math.fround(fallback)) || (v instanceof Set && !v.size);
}

// An RNA value as IR data: IDs by key (recording the reference), nested structs walked to `depth`.
function walker(onReference) {
  const value = (owner, path, v, depth) => {
    if (v === null || v === undefined || typeof v !== 'object') return v ?? null;
    if (typeof v.length === 'number' && !pointerOf(v) && typeof v[Symbol.iterator] === 'function' && !v.bl_rna) {
      const items = [...v];
      return items.every((x) => typeof x !== 'object') ? items : items.map((x, i) => value(owner, `${path}[${i}]`, x, depth));
    }
    const pointer = pointerOf(v);
    if (!pointer) return safe(() => [...v]) ?? null;
    if (isID(v, pointer)) {
      const to = idKey(v);
      onReference(owner, path, v);
      return { id: to };
    }
    // A struct met again (a link's node, a socket's node) is named by where it was first written.
    const at = `${pointer[0]}:${pointer[2]}`;
    if (seen.has(at)) return { struct: seen.get(at) };
    seen.set(at, path);
    return depth > 0 ? struct(owner, path, v, depth - 1) : null;
  };
  const seen = new Map();
  const struct = (owner, path, s, depth) => {
    if (BULK.test(s.rna_type.identifier)) return null;
    const out = {};
    for (const prop of s.bl_rna.properties) {
      const name = prop.identifier;
      if (SKIP.has(name) || UI.test(name) || LAYOUT.has(name) && /Node/.test(s.rna_type.identifier) || DERIVED.has(`${s.rna_type.identifier}.${name}`)) continue;
      if (GRAPHED.has(name) && s.rna_type.identifier.endsWith('NodeTree')) continue;
      if (prop.type === 'COLLECTION' && BULK.test(safe(() => prop.fixed_type.identifier) ?? '')) continue;
      const v = safe(() => s[name]);
      if (v === undefined || isDefault(prop, v)) continue;
      const at = path ? `${path}.${name}` : name;
      if (prop.type === 'COLLECTION') {
        out[name] = safe(() => [...v].map((item, i) => value(owner, `${at}${named(item) ? key(item.name) : `[${i}]`}`, item, depth))) ?? [];
      } else out[name] = value(owner, at, v, depth);
    }
    return out;
  };
  return struct;
}

// The IDs reachable from `roots` (RNA ID structs), each with its data, and the references between them.
export function exportIDs(roots, depth = 6) {
  const ids = {}, references = [], queue = [...roots];
  const struct = walker((owner, path, to) => {
    references.push({ from: idKey(owner), path, to: idKey(to) });
    queue.push(to);
  });
  while (queue.length) {
    const id = queue.shift(), k = idKey(id);
    if (ids[k]) continue;
    const code = codeOf(id), collection = COLLECTION_OF.get(code);
    ids[k] = { type: id.rna_type.identifier.toUpperCase(), name: id.name, path: collection ? `${collection}${key(id.name)}` : null, data: null };
    ids[k].data = struct(id, '', id, depth);
  }
  return { ids, references };
}

// The ID key of the ID an RNA path starts at (`objects["Cube"].location[0]`).
export function pathID(path) {
  const match = /^(\w+)\["((?:[^"\\]|\\.)*)"\]/.exec(path);
  return match && CODES[match[1]] ? `${CODES[match[1]]}:${match[2].replace(/\\(.)/g, '$1')}` : null;
}

// The scene's own IDs: every scene with its collections, view layers, world and compositor, and the objects drawn.
export const rootIDs = (objects) => [...blendData().scenes, ...objects.map(idStruct)];

// An unlinked socket's value as the property that sets it, where there is one: a vector's by component.
const socketProperty = (properties, base) => (socket, node) => {
  const index = [...node.inputs].findIndex((s) => s.identifier === socket.identifier), path = `${base}.nodes${key(node.name)}.inputs[${index}].default_value`;
  if (properties[path]) return { property: path };
  if (!properties[`${path}[0]`]) return undefined;
  return [...socket.default_value].map((v, i) => (properties[`${path}[${i}]`] ? { property: `${path}[${i}]` } : v));
};

// The carried node trees as graphs: a node group (Geometry Nodes, a compositor) by its own key, a material's or a
// world's by `<its key>/node_tree`; an unlinked input set by a property refers to it.
function idGraphs(ids, properties, graphs) {
  const data = blendData();
  for (const [k, id] of Object.entries(ids)) {
    const collection = COLLECTION_OF.get(k.split(':')[0]), struct = collection && !id.name.includes('@') && safe(() => data[collection].get(id.name));
    if (collection === 'node_groups' && struct) writeGraph(struct, k, graphs, { value: socketProperty(properties, id.path) });
    else if ((collection === 'materials' || collection === 'worlds') && struct?.node_tree) {
      writeGraph(struct.node_tree, `${k}/node_tree`, graphs, { value: socketProperty(properties, `${id.path}.node_tree`) });
    }
  }
}

// The F-Curves of an ID's action, in the slot it uses.
export function actionFCurves(animation) {
  const action = animation?.action;
  if (!action) return [];
  return [...action.layers].flatMap((layer) => [...layer.strips].flatMap((strip) => [...strip.channelbags]))
    .filter((bag) => !animation.action_slot || bag.slot?.handle === animation.action_slot.handle).flatMap((bag) => [...bag.fcurves]);
}

// The property an F-Curve sets: its RNA path with its index, else without, else a Geometry Nodes input's.
function curveTarget(id, fc, properties) {
  const path = `${id.path}${fc.data_path.startsWith('[') ? '' : '.'}${fc.data_path}`, socket = /^(modifiers\["(?:[^"\\]|\\.)*"\])\["([^"]+)"\]$/.exec(fc.data_path);
  return [`${path}[${fc.array_index}]`, path, socket && `${id.path}.${socket[1]}.properties.inputs.${socket[2]}.value`].find((p) => p && properties[p]) ?? null;
}

// An object's or a pose bone's transform, whose F-Curves run live only where Main's samples confirm them (live-curves.js).
const TRANSFORM = /^objects\[.*\]\.(pose\.bones\[.*\]\.)?(location|rotation_euler|rotation_quaternion|scale)\[\d\]$/;

// A FLOAT property (a light's power, a material's input, a modifier's setting, a custom property, a Geometry Nodes
// input) whose F-Curve the unit runs as Blender evaluates it and nothing else animates: its F-Curve as the `fcurve`
// implementation runs it, else null. Written after Babylon's animation, it holds over any samples of the same value.
function propertyCurve(animation, fc, target, property) {
  if (TRANSFORM.test(target) || property?.type !== 'FLOAT' || animation.nla_tracks.length || [...animation.drivers].some((d) => d.data_path === fc.data_path)) return null;
  const input = driverCurve(fc);
  if (!input) return null;
  const { keyframes, ...settings } = input;
  return { settings, keys: packKeys(keyframes) };
}

// Each F-Curve of the carried IDs' actions, by name: one of `curves` (live-curves.js) or of a property no Babylon
// binding sets runs on the clean-room unit (`fcurve`), its keys in scene.bin; another Babylon's animation of the node
// it lands on plays (`native`), its keys being that animation's; else it stays baked.
function animationEntities(ids, properties, time, animationGroups, curves, bin) {
  const data = blendData(), entities = {};
  const groupOf = (node) => animationGroups.find((group) => group.targetedAnimations?.some((t) => t.targetId === node))?.name;
  const live = new Map(curves.map((c) => [`${idKey(c.id)}/animation/${c.fc.data_path}[${c.fc.array_index}]`, c]));
  for (const [k, id] of Object.entries(ids)) {
    const collection = COLLECTION_OF.get(k.split(':')[0]), struct = collection && safe(() => data[collection].get(id.name));
    // A material's or world's node tree animates its inputs with its own action, from the tree's path.
    const owners = [[struct?.animation_data, id, ''], [safe(() => struct?.node_tree?.animation_data), { ...id, path: `${id.path}.node_tree` }, 'node_tree.']];
    for (const [animation, owner, prefix] of owners) for (const fc of actionFCurves(animation)) {
      const name = `${k}/animation/${prefix}${fc.data_path}[${fc.array_index}]`, target = curveTarget(owner, fc, properties);
      const run = target && time && !fc.mute && (live.get(name) ?? propertyCurve(animation, fc, target, properties[target]));
      const group = id.node && groupOf(id.node), native = !run && group !== undefined && !!target;
      entities[name] = { type: 'animation:FCURVE', id: k,
        inputs: { action: `actions${key(animation.action.name)}`, data_path: fc.data_path, array_index: fc.array_index, ...(native && { animation: { group, target: id.node } }),
          ...(run && { curve: { ...run.settings, keyframes: { buffer: bin.add(run.keys) } } }), ...(time && { frame: { property: time } }) },
        outputs: { value: target ? { property: target } : null }, ...((run || native) && { implementation: run ? 'fcurve' : 'native' }) };
    }
  }
  return entities;
}

// Whether a node tree, or a group it uses, reads the scene's time.
export const treeReadsFrame = (tree) => readsTime(writeGraph(tree, idKey(tree)), idKey(tree));

// Whether a graph, or a group it uses, reads the scene's time (a Scene Time node).
function readsTime(graphs, graphKey, seen = new Set()) {
  if (seen.has(graphKey) || !graphs[graphKey]) return false;
  seen.add(graphKey);
  return graphs[graphKey].nodes.some((node) => node.type === 'node:GeometryNodeInputSceneTime' || (node.settings.node_tree?.id && readsTime(graphs, node.settings.node_tree.id, seen)));
}

// The depsgraph's relations (BlenderMain.relations) the pointer walk does not see, as references from the ID that
// depends to the one it reads (`time`: the scene's time), each pair once, between carried IDs: the scene's time, an
// Object or Collection Info given its ID by a link, the view layer's flags.
export function depsgraphReferences(ids, references, relations) {
  const seen = new Set(references.flatMap(({ from, to }) => [`${from}\0${to}`, `${to}\0${from}`]));
  return (relations ?? []).filter(({ from, to }) => (from === 'time' || ids[from]) && ids[to] && !seen.has(`${to}\0${from}`) && seen.add(`${to}\0${from}`).add(`${from}\0${to}`))
    .map(({ from, to, name }) => ({ from: to, to: from, relation: name }));
}

// The IDs a graph names in its nodes' settings and inputs, and those of the groups it uses.
function graphIDs(graphs, graphKey, seen = new Set()) {
  if (seen.has(graphKey) || !graphs[graphKey]) return [];
  seen.add(graphKey);
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') found.push(value.id);
    Object.values(value).forEach(walk);
  };
  graphs[graphKey].nodes.forEach((node) => walk([node.settings, node.inputs]));
  return found.flatMap((k) => (k.startsWith('NT:') ? graphIDs(graphs, k, seen) : [k]));
}

// What Blender evaluated at export for the objects the Geometry Nodes graphs read, directly or through a collection:
// each object's world matrix and mesh (in scene.bin), as `evaluated` on its ID, which the page's evaluator reads.
function evaluatedIDs(ids, graphs, entities, sync, bin) {
  const objects = new Set(), visit = (k) => {
    if (k.startsWith('OB:')) objects.add(k);
    if (k.startsWith('GR:')) [...(ids[k]?.data?.objects ?? []), ...(ids[k]?.data?.children ?? [])].forEach((member) => visit(member.id));
  };
  for (const entity of Object.values(entities)) if (entity.type === 'modifier:NODES') graphIDs(graphs, entity.inputs.graph.graph).forEach(visit);
  const pointers = new Map(sync.blender.ids(ID_OB).map((ob) => [`OB:${sync.blender.name(ob)}`, ob]));
  for (const k of objects) {
    const pointer = pointers.get(k), ob = pointer && idStruct(pointer);
    if (!ids[k] || !ob) continue;
    ids[k].evaluated = { matrix_world: Array.from(sync.blender.transform(pointer).matrix_world),
      ...(ob.type === 'MESH' && { geometry: { mesh: baseMesh(sync.blender.mesh(pointer), bin, { attributes: true }) } }) };
  }
}

// An object's constraints the page applies to its node each frame, after what places it (`constraints:OBJECT`), by the
// node's id.
function constraintEntities(ids, constraints, time) {
  const idOf = new Map(Object.entries(ids).filter(([, id]) => id.node !== undefined).map(([k, id]) => [id.node, k]));
  return Object.fromEntries(constraints.filter((c) => idOf.has(c.node)).map((inputs) => [`${idOf.get(inputs.node)}/constraints/object`,
    { type: 'constraints:OBJECT', id: idOf.get(inputs.node), inputs: { ...inputs, ...(time && { frame: { property: time } }) }, outputs: {}, implementation: 'constraints' }]));
}

// The package's IR (docs/ir.md): `controls` (controls-export.js) as its properties, with what the `live` stacks and the
// Geometry Nodes modifiers add; the carried IDs, their node trees, and the computed entities, with the F-Curves and the
// objects' constraints the page runs (`curves`, `constraints`, live-curves.js); `collections`, the scene's and its
// collections (collections-export.js); `states`, the export's options that set
// the states of its branches (export-options.js chosenState).
export function exportIR(world, { controls, collections = null, live, bin, animationGroups = [], sampleRates = {}, curves = [], constraints = [], states = {} }) {
  const sync = world.mainSync, objects = world.objects.map((node) => [node, sync?.objectOf(node)]).filter(([, pointer]) => pointer);
  const { ids, references } = sync ? exportIDs(rootIDs(objects.map(([, pointer]) => pointer))) : { ids: {}, references: [] };
  for (const [node, pointer] of objects) if (ids[idKey(idStruct(pointer))]) ids[idKey(idStruct(pointer))].node = node.id;
  if (sync) references.push(...depsgraphReferences(ids, references, sync.blender.relations()));
  const graphs = {};
  const time = controls.some(({ path }) => path.endsWith('.frame_current'));
  const readsFrame = (tree) => time && treeReadsFrame(tree);
  const entities = sync ? { ...modifierEntities(world, live, controls, bin), ...geometryNodesEntities(world, controls, bin, (tree) => {
    writeGraph(tree, idKey(tree), graphs);
    return idKey(tree);
  }, readsFrame, states) } : {};
  const properties = Object.fromEntries(controls.map(({ path, bind, ...property }) => [path, { id: pathID(path), ...property, ...(bind && { bind }) }]));
  if (sync) {
    evaluatedIDs(ids, graphs, entities, sync, bin);
    idGraphs(ids, properties, graphs);
    const time = Object.keys(properties).find((p) => p.endsWith('.frame_current'));
    // A Geometry Nodes modifier whose graph reads the scene's time runs again when the frame changes.
    for (const entity of Object.values(entities)) if (time && entity.type === 'modifier:NODES' && readsTime(graphs, entity.inputs.graph.graph)) entity.inputs.frame = { property: time };
    Object.assign(entities, driverEntities(properties), animationEntities(ids, properties, time, animationGroups, curves, bin),
      greasePencilEntities(world, objects.map(([node]) => node), bin, time),
      chosenState(states, 'curves') === 'OFF' ? {} : curvesEntities(world, objects.map(([node]) => node), bin), constraintEntities(ids, constraints, time));
    Object.assign(entities, pointCloudEntities(world, objects.map(([node]) => node), bin));
  }
  // What the page computes from is offered to authors.
  for (const entity of Object.values(entities)) if (entity.implementation) for (const [ref] of referencesIn(entity.inputs)) if ('property' in ref) properties[ref.property].suggested = true;
  return { schema: IR_SCHEMA, version: IR_VERSION, scene: { ...(collections?.scene ?? { id: null, collection: null, view_layer: null }), time: { ...sceneTime(world.animation.time.state), sample_rates: sampleRates } }, ids,
    collections: collections?.collections ?? {}, references, properties, graphs, entities, order: entityOrder(entities) };
}
