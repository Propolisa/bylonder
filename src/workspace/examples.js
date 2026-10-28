import { textFile } from "./project-model.js";

const json = (value) => textFile(JSON.stringify(value, null, 2));
const base = (files) => ({
  "importmap.json": json({ imports: {} }),
  "types.json": json({ imports: {} }),
  ...Object.fromEntries(Object.entries(files).map(([path, source]) => [path, textFile(source)])),
});

// Blender's startup scene. Blender's (x, y, z) is Babylon's (x, z, y).
const cube = {
  "index.js": `import { createPrimitive } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);

  createPrimitive('Cube', 'mesh.primitive_cube_add', { size: 2 }, scene);

  const camera = new BABYLON.FreeCamera('Camera', new BABYLON.Vector3(7.3589, 4.9583, -6.9258), scene);
  camera.rotation = new BABYLON.Vector3(BABYLON.Tools.ToRadians(90 - 63.559), BABYLON.Tools.ToRadians(-46.692), 0);
  // A 50 mm lens on a 36 mm sensor, fitted horizontally.
  camera.fovMode = BABYLON.Camera.FOVMODE_HORIZONTAL_FIXED;
  camera.fov = 2 * Math.atan(18 / 50);

  const light = new BABYLON.PointLight('Light', new BABYLON.Vector3(4.0762, 5.9039, 1.0055), scene);
  light.radius = 0.1;
  return scene;
};
`,
  "README.md": `# Default cube

Blender's startup scene: a 2 m cube at the origin, the camera and the point light at Blender's default transforms.
The visual parity harness (\`tools/blender-reference/parity.mjs\`) compares Bylonder with Blender on this scene.
`,
};

const solar = {
  "index.js": `import { createOrbits } from './systems/orbits.js';
import { starfield } from './systems/stars.js';

export const createScene = async function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.05, 1);

  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.1, 30, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);

  const sun = BABYLON.MeshBuilder.CreateSphere('Sun', { diameter: 3, segments: 48 }, scene);
  const glow = new BABYLON.StandardMaterial('sunMaterial', scene);
  glow.emissiveColor = new BABYLON.Color3(1, 0.7, 0.25);
  glow.disableLighting = true;
  sun.material = glow;
  new BABYLON.GlowLayer('glow', scene).intensity = 0.8;

  const light = new BABYLON.PointLight('Sunlight', BABYLON.Vector3.Zero(), scene);
  light.intensity = 1.6;
  new BABYLON.HemisphericLight('Fill', new BABYLON.Vector3(0, 1, 0), scene).intensity = 0.08;

  starfield(scene, 1200);
  createOrbits(scene);
  return scene;
};
`,
  "systems/orbits.js": `import { controls } from '@workbench/sdk';

const palette = ['#c9a27c', '#e3c16f', '#4f8fd9', '#d0573d', '#d9b38c', '#e8d9a8', '#8fd3e8', '#5b6fd9'];

export function createOrbits(scene) {
  let planets = [];
  const store = controls({
    id: 'orbits', title: 'Orbits',
    schema: {
      count: { default: 6, min: 1, max: 8, step: 1, label: 'Planets' },
      spacing: { default: 2.6, min: 1.5, max: 5, step: 0.1, label: 'Spacing' },
      speed: { default: 1, min: 0, max: 5, step: 0.05, label: 'Speed' },
      rings: { default: true, label: 'Show orbits' }
    },
    connect(store) {
      const build = store.effect(['count', 'spacing', 'rings'], ({ count, spacing, rings }) => {
        planets.forEach(p => p.dispose());
        planets = Array.from({ length: count }, (_, i) => planet(scene, i, 4 + i * spacing, rings));
      });
      let time = 0;
      const spin = scene.onBeforeRenderObservable.add(() => {
        time += scene.getEngine().getDeltaTime() / 1000 * store.values.speed;
        planets.forEach((p, i) => p.orbit(time));
      });
      return () => { build(); scene.onBeforeRenderObservable.remove(spin); planets.forEach(p => p.dispose()); };
    }
  });
  return store;
}

function planet(scene, i, radius, rings) {
  const size = 0.4 + ((i * 37) % 5) * 0.18;
  const body = BABYLON.MeshBuilder.CreateSphere('Planet ' + (i + 1), { diameter: size, segments: 24 }, scene);
  const material = new BABYLON.StandardMaterial('planet' + i, scene);
  material.diffuseColor = BABYLON.Color3.FromHexString(palette[i % palette.length]);
  material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  body.material = material;
  body.metadata = { editable: false };
  const ring = rings ? BABYLON.MeshBuilder.CreateTorus('orbit' + i, { diameter: radius * 2, thickness: 0.02, tessellation: 128 }, scene) : null;
  if (ring) { ring.isPickable = false; ring.metadata = { editable: false }; ring.material = new BABYLON.StandardMaterial('orbitLine' + i, scene); ring.material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.4); ring.material.disableLighting = true; }
  const phase = i * 2.1, rate = 1.6 / Math.sqrt(radius);
  return {
    orbit(t) { body.position.set(Math.cos(phase + t * rate) * radius, 0, Math.sin(phase + t * rate) * radius); body.rotation.y = t; },
    dispose() { body.dispose(false, true); ring?.dispose(false, true); }
  };
}
`,
  "systems/stars.js": `export function starfield(scene, count) {
  const sps = new BABYLON.PointsCloudSystem('Stars', 2, scene);
  sps.addPoints(count, particle => {
    const d = BABYLON.Vector3.Random(-1, 1).normalize().scale(80 + Math.random() * 40);
    particle.position = d;
    const b = 0.6 + Math.random() * 0.4;
    particle.color = new BABYLON.Color4(b, b, b + 0.1, 1);
  });
  return sps.buildMeshAsync().then(mesh => { mesh.isPickable = false; mesh.metadata = { editable: false }; return mesh; });
}
`,
  "README.md": `# Solar system

Multi-file project: \`index.js\` imports reactive systems from \`./systems\`.
The **Orbits** store (Properties > Scene) drives planet count, spacing and speed.
Switch the viewport to **Rendered** shading to see the scene's own background and glow.
`,
};

