// Outlines of selected objects (overlay_outline.hh, overlay_outline_prepass_vert.glsl,
// overlay_outline_prepass_wire_vert.glsl, overlay_outline_detect_frag.glsl, overlay_antialiasing.bsl.hh): a prepass
// renders the outlined meshes' ids and depth, the detect pass finds the pixels where the id changes and writes each
// one's color and line, and the anti-aliasing pass draws those lines over the view at a constant pixel width, dimmed
// where the scene hides them. With X-ray the prepass draws each mesh's silhouette edges instead of its faces.
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { MultiRenderTarget } from '@babylonjs/core/Materials/Textures/multiRenderTarget.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { view_3d as theme } from '../editors/interface/userdef-default-theme.js';
import { mesh_batch_cache_edge_detection } from './mesh-batch-cache.js';
import { createFullscreenPass } from './fullscreen-pass.js';

// Replaces the top 2 bits (of 16) by the color id, leaving 16K ids to outline objects against each other.
const outline_id_pack = (outline_id, object_id) => (outline_id << 14) | (object_id & 0x3fff);
const outline_colorid_get = (is_transform, is_active) => (is_transform ? 0 : is_active ? 3 : 1);
// Above every camera's layers: the silhouette edges draw in the prepass only.
const PREPASS_ONLY = 0x10000000;

const PREPASS_VERTEX = `precision highp float;
attribute vec3 position;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<instancesDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
uniform mat4 viewProjection;
void main() {
  vec3 positionUpdated = position;
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
  gl_Position = viewProjection * finalWorld * vec4(positionUpdated, 1.0);
  /* Small bias to always be on top of the geom. */
  gl_Position.z -= 1e-3;
}`;

// Each line vertex carries its edge's four corners (a line adjacency primitive) and draws when the edge is a
// silhouette. Babylon's view space looks down +Z, so the incident vector of an orthographic view is -Z. The lines take
// their mesh's world matrix and thin instances; bones and morph targets do not move them.
const PREPASS_WIRE_VERTEX = `precision highp float;
attribute vec3 position;
attribute vec3 adjacency0;
attribute vec3 adjacency1;
attribute vec3 adjacency2;
attribute vec3 adjacency3;
#include<instancesDeclaration>
uniform mat4 view;
uniform mat4 projection;
uniform mat4 viewProjection;
float safe_rcp(float a) { return a != 0.0 ? 1.0 / a : 0.0; }
vec3 drw_point_world_to_view(mat4 finalWorld, vec3 p) { return (view * finalWorld * vec4(p, 1.0)).xyz; }
vec3 drw_view_incident_vector(vec3 P) { return projection[3][3] == 0.0 ? normalize(-P) : vec3(0.0, 0.0, -1.0); }
void main() {
#include<instancesVertex>
  vec3 vs_P0 = drw_point_world_to_view(finalWorld, adjacency0), vs_P1 = drw_point_world_to_view(finalWorld, adjacency1);
  vec3 vs_P2 = drw_point_world_to_view(finalWorld, adjacency2), vs_P3 = drw_point_world_to_view(finalWorld, adjacency3);
  vec3 view_vec = -drw_view_incident_vector(vs_P1);
  vec3 v10 = vs_P0 - vs_P1;
  vec3 v12 = vs_P2 - vs_P1;
  vec3 v13 = vs_P3 - vs_P1;
  vec3 n0 = cross(v12, v10);
  n0 *= safe_rcp(length(n0));
  vec3 n3 = cross(v13, v12);
  n3 *= safe_rcp(length(n3));
  float fac0 = dot(view_vec, n0);
  float fac3 = dot(view_vec, n3);
  /* If one of the face is perpendicular to the view, consider it an outline edge.
   * If both adjacent verts are facing the camera the same way, then it isn't an outline edge. */
  if (abs(fac0) > 1e-5 && abs(fac3) > 1e-5 && sign(fac0) == sign(fac3)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
  gl_Position.z -= 1e-3;
}`;

// The id, and the depth Blender keeps in the prepass's depth attachment.
const PREPASS_FRAGMENT = `precision highp float;
uniform float ob_id;
layout(location = 0) out vec4 out_object_id;
void main() { out_object_id = vec4(ob_id, gl_FragCoord.z, 0.0, 0.0); }`;

