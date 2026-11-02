// Blender's modifiers as Main holds them on an object, in the terms of Bylonder's stack ({ id: its name, type, name,
// showViewport, showRender, values }), read from its ModifierData and written into it. A textured modifier's texture is
// its texture record's id, a scene modifier's object its node's id; `links` maps them both ways: { textureId(tex),
// texture(id), nodeId(ob), object(id) }.
import { blenderModifierDefinitions, sceneModifierDefinitions, MODIFIER_REALTIME, MODIFIER_RENDER } from './blender.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { pointerStruct, structFind, idStruct, inPythonContext } from '../python/bpy_rna.js';

const { exports: x } = blenderModule;
const DEFINITIONS = [...blenderModifierDefinitions, ...sceneModifierDefinitions];
const view = () => new DataView(x.memory.buffer);

export const mainDefinition = (type) => DEFINITIONS.find((d) => d.id === type) ?? null;
// The definition of a ModifierType Bylonder has, or null.
const definitionOfCode = (code) => DEFINITIONS.find((d) => d.mesh.type === code) ?? null;

// One modifier Main holds ({ type: ModifierType, name, mode, md }, as BlenderMain.modifiers lists them), or null for a
// type Bylonder does not have.
export function readModifier({ type, name, mode, md }, links) {
  const definition = definitionOfCode(type);
  if (!definition) return null;
  const values = definition.mesh.read(view(), md);
  if (definition.mesh.textured) values.texture = links.textureId(view().getUint32(md + definition.mesh.texture, true));
  if (definition.mesh.scene) values.object = links.nodeId(view().getUint32(md + definition.mesh.object, true));
  return { id: name, type: definition.id, name, showViewport: !!(mode & MODIFIER_REALTIME), showRender: !!(mode & MODIFIER_RENDER), values };
}

// Writes what a change gives of a modifier's settings and modes through RNA in its Main (a BlenderMain), as Blender's
// Properties editor does: each property's update tags what it changes (the object's geometry; a pointer's, the
// relations too).
export function writeModifier(main, ob, md, { values = {}, showViewport, showRender }, links) {
  const modifier = pointerStruct(structFind('Modifier'), ob, md);
  const id = (pointer) => (pointer ? idStruct(pointer) : null);
  const pointers = { texture: (value) => id(links.texture(value)), object: (value) => id(links.object(value)) };
  const settings = { ...values, ...(showViewport !== undefined && { show_viewport: showViewport }), ...(showRender !== undefined && { show_render: showRender }) };
  main.current(() => inPythonContext(main.C, () => {
    for (const [path, value] of Object.entries(settings)) {
      const [, name, index] = path.match(/^(\w+)(?:\[(\d+)\])?$/), rnaValue = name in pointers ? pointers[name](value) : value;
      if (index === undefined) modifier[name] = rnaValue;
      else modifier[name][Number(index)] = rnaValue;
    }
  }));
}

// An object's Blender modifiers in Main (sync: main-sync.js), and their edits by Blender's own editor functions, each
// evaluated and drawn: one added (with settings and modes), a change of one's (values, modes, name), one removed, moved
// to an index, copied after itself or applied to the object's Mesh. Modifiers are named by their name, unique in the
// stack; an edit returns the name the modifier has after it.
export function createMainModifiers(sync) {
  const { blender, links } = sync;
  const listed = (ob) => blender.modifiers(ob);
  const mdOf = (ob, name) => listed(ob).find((m) => m.name === name) ?? null;
  const nameOf = (ob, md) => listed(ob).find((m) => m.md === md)?.name;
  return {
    of(node) {
      const ob = sync.objectOf(node);
      return ob ? listed(ob).map((m) => readModifier(m, links)).filter(Boolean) : [];
    },
    add: (node, type, change = {}) => sync.edit(node, (ob) => {
      const md = blender.addModifier(ob, mainDefinition(type).mesh.type);
      writeModifier(blender, ob, md, change, links);
      return nameOf(ob, md);
    }),
    set: (node, name, { name: rename, ...change }) => sync.edit(node, (ob) => {
      const modifier = mdOf(ob, name);
      if (!modifier) return null;
      writeModifier(blender, ob, modifier.md, change, links);
      if (rename) blender.renameModifier(ob, modifier.md, rename);
      return nameOf(ob, modifier.md);
    }),
    remove: (node, name) => sync.edit(node, (ob) => blender.removeModifier(ob, mdOf(ob, name)?.md ?? 0)),
    move: (node, name, index) => sync.edit(node, (ob) => blender.moveModifier(ob, mdOf(ob, name)?.md ?? 0, index)),
    copy: (node, name) => sync.edit(node, (ob) => blender.copyModifier(ob, mdOf(ob, name)?.md ?? 0)),
    // Its result becomes the object's Mesh data, the page's record of it too.
    apply: (node, name) => sync.edit(node, (ob) => blender.applyModifier(ob, mdOf(ob, name)?.md ?? 0)) && sync.keepMesh(node),
  };
}
