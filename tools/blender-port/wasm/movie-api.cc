/* Video as the browser writes it (WebCodecs, src/render/output.js) in Blender's movie settings. The module has no
 * FFmpeg, so rna_scene.cc defines neither the movie file format nor its encoding settings (its WITH_FFMPEG parts):
 * they are defined here over Blender's own DNA (RenderData.ffcodecdata), with Blender's identifiers, offering what the
 * browser encodes. A .blend keeps them as Blender reads them. */

#include "BLI_vector.hh"

#include "DNA_scene_types.h"

#include "IMB_imbuf_enums.h"
#include "MOV_enums.hh"
#include "MOV_util.hh"

#include "RNA_access.hh"
#include "RNA_define.hh"
#include "RNA_enum_types.hh"
#include "RNA_prototypes.hh"
#include "rna_internal_types.hh"

#include "UI_resources.hh"

namespace blender {

static const EnumPropertyItem video_formats[] = {
    {R_IMF_IMTYPE_FFMPEG, "FFMPEG", ICON_FILE_MOVIE, "Video", "Encoded by the browser (WebCodecs)"},
    {0, nullptr, 0, nullptr, nullptr},
};
static const EnumPropertyItem containers[] = {
    {FFMPEG_MPEG4, "MPEG4", 0, "MPEG-4", ""},
    {FFMPEG_MKV, "MKV", 0, "Matroska", ""},
    {FFMPEG_WEBM, "WEBM", 0, "WebM", ""},
    {FFMPEG_MOV, "QUICKTIME", 0, "QuickTime", ""},
    {0, nullptr, 0, nullptr, nullptr},
};
static const EnumPropertyItem codecs[] = {
    {FFMPEG_CODEC_ID_AV1, "AV1", 0, "AV1", ""},
    {FFMPEG_CODEC_ID_H264, "H264", 0, "H.264", ""},
    {FFMPEG_CODEC_ID_H265, "H265", 0, "H.265 / HEVC", ""},
    {FFMPEG_CODEC_ID_VP9, "WEBM", 0, "WebM / VP9", ""},
    {0, nullptr, 0, nullptr, nullptr},
};
static const EnumPropertyItem qualities[] = {
    {FFM_CRF_NONE, "NONE", 0, "Constant Bitrate", "Configure constant bit rate, rather than constant output quality"},
    {FFM_CRF_HIGH, "HIGH", 0, "High Quality", ""},
    {FFM_CRF_MEDIUM, "MEDIUM", 0, "Medium Quality", ""},
    {FFM_CRF_LOW, "LOW", 0, "Low Quality", ""},
    {FFM_CRF_VERYLOW, "VERYLOW", 0, "Very Low Quality", ""},
    {FFM_CRF_LOWEST, "LOWEST", 0, "Lowest Quality", ""},
    {0, nullptr, 0, nullptr, nullptr},
};
/* WebCodecs' latencyMode: quality, or realtime. */
static const EnumPropertyItem speeds[] = {
    {FFM_PRESET_BEST, "BEST", 0, "Slowest", "Recommended if you have lots of time and want the best compression efficiency"},
    {FFM_PRESET_GOOD, "GOOD", 0, "Good", "The default and recommended for most applications"},
    {FFM_PRESET_REALTIME, "REALTIME", 0, "Realtime", "Recommended for fast encoding"},
    {0, nullptr, 0, nullptr, nullptr},
};

static FFMpegCodecData &codec_data(PointerRNA *ptr) { return *static_cast<FFMpegCodecData *>(ptr->data); }

template<int FFMpegCodecData::*field> static int field_get(PointerRNA *ptr, PropertyRNA *) { return codec_data(ptr).*field; }
template<int FFMpegCodecData::*field> static void field_set(PointerRNA *ptr, PropertyRNA *, int value) { codec_data(ptr).*field = value; }

static void define_enum(StructRNA *srna, const char *identifier, const char *name, const EnumPropertyItem *items,
                        EnumPropertyGetFunc get, EnumPropertySetFunc set)
{
  PropertyRNA *prop = RNA_def_property(srna, identifier, PROP_ENUM, PROP_NONE);
  RNA_def_property_enum_items(prop, items);
  RNA_def_property_enum_funcs_runtime(prop, get, set, nullptr, nullptr, nullptr);
  RNA_def_property_ui_text(prop, name, "");
  RNA_def_property_clear_flag(prop, PROP_ANIMATABLE);
}

static void define_int(StructRNA *srna, const char *identifier, const char *name, int min, int max, IntPropertyGetFunc get,
                       IntPropertySetFunc set)
{
  PropertyRNA *prop = RNA_def_property(srna, identifier, PROP_INT, PROP_NONE);
  RNA_def_property_int_funcs_runtime(prop, get, set, nullptr, nullptr, nullptr);
  RNA_def_property_range(prop, min, max);
  RNA_def_property_ui_text(prop, name, "");
  RNA_def_property_clear_flag(prop, PROP_ANIMATABLE);
}

static int crf_get(PointerRNA *ptr, PropertyRNA *) { return codec_data(ptr).constant_rate_factor; }
static void crf_set(PointerRNA *ptr, PropertyRNA *, int value) { codec_data(ptr).constant_rate_factor = eFFMpegCrf(value); }
static int speed_get(PointerRNA *ptr, PropertyRNA *) { return codec_data(ptr).ffmpeg_preset; }
static void speed_set(PointerRNA *ptr, PropertyRNA *, int value) { codec_data(ptr).ffmpeg_preset = eFFMpegPreset(value); }

static EnumPropertyItemFunc image_format_items = nullptr;
static const EnumPropertyItem *file_format_items(bContext *C, PointerRNA *ptr, PropertyRNA *prop, bool *r_free)
{
  if (ptr->data_as<ImageFormatData>()->media_type == MEDIA_TYPE_VIDEO) {
    return video_formats;
  }
  return image_format_items(C, ptr, prop, r_free);
}

/* port-override: Blender's defaults for a new movie output (movie_util.cc, its H.264 preset), in a container the
 * browser writes. */
void MOV_validate_output_settings(RenderData *rd, const ImageFormatData *imf)
{
  FFMpegCodecData &codec = rd->ffcodecdata;
  if (imf->imtype != R_IMF_IMTYPE_FFMPEG || (codec.type > 0 && codec.codec_id_get() > 0 && codec.video_bitrate > 1)) {
    return;
  }
  codec.type = FFMPEG_MKV;
  codec.codec_id_set(FFMPEG_CODEC_ID_H264);
  codec.video_bitrate = 6000;
  codec.gop_size = rd->frs_sec != 25 ? 18 : 15;
  codec.constant_rate_factor = FFM_CRF_MEDIUM;
  codec.ffmpeg_preset = FFM_PRESET_GOOD;
}

}  // namespace blender

