// Where the dev tools live: .tools/ of the checkout (scripts/dev-tools.mjs installs them). Importing this points
// Playwright at its Chromium there unless PLAYWRIGHT_BROWSERS_PATH says otherwise.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../.tools/', import.meta.url));
export const TOOLS = { root, playwright: join(root, 'playwright'), blender: join(root, 'blender') };
process.env.PLAYWRIGHT_BROWSERS_PATH ??= TOOLS.playwright;
// Chromium's GL: on Linux Mesa's llvmpipe through ANGLE (Chromium's default SwiftShader takes seconds a frame over
// Blender's 4D noise); on Windows D3D11 on the discrete GPU (headless Chromium otherwise takes SwiftShader, or the
// integrated GPU of a laptop); elsewhere its own GPU backend.
const GL_BY_PLATFORM = {
  linux: ['--use-gl=angle', '--use-angle=gl-egl'],
  win32: ['--enable-gpu', '--use-angle=d3d11', '--force_high_performance_gpu'],
};
export const GL_ARGS = [...(GL_BY_PLATFORM[process.platform] ?? []), '--ignore-gpu-blocklist'];