const arrays = {
  "index.js": `import { addModifier } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.ArcRotateCamera('camera', -2.2, 1.05, 26, new BABYLON.Vector3(0, 3, 0), scene);
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight('Sky', new BABYLON.Vector3(0.3, 1, 0.2), scene).intensity = 0.75;
  const sun = new BABYLON.DirectionalLight('Sun', new BABYLON.Vector3(-0.5, -1, 0.4), scene);
  sun.intensity = 0.8;

  const stone = new BABYLON.StandardMaterial('stone', scene);
  stone.diffuseColor = new BABYLON.Color3(0.82, 0.78, 0.7);

  const step = BABYLON.MeshBuilder.CreateBox('Stair Step', { width: 2.4, height: 0.2, depth: 0.8 }, scene);
  step.material = stone;
  step.position.set(1.4, 0.1, 0);
  addModifier(step, 'GN_ARRAY', { shape: 'Transform', count: 24, 'translation.x': 0, 'translation.y': 0.25, 'translation.z': 0, 'rotation.y': Math.PI / 10 });

  const column = BABYLON.MeshBuilder.CreateCylinder('Column', { height: 5, diameter: 0.5, tessellation: 24 }, scene);
  column.material = stone;
  column.position.set(0, 2.5, 0);
  addModifier(column, 'GN_ARRAY', { shape: 'Circle', count: 12, radius: 8, centralAxis: 'Y', alignRotation: false });

  const tile = BABYLON.MeshBuilder.CreateBox('Floor Tile', { width: 0.95, height: 0.1, depth: 0.95 }, scene);
  tile.material = new BABYLON.StandardMaterial('tile', scene);
  tile.material.diffuseColor = new BABYLON.Color3(0.35, 0.37, 0.42);
  tile.position.set(-9.5, -0.05, -9.5);
  addModifier(tile, 'GN_ARRAY', { shape: 'Line', count: 20 });
  addModifier(tile, 'GN_ARRAY', { shape: 'Line', count: 20, 'offset.x': 0, 'offset.z': 1 });
  return scene;
};
`,
  "README.md": `# Array modifiers

Spiral stair (Transform array), colonnade (Circle array) and a floor made of two stacked Line arrays.
Select an object and open **Properties > Modifiers** to edit, reorder, keyframe or Apply each array.
`,
};

const animation = {
  "index.js": `import { animate, animation } from '@workbench/sdk';

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
`,
  "README.md": `# Keyframes

Keys are created from code with \`animation.insert\` the first time the project runs, then saved with the project.
Press **Space** to play. In the Timeline use **View > Show Channels** to see every F-curve,
drag diamonds to retime, and press **I** over the viewport to key the selected object.
`,
};

