import { animate, animation } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.2, 12, new BABYLON.Vector3(0, 1, 0), scene);
  camera.attachControl(canvas, true);
  const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);

  const ball = BABYLON.MeshBuilder.CreateSphere('Ball', { diameter: 1, segments: 32 }, scene);
  const paint = new BABYLON.StandardMaterial('paint', scene);
  ball.material = paint;
  BABYLON.MeshBuilder.CreateGround('Ground', { width: 10, height: 4 }, scene);

  const ballTrack = animate(ball, { id: 'ball', title: 'Ball', properties: { position: { label: 'Location' }, scaling: { label: 'Scale' } } });
  const paintTrack = animate(paint, { id: 'paint', title: 'Paint', properties: { diffuseColor: { label: 'Color' } } });
  animate(light, { id: 'light', title: 'Light', properties: { intensity: { label: 'Intensity', min: 0, max: 2 } } });

  if (!animation.action.tracks.length) {
    const key = (ref, frame, value) => animation.insert([ref], frame, value);
    [[1, -4, 3], [20, -2, 0.5], [40, 0, 2.2], [60, 2, 0.5], [80, 4, 1.6]].forEach(([f, x, y]) => {
      key(ballTrack.ref('position.x'), f, x);
      key(ballTrack.ref('position.y'), f, y);
    });
    [[19, 1], [20, 0.7], [22, 1], [59, 1], [60, 0.7], [62, 1]].forEach(([f, s]) => key(ballTrack.ref('scaling.y'), f, s));
    [[1, [0.9, 0.3, 0.2]], [40, [0.2, 0.6, 0.95]], [80, [0.95, 0.8, 0.2]]].forEach(([f, c]) => ['r', 'g', 'b'].forEach((k, i) => key(paintTrack.ref('diffuseColor.' + k), f, c[i])));
    animation.time.configure({ frameStart: 1, frameEnd: 80, loop: true });
  }
  animation.seek(animation.time.state.frameStart);
  return scene;
};
