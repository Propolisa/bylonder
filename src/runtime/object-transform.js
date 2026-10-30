// Lights and cameras as objects, as Blender's are: Babylon gives them a position (and a camera a rotation) but not the
// rest of an object's transform, which every editor reads (selection, transform, animation, undo). A light or camera
// without them gets a rotation and a scaling; a light's rotation turns its direction, which points along its local
// +Z as a camera looks (Blender's -Z, see rna-bylonder.js). Scaling has no effect on either, as in Blender's viewport.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';

const FORWARD = new Vector3(0, 0, 1);

// The rotation that turns +Z to `direction`, keeping +Y up where it can.
function rotationTo(direction) {
  const forward = direction.normalizeToNew();
  const up = Math.abs(forward.y) > 0.999 ? new Vector3(0, 0, 1) : Vector3.Up();
  const right = Vector3.Cross(up, forward).normalize(), trueUp = Vector3.Cross(forward, right);
  const m = Matrix.FromValues(right.x, right.y, right.z, 0, trueUp.x, trueUp.y, trueUp.z, 0, forward.x, forward.y, forward.z, 0, 0, 0, 0, 1);
  return Quaternion.FromRotationMatrix(m).toEulerAngles();
}

export function asObject(node) {
  // A hemispheric light has a direction and no position: Light's world matrix is then the identity and its absolute
  // position the origin, so it gets a world matrix of the transform it is given, as a TransformNode's.
  const positioned = !!node.position;
  node.position ??= Vector3.Zero();
  node.scaling ??= new Vector3(1, 1, 1);
  node.getAbsolutePosition ??= () => node.globalPosition ?? node.position;
  if (!node.rotation) {
    node.rotation = node.direction ? rotationTo(node.direction) : new Vector3();
    node.rotationQuaternion = null;
  }
  if (!positioned) {
    const world = Matrix.Identity(), quaternion = new Quaternion();
    node.computeWorldMatrix = () => {
      const rotation = node.rotationQuaternion ?? Quaternion.FromEulerVectorToRef(node.rotation, quaternion);
      Matrix.ComposeToRef(node.scaling, rotation, node.position, world);
      if (node.parent) world.multiplyToRef(node.parent.computeWorldMatrix(true), world);
      return world;
    };
    node.getWorldMatrix = node.computeWorldMatrix;
    node.getAbsolutePosition = () => node.computeWorldMatrix().getTranslation();
  }
  return node;
}

// Keeps lights' directions on their rotations, before each frame.
export function syncLightDirections(scene) {
  const last = new WeakMap(), quaternion = new Quaternion();
  return scene.onBeforeRenderObservable.add(() => {
    for (const light of scene.lights) {
      if (!light.direction || !light.rotation) continue;
      const q = light.rotationQuaternion ?? Quaternion.FromEulerVectorToRef(light.rotation, quaternion);
      const key = `${q.x},${q.y},${q.z},${q.w}`;
      if (last.get(light) === key) continue;
      last.set(light, key);
      light.direction = FORWARD.applyRotationQuaternion(q);
    }
  });
}

// Blender's light and camera point along their local -Z with +Y up: Babylon's (x, z, y) of them.
const BLENDER_FORWARD = new Vector3(0, -1, 0), BLENDER_UP = new Vector3(0, 0, 1);
const evaluatedMatrices = new WeakMap();
// A light or camera drawn at the world matrix Blender evaluated (its constraints, drivers and parents; Babylon's axes),
// as Babylon reads it: a light's position and direction in the world, a camera's view.
export function setEvaluatedMatrix(node, matrix) {
  if (!evaluatedMatrices.has(node)) {
    if (node._computeTransformedInformation) {
      // An area light: its rectangle in Blender's local XY plane, lighting along its -Z.
      node._computeTransformedInformation = () => {
        const m = evaluatedMatrices.get(node);
        m.getTranslationToRef(node._pointTransformedPosition);
        Vector3.TransformNormalToRef(new Vector3(node.width, 0, 0), m, node._pointTransformedWidth);
        Vector3.TransformNormalToRef(new Vector3(0, 0, -node.height), m, node._pointTransformedHeight);
        return true;
      };
    } else if (node.computeTransformedInformation) {
      node.computeTransformedInformation = () => {
        const m = evaluatedMatrices.get(node);
        node.transformedPosition = m.getTranslation();
        if (node.direction) node.transformedDirection = Vector3.TransformNormal(BLENDER_FORWARD, m).normalize();
        return true;
      };
    } else if (node._getViewMatrix) {
      node._isSynchronizedViewMatrix = () => false;
      // A camera locked on a target (Babylon's lockedTarget, a point or a node) looks at it from where Main puts it.
      node._getViewMatrix = () => {
        const m = evaluatedMatrices.get(node), eye = m.getTranslation(), target = node.lockedTarget?.getAbsolutePosition?.() ?? node.lockedTarget;
        if (target) Matrix.LookAtLHToRef(eye, target, node.upVector ?? Vector3.Up(), node._viewMatrix);
        else Matrix.LookAtLHToRef(eye, eye.add(Vector3.TransformNormal(BLENDER_FORWARD, m)), Vector3.TransformNormal(BLENDER_UP, m), node._viewMatrix);
        return node._viewMatrix;
      };
    }
  }
  evaluatedMatrices.set(node, matrix);
}
