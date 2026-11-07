// Blender's Area light as Babylon's rectangular area light that casts shadows: Babylon has no shadow for its area lights,
// so this one is a shadow light (Babylon's IShadowLight) whose shadow is a point light's cube from its center, as EEVEE's
// punctual shadow of an area light is (eevee_shadow.cc ShadowPunctual). A render extension (Area Light Shadows).
import { Matrix, RectAreaLight, Vector3 } from '@babylonjs/core';
import { renderExtension } from '../../draw/render-extension.js';

export const areaLightShadows = renderExtension({
  id: 'bylonder_area_light_shadows', label: 'Area Light Shadows',
  description: 'Area lights cast shadows as in EEVEE, from a shadow cube at the light center. Off, they cast none, as in plain Babylon',
  detail: 'Shadows from the light center',
});

// The cube's faces in the order Babylon's shadow maps draw them (as its PointLight's).
const CUBE_FACES = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];

export class AreaLight extends RectAreaLight {
  constructor(name, position, width, height, scene) {
    super(name, position, width, height, scene);
    this.transformedPosition = null;
    this.shadowMinZ = undefined;
    this.shadowMaxZ = undefined;
  }

  needCube() { return true; }
  needProjectionMatrixCompute() { return false; }
  forceProjectionMatrixCompute() {}
  getShadowDirection(faceIndex) { return CUBE_FACES[faceIndex] ?? CUBE_FACES[0]; }
  getDepthScale() { return 50; }
  getDepthMinZ(camera) { return this.shadowMinZ ?? camera?.minZ ?? 0; }
  getDepthMaxZ(camera) { return this.shadowMaxZ ?? camera?.maxZ ?? 10000; }

  // Its world position, with a parent's transform; false when it has none (its position is world).
  computeTransformedInformation() {
    if (!this.parent?.getWorldMatrix) { this.transformedPosition = null; return false; }
    this.transformedPosition ??= Vector3.Zero();
    Vector3.TransformCoordinatesToRef(this.position, this.parent.getWorldMatrix(), this.transformedPosition);
    return true;
  }
  getAbsolutePosition() { return this.computeTransformedInformation() ? this.transformedPosition : this.position; }

  // A cube face's projection: a quarter turn wide, square, over the shadow's depth range.
  setShadowProjectionMatrix(matrix) {
    const scene = this.getScene(), engine = scene.getEngine(), camera = scene.activeCamera, reverse = engine.useReverseDepthBuffer;
    const minZ = this.getDepthMinZ(camera), maxZ = this.getDepthMaxZ(camera);
    Matrix.PerspectiveFovLHToRef(Math.PI / 2, 1, reverse ? maxZ : minZ, reverse ? minZ : maxZ, matrix, true, engine.isNDCHalfZRange, undefined, reverse);
    return this;
  }
}
