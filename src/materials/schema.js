const color = (path, label, extra = {}) => ({ path, label, color: true, ...extra });
const num = (path, label, min = 0, max = 1, step = 0.01, extra = {}) => ({ path, label, min, max, step, ...extra });
const bool = (path, label, extra = {}) => ({ path, label, bool: true, ...extra });
const map = (path, label, extra = {}) => ({ path, label, texture: true, animatable: false, ...extra });
const choice = (path, label, options, extra = {}) => ({ path, label, options, ...extra });
const blend = choice('transparencyMode', 'Blend Mode', { Opaque: 0, 'Alpha Clip': 1, 'Alpha Blend': 2, 'Clip and Blend': 3 }, { nullable: true });

export const materialTypes = {
  pbr: {
    title: 'Principled (PBR)',
    className: 'PBRMaterial',
    sections: [
      { id: 'surface', title: 'Surface', fields: [
        color('albedoColor', 'Base Color'), map('albedoTexture', 'Base Color Map'),
        num('metallic', 'Metallic'), num('roughness', 'Roughness'),
        map('metallicTexture', 'Metal/Rough Map', { title: 'Babylon ORM layout: roughness in green, metallic in blue' }),
        num('indexOfRefraction', 'IOR', 1, 3), num('alpha', 'Alpha'), map('bumpTexture', 'Normal Map'),
      ] },
      { id: 'specular', title: 'Specular', sub: true, fields: [num('metallicF0Factor', 'IOR Level'), color('metallicReflectanceColor', 'Tint')] },
      { id: 'transmission', title: 'Transmission', sub: true, fields: [bool('subSurface.isRefractionEnabled', 'Enabled'), num('subSurface.refractionIntensity', 'Weight')] },
      { id: 'subsurface', title: 'Subsurface', sub: true, fields: [bool('subSurface.isTranslucencyEnabled', 'Enabled'), num('subSurface.translucencyIntensity', 'Weight'), color('subSurface.tintColor', 'Tint')] },
      { id: 'coat', title: 'Coat', sub: true, fields: [bool('clearCoat.isEnabled', 'Enabled'), num('clearCoat.intensity', 'Weight'), num('clearCoat.roughness', 'Roughness'), num('clearCoat.indexOfRefraction', 'IOR', 1, 3)] },
      { id: 'sheen', title: 'Sheen', sub: true, fields: [bool('sheen.isEnabled', 'Enabled'), num('sheen.intensity', 'Weight'), num('sheen.roughness', 'Roughness'), color('sheen.color', 'Tint')] },
      { id: 'anisotropy', title: 'Anisotropy', sub: true, fields: [bool('anisotropy.isEnabled', 'Enabled'), num('anisotropy.intensity', 'Strength')] },
      { id: 'emission', title: 'Emission', sub: true, fields: [color('emissiveColor', 'Color'), num('emissiveIntensity', 'Strength', 0, 100, 0.1), map('emissiveTexture', 'Emission Map')] },
      { id: 'settings', title: 'Settings', fields: [bool('backFaceCulling', 'Backface Culling'), blend, num('alphaCutOff', 'Alpha Clip Threshold'), bool('unlit', 'Unlit'), bool('wireframe', 'Wireframe'), num('environmentIntensity', 'Environment', 0, 4)] },
    ],
  },
  standard: {
    title: 'Standard',
    className: 'StandardMaterial',
    sections: [
      { id: 'surface', title: 'Surface', fields: [
        color('diffuseColor', 'Diffuse Color'), map('diffuseTexture', 'Diffuse Map'),
        color('specularColor', 'Specular Color'), num('specularPower', 'Shininess', 1, 512, 1), map('specularTexture', 'Specular Map'),
        color('ambientColor', 'Ambient'), num('alpha', 'Alpha'), map('opacityTexture', 'Opacity Map'), map('bumpTexture', 'Normal Map'),
      ] },
      { id: 'emission', title: 'Emission', sub: true, fields: [color('emissiveColor', 'Color'), map('emissiveTexture', 'Emission Map')] },
      { id: 'settings', title: 'Settings', fields: [bool('backFaceCulling', 'Backface Culling'), blend, num('alphaCutOff', 'Alpha Clip Threshold'), bool('useAlphaFromDiffuseTexture', 'Alpha from Diffuse'), bool('disableLighting', 'Shadeless'), bool('wireframe', 'Wireframe')] },
    ],
  },
  node: {
    title: 'Node Material',
    className: 'NodeMaterial',
    sections: [{ id: 'settings', title: 'Settings', fields: [bool('backFaceCulling', 'Backface Culling'), blend, num('alphaCutOff', 'Alpha Clip Threshold'), bool('wireframe', 'Wireframe')] }],
  },
};

export const materialType = material => {
  const name = material?.getClassName?.();
  return name === 'NodeMaterial' ? 'node' : name === 'PBRMaterial' || name === 'PBRMetallicRoughnessMaterial' ? 'pbr' : name === 'StandardMaterial' ? 'standard' : null;
};
export const fields = type => (materialTypes[type]?.sections || []).flatMap(section => section.fields);
export const textureSlots = [...new Set(Object.values(materialTypes).flatMap(t => t.sections.flatMap(s => s.fields.filter(f => f.texture).map(f => f.path))))];
export const resolve = (target, path) => {
  const parts = path.split('.'), key = parts.pop();
  const owner = parts.reduce((o, k) => o?.[k], target);
  return { owner, key };
};
