/* The edit mesh's arrays as Blender's draw cache extracts them from the BMesh (bmesh-api.cc), refilled by what changed
 * into buffers its context owns; JS reads the header and views the buffers in place. */
#pragma once

#include "BLI_vector.hh"
#include "bmesh.hh"
#include "DNA_mesh_types.h"

namespace blender {

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

}  // namespace blender
