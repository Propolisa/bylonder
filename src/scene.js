import {
  Engine,
  Scene,
  Color3,
  Color4,
  Vector3,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  ShadowGenerator,
} from "@babylonjs/core";
export function createWorld(canvas) {
  const engine = new Engine(canvas, true, {
    stencil: true,
    preserveDrawingBuffer: false,
  });
  engine.setHardwareScalingLevel(Math.max(1, devicePixelRatio / 2));
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.065, 0.083, 0.115, 1);
  const camera = new ArcRotateCamera(
    "Orbit",
    -Math.PI / 2.8,
    Math.PI / 2.9,
    13,
    new Vector3(0, 0.6, 0),
    scene,
  );
  camera.minZ = 0.05;
  camera.maxZ = 2000;
  camera.lowerRadiusLimit = 0.4;
  camera.upperRadiusLimit = 200;
  camera.inertia = 0;
  const fill = new HemisphericLight("Fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.65;
  fill.groundColor = new Color3(0.12, 0.15, 0.22);
  const key = new DirectionalLight("Key", new Vector3(-0.5, -1, 0.4), scene);
  key.position = new Vector3(5, 9, -5);
  key.intensity = 2;
  const shadows = new ShadowGenerator(2048, key);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 32;
  const mat = (name, color) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.FromHexString(color);
    m.specularColor = new Color3(0.25, 0.25, 0.25);
    return m;
  };
  const cube = MeshBuilder.CreateBox("Cube", { size: 1.8 }, scene);
  cube.position.set(0, 0.9, 0);
  cube.material = mat("Sage", "#afc49c");
  const sphere = MeshBuilder.CreateSphere(
    "Sphere",
    { diameter: 1.45, segments: 48 },
    scene,
  );
  sphere.position.set(-2.7, 0.725, 0.2);
  sphere.material = mat("Porcelain", "#c4cbd7");
  const torus = MeshBuilder.CreateTorus(
    "Torus",
    { diameter: 1.6, thickness: 0.42, tessellation: 64 },
    scene,
  );
  torus.position.set(2.65, 1, 0.15);
  torus.rotation.x = Math.PI / 2.3;
  torus.material = mat("Terracotta", "#bc8063");
  const objects = [cube, sphere, torus];
  objects.forEach((m) => {
    m.metadata = { editable: true };
    shadows.addShadowCaster(m);
  });
  const floor = MeshBuilder.CreateGround(
    "Ground",
    { width: 200, height: 200 },
    scene,
  );
  floor.position.y = -0.025;
  floor.material = mat("Ground", "#202937");
  floor.receiveShadows = true;
  floor.isPickable = false;
  const lines = [];
  for (let i = -30; i <= 30; i++) {
    lines.push(
      [new Vector3(i, 0, -30), new Vector3(i, 0, 30)],
      [new Vector3(-30, 0, i), new Vector3(30, 0, i)],
    );
  }
  const grid = MeshBuilder.CreateLineSystem("Grid", { lines }, scene);
  grid.color = new Color3(0.2, 0.25, 0.32);
  grid.alpha = 0.3;
  grid.isPickable = false;
  const axis = (name, points, color) => {
    const l = MeshBuilder.CreateLines(name, { points }, scene);
    l.color = Color3.FromHexString(color);
    l.alpha = 0.45;
    l.isPickable = false;
    return l;
  };
  const axes = [
    axis(
      "X axis",
      [new Vector3(-30, 0.005, 0), new Vector3(30, 0.005, 0)],
      "#985757",
    ),
    axis(
      "Z axis",
      [new Vector3(0, 0.005, -30), new Vector3(0, 0.005, 30)],
      "#567e91",
    ),
  ];
  return { engine, scene, camera, objects, fill, key, grid, axes, shadows };
}
