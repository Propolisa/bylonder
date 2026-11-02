/* Images: their buffers and Blender's partial updates for the textures Babylon draws them with
 * (src/imbuf/image-textures.js), and the UV editor's view of an edit mesh (src/editors/space_image). */

#include "BKE_context.hh"
#include "BKE_editmesh.hh"
#include "BKE_image.hh"
#include "BKE_image_partial_update.hh"
#include "BKE_main.hh"
#include "BLI_vector.hh"
#include "DNA_image_types.h"
#include "DNA_object_types.h"
#include "DNA_scene_types.h"
#include "DNA_screen_types.h"
#include "GPU_texture.hh"
#include "ED_mesh.hh"
#include "ED_uvedit.hh"
#include "IMB_colormanagement.hh"
#include "IMB_imbuf.hh"
#include "IMB_imbuf_types.hh"
#include "bmesh.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace blender {

/* port-override: a region's draw engines are Babylon's: the page draws the 3D View and the Image Editor's image and UVs
 * under what the region's own drawing records (region-draw.cc). */
void DRW_draw_view(const bContext * /*C*/) {}

/* port-override: the GPU module is not in the module; the Image panel names the format Blender's GPU texture of an image
 * has (IMB_gpu_get_texture_format), with gpu_texture.cc's names of those formats. */
const char *GPU_texture_format_name(gpu::TextureFormat format)
{
  using gpu::TextureFormat;
  switch (format) {
    case TextureFormat::UNORM_8_8_8_8:
      return "RGBA8";
    case TextureFormat::SRGBA_8_8_8_8:
      return "SRGB8_A8";
    case TextureFormat::SFLOAT_16_16_16_16:
      return "RGBA16F";
    case TextureFormat::SFLOAT_32_32_32_32:
      return "RGBA32F";
    case TextureFormat::UNORM_8:
      return "R8";
    case TextureFormat::SFLOAT_16:
      return "R16F";
    case TextureFormat::SFLOAT_32:
      return "R32F";
    case TextureFormat::SRGB_DXT1:
      return "SRGB8_A8_DXT1";
    case TextureFormat::SRGB_DXT3:
      return "SRGB8_A8_DXT3";
    case TextureFormat::SRGB_DXT5:
      return "SRGB8_A8_DXT5";
    case TextureFormat::SNORM_DXT1:
      return "RGBA8_DXT1";
    case TextureFormat::SNORM_DXT3:
      return "RGBA8_DXT3";
    case TextureFormat::SNORM_DXT5:
      return "RGBA8_DXT5";
    default:
      return "";
  }
}

}  // namespace blender

/* An image's buffer as Blender draws it (the image user's frame and tile, or the first), read by JS as 32-bit words:
 * size, the byte and float buffers (null when absent, bottom row first, 4 channels), and how their values are encoded:
 * ImageBufferKind. Its pointers are valid until the image's buffers change. */
enum ImageBufferKind { BUFFER_SRGB, BUFFER_LINEAR, BUFFER_DATA };
struct ImageBuffer {
  int x, y;
  const uchar *byte_data;
  const float *float_data;
  int byte_kind, float_kind;
};
static ImageBufferKind buffer_kind(const ColorSpace *colorspace, bool is_float)
{
  if (colorspace && IMB_colormanagement_space_is_data(colorspace)) {
    return BUFFER_DATA;
  }
  if (is_float) {
    return BUFFER_LINEAR;
  }
  return !colorspace || IMB_colormanagement_space_is_srgb(colorspace) ? BUFFER_SRGB : BUFFER_LINEAR;
}
EXPORT(image_buffer) const ImageBuffer *image_buffer(Image *ima, ImageUser *iuser)
{
  static ImageBuffer buffer;
  void *lock;
  ImBuf *ibuf = BKE_image_acquire_ibuf(ima, iuser, &lock);
  if (!ibuf || (!ibuf->byte_data() && !ibuf->float_data())) {
    BKE_image_release_ibuf(ima, ibuf, lock);
    return nullptr;
  }
  buffer = {ibuf->x, ibuf->y, ibuf->byte_data(), ibuf->float_data(), buffer_kind(ibuf->byte_buffer.colorspace, false),
            ibuf->colorspace_is_data() ? BUFFER_DATA : buffer_kind(ibuf->float_buffer.colorspace, true)};
  BKE_image_release_ibuf(ima, ibuf, lock);
  return &buffer;
}

/* Blender's partial updates of an image's buffers (BKE_image_partial_update.hh), as image_gpu.cc follows them for its
 * GPU textures: a user per texture, and what changed since its last collection. */
EXPORT(image_partial_update_create) PartialUpdateUser *image_partial_update_create(const Image *ima) { return BKE_image_partial_update_create(ima); }
EXPORT(image_partial_update_free) void image_partial_update_free(PartialUpdateUser *user) { BKE_image_partial_update_free(user); }
/* -1 when the whole image changed, else the number of regions written to r_regions (xmin, ymin, xmax, ymax each, of the
 * first tile) up to max; more than max is a whole change. */