// Without textureGather (Blender's #else path). Reads stay inside the view's region; the line data's alpha holds the
// outline's depth for the anti-aliasing pass, which tests it against the scene's.
const DETECT_FRAGMENT = `precision highp float;
precision highp int;
uniform sampler2D outline_id_tx;
uniform vec2 size_viewport;
uniform vec4 region;
uniform bool do_thick_outlines;
uniform bool do_anti_aliasing;
uniform bool is_xray_wires;
uniform vec4 colors_object_select;
uniform vec4 colors_active_object;
uniform vec4 colors_transform;
layout(location = 0) out vec4 frag_color;
layout(location = 1) out vec4 line_output;

#define XPOS (1 << 0)
#define XNEG (1 << 1)
#define YPOS (1 << 2)
#define YNEG (1 << 3)
#define ALL (XPOS | XNEG | YPOS | YNEG)
#define NONE 0
#define DIAG_XNEG_YPOS (XNEG | YPOS)
#define DIAG_XPOS_YPOS (XPOS | YPOS)
#define DIAG_XPOS_YNEG (XPOS | YNEG)
#define DIAG_XNEG_YNEG (XNEG | YNEG)
#define APEX_XPOS (ALL & (~XPOS))
#define APEX_XNEG (ALL & (~XNEG))
#define APEX_YPOS (ALL & (~YPOS))
#define APEX_YNEG (ALL & (~YNEG))

vec4 outline_texel(vec2 uv) {
  ivec2 p = clamp(ivec2(floor(uv * size_viewport)), ivec2(region.xy), ivec2(region.zw));
  return texelFetch(outline_id_tx, p, 0);
}
uint outline_id(vec2 uv) { return uint(outline_texel(uv).r + 0.5); }

bool has_edge(uint id, vec2 uv, uint ref, inout uint ref_col, inout vec2 depth_uv)
{
  if (ref_col == 0u) {
    /* Make outline bleed on the background. */
    ref_col = id;
    depth_uv = uv;
  }
  return (id != ref);
}

bvec4 gather_edges(vec2 uv, uint ref)
{
  uvec4 ids;
  vec3 ofs = vec3(0.5, 0.5, -0.5) * (1.0 / size_viewport).xyy;
  ids.x = outline_id(uv - ofs.xz);
  ids.y = outline_id(uv + ofs.xy);
  ids.z = outline_id(uv + ofs.xz);
  ids.w = outline_id(uv - ofs.xy);
  return notEqual(ids, uvec4(ref));
}

/* Clockwise */
vec2 rotate_90(vec2 v) { return vec2(v.y, -v.x); }
vec2 rotate_180(vec2 v) { return vec2(-v.x, -v.y); }
vec2 rotate_270(vec2 v) { return vec2(-v.y, v.x); }
/* Counter-Clockwise */
bvec4 rotate_90(bvec4 v) { return v.yzwx; }
bvec4 rotate_180(bvec4 v) { return v.zwxy; }
bvec4 rotate_270(bvec4 v) { return v.wxyz; }

/* Apply offset to line endpoint based on surrounding edges infos. */
bool line_offset(bvec2 edges, vec2 ofs, inout vec2 line_point)
{
  if (all(edges.xy)) {
    line_point.y -= ofs.y;
  }
  else if (!edges.x) {
    line_point.y += ofs.y;
  }
  else /* !edges.y */ {
    line_point.x += ofs.x;
    return true;
  }
  return false;
}

/* Changes Anti-aliasing pattern and makes line thicker. 0.0 is thin. */
#define PROXIMITY_OFS -0.35

/* Use surrounding edges to approximate the outline direction to create smooth lines. */
void straight_line_dir(bvec4 edges1, bvec4 edges2, out vec2 line_start, out vec2 line_end)
{
  /* Y_POS as reference. Other cases are rotated to match reference. */
  line_end = vec2(1.5, 0.5 + PROXIMITY_OFS);
  line_start = vec2(-line_end.x, line_end.y);
  vec2 line_ofs = vec2(1.0, 0.5);
  if (line_offset(edges1.xw, line_ofs, line_end)) {
    line_offset(edges1.yz, line_ofs, line_end);
  }
  line_ofs = vec2(-line_ofs.x, line_ofs.y);
  if (line_offset(edges2.yz, line_ofs, line_start)) {
    line_offset(edges2.xw, line_ofs, line_start);
  }
}

vec2 diag_offset(bvec4 edges)
{
  /* X_NEG | Y_POS as reference. Other cases are rotated to match reference.
   * So the line is coming from bottom left. */
  if (all(edges.wz)) {
    /* Horizontal line. */
    return vec2(2.5, 0.5);
  }
  else if (all(not(edges.xw))) {
    /* Vertical line. */
    return vec2(0.5, 2.5);
  }
  else if (edges.w) {
    /* Less horizontal Line. */
    return vec2(2.5, 0.5);
  }
  else {
    /* Less vertical Line. */
    return vec2(0.5, 2.5);
  }
}

/* Compute line direction vector from the bottom left corner. */
void diag_dir(bvec4 edges1, bvec4 edges2, out vec2 line_start, out vec2 line_end)
{
  /* Negate instead of rotating back the result of diag_offset. */
  edges2 = not(edges2);
  edges2 = rotate_180(edges2);
  line_end = diag_offset(edges1);
  line_end += diag_offset(edges2);
  if (line_end.x == line_end.y) {
    /* Perfect diagonal line. Push line start towards edge. */
    line_start = vec2(-1.0, 1.0) * PROXIMITY_OFS * 0.4;
  }
  else if (line_end.x > line_end.y) {
    /* Horizontal Line. Lower line start. */
    line_start = vec2(0.0, PROXIMITY_OFS);
  }
  else {
    /* Vertical Line. Push line start to the right. */
    line_start = -vec2(PROXIMITY_OFS, 0.0);
  }
  line_end += line_start;
}

/* overlay_common_lib.glsl */
vec4 pack_line_data(vec2 frag_co, vec2 edge_start, vec2 edge_pos)
{
  vec2 edge = edge_start - edge_pos;
  float len = length(edge);
  if (len > 0.0) {
    edge /= len;
    vec2 perp = vec2(-edge.y, edge.x);
    float dist = dot(perp, frag_co - edge_start);
    /* Add 0.1f to differentiate with cleared pixels. */
    return vec4(perp * 0.5 + 0.5, dist * 0.25 + 0.5 + 0.1, 1.0);
  }
  else {
    /* Default line if the origin is perfectly aligned with a pixel. */
    return vec4(1.0, 0.0, 0.5 + 0.1, 1.0);
  }
}

void main()
{
  vec2 size_viewport_inv = 1.0 / size_viewport;
  vec2 uvs = gl_FragCoord.xy * size_viewport_inv;
  uint ref = outline_id(uvs);
  uint ref_col = ref;
  vec3 ofs = vec3(size_viewport_inv, 0.0);

  vec2 depth_uv = uvs;

  uvec4 ids;
  ids.x = outline_id(uvs + ofs.xz);
  ids.y = outline_id(uvs - ofs.xz);
  ids.z = outline_id(uvs + ofs.zy);
  ids.w = outline_id(uvs - ofs.zy);

  bool has_edge_pos_x = has_edge(ids.x, uvs + ofs.xz, ref, ref_col, depth_uv);
  bool has_edge_neg_x = has_edge(ids.y, uvs - ofs.xz, ref, ref_col, depth_uv);
  bool has_edge_pos_y = has_edge(ids.z, uvs + ofs.zy, ref, ref_col, depth_uv);
  bool has_edge_neg_y = has_edge(ids.w, uvs - ofs.zy, ref, ref_col, depth_uv);

  if (do_thick_outlines) {
    if (!any(bvec4(has_edge_pos_x, has_edge_neg_x, has_edge_pos_y, has_edge_neg_y))) {
      ids.x = outline_id(uvs + 2.0 * ofs.xz);
      ids.y = outline_id(uvs - 2.0 * ofs.xz);
      ids.z = outline_id(uvs + 2.0 * ofs.zy);
      ids.w = outline_id(uvs - 2.0 * ofs.zy);

      has_edge_pos_x = has_edge(ids.x, uvs + 2.0 * ofs.xz, ref, ref_col, depth_uv);
      has_edge_neg_x = has_edge(ids.y, uvs - 2.0 * ofs.xz, ref, ref_col, depth_uv);
      has_edge_pos_y = has_edge(ids.z, uvs + 2.0 * ofs.zy, ref, ref_col, depth_uv);
      has_edge_neg_y = has_edge(ids.w, uvs - 2.0 * ofs.zy, ref, ref_col, depth_uv);
    }
  }

  if (is_xray_wires) {
    /* Don't inflate the wire outlines too much. */
    has_edge_neg_x = has_edge_neg_y = false;
  }

  /* WATCH: Keep in sync with outline_id_tx of the pre-pass. */
  uint color_id = ref_col >> 14u;
  if (ref_col == 0u) {
    frag_color = vec4(0.0);
  }
  else if (color_id == 1u) {
    frag_color = colors_object_select;
  }
  else if (color_id == 3u) {
    frag_color = colors_active_object;
  }
  else {
    frag_color = colors_transform;
  }

  float ref_depth = outline_texel(depth_uv).g;

  /* NOTE: We never set alpha to 1.0 to avoid Anti-aliasing destroying the line. */
  frag_color *= 254.0 / 255.0;

  int edge_case = 0;
  edge_case += int(has_edge_pos_x) * XPOS;
  edge_case += int(has_edge_neg_x) * XNEG;
  edge_case += int(has_edge_pos_y) * YPOS;
  edge_case += int(has_edge_neg_y) * YNEG;

  if (edge_case == ALL || edge_case == NONE) {
    frag_color = vec4(0.0);
    line_output = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  if (!do_anti_aliasing) {
    line_output = vec4(0.0, 0.0, 0.0, ref_depth);
    return;
  }

  vec2 line_start, line_end;
  bvec4 extra_edges, extra_edges2;
  /* Straight lines. */
  if (edge_case == YPOS) {
    extra_edges = gather_edges(uvs + size_viewport_inv * vec2(2.5, 0.5), ref);
    extra_edges2 = gather_edges(uvs + size_viewport_inv * vec2(-2.5, 0.5), ref);
    straight_line_dir(extra_edges, extra_edges2, line_start, line_end);
  }
  else if (edge_case == YNEG) {
    extra_edges = gather_edges(uvs + size_viewport_inv * vec2(-2.5, -0.5), ref);
    extra_edges2 = gather_edges(uvs + size_viewport_inv * vec2(2.5, -0.5), ref);
    extra_edges = rotate_180(extra_edges);
    extra_edges2 = rotate_180(extra_edges2);
    straight_line_dir(extra_edges, extra_edges2, line_start, line_end);
    line_start = rotate_180(line_start);
    line_end = rotate_180(line_end);
  }
  else if (edge_case == XPOS) {
    extra_edges = gather_edges(uvs + size_viewport_inv * vec2(0.5, 2.5), ref);
    extra_edges2 = gather_edges(uvs + size_viewport_inv * vec2(0.5, -2.5), ref);
    extra_edges = rotate_90(extra_edges);
    extra_edges2 = rotate_90(extra_edges2);
    straight_line_dir(extra_edges, extra_edges2, line_start, line_end);
    line_start = rotate_90(line_start);
    line_end = rotate_90(line_end);
  }
  else if (edge_case == XNEG) {
    extra_edges = gather_edges(uvs + size_viewport_inv * vec2(-0.5, 2.5), ref);
    extra_edges2 = gather_edges(uvs + size_viewport_inv * vec2(-0.5, -2.5), ref);
    extra_edges = rotate_270(extra_edges);
    extra_edges2 = rotate_270(extra_edges2);
    straight_line_dir(extra_edges, extra_edges2, line_start, line_end);
    line_start = rotate_270(line_start);
    line_end = rotate_270(line_end);
  }
  /* Diagonal */
  else if (edge_case == DIAG_XNEG_YPOS) {
    extra_edges = gather_edges(uvs + ofs.xy * vec2(1.5), ref);
    extra_edges2 = gather_edges(uvs + ofs.xy * vec2(-1.5), ref);
    diag_dir(extra_edges, extra_edges2, line_start, line_end);
  }
  else if (edge_case == DIAG_XPOS_YNEG) {
    extra_edges = gather_edges(uvs - ofs.xy * vec2(1.5), ref);
    extra_edges2 = gather_edges(uvs - ofs.xy * vec2(-1.5), ref);
    extra_edges = rotate_180(extra_edges);
    extra_edges2 = rotate_180(extra_edges2);
    diag_dir(extra_edges, extra_edges2, line_start, line_end);
    line_start = rotate_180(line_start);
    line_end = rotate_180(line_end);
  }
  else if (edge_case == DIAG_XPOS_YPOS) {
    extra_edges = gather_edges(uvs + ofs.xy * vec2(1.5, -1.5), ref);
    extra_edges2 = gather_edges(uvs - ofs.xy * vec2(1.5, -1.5), ref);
    extra_edges = rotate_90(extra_edges);
    extra_edges2 = rotate_90(extra_edges2);
    diag_dir(extra_edges, extra_edges2, line_start, line_end);
    line_start = rotate_90(line_start);
    line_end = rotate_90(line_end);
  }
  else if (edge_case == DIAG_XNEG_YNEG) {
    extra_edges = gather_edges(uvs - ofs.xy * vec2(1.5, -1.5), ref);
    extra_edges2 = gather_edges(uvs + ofs.xy * vec2(1.5, -1.5), ref);
    extra_edges = rotate_270(extra_edges);
    extra_edges2 = rotate_270(extra_edges2);
    diag_dir(extra_edges, extra_edges2, line_start, line_end);
    line_start = rotate_270(line_start);
    line_end = rotate_270(line_end);
  }
  /* Apex */
  else if (edge_case == APEX_XPOS || edge_case == APEX_XNEG) {
    line_start = vec2(-0.5, 0.0);
    line_end = vec2(0.5, 0.0);
  }
  else if (edge_case == APEX_YPOS || edge_case == APEX_YNEG) {
    line_start = vec2(0.0, -0.5);
    line_end = vec2(0.0, 0.5);
  }
  else {
    line_start = vec2(0.0);
    line_end = vec2(0.0);
  }

  line_output = vec4(pack_line_data(vec2(0.0), line_start, line_end).rgb, ref_depth);
}`;

