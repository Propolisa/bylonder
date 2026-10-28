import { createMesh, createPrimitive, addModifier, shadeSmooth } from '@workbench/sdk';

// Machined parts. Profiles and outlines are Mesh data in Blender's axes (Z up); Blender's modifiers give them depth,
// rounded edges and smooth surfaces, as a modeler would in Blender.

// A part turned on a lathe: a profile of [radius, height] points revolved by Screw.
export function turned(name, profile, scene, { steps = 64, levels = 1 } = {}) {
  const mesh = createMesh(name, { vertices: profile.map(([r, z]) => [r, 0, z]), edges: profile.slice(1).map((_, i) => [i, i + 1]) }, scene);
  addModifier(mesh, 'SCREW', { steps, render_steps: steps, use_merge_vertices: true, use_normal_calculate: true });
  if (levels) addModifier(mesh, 'SUBSURF', { levels, render_levels: levels });
  return mesh;
}

// A ring of rectangular section: a square outline revolved by Screw, its edges rounded by Bevel.
export function ring(name, radius, width, thickness, scene) {
  const r0 = radius - width / 2, r1 = radius + width / 2, h = thickness / 2;
  const mesh = createMesh(name, { vertices: [[r0, 0, -h], [r1, 0, -h], [r1, 0, h], [r0, 0, h]], edges: [[0, 1], [1, 2], [2, 3], [3, 0]] }, scene);
  addModifier(mesh, 'SCREW', { steps: 96, render_steps: 96, use_merge_vertices: true, use_normal_calculate: true });
  addModifier(mesh, 'BEVEL', { width: Math.min(width, thickness) * 0.18, segments: 2, limit_method: 'ANGLE' });
  return mesh;
}

// A spur gear: its outline is one n-gon face, Solidify gives it thickness and Bevel chamfers the teeth.
export function gear(name, { teeth, radius, thickness = 0.012, depth = 0.012 }, scene) {
  const outline = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, pitch = (Math.PI * 2) / teeth;
    for (const [t, r] of [[0, radius - depth], [0.18, radius - depth], [0.32, radius], [0.68, radius], [0.82, radius - depth]]) {
      outline.push([Math.cos(a + t * pitch) * r, Math.sin(a + t * pitch) * r, 0]);
    }
  }
  const mesh = createMesh(name, { vertices: outline, faces: [outline.map((_, i) => i)] }, scene);
  addModifier(mesh, 'SOLIDIFY', { thickness, offset: 0, use_even_offset: true });
  addModifier(mesh, 'BEVEL', { width: thickness * 0.12, segments: 1, limit_method: 'ANGLE' });
  return mesh;
}

// A box of width x height x depth standing on its base, its edges rounded by Bevel.
export function slab(name, [width, height, depth], scene, { bevel = 0.01, segments = 3 } = {}) {
  const x = width / 2, y = depth / 2, corners = [];
  for (const z of [0, height]) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) corners.push([sx * x, sy * y, z]);
  const box = createMesh(name, { vertices: corners, faces: [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] }, scene);
  addModifier(box, 'BEVEL', { width: bevel, segments, limit_method: 'NONE' });
  return box;
}

// A ball: Blender's UV Sphere, smooth shaded.
export const ball = (name, radius, scene, segments = 48) => shadeSmooth(createPrimitive(name, 'mesh.primitive_uv_sphere_add', { radius, segments, ring_count: segments / 2 }, scene));

// A rod: Blender's Cylinder, centered on its origin.
export const rod = (name, radius, length, scene) => shadeSmooth(createPrimitive(name, 'mesh.primitive_cylinder_add', { vertices: 16, radius, depth: length }, scene));
