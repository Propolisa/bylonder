// Image sampling on Babylon (docs/runtimes.md, Babylon (native)): an Image's textures sampled with Babylon's own
// settings (anisotropy, mipmaps) instead of Blender's (the Image Texture node's interpolation and Preferences >
// Viewport > Textures). The pixels stay Blender's either way (imbuf/image-textures.js); its panel is in the Image
// Editor's sidebar, Image tab.
import { Texture } from '@babylonjs/core';
import { blendData } from '../python/bpy_rna.js';
import { imageTextures, sample, sampleAsBlender } from '../imbuf/image-textures.js';
import { registerRuntime, runtimeOf } from './runtimes.js';

const NEAREST = { true: Texture.NEAREST_NEAREST_MIPLINEAR, false: Texture.NEAREST_SAMPLINGMODE };
const LINEAR = { true: Texture.TRILINEAR_SAMPLINGMODE, false: Texture.BILINEAR_SAMPLINGMODE };

const sampleAsBabylon = (texture, { anisotropic_filtering, use_mipmaps }) =>
  sample(texture, anisotropic_filtering, (texture.metadata.interpolation === 'Closest' ? NEAREST : LINEAR)[use_mipmaps]);

function evaluate() {
  const images = [...blendData().images];
  for (const image of images) {
    const native = runtimeOf(image) === 'NATIVE';
    for (const texture of imageTextures(image)) (native ? sampleAsBabylon(texture, image.bylonder.babylon) : sampleAsBlender(texture));
  }
  return images;
}

registerRuntime({
  id: 'IMAGE', label: 'Image sampling', struct: 'Image', owner: 'edit_image', context: 'image', sidebar: { space: 'IMAGE_EDITOR', category: 'Image' },
  icon: 'IMAGE_DATA', runtimes: ['BLENDER', 'NATIVE'],
  settings: (props, kw) => ({
    anisotropic_filtering: props.IntProperty(kw({ name: 'Anisotropic Filtering', description: "Samples along a surface seen at a grazing angle (the textures' anisotropicFilteringLevel)",
      min: 1, max: 16, default: 4, options: new Set() })),
    use_mipmaps: props.BoolProperty(kw({ name: 'Mipmaps', description: 'Sample the texture\'s mipmaps when it is drawn smaller than its size', default: true, options: new Set() })),
  }),
  poll: (struct) => struct?.bl_rna?.identifier === 'Image',
  note: () => 'Sampling only: the pixels are Blender\'s',
  issues: () => [],
  instances: (context) => [...context.blend_data.images],
  evaluates: () => false,
  evaluate,
  export: () => ({ reports: [], animations: [], restore() {} }),
});