// Reads the detect pass's color and line data in place of overlay_tx and line_tx, and the outline's depth in place of
// the scene's; draws once where that depth passes the scene's depth test and once, dimmed, where it fails.
const ANTI_ALIASING_FRAGMENT = `precision highp float;
precision highp int;
uniform sampler2D color_tx;
uniform sampler2D line_tx;
uniform vec4 region;
uniform bool do_smooth_lines;
uniform float sizes_pixel;
uniform float alpha_occlu;
layout(location = 0) out vec4 frag_color;

#define M_1_SQRTPI 0.5641895835477563
#define DISC_RADIUS (M_1_SQRTPI * 1.05)
#define LINE_SMOOTH_START (0.5 - DISC_RADIUS)
#define LINE_SMOOTH_END (0.5 + DISC_RADIUS)

struct Line {
  vec2 dir;
  float dist;
  float dist_raw;
};
Line line_decode(vec3 data) { return Line(data.xy * 2.0 - 1.0, (data.z - 0.1) * 4.0 - 2.0, data.z); }
bool line_is_valid(Line line) { return line.dist_raw != 0.0; }

struct TexelData {
  vec4 color;
  float depth;
  Line line;
};
TexelData fetch_texel(ivec2 texel, ivec2 offset)
{
  ivec2 texel_actual = clamp(texel + offset, ivec2(region.xy), ivec2(region.zw));
  vec4 line = texelFetch(line_tx, texel_actual, 0);
  return TexelData(texelFetch(color_tx, texel_actual, 0), line.a, line_decode(line.rgb));
}

/* smoothstep(LINE_SMOOTH_END, LINE_SMOOTH_START, x), whose reversed edges GLSL leaves undefined. */
float line_coverage(float distance_to_line, float line_kernel_size, bool do_smooth_lines)
{
  if (do_smooth_lines) {
    return 1.0 - smoothstep(LINE_SMOOTH_START, LINE_SMOOTH_END, abs(distance_to_line) - line_kernel_size);
  }
  return step(-0.5, line_kernel_size - abs(distance_to_line));
}
vec4 line_coverage(vec4 distance_to_line, float line_kernel_size, bool do_smooth_lines)
{
  if (do_smooth_lines) {
    return 1.0 - smoothstep(LINE_SMOOTH_START, LINE_SMOOTH_END, abs(distance_to_line) - line_kernel_size);
  }
  return step(-0.5, line_kernel_size - abs(distance_to_line));
}

float neighbor_dist(TexelData neighbor, ivec2 offset)
{
  bool is_dir_horizontal = abs(neighbor.line.dir.x) > abs(neighbor.line.dir.y);
  bool is_ofs_horizontal = offset.x != 0;
  if (!line_is_valid(neighbor.line) || is_ofs_horizontal != is_dir_horizontal) {
    return 1e10; /* No line. */
  }
  /* Add projection of the line direction onto a unit vector. */
  return neighbor.line.dist + dot(vec2(offset), -neighbor.line.dir);
}

void neighbor_blend(TexelData neighbor, inout TexelData target, float line_coverage)
{
  neighbor.color *= line_coverage;
  if (line_coverage > 0.0 && neighbor.depth < target.depth) {
    /* Alpha over blending, and update to new closest target depth. */
    target.color = neighbor.color + target.color * (1.0 - neighbor.color.a);
    target.depth = neighbor.depth;
  }
  else {
    /* Alpha under blending */
    target.color = target.color + neighbor.color * (1.0 - target.color.a);
  }
}

vec4 anti_aliasing(inout TexelData center, ivec2 texel)
{
  bool original_center_has_alpha = center.color.a < 1.0;
  if (!do_smooth_lines && center.line.dist <= 1.0) {
    return center.color;
  }
  TexelData neighbors[4];
  neighbors[0] = fetch_texel(texel, ivec2(1, 0));
  neighbors[1] = fetch_texel(texel, ivec2(-1, 0));
  neighbors[2] = fetch_texel(texel, ivec2(0, 1));
  neighbors[3] = fetch_texel(texel, ivec2(0, -1));
  vec4 neighbor_dists = vec4(neighbor_dist(neighbors[0], ivec2(1, 0)),
                             neighbor_dist(neighbors[1], ivec2(-1, 0)),
                             neighbor_dist(neighbors[2], ivec2(0, 1)),
                             neighbor_dist(neighbors[3], ivec2(0, -1)));
  float line_kernel = sizes_pixel * 0.5 - 0.5;
  vec4 coverage = line_coverage(neighbor_dists, line_kernel, do_smooth_lines);
  if (line_is_valid(center.line)) {
    center.color *= line_coverage(center.line.dist, line_kernel, do_smooth_lines);
  }
  neighbor_blend(neighbors[0], center, coverage.x);
  neighbor_blend(neighbors[1], center, coverage.y);
  neighbor_blend(neighbors[2], center, coverage.z);
  neighbor_blend(neighbors[3], center, coverage.w);
  /* Fix aliasing issue with really dense meshes and 1 pixel sized lines. */
  if (!original_center_has_alpha && line_is_valid(center.line) && line_kernel < 0.45) {
    vec4 lines_raw = vec4(neighbors[0].line.dist_raw,
                          neighbors[1].line.dist_raw,
                          neighbors[2].line.dist_raw,
                          neighbors[3].line.dist_raw);
    float blend = dot(vec4(0.25), step(1e-2, lines_raw));
    /* Only do blend if there are more than 2 neighbors, to avoid losing too much AA. */
    blend = clamp(blend * 2.0 - 1.0, 0.0, 1.0);
    center.color = mix(center.color, center.color / center.color.a, blend);
  }
  return center.color;
}

void main()
{
  ivec2 texel = ivec2(gl_FragCoord.xy);
  TexelData center = fetch_texel(texel, ivec2(0));
  vec4 color = anti_aliasing(center, texel);
  if (color.a <= 0.0) {
    discard;
  }
  frag_color = color * alpha_occlu;
  gl_FragDepth = center.depth;
}`;

