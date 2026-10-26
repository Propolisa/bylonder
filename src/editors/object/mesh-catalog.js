import { MeshBuilder, VertexData } from "@babylonjs/core";
import reflected from "./builder-schema.json" with { type: "json" };
const n = (value, min = 0.01, max = 100, step = 0.1) => ({
  default: value,
  min,
  max,
  step,
});
const sides = { default: 0, options: { Front: 0, Back: 1, Double: 2 } };
const detail = (value) => n(value, 3, 128, 1);
export const presets = [
  {
    id: "box",
    blender: "mesh.primitive_cube_add",
    title: "Cube",
    builder: "CreateBox",
    schema: { width: n(2), height: n(2), depth: n(2) },
  },
  {
    id: "sphere",
    blender: "mesh.primitive_uv_sphere_add",
    title: "UV Sphere",
    builder: "CreateSphere",
    schema: {
      diameter: n(2),
      segments: detail(32),
      arc: n(1, 0.01, 1, 0.01),
      slice: n(1, 0.01, 1, 0.01),
    },
  },
  {
    id: "ico",
    blender: "mesh.primitive_ico_sphere_add",
    title: "Icosphere",
    builder: "CreateIcoSphere",
    schema: {
      radius: n(1),
      subdivisions: n(4, 1, 16, 1),
      flat: { default: true },
    },
  },
  {
    id: "cylinder",
    blender: "mesh.primitive_cylinder_add",
    title: "Cylinder",
    builder: "CreateCylinder",
    schema: {
      height: n(2),
      diameterTop: n(2, 0),
      diameterBottom: n(2),
      tessellation: detail(32),
      subdivisions: n(1, 1, 64, 1),
    },
  },
  {
    id: "cone",
    blender: "mesh.primitive_cone_add",
    title: "Cone",
    builder: "CreateCylinder",
    schema: {
      height: n(2),
      diameterTop: n(0, 0),
      diameterBottom: n(2),
      tessellation: detail(32),
    },
  },
  {
    id: "torus",
    blender: "mesh.primitive_torus_add",
    title: "Torus",
    builder: "CreateTorus",
    schema: { diameter: n(2), thickness: n(0.5), tessellation: detail(48) },
  },
  {
    id: "knot",
    title: "Torus Knot",
    builder: "CreateTorusKnot",
    schema: {
      radius: n(1),
      tube: n(0.3),
      radialSegments: detail(64),
      tubularSegments: detail(32),
      p: n(2, 1, 12, 1),
      q: n(3, 1, 12, 1),
    },
  },
  {
    id: "plane",
    blender: "mesh.primitive_plane_add",
    title: "Plane",
    builder: "CreatePlane",
    schema: { width: n(2), height: n(2), sideOrientation: sides },
  },
  {
    id: "ground",
    blender: "mesh.primitive_grid_add",
    title: "Ground",
    builder: "CreateGround",
    schema: { width: n(6), height: n(6), subdivisions: n(1, 1, 64, 1) },
  },
  {
    id: "disc",
    blender: "mesh.primitive_circle_add",
    title: "Disc",
    builder: "CreateDisc",
    schema: {
      radius: n(1),
      tessellation: detail(48),
      arc: n(1, 0.01, 1, 0.01),
      sideOrientation: sides,
    },
  },
  {
    id: "capsule",
    title: "Capsule",
    builder: "CreateCapsule",
    schema: {
      height: n(2),
      radius: n(0.5),
      tessellation: detail(24),
      subdivisions: n(2, 1, 32, 1),
    },
  },
  {
    id: "polyhedron",
    title: "Polyhedron",
    builder: "CreatePolyhedron",
    schema: {
      type: {
        default: 0,
        options: {
          Tetrahedron: 0,
          Octahedron: 1,
          Dodecahedron: 2,
          Icosahedron: 3,
          Rhombicuboctahedron: 4,
        },
      },
      size: n(1),
      flat: { default: true },
    },
  },
];
export function meshCatalog(config = {}) {
  return presets
    .filter((p) => !config.include || config.include.includes(p.id))
    .map((p) => {
      const schema = structuredClone(p.schema);
      for (const [key, def] of Object.entries(config.fields?.[p.id] || {}))
        schema[key] = { ...schema[key], ...def };
      for (const [key, value] of Object.entries(
        config.defaults?.[p.id] || {},
      )) {
        if (!schema[key])
          throw Error("Unknown preset field " + p.id + "." + key);
        schema[key].default = value;
      }
      for (const [key, def] of Object.entries(schema)) {
        const field = reflected[p.builder]?.fields[key];
        if (!field || !["number", "boolean", "string"].includes(field.type))
          throw Error("Unsupported builder field " + p.builder + "." + key);
        if (typeof def.default !== field.type)
          throw Error("Invalid default " + key);
      }
      return { ...p, schema };
    });
}
export function buildMesh(scene, name, recipe) {
  const fn = MeshBuilder[recipe.builder];
  if (!fn || !reflected[recipe.builder]) throw Error("Unknown mesh builder");
  return fn(name, recipe.options, scene);
}
export function rebuildMesh(mesh, recipe) {
  const temp = buildMesh(mesh.getScene(), "__previewGeometry", recipe);
  try {
    mesh.makeGeometryUnique();
    VertexData.ExtractFromMesh(temp).applyToMesh(mesh);
    mesh.refreshBoundingInfo();
    mesh.metadata.wbCreation = { ...recipe };
  } finally {
    temp.dispose();
  }
}
export { reflected as builderSchema };
