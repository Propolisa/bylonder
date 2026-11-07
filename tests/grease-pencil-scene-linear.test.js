// Grease Pencil colors come in display sRGB, as Blender's draw gives them: a view that draws in scene linear (Rendered,
// its post-process displaying it) takes strokes and fills back to linear, or Bike Ride's rider draws washed out.
import assert from 'node:assert/strict';
import { FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { GreasedLineMesh } from '@babylonjs/core/Meshes/GreasedLine/greasedLineMesh.js';
import { fillMaterial, greasedLineMaterial } from '../src/draw/grease-pencil.js';

const scene = new Scene(new NullEngine());
new FreeCamera('Camera', new Vector3(0, 0, -5), scene);
const ip = scene.imageProcessingConfiguration;
const stroke = new GreasedLineMesh('Stroke', scene, { points: [[0, 0, 0, 1, 0, 0]], widths: [1, 1, 1, 1] });
stroke.material = greasedLineMaterial(scene, 'Stroke', false);

// The stroke's effect once it draws with the view's scene linear as given.
const strokeEffect = async (sceneLinear) => {
  ip.applyByPostProcess = sceneLinear;
  scene.render();
  await scene.whenReadyAsync();
  return stroke.subMeshes[0].effect;
};
const GUARDED = '#ifdef IMAGEPROCESSINGPOSTPROCESS\ncolor.rgb = toLinearSpace(color.rgb);\n#endif';
const linear = await strokeEffect(true), code = linear._fragmentSourceCode;
assert.ok(code.lastIndexOf(GUARDED) > code.lastIndexOf('grl_colors'), "a stroke's color is taken to scene linear after GreasedLine sets it");
assert.match(linear.defines, /IMAGEPROCESSINGPOSTPROCESS/, 'in a scene linear view');
assert.doesNotMatch((await strokeEffect(false)).defines, /IMAGEPROCESSINGPOSTPROCESS/, 'a display view draws it as it comes');

const fill = fillMaterial(scene, 'Fill'), bound = [];
const effect = { setFloat: (name, value) => bound.push([name, value]) };
fill.getEffect = () => effect;
for (const linear of [true, false]) {
  ip.applyByPostProcess = linear;
  fill.onBindObservable.notifyObservers(null);
}
assert.deepEqual(bound, [['sceneLinear', 1], ['sceneLinear', 0]], "a fill's colors follow the view's scene linear");
console.log('Grease Pencil: strokes and fills draw in scene linear where the view does');
