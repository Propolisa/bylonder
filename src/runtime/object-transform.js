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
