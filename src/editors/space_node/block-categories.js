// Babylon's blocks by kind, from their class names, for the colors Blender gives its node classes.
const categories = [
  ['output', /Output/],
  ['input', /^(Input|NodeRenderGraphInput|GeometryInput|ParticleInput|Mesh|Contextual|SystemSource|Time|Random)Block$|Input|Source/],
  ['texture', /Texture|Image|Reflection|Refraction|Planar|Noise|Voronoi|Worley|Perlin/],
  ['shader', /PBR|Light|Sheen|ClearCoat|SubSurface|Anisotropy|Fragment|Shadow|Fog|Iridescence|Material/],
  ['filter', /PostProcess|Renderer|Bloom|Blur|Glow|Highlight|Layer|Clear|Copy|Mipmap|Culling|Taa|Ssao|Ssr/],
  ['particle', /Particle|Emitter|Update|Create|System|Shape/],
  ['geometry', /Geometry|Instantiate|Merge|Mapping|Box|Sphere|Plane|Cylinder|Torus|Capsule|Disc|Grid|Points|Mesh|Extrude|Subdivide|Boolean|Optimize|Collection/],
  ['color', /Color|Desaturate|Posterize|Gradient|Replace|Tone/],
  ['vector', /Transform|Vector|Normal|Cross|Dot|Length|Distance|Rotate|Translate|Scale|Matrix|Position|Reflect|Refract/],
  ['layout', /Elbow|Teleport|Frame|Debug|Comment/],
];
export const categoryOf = name => categories.find(([, test]) => test.test(name))?.[0] || 'converter';