const city = {
  "index.js": `import { controls } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.55, 0.68, 0.82, 1);
  const camera = new BABYLON.ArcRotateCamera('camera', -0.8, 0.95, 60, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight('Sky', new BABYLON.Vector3(0, 1, 0), scene).intensity = 0.6;
  const sun = new BABYLON.DirectionalLight('Sun', new BABYLON.Vector3(-1, -2, -1), scene);
  sun.position = new BABYLON.Vector3(40, 80, 40);
  const shadows = new BABYLON.ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;

  const ground = BABYLON.MeshBuilder.CreateGround('Ground', { width: 80, height: 80 }, scene);
  ground.receiveShadows = true;
  const block = BABYLON.MeshBuilder.CreateBox('Buildings', { size: 1 }, scene);
  block.setPivotPoint(new BABYLON.Vector3(0, -0.5, 0));
  block.material = new BABYLON.StandardMaterial('concrete', scene);
  block.material.diffuseColor = new BABYLON.Color3(0.86, 0.86, 0.9);
  block.receiveShadows = true;
  shadows.addShadowCaster(block);

  controls({
    id: 'city', title: 'City',
    schema: {
      size: { default: 14, min: 4, max: 30, step: 1, label: 'Blocks' },
      density: { default: 0.7, min: 0.1, max: 1, step: 0.05, label: 'Density' },
      height: { default: 12, min: 2, max: 40, step: 0.5, label: 'Max height' },
      seed: { default: 7, min: 1, max: 999, step: 1, label: 'Seed' }
    },
    connect(store) {
      return store.effect(['size', 'density', 'height', 'seed'], ({ size, density, height, seed }) => {
        let s = seed;
        const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
        const matrices = [];
        for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
          if (random() > density) continue;
          const w = 1.2 + random() * 1.3, h = 1 + Math.pow(random(), 2.5) * height;
          const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(w, h, w), BABYLON.Quaternion.Identity(), new BABYLON.Vector3((x - size / 2) * 3, h / 2, (z - size / 2) * 3));
          matrices.push(...m.asArray());
        }
        block.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16);
      }, { mode: 'debounce', delay: 80 });
    }
  });
  return scene;
};
`,
  "README.md": `# Procedural city

One mesh, thousands of thin instances regenerated by a debounced store effect.
Tweak **City** in Properties > Scene; values persist when *Remember scene edits* is on.
`,
};

const shader = {
  "index.js": `import vertex from './shaders/wave.vert.glsl?raw';
import fragment from './shaders/wave.frag.glsl?raw';
import { controls } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.08, 1);
  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.0, 14, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);

  const surface = BABYLON.MeshBuilder.CreateGround('Water', { width: 12, height: 12, subdivisions: 160 }, scene);
  const material = new BABYLON.ShaderMaterial('wave', scene, { vertexSource: vertex, fragmentSource: fragment }, {
    attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'amplitude', 'frequency', 'deep', 'shallow']
  });
  surface.material = material;

  const store = controls({
    id: 'waves', title: 'Waves',
    schema: {
      amplitude: { default: 0.35, min: 0, max: 1.5, step: 0.01, label: 'Amplitude' },
      frequency: { default: 1.4, min: 0.2, max: 5, step: 0.05, label: 'Frequency' },
      speed: { default: 1, min: 0, max: 4, step: 0.05, label: 'Speed' }
    },
    connect(store) {
      return store.effect(['amplitude', 'frequency'], ({ amplitude, frequency }) => {
        material.setFloat('amplitude', amplitude);
        material.setFloat('frequency', frequency);
      }, { mode: 'immediate' });
    }
  });
  material.setColor3('deep', new BABYLON.Color3(0.02, 0.15, 0.3));
  material.setColor3('shallow', new BABYLON.Color3(0.3, 0.85, 0.9));
  let time = 0;
  scene.onBeforeRenderObservable.add(() => {
    time += engine.getDeltaTime() / 1000 * store.values.speed;
    material.setFloat('time', time);
  });
  return scene;
};
`,
  "shaders/wave.vert.glsl": `precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform float time, amplitude, frequency;
varying float vHeight;
varying vec2 vUV;

void main() {
  vec3 p = position;
  float h = sin(p.x * frequency + time * 1.7) * cos(p.z * frequency * 0.8 + time * 1.3);
  h += 0.35 * sin((p.x + p.z) * frequency * 2.3 - time * 2.1);
  p.y = h * amplitude;
  vHeight = h;
  vUV = uv;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}
`,
  "shaders/wave.frag.glsl": `precision highp float;
uniform vec3 deep, shallow;
varying float vHeight;
varying vec2 vUV;

void main() {
  float t = smoothstep(-1.2, 1.2, vHeight);
  vec3 color = mix(deep, shallow, t);
  float grid = step(0.97, fract(vUV.x * 24.0)) + step(0.97, fract(vUV.y * 24.0));
  gl_FragColor = vec4(color + grid * 0.04, 1.0);
}
`,
  "README.md": `# Shader waves

GLSL lives in its own files and is imported as text with \`?raw\`.
Uniforms are driven by the **Waves** store. Use **Rendered** shading to see the scene background.
`,
};

