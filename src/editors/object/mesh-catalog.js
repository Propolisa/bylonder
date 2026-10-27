import { Mesh, MeshBuilder, VertexData } from "@babylonjs/core";
import reflected from "./builder-schema.json" with { type: "json" };
import rna from "../../makesrna/rna-operators.json" with { type: "json" };
import { primitiveOperators, primitive_add } from "../mesh/editmesh-add.js";
import { mesh_batch_cache_apply } from "../../draw/mesh-batch-cache.js";
import { mesh_deserialize } from "../../blenkernel/mesh/mesh.js";

const n = (value, min = 0.01, max = 100, step = 0.1) => ({ default: value, min, max, step });
const detail = (value) => n(value, 3, 128, 1);
// Operator properties drawn by the Add panel (Blender draws align, location and rotation separately).
const PLACEMENT = ["align", "location", "rotation", "scale", "enter_editmode"];

// An operator's RNA properties as panel fields.
export function operatorSchema(idname) {
  const fields = Object.entries(rna[idname].properties).filter(([key, def]) => !def.hidden && !PLACEMENT.includes(key));
  return Object.fromEntries(fields.map(([key, def]) => [key, {
    label: def.name,
    default: def.default,
    ...(def.type === "ENUM" ? { options: Object.fromEntries(def.items.map(([id, name]) => [name, id])) } : {}),
    ...(def.type === "INT" || def.type === "FLOAT" ? { min: def.soft_min, max: def.soft_max, step: def.type === "INT" ? 1 : 0.1 } : {}),
  }]));
}
const operatorPreset = (preset) => ({ ...preset, title: rna[preset.blender].name.replace(/^Add /, ""), operator: preset.blender, schema: operatorSchema(preset.blender) });

// Add > Mesh in Blender's order. Entries with `operator` build Blender's exact primitive; the rest are Babylon
// builders standing in until their Blender operator is ported.
export const presets = [
  operatorPreset({ id: "plane", blender: "mesh.primitive_plane_add", icon: "mesh_plane" }),
  operatorPreset({ id: "box", blender: "mesh.primitive_cube_add", icon: "mesh_cube" }),
  operatorPreset({ id: "disc", blender: "mesh.primitive_circle_add", icon: "mesh_circle" }),
  operatorPreset({ id: "sphere", blender: "mesh.primitive_uv_sphere_add", icon: "mesh_uvsphere" }),
  operatorPreset({ id: "ico", blender: "mesh.primitive_ico_sphere_add", icon: "mesh_icosphere" }),
  operatorPreset({ id: "cylinder", blender: "mesh.primitive_cylinder_add", icon: "mesh_cylinder" }),
  operatorPreset({ id: "cone", blender: "mesh.primitive_cone_add", icon: "mesh_cone" }),
  operatorPreset({ id: "torus", blender: "mesh.primitive_torus_add", icon: "mesh_torus" }),
  operatorPreset({ id: "ground", blender: "mesh.primitive_grid_add", icon: "mesh_grid" }),
  operatorPreset({ id: "monkey", blender: "mesh.primitive_monkey_add", icon: "mesh_monkey" }),
  { id: "knot", group: "babylon", title: "Torus Knot", builder: "CreateTorusKnot", schema: { radius: n(1), tube: n(0.3), radialSegments: detail(64), tubularSegments: detail(32), p: n(2, 1, 12, 1), q: n(3, 1, 12, 1) } },
  { id: "capsule", group: "babylon", title: "Capsule", builder: "CreateCapsule", schema: { height: n(2), radius: n(0.5), tessellation: detail(24), subdivisions: n(2, 1, 32, 1) } },
  { id: "polyhedron", group: "babylon", title: "Polyhedron", builder: "CreatePolyhedron", schema: { type: { default: 0, options: { Tetrahedron: 0, Octahedron: 1, Dodecahedron: 2, Icosahedron: 3, Rhombicuboctahedron: 4 } }, size: n(1), flat: { default: true } } },
];

// Field types a builder or operator accepts, for validating meshTools() overrides.
function fieldType(preset, key) {
  if (preset.operator) {
    const def = rna[preset.operator].properties[key];
    return def && { INT: "number", FLOAT: "number", BOOLEAN: "boolean", ENUM: "string" }[def.type];
  }
  const field = reflected[preset.builder]?.fields[key];
  return ["number", "boolean", "string"].includes(field?.type) && field.type;
}

export function meshCatalog(config = {}) {
  return presets
    .filter((p) => !config.include || config.include.includes(p.id))
    .map((p) => {
      const schema = structuredClone(p.schema);
      for (const [key, def] of Object.entries(config.fields?.[p.id] || {})) schema[key] = { ...schema[key], ...def };
      for (const [key, value] of Object.entries(config.defaults?.[p.id] || {})) {
        if (!schema[key]) throw Error("Unknown preset field " + p.id + "." + key);
        schema[key].default = value;
      }
      for (const [key, def] of Object.entries(schema)) {
        const type = fieldType(p, key);
        if (!type) throw Error("Unsupported field " + (p.operator || p.builder) + "." + key);
        if (typeof def.default !== type) throw Error("Invalid default " + key);
      }
      return { ...p, schema };
    });
}

// A recipe is { mesh } for edited Mesh data, { operator, options } for Blender primitives or { builder, options }
// for Babylon builders.
const recipeMesh = (recipe) => {
  if (recipe.mesh) return mesh_deserialize(recipe.mesh);
  if (!primitiveOperators[recipe.operator]) throw Error("Unknown mesh operator");
  return primitive_add(recipe.operator, recipe.options);
};

export function buildMesh(scene, name, recipe) {
  if (recipe.mesh || recipe.operator) {
    const node = new Mesh(name, scene);
    mesh_batch_cache_apply(recipeMesh(recipe), node);
    return node;
  }
  const fn = MeshBuilder[recipe.builder];
  if (!fn || !reflected[recipe.builder]) throw Error("Unknown mesh builder");
  return fn(name, recipe.options, scene);
}

export function rebuildMesh(mesh, recipe) {
  if (recipe.mesh || recipe.operator) mesh_batch_cache_apply(recipeMesh(recipe), mesh);
  else {
    const temp = buildMesh(mesh.getScene(), "__previewGeometry", recipe);
    try {
      mesh.makeGeometryUnique();
      VertexData.ExtractFromMesh(temp).applyToMesh(mesh);
      mesh.refreshBoundingInfo();
    } finally {
      temp.dispose();
    }
  }
  mesh.metadata.wbCreation = { ...recipe };
}
export { reflected as builderSchema };