EXPORT(image_partial_update_collect) int image_partial_update_collect(Image *ima, PartialUpdateUser *user, int *r_regions, int max)
{
  using namespace bke::image::partial_update;
  switch (BKE_image_partial_update_collect_changes(ima, user)) {
    case ePartialUpdateCollectResult::FullUpdateNeeded:
      return -1;
    case ePartialUpdateCollectResult::NoChangesDetected:
      return 0;
    case ePartialUpdateCollectResult::PartialChangesDetected:
      break;
  }
  int count = 0;
  PartialUpdateRegion change;
  while (BKE_image_partial_update_get_next_change(user, &change) == ePartialUpdateIterResult::ChangeAvailable) {
    if (change.tile_number != 1001 && change.tile_number != 0) {
      continue;
    }
    if (count == max) {
      return -1;
    }
    const rcti &r = change.region;
    int *region = &r_regions[count++ * 4];
    region[0] = r.xmin, region[1] = r.ymin, region[2] = r.xmax, region[3] = r.ymax;
  }
  return count;
}

/* An image's buffers packed into the file, as Image > Pack does: an edited or generated image as PNG (or OpenEXR for a
 * float buffer, BKE_image_memorypack), one read from a file as that file. */
EXPORT(image_pack) bool image_pack(Main *bmain, Image *ima)
{
  if (BKE_image_is_dirty(ima) || ima->source == IMA_SRC_GENERATED) {
    return BKE_image_memorypack(ima);
  }
  BKE_image_packfiles(nullptr, ima, ID_BLEND_PATH(bmain, &ima->id));
  return BKE_image_has_packedfile(ima);
}

/* The context region's View2D as its draw last set it: cur (xmin, xmax, ymin, ymax) and mask (the same, in region
 * pixels). */
EXPORT(region_view2d) void region_view2d(const bContext *C, float r_view[8])
{
  const View2D &v2d = CTX_wm_region(C)->v2d;
  const float view[8] = {v2d.cur.xmin, v2d.cur.xmax, v2d.cur.ymin, v2d.cur.ymax,
                         float(v2d.mask.xmin), float(v2d.mask.xmax), float(v2d.mask.ymin), float(v2d.mask.ymax)};
  std::copy_n(view, 8, r_view);
}

/* The UV editor's view of an object's edit mesh: its active UV map per corner (BM_elem_index_get order, as
 * extraction.hh's), each corner's flags as the overlay's shaders read them (overlay_shader_shared.hh: VERT_UV_SELECT,
 * VERT_UV_PINNED, EDGE_UV_SELECT, FACE_UV_ACTIVE, FACE_UV_SELECT, FACE_ACTIVE, FACE_SELECTED), and each face's
 * visibility in the UV editor; valid until the next call, or null without an edit mesh or UV map. */
struct EditUV {
  int corners_num, faces_num;
  const float (*uvs)[2];
  const uchar *flags;
  const bool *visible;
};
enum { FACE_ACTIVE = 1 << 0, FACE_SELECTED = 1 << 1, VERT_UV_SELECT = 1 << 3, VERT_UV_PINNED = 1 << 4, EDGE_UV_SELECT = 1 << 5,
       FACE_UV_ACTIVE = 1 << 6, FACE_UV_SELECT = 1 << 7 };
EXPORT(view_edit_uv_extract) const EditUV *view_edit_uv_extract(const Scene *scene, Object *ob)
{
  static EditUV result;
  static Vector<float2> uvs;
  static Vector<uchar> flags;
  static Vector<bool> visible;
  BMEditMesh *em = BKE_editmesh_from_object(ob);
  if (!em) {
    return nullptr;
  }
  BMesh *bm = em->bm;
  const BMUVOffsets offsets = BM_uv_map_offsets_get(bm);
  if (offsets.uv == -1) {
    return nullptr;
  }
  BM_mesh_elem_index_ensure(bm, BM_FACE | BM_LOOP);
  uvs.resize(bm->totloop);
  flags.resize(bm->totloop);
  visible.resize(bm->totface);
  const ToolSettings *ts = scene->toolsettings;
  const BMFace *active = BM_mesh_active_face_get(bm, false, true), *active_uv = EDBM_uv_active_face_get(em, false, false);
  BMIter iter, liter;
  BMFace *efa;
  BMLoop *l;
  BM_ITER_MESH (efa, &iter, bm, BM_FACES_OF_MESH) {
    visible[BM_elem_index_get(efa)] = uvedit_face_visible_test_ex(ts, efa);
    /* blender-port: draw/intern/mesh_extractors/extract_mesh.cc mesh_render_data_face_flag, loop_flag and
     * loop_edge_flag (the draw module is past the seam). */
    uchar face = (efa == active ? FACE_ACTIVE : 0) | (BM_elem_flag_test(efa, BM_ELEM_SELECT) ? FACE_SELECTED : 0) |
                 (efa == active_uv ? FACE_UV_ACTIVE : 0);
    if (!BM_elem_flag_test(efa, BM_ELEM_HIDDEN) && uvedit_face_select_test_ex(ts, bm, efa)) {
      face |= FACE_UV_SELECT;
    }
    BM_ITER_ELEM (l, &liter, efa, BM_LOOPS_OF_FACE) {
      const int i = BM_elem_index_get(l);
      uvs[i] = BM_ELEM_CD_GET_FLOAT_P(l, offsets.uv);
      uchar flag = face;
      if (offsets.pin != -1 && BM_ELEM_CD_GET_BOOL(l, offsets.pin)) {
        flag |= VERT_UV_PINNED;
      }
      if (uvedit_uv_select_test_ex(ts, bm, l, offsets)) {
        flag |= VERT_UV_SELECT;
      }
      if (uvedit_edge_select_test_ex(ts, bm, l, offsets)) {
        flag |= EDGE_UV_SELECT | VERT_UV_SELECT;
      }
      flags[i] = flag;
    }
  }
  result = {bm->totloop, bm->totface, reinterpret_cast<const float(*)[2]>(uvs.data()), flags.data(), visible.data()};
  return &result;
}