const title = {
  "index.js": `import { createText, updateText, controls } from '@workbench/sdk';

export const createScene = async function () {
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.35, 12, new BABYLON.Vector3(0, 1, 0), scene);
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0.2, 1, -0.6), scene).intensity = 0.9;

  const text = await createText('Title', { text: 'Bylonder', family: 'Roboto', weight: 900, size: 1.6, depth: 0.4, align: 'center' }, scene);
  text.position.y = 0.6;
  const material = new BABYLON.PBRMetallicRoughnessMaterial('gold', scene);
  material.baseColor = new BABYLON.Color3(1, 0.75, 0.3);
  material.metallic = 0.9;
  material.roughness = 0.25;
  text.material = material;
  scene.createDefaultEnvironment({ createGround: false, createSkybox: false });

  controls({
    id: 'title', title: 'Title',
    schema: {
      label: { default: 'Bylonder', label: 'Text' },
      family: { default: 'Roboto', label: 'Google font' },
      weight: { default: 900, min: 100, max: 900, step: 100, label: 'Weight' }
    },
    connect(store) {
      return store.effect(['label', 'family', 'weight'], async ({ label, family, weight }) => {
        try { await updateText(text, { text: label, family, weight }); } catch (error) { console.warn(error.message); }
      }, { mode: 'debounce', delay: 300 });
    }
  });
  return scene;
};
`,
  "README.md": `# 3D text

Extruded text from any Google Fonts family (needs network access to fonts.googleapis.com).
Select the text and press **Tab** to edit it like Blender, or change the **Title** store values.
`,
};

const materials = {
  "index.js": `export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.15, 11, new BABYLON.Vector3(0, 0.8, 0), scene);
  camera.attachControl(canvas, true);
  scene.environmentTexture = BABYLON.CubeTexture.CreateFromPrefilteredData('https://assets.babylonjs.com/environments/environmentSpecular.env', scene);
  new BABYLON.HemisphericLight('Sky', new BABYLON.Vector3(0.2, 1, 0.3), scene).intensity = 0.4;

  const gold = new BABYLON.PBRMaterial('Gold', scene);
  gold.albedoColor = new BABYLON.Color3(1, 0.77, 0.34);
  gold.metallic = 1;
  gold.roughness = 0.25;

  const clay = new BABYLON.StandardMaterial('Clay', scene);
  clay.diffuseColor = new BABYLON.Color3(0.75, 0.38, 0.28);
  clay.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  const glow = new BABYLON.NodeMaterial('Glow', scene);
  glow.setToDefault();
  glow.build();
  const tint = glow.getInputBlocks().find(b => b.isUniform && b.value?.r !== undefined);
  if (tint) { tint.name = 'Tint'; tint.value = new BABYLON.Color4(0.2, 0.8, 1, 1); }

  const place = (mesh, x, material) => { mesh.position.set(x, 1, 0); mesh.material = material; return mesh; };
  place(BABYLON.MeshBuilder.CreateSphere('Gold Sphere', { diameter: 1.6, segments: 48 }, scene), -3, gold);
  place(BABYLON.MeshBuilder.CreateTorusKnot('Gold Knot', { radius: 0.55, tube: 0.18, radialSegments: 128 }, scene), 3, gold);
  place(BABYLON.MeshBuilder.CreateBox('Clay Cube', { size: 1.3 }, scene), -1, clay);
  place(BABYLON.MeshBuilder.CreateCylinder('Glow Pillar', { height: 1.6, diameter: 1.1 }, scene), 1, glow);
  const ground = BABYLON.MeshBuilder.CreateGround('Ground', { width: 12, height: 6 }, scene);
  ground.material = new BABYLON.PBRMaterial('Floor', scene);
  ground.material.albedoColor = new BABYLON.Color3(0.2, 0.2, 0.22);
  ground.material.roughness = 0.9;
  ground.material.metallic = 0;
  return scene;
};
`,
  "README.md": `# Materials and nodes

- **Gold** is one PBR material linked to two objects; its user count shows 2 in Properties > Material. Click the number to make a single-user copy.
- **Clay** is a Standard material; **Glow** is a Node Material whose **Tint** input is exposed in the Surface panel and can be keyframed.
- Select an object and open Properties > Material to browse, link, duplicate, convert (Surface type), add slots and assign project images.
- Switch any area to **Shader Editor** from the editor-type menu to edit Glow's nodes, or to **Compositor**, **Geometry Node Editor**, **Particle Node Editor** or **Logic Editor**.
`,
};

export const examples = [
  { id: "cube", title: "Default Cube", files: () => base(cube) },
  { id: "materials", title: "Materials & Nodes", files: () => base(materials) },
  { id: "solar", title: "Solar System", files: () => base(solar) },
  { id: "arrays", title: "Array Modifiers", files: () => base(arrays) },
  { id: "animation", title: "Keyframe Animation", files: () => base(animation) },
  { id: "city", title: "Procedural City", files: () => base(city) },
  { id: "shader", title: "Shader Waves", files: () => base(shader) },
  { id: "text", title: "3D Text", files: () => base(title) },
];
