/* The module's GPU backend records what Blender's GPU code asks of it (gpu-record.cc): textures, uploads, clears,
 * copies and compute dispatches with the shader, push constants and bindings of each, for Babylon to replay. */
#pragma once

#include <string>

#include "BLI_span.hh"

namespace blender::gpu {

class Texture;

/* While it lives, a GPU context is active whose work is recorded. */
class Recording {
 public:
  Recording();
  ~Recording();

  /* The recorded texture's id. */
  static int id(const Texture *texture);
  /* What was recorded as JSON: {"textures", "shaders", "commands", "unsupported"}; uploads' bytes are data(). */
  static std::string json();
  static Span<uint8_t> data();
};

}  // namespace blender::gpu
