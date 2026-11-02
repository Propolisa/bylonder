/* Blender's draw module is past the seam (Babylon draws). Its engines are still registered as Blender registers them
 * (draw_context.cc), so the scene's render engine and the panels that ask for it find EEVEE and Workbench; they have no
 * callbacks, as nothing here renders. */
#include "BLI_string.h"
#include "BLT_translation.hh"
#include "DRW_engine.hh"
#include "GPU_context.hh"
#include "GPU_platform.hh"
#include "RE_engine.h"

namespace blender {

static RenderEngineType engine_type(const char *idname, const char *name, int flag)
{
  RenderEngineType type = {};
  STRNCPY(type.idname, idname);
  STRNCPY(type.name, name);
  type.flag = flag;
  return type;
}

/* port-override: the engines' identities without their draw code. */
void DRW_engines_register()
{
  static RenderEngineType eevee = engine_type("BLENDER_EEVEE", N_("EEVEE"),
                                              RE_INTERNAL | RE_USE_PREVIEW | RE_USE_STEREO_VIEWPORT | RE_USE_GPU_CONTEXT);
  static RenderEngineType workbench = engine_type("BLENDER_WORKBENCH", N_("Workbench"),
                                                  RE_INTERNAL | RE_USE_STEREO_VIEWPORT | RE_USE_GPU_CONTEXT);
  RE_engines_register(&eevee);
  RE_engines_register(&workbench);
}

/* port-override: no batch caches to tag or free; Bylonder's mesh extraction is its own. */
void DRW_module_init() {}
void DRW_module_exit() {}
void DRW_engines_free() {}
bool DRW_gpu_context_try_enable() { return false; }

/* port-override: the GPU module is past the seam; the browser chooses the graphics backend and device for Babylon, so
 * none is overridden or listed in the Preferences. */
bool GPU_backend_type_selection_is_overridden() { return false; }
void GPU_backend_type_selection_set_override(GPUBackendType /*backend_type*/) {}
bool GPU_backend_type_selection_detect() { return true; }
Span<GPUDevice> GPU_platform_devices_list() { return {}; }

}  // namespace blender
