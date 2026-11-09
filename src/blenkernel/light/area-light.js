// Blender's Area light as Babylon's rectangular area light that casts shadows (io_scene_babylon/runtime/area-light.js,
// which exported pages ship too). A render extension (Area Light Shadows).
import { renderExtension } from '../../draw/render-extension.js';

export { AreaLight } from '../../io_scene_babylon/runtime/area-light.js';

export const areaLightShadows = renderExtension({
  id: 'bylonder_area_light_shadows', label: 'Area Light Shadows',
  description: 'Area lights cast shadows as in EEVEE, from a shadow cube at the light center. Off, they cast none, as in plain Babylon',
  detail: 'Shadows from the light center',
});
