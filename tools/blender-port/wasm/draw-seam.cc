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
  /* Cycles' place among the engines until its side module and add-on arrive (render/cycles.js, which choosing it
   * starts): cycles-api.cc takes it out before the add-on registers Cycles' own. */
  static RenderEngineType cycles = engine_type("CYCLES", N_("Cycles"), 0);
  RE_engines_register(&cycles);
}

/* port-override: no batch caches to tag or free; Bylonder's mesh extraction is its own. */
void DRW_module_init() {}
void DRW_module_exit() {}
void DRW_engines_free() {}
bool DRW_gpu_context_try_enable() { return false; }
/* port-override: an engine Blender renders in the module (Cycles) gets no draw GPU context, and no Grease Pencil pass
 * from the draw module, which is past the seam. */
bool DRW_render_check_grease_pencil(Depsgraph * /*depsgraph*/, View3D * /*v3d*/) { return false; }
void DRW_render_gpencil(RenderEngine * /*engine*/, Depsgraph * /*depsgraph*/) {}
void DRW_render_context_enable(Render * /*render*/) {}
void DRW_render_context_disable(Render * /*render*/) {}

/* port-override: the GPU module is past the seam; the browser chooses the graphics backend and device for Babylon, so
 * none is overridden or listed in the Preferences. */
bool GPU_backend_type_selection_is_overridden() { return false; }
void GPU_backend_type_selection_set_override(GPUBackendType /*backend_type*/) {}
bool GPU_backend_type_selection_detect() { return true; }
Span<GPUDevice> GPU_platform_devices_list() { return {}; }

/* port-override: no off-screen GPU context for a render job (imbuf's and the render display's), as the module has no
 * GPU; the job renders and converts its result on the CPU. */
namespace gpu {
GPUSecondaryContextData GPU_create_secondary_context() { return {}; }
void GPU_activate_secondary_context(const GPUSecondaryContextData & /*data*/) {}
void GPU_deactivate_secondary_context(const GPUSecondaryContextData & /*data*/) {}
void GPU_destroy_secondary_context(GPUSecondaryContextData & /*data*/) {}
}  // namespace gpu

}  // namespace blender