/* port-override: called after RNA_init, as WITH_FFMPEG would have rna_scene.cc define them. */
void movie_init()
{
  using namespace blender;
  EnumPropertyRNA *file_format = reinterpret_cast<EnumPropertyRNA *>(
      RNA_struct_type_find_property(RNA_ImageFormatSettings, "file_format"));
  image_format_items = file_format->item_fn;
  file_format->item_fn = file_format_items;
  /* Read without a context, by its items: every format's. */
  static Vector<EnumPropertyItem> all;
  for (const EnumPropertyItem *item = rna_enum_image_type_all_items; item->identifier; item++) {
    all.append(*item);
  }
  all.extend({video_formats[0], video_formats[1]});
  file_format->item = all.data();
  file_format->totitem = int(all.size()) - 1;

  StructRNA *srna = RNA_FFmpegSettings;
  define_enum(srna, "format", "Container", containers, field_get<&FFMpegCodecData::type>, field_set<&FFMpegCodecData::type>);
  define_enum(srna, "codec", "Video Codec", codecs, field_get<&FFMpegCodecData::codec>, field_set<&FFMpegCodecData::codec>);
  define_enum(srna, "constant_rate_factor", "Output Quality", qualities, crf_get, crf_set);
  define_enum(srna, "ffmpeg_preset", "Encoding Speed", speeds, speed_get, speed_set);
  define_int(srna, "video_bitrate", "Bitrate", 1, 1000000, field_get<&FFMpegCodecData::video_bitrate>,
             field_set<&FFMpegCodecData::video_bitrate>);
  define_int(srna, "gopsize", "Keyframe Interval", 0, 500, field_get<&FFMpegCodecData::gop_size>,
             field_set<&FFMpegCodecData::gop_size>);
}
