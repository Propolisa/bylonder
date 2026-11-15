// Lightmaps (docs/features/lightmaps.md): an object's baked light, Bylonder's setting `object.bylonder.lightmap` (Object
// properties > Lightmap): an image, the UV map it is laid out on, its Intensity (what the image's 0..1, sRGB, is multiplied
// by) and Direct, which says what the image holds and so how Babylon's lightmap slot takes it. With Direct, all the light
// reaching the object, without its colour (a Diffuse bake, Color off): the export's copy of its material, Babylon's
// PBRMaterial, is unlit, its colour multiplied by the lightmap (useLightmapAsShadowmap). Without, the light it gives back
// of what reaches it besides the lights' direct light (Diffuse, Indirect, Color on): the copy is lit by the lights live,
// the lightmap added. Either way the copy reads it through the UV map as the mesh's second UV set, with no environment light.
import { MultiMaterial, PBRMaterial } from '@babylonjs/core';
import { __class__, __kwargtrans__ } from '../bl_py/org.transcrypt.__runtime__.js';
import { idStruct, registerClass } from '../python/bpy_rna.js';
import { registerSettings } from '../runtimes/runtimes.js';
import { fileBytes } from '../blenkernel/packed-file.js';
import { webImage } from '../imbuf/data-url.js';

const kw = (keywords) => __kwargtrans__(keywords);

registerSettings('Object', {
  settings(props, types) {
    const Group = __class__('BYLONDER_PG_lightmap', [types.PropertyGroup], {
      __annotations__: {
        image: props.PointerProperty(kw({ type: types.Image, name: 'Image', description: "The object's baked light, laid out on its UV map: with Direct, the light reaching it (Diffuse, Color off); without, the light it gives back besides the lights' direct light (Diffuse, Indirect, Color on)" })),
        uv_map: props.StringProperty(kw({ name: 'UV Map', description: 'The UV map the image is laid out on', default: 'Lightmap', options: new Set() })),
        intensity: props.FloatProperty(kw({ name: 'Intensity', description: "What the image's values are multiplied by: the brightest light it holds", default: 1, min: 0, soft_max: 16, options: new Set() })),
        direct: props.BoolProperty(kw({ name: 'Direct', description: "The image holds the lights' direct light too and multiplies the material's colour: the object is drawn with it alone. Off, the lights light the object live and the image adds to them", default: true, options: new Set() })),
      },
    });
    registerClass(Group);
    return { lightmap: props.PointerProperty(kw({ type: Group, name: 'Lightmap', description: "The object's baked light" })) };
  },
  panel: (types, icon) => __class__('OBJECT_PT_bylonder_lightmap', [types.Panel], {
    bl_label: 'Lightmap', bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: 'object', bl_options: new Set(['DEFAULT_CLOSED']),
    poll: (C) => C.object?.type === 'MESH',
    draw_header() { this.layout.label(kw({ text: '', icon_value: icon })); },
    draw(C) {
      const { layout } = this, settings = C.object.bylonder.lightmap;
      layout.use_property_split = true;
      layout.use_property_decorate = false;
      layout.prop(settings, 'image');
      layout.prop_search(settings, 'uv_map', C.object.data, 'uv_layers', kw({ icon: 'GROUP_UVS' }));
      layout.prop(settings, 'intensity');
      layout.prop(settings, 'direct');
    },
  }),
});

/** The lightmap of an object (an Object struct): its settings where it has an image in a format browsers read, else null. */
export function lightmapOf(ob) {
  // Read only where set: reading a group property makes it, and an export changes nothing.
  if (!ob?.is_property_set('bylonder') || !ob.bylonder.is_property_set('lightmap')) return null;
  const settings = ob.bylonder.lightmap, image = settings.image;
  const url = image && webImage(fileBytes(image));
  return url ? { url, uvMap: settings.uv_map, intensity: settings.intensity, direct: settings.direct } : null;
}

// The UV map's coordinates per vertex of the drawn mesh (a vertex per face corner, then loose points), from the draw
// buffers' attribute of that name; null without it.
function uvs(world, node, uvMap) {
  const buffers = world.mainSync.evaluatedMesh(node)?.drawBuffers(0, [uvMap]);
  if (!buffers) return null;
  const read = buffers.attributes[0], out = read && new Float32Array(node.getTotalVertices() * 2);
  if (read) out.set(read.data.subarray(0, out.length));
  buffers.free();
  return out;
}

