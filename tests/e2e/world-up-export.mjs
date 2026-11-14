// The world-up fixture's page bundled for WebGL 2 and WebGPU into <dir>/WEBGL2 and <dir>/WEBGPU, in a process of its own
// (Blender's module holds one Main, and prod.mjs has opened another).
//   usage: node tests/e2e/world-up-export.mjs <dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openExample } from "../open-example.js";
import { exportModule } from "../../src/io_scene_babylon/js-export.js";
import { bundledFiles } from "../export-package.js";

const dir = process.argv[2];
const { world, sync } = openExample(new URL("../fixtures/world-up.blend", import.meta.url));
sync.view();
for (const target of ["WEBGL2", "WEBGPU"]) {
  for (const [path, data] of Object.entries(await bundledFiles(await exportModule(world, { bundle: true, target })))) {
    mkdirSync(dirname(join(dir, target, path)), { recursive: true });
    writeFileSync(join(dir, target, path), data);
  }
}
process.exit(0);
