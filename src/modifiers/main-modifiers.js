// Blender's modifiers as Main holds them on an object, in the terms of Bylonder's stack ({ id: its name, type, name,
// showViewport, showRender, values }), read from its ModifierData and written into it. A textured modifier's texture is
// its texture record's id, a scene modifier's object its node's id; `links` maps them both ways: { textureId(tex),
// texture(id), nodeId(ob), object(id) }.
import { blenderModifierDefinitions, sceneModifierDefinitions, MODE, MODIFIER_REALTIME, MODIFIER_RENDER } from './blender.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';

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

// Writes what a change gives of a modifier's settings and modes into its ModifierData.
export function writeModifier(md, type, { values = {}, showViewport, showRender }, links) {
  const { mesh } = mainDefinition(type), dv = view();
  const settings = Object.fromEntries(Object.entries(values).filter(([path]) => path !== 'texture' && path !== 'object'));
  mesh.write(settings)(dv, md);
  if (mesh.textured && 'texture' in values) x.modifier_texture_set(md, links.texture(values.texture));
  if (mesh.scene && 'object' in values) view().setUint32(md + mesh.object, links.object(values.object), true);
  const bits = [[showViewport, MODIFIER_REALTIME], [showRender, MODIFIER_RENDER]].filter(([shown]) => shown !== undefined);
  for (const [shown, bit] of bits) {
    const mode = view().getInt32(md + MODE, true);
    view().setInt32(md + MODE, shown ? mode | bit : mode & ~bit, true);
  }
}
