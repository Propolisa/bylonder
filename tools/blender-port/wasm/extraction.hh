/* The edit mesh's arrays as Blender's draw cache extracts them from the BMesh (bmesh-api.cc), refilled by what changed
 * into buffers its context owns; JS reads the header and views the buffers in place. */
#pragma once

#include <string>

#include "BLI_span.hh"
#include "BLI_vector.hh"
#include "bmesh.hh"
#include "DNA_mesh_types.h"

namespace blender {

/* The UV map a material's image textures read with nothing linked into their Vector: the render one, as EEVEE's
 * (mesh_cd_calc_used_gpu_layers), else the active one. */
inline StringRef shading_uv_map_name(const Mesh &mesh)
{
  const StringRef render = mesh.default_uv_map_name();
  return render.is_empty() ? StringRef(mesh.active_or_default_uv_map_name()) : render;
}

/* The boolean attributes BM_mesh_bm_from_me reads and BM_mesh_bm_to_me writes. */
enum MeshFlag { SELECT_VERT, HIDE_VERT, SELECT_EDGE, HIDE_EDGE, UV_SEAM, SHARP_EDGE, SELECT_POLY, HIDE_POLY, SHARP_FACE, FLAGS_NUM };

/* What changed since the last extraction: topology (edges, faces and their corners, and everything with them),
 * positions (with normals and triangles), flags, or the UV map. */
enum ExtractFlag { EXTRACT_TOPOLOGY = 1, EXTRACT_POSITIONS = 2, EXTRACT_FLAGS = 4, EXTRACT_UV = 8 };

/* Read by JS as 32-bit words: the counts, then the buffers (null when absent). */
struct ExtractionHeader {
  int verts_num, edges_num, faces_num, corners_num, tris_num;
  float (*positions)[3], (*vert_normals)[3], (*face_normals)[3];
  int (*edges)[2], *face_offsets, *corner_verts, *corner_edges, (*corner_tris)[3], *tri_faces;
  float (*uvs)[2];
  bool *flags[FLAGS_NUM];
  /* An evaluated mesh's original vert, edge and face of each of its own (CD_ORIGINDEX, -1 for none), or null. */
  const int *orig_index[3];
};

struct Extraction {
  ExtractionHeader header = {};
  Vector<float3> positions, vert_normals, face_normals;
  Vector<int2> edges;
  Vector<int> face_offsets, corner_verts, corner_edges, tri_faces;
  Vector<int3> corner_tris;
  Vector<float2> uvs;
  Vector<bool> flags[FLAGS_NUM];
};

/* Refills what changed (ExtractFlag); a change of topology refills everything. */
void extraction_update(BMesh *bm, Extraction &extraction, int what);

/* Points the header at an evaluated Mesh's own arrays (the flags stay null: they exist in Edit Mode only). */
void mesh_extraction(const Mesh &mesh, ExtractionHeader &header);
/* What mesh_extraction keeps beside a header, freed with it. */
void extraction_free(const ExtractionHeader &header);
/* The Mesh the last mesh_extraction read (an evaluated Mesh, or the one its subdivision made). */
extern const Mesh *extracted_mesh;

/* A Mesh outside Main from the arrays bm_from_arrays takes; a UV map, when given, as Blender's default "UVMap". */
Mesh *mesh_from_arrays(int verts_num, const float3 *positions, int edges_num, const int2 *edges, int faces_num, const int *face_offsets,
                       const int *corner_verts, const int *corner_edges, const float2 *uvs);

struct Object;
struct Scene;

/* One draw buffer in module memory: its bytes, its type (a vertex buffer's gpu::VertAttrType, an index buffer's 16 or
 * 32 bits), the bytes of one element and how many elements it has. */
struct DrawBuffer {
  const void *data;
  int bytes, type, stride, count;
};
/* Read by JS as 32-bit words: a mesh's draw buffers (draw-mesh.cc), absent ones empty, its triangles by material, and
 * the generic attributes asked for, in the order asked (an attribute's type is its component count, plus 16 for
 * unsigned and 32 for signed normalized 16-bit components). */
struct DrawBuffers {
  DrawBuffer positions, normals, uvs, tris, lines, lines_adjacency, tangents;
  int materials_num;
  const int *tris_by_material;
  int attributes_num;
  const DrawBuffer *attributes;
};
/* The index buffers drawn on demand besides the triangles: the face edges (Wireframe) and the edges with their
 * adjacent corners (the outline). */
enum DrawRequest { DRAW_LINES = 1, DRAW_LINES_ADJACENCY = 2, DRAW_TANGENTS = 4 };

/* A mesh object's draw buffers as Blender's draw cache extracts them, valid until the next call or draw_buffers_free. */
const DrawBuffers *mesh_draw_buffers(const Scene &scene, Object &object, Mesh &mesh, int what, Span<std::string> attributes = {});
void draw_buffers_free();

}  // namespace blender
