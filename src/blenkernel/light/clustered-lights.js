// Clustered Lights, a render extension: an exported page draws its point and spot lights in clusters where it has more
// lights than a material takes (overrides/babylon/clustered-lights.js).
import { renderExtension } from '../../draw/render-extension.js';

export const clusteredLights = renderExtension({
  id: 'bylonder_clustered_lights', label: 'Clustered Lights',
  description: "Exported pages with more lights than a material takes draw their point and spot lights in clusters, as EEVEE does, so none is left out. Clustered lights are not in Babylon's scene.lights (find them through the page's SDK); off, each mesh takes the lights nearest it",
  detail: 'Exported pages',
});
