// The mesh attributes Blender's shader nodes read (shader-nodes.js), as a Babylon mesh's draw buffers give them
// (mesh-batch-cache.js): each a vertex buffer of its own kind.

// The active UV map's tangents.
export const TANGENT_KIND = 'bl_tangent';

// A Blender attribute's Babylon vertex buffer kind: a GLSL name from it (Blender's GPU code names it by a hash too); the
// default color attribute's name is ':color'.
export function attributeKind(name) {
  let hash = 5381;
  for (const c of name) hash = (Math.imul(hash, 33) ^ c.codePointAt(0)) >>> 0;
  return `bl_attribute_${name.replace(/\W+/g, '_')}_${hash.toString(36)}`.replace(/_{2,}/g, '_');
}

// The geometry attributes a node material's nodes read (GPU_material_attributes), in order, each its name or `tangent`
// (the active UV map's), and its vertex buffer kind.
// Kept with the material until it builds again.
const READ = Symbol('read');
export function requestedAttributes(material) {
  if (!material?.attachedBlocks) return [];
  if (material[READ]?.build !== material.buildId) {
    material[READ] = { build: material.buildId, requests: material.attachedBlocks.filter((b) => b.blenderAttribute).map((b) => b.blenderAttribute) };
  }
  return material[READ].requests;
}

// What a Babylon mesh's materials read of its attributes: their names, and whether its tangents.
export function meshAttributes(babylonMesh) {
  const requests = (babylonMesh.material?.subMaterials ?? [babylonMesh.material]).flatMap(requestedAttributes);
  return { names: [...new Set(requests.filter((r) => !r.tangent).map((r) => r.name))], tangents: requests.some((r) => r.tangent) };
}