//   outlined() -> the meshes to outline (selection.outlined), isActive(mesh) -> whether it is the active object,
//   isTransform() -> whether objects are being transformed
export function createOutlineOverlay(scene, { outlined, isActive, isTransform = () => false }) {
  const engine = scene.getEngine(), pass = createFullscreenPass(engine);
  const prepassTarget = new RenderTargetTexture('__outlinePrepass', pass.size, scene, {
    generateMipMaps: false, type: Constants.TEXTURETYPE_FLOAT, format: Constants.TEXTUREFORMAT_RG,
    samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE, generateDepthBuffer: true, generateStencilBuffer: false,
  });
  Object.assign(prepassTarget, { clearColor: new Color4(0, 1, 0, 0), renderParticles: false, renderSprites: false, renderList: [] });
  const lineTarget = new MultiRenderTarget('__outlineLines', pass.size, 2, scene, {
    generateMipMaps: false, generateDepthBuffer: false, types: [Constants.TEXTURETYPE_UNSIGNED_BYTE, Constants.TEXTURETYPE_FLOAT],
    samplingModes: [Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURE_NEAREST_SAMPLINGMODE],
  });

  const ids = new Map(); // mesh drawn in the prepass -> its packed id
  const prepassMaterial = (name, vertexSource, attributes, uniforms) => {
    const material = new ShaderMaterial(name, scene, { vertexSource, fragmentSource: PREPASS_FRAGMENT }, { attributes, uniforms: [...uniforms, 'ob_id'] });
    material.backFaceCulling = false;
    material.onBindObservable.add((mesh) => material.getEffect().setFloat('ob_id', ids.get(mesh) ?? 0));
    return material;
  };
  const surface = prepassMaterial('__outlinePrepassMesh', PREPASS_VERTEX, ['position'], [
    'world', 'viewProjection', 'mBones', 'morphTargetInfluences', 'morphTargetCount', 'morphTargetTextureInfo', 'morphTargetTextureIndices',
    'bakedVertexAnimationSettings', 'bakedVertexAnimationTextureSizeInverted', 'bakedVertexAnimationTime',
  ]);
  const wire = prepassMaterial('__outlinePrepassWire', PREPASS_WIRE_VERTEX, ['position', 'adjacency0', 'adjacency1', 'adjacency2', 'adjacency3'], ['world', 'view', 'projection', 'viewProjection']);
  wire.fillMode = Material.LineListDrawMode;

  // Each mesh's edges with their adjacent corners as a line list, rebuilt when its geometry is replaced, placed and
  // instanced as the mesh is.
  const wires = new Map(); // mesh -> lines mesh
  const edgeLines = (mesh, positions) => {
    const p = mesh.getVerticesData('position'), adjacency = mesh_batch_cache_edge_detection(mesh), count = adjacency.length / 2;
    const corners = [0, 1, 2, 3].map(() => new Float32Array(count * 3)), position = new Float32Array(count * 3);
    for (let e = 0; e < adjacency.length / 4; e++) {
      for (let end = 0; end < 2; end++) {
        const v = e * 2 + end;
        for (let k = 0; k < 4; k++) corners[k].set(p.subarray(adjacency[e * 4 + k] * 3, adjacency[e * 4 + k] * 3 + 3), v * 3);
        position.set(p.subarray(adjacency[e * 4 + 1 + end] * 3, adjacency[e * 4 + 1 + end] * 3 + 3), v * 3);
      }
    }
    const lines = new Mesh('__outlineWire ' + mesh.name, scene);
    lines.setVerticesData('position', position, false, 3);
    corners.forEach((data, k) => lines.setVerticesData('adjacency' + k, data, false, 3));
    Object.assign(lines, { isUnIndexed: true, isPickable: false, doNotSerialize: true, layerMask: PREPASS_ONLY });
    lines._getRenderingFillMode = (fillMode) => fillMode;
    lines.metadata = { overlay: true, positions, instances: null };
    prepassTarget.setMaterialForRendering(lines, wire);
    return lines;
  };
  const edgeDetection = (mesh) => {
    const buffer = mesh.getVertexBuffer('position'), positions = buffer?.getData() ?? buffer;
    let lines = wires.get(mesh);
    if (lines?.metadata.positions !== positions) {
      lines?.dispose();
      wires.set(mesh, (lines = edgeLines(mesh, positions)));
    }
    lines.freezeWorldMatrix(mesh.computeWorldMatrix());
    const instances = mesh.thinInstanceCount ? mesh._thinInstanceDataStorage.matrixData : null;
    if (instances !== lines.metadata.instances) lines.thinInstanceSetBuffer('matrix', instances, 16, false);
    else if (instances) lines.thinInstanceBufferUpdated('matrix');
    if (instances) lines.thinInstanceCount = mesh.thinInstanceCount;
    lines.metadata.instances = instances;
    return lines;
  };

  const colors = { colors_object_select: theme.object_selected, colors_active_object: theme.object_active, colors_transform: theme.transform };
  const detect = pass.effect('outlineDetect', DETECT_FRAGMENT, ['size_viewport', 'do_thick_outlines', 'do_anti_aliasing', 'is_xray_wires', ...Object.keys(colors)], ['outline_id_tx']);
  const antiAliasing = pass.effect('outlineAntiAliasing', ANTI_ALIASING_FRAGMENT, ['do_smooth_lines', 'sizes_pixel', 'alpha_occlu'], ['color_tx', 'line_tx']);
  const ready = () => detect.effect.isReady() && antiAliasing.effect.isReady();
  let active = false, xray = false;

  // After the prepass, before the view renders: the detect pass into the line targets.
  const detected = prepassTarget.onAfterUnbindObservable.add(() => {
    if (!active || !ready()) return;
    const camera = scene.activeCamera, pixelsize = 1 / engine.getHardwareScalingLevel();
    engine.bindFramebuffer(lineTarget.renderTarget);
    pass.draw(detect, camera, (effect) => {
      effect.setTexture('outline_id_tx', prepassTarget);
      effect.setFloat2('size_viewport', pass.size.width, pass.size.height);
      effect.setBool('do_thick_outlines', pixelsize > 1 || theme.outline_width > 2);
      effect.setBool('do_anti_aliasing', true);
      effect.setBool('is_xray_wires', xray);
      for (const [name, c] of Object.entries(colors)) effect.setFloat4(name, c[0], c[1], c[2], c[3]);
    });
    engine.unBindFramebuffer(lineTarget.renderTarget);
    engine.setViewport(camera.viewport);
    scene.resetCachedMaterial();
  });
  // Over the scene's meshes and extras, under the origins and the 3D cursor: the lines, tested against the scene's depth.
  const drawn = scene.onAfterRenderingGroupObservable.add(({ renderingGroupId, camera }) => {
    if (!active || renderingGroupId !== 0 || engine.currentRenderPassId !== camera.renderPassId || !ready()) return;
    const depthFunction = engine.getDepthFunction(), depthWrite = engine.getDepthWrite();
    engine.setDepthWrite(false);
    engine.setAlphaMode(Constants.ALPHA_PREMULTIPLIED);
    // Don't occlude the outline if in xray mode as it causes too much flickering.
    for (const [func, alpha_occlu] of xray ? [[Constants.ALWAYS, 1]] : [[Constants.LEQUAL, 1], [Constants.GREATER, 0.35]]) {
      engine.setDepthFunction(func);
      pass.draw(antiAliasing, camera, (effect) => {
        effect.setTexture('color_tx', lineTarget.textures[0]);
        effect.setTexture('line_tx', lineTarget.textures[1]);
        effect.setBool('do_smooth_lines', true);
        effect.setFloat('sizes_pixel', 1 / engine.getHardwareScalingLevel());
        effect.setFloat('alpha_occlu', alpha_occlu);
      }, true);
    }
    engine.setAlphaMode(Constants.ALPHA_DISABLE);
    engine.setDepthFunction(depthFunction);
    engine.setDepthWrite(depthWrite);
    scene.resetCachedMaterial();
  });

  const show = (value) => {
    const index = scene.customRenderTargets.indexOf(prepassTarget);
    if (value && index < 0) scene.customRenderTargets.push(prepassTarget);
    else if (!value && index >= 0) scene.customRenderTargets.splice(index, 1);
    active = value;
  };
  return {
    // Fills the prepass from the outlined meshes, or skips every pass when none is; called per view before it renders.
    update(shown, { xray: inXray = false } = {}) {
      // Line meshes have no surface to outline.
      const meshes = shown ? outlined().filter((mesh) => !mesh.getClassName().includes('LinesMesh')) : [];
      show(meshes.length > 0);
      for (const [mesh, lines] of wires) if (mesh.isDisposed()) { lines.dispose(); wires.delete(mesh); }
      if (!active) return;
      xray = inXray;
      pass.fit([prepassTarget, lineTarget]);
      const transform = isTransform(), list = prepassTarget.renderList;
      ids.clear();
      list.length = 0;
      for (const mesh of meshes) {
        const id = outline_id_pack(outline_colorid_get(transform, isActive(mesh)), list.length + 1);
        const drawn = xray ? edgeDetection(mesh) : mesh, source = mesh.sourceMesh ?? mesh;
        if (!xray && source.getMaterialForRenderPass(prepassTarget.renderPassId) !== surface) prepassTarget.setMaterialForRendering(source, surface);
        list.push(drawn);
        ids.set(drawn, id);
        // An instance draws through its source.
        if (!ids.has(source)) ids.set(source, id);
      }
    },
    dispose() {
      show(false);
      prepassTarget.onAfterUnbindObservable.remove(detected);
      scene.onAfterRenderingGroupObservable.remove(drawn);
      for (const lines of wires.values()) lines.dispose();
      for (const resource of [prepassTarget, lineTarget, surface, wire, detect, antiAliasing, pass]) resource.dispose();
    },
  };
}