/** Each exported mesh with a lightmap, by node: its settings and its second UV set. */
export function lightmapsOf(world, meshes) {
  if (!world.mainSync) return new Map();
  return new Map(meshes.flatMap((node) => {
    const pointer = world.mainSync.objectOf(node), lightmap = pointer && lightmapOf(idStruct(pointer));
    const uv2 = lightmap && uvs(world, node, lightmap.uvMap);
    return uv2 ? [[node, { ...lightmap, uv2 }]] : [];
  }));
}

// A material's colour, roughness and metallic from its Principled BSDF's unlinked inputs, else its viewport display's.
function surface(ma) {
  const bsdf = ma && [...ma.node_tree?.nodes ?? []].find((n) => n.type === 'BSDF_PRINCIPLED');
  const input = (name, fallback) => {
    const socket = bsdf && [...bsdf.inputs].find((i) => i.name === name);
    return socket && !socket.is_linked ? socket.default_value : fallback;
  };
  return { color: [...input('Base Color', ma?.diffuse_color ?? [0.8, 0.8, 0.8, 1])].slice(0, 3), roughness: input('Roughness', ma?.roughness ?? 0.5), metallic: input('Metallic', ma?.metallic ?? 0) };
}

// The lightmap as a texture's serialization, its UV set the mesh's second.
const texture = (name, url, level) => ({ name, base64String: url, coordinatesIndex: 1, level, invertY: true, gammaSpace: true, hasAlpha: false,
  wrapU: 0, wrapV: 0, samplingMode: 3, uOffset: 0, vOffset: 0, uScale: 1, vScale: 1, uAng: 0, vAng: 0, wAng: 0, coordinatesMode: 0 });

// The serialization of a PBRMaterial drawing a lightmap with the slot's material's surface.
function lightmapMaterial(scene, name, ma, { url, intensity, direct }) {
  const material = new PBRMaterial(name, scene), { color, roughness, metallic } = surface(ma);
  Object.assign(material, { metallic, roughness, environmentIntensity: 0, unlit: direct, useLightmapAsShadowmap: direct }).albedoColor.fromArray(color);
  const json = material.serialize();
  material.dispose();
  json.lightmapTexture = texture(`${name} lightmap`, url, intensity);
  return json;
}

/**
 * Draws each lightmapped mesh of a serialized scene (`json`) with its lightmap: a material of its own per slot, and, with
 * the scene's vertex data (`geometry`), its second UV set.
 */
export function writeLightmaps(world, json, lightmaps) {
  const { scene } = world, replaced = new Set();
  for (const [node, lightmap] of lightmaps) {
    const entry = json.meshes.find((m) => m.uniqueId === node.uniqueId), pointer = world.mainSync.objectOf(node);
    if (!entry) continue;
    replaced.add(entry.materialUniqueId);
    for (const id of json.multiMaterials.find((m) => m.uniqueId === entry.materialUniqueId)?.materialsUniqueIds ?? []) replaced.add(id);
    const slots = [...idStruct(pointer).material_slots].map((slot) => slot.material);
    const own = (ma, i) => {
      const made = { ...lightmapMaterial(scene, `${node.name} ${ma?.name ?? i} Lightmapped`, ma, lightmap), uniqueId: scene.getUniqueId() };
      made.id = made.name;
      json.materials.push(made);
      return made;
    };
    const multi = node.material instanceof MultiMaterial && json.multiMaterials.find((m) => m.uniqueId === entry.materialUniqueId);
    const subs = multi && slots.map(own), made = multi ? { ...multi, name: `${node.name} Lightmapped`, id: `${node.name} Lightmapped`, uniqueId: scene.getUniqueId(),
      materials: subs.map((m) => m.id), materialsUniqueIds: subs.map((m) => m.uniqueId) } : own(slots[0], 0);
    if (multi) json.multiMaterials.push(made);
    Object.assign(entry, { materialId: made.id, materialUniqueId: made.uniqueId });
    const vertexData = json.geometries?.vertexData?.find((g) => g.id === entry.geometryId);
    if (vertexData) vertexData.uvs2 = Array.from(lightmap.uv2);
  }
  // What only lightmapped meshes drew with goes.
  const used = new Set(json.meshes.map((m) => m.materialUniqueId));
  const unused = (m) => replaced.has(m.uniqueId) && !used.has(m.uniqueId);
  json.multiMaterials = json.multiMaterials.filter((m) => !unused(m));
  for (const m of json.multiMaterials) m.materialsUniqueIds?.forEach((id) => used.add(id));
  json.materials = json.materials.filter((m) => !unused(m));
}
