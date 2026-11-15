// The world-up fixture's page bundled for WebGL 2 and WebGPU into <dir>/WEBGL2 and <dir>/WEBGPU, in a process of its own
// (Blender's module holds one Main, and prod.mjs has opened another). Each stage logs its time, so a hang names its stage.
//   usage: node tests/e2e/world-up-export.mjs <dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openExample } from "../open-example.js";
import { exportModule } from "../../src/io_scene_babylon/js-export.js";
import { bundledFiles } from "../export-package.js";

const stage = async (name, work) => {
  const at = Date.now();
  console.log(`      world-up: ${name}`);
  const result = await work();
  console.log(`      world-up: ${name} done (${Date.now() - at} ms)`);
  return result;
};
const dir = process.argv[2];
const { world, sync } = await stage("open", () => openExample(new URL("../fixtures/world-up.blend", import.meta.url)));
sync.view();
for (const target of ["WEBGL2", "WEBGPU"]) {
  const files = await stage(`export ${target}`, () => exportModule(world, { bundle: true, target }));
  const bundled = await stage(`bundle ${target}`, () => bundledFiles(files));
  await stage(`write ${target}`, () => {
    for (const [path, data] of Object.entries(bundled)) {
      mkdirSync(dirname(join(dir, target, path)), { recursive: true });
      writeFileSync(join(dir, target, path), data);
    }
  });
}
process.exit(0);
