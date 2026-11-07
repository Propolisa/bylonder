// Where the dev tools live: .tools/ of the checkout (scripts/dev-tools.mjs installs them). Importing this points
// Playwright at its Chromium there unless PLAYWRIGHT_BROWSERS_PATH says otherwise.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../.tools/', import.meta.url));
export const TOOLS = { root, playwright: join(root, 'playwright'), blender: join(root, 'blender') };
process.env.PLAYWRIGHT_BROWSERS_PATH ??= TOOLS.playwright;
// Chromium's GL: on Linux Mesa's llvmpipe through ANGLE (Chromium's default SwiftShader takes seconds a frame over
// Blender's 4D noise); elsewhere its own GPU backend.
export const GL_ARGS = process.platform === 'linux' ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
