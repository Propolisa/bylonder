// Installs the dev tools into .tools/ of the checkout (git-ignored; deleting it removes them all, nothing else on the
// machine changes): Playwright's Chromium (.tools/playwright) and the reference Blender (.tools/blender). ffmpeg comes
// with the dev dependencies in node_modules.
// usage: npm run tools
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../tests/e2e/tools.mjs';

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: TOOLS.playwright };
execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url)), 'install', 'chromium'], { env, stdio: 'inherit' });
execFileSync(process.execPath, [fileURLToPath(new URL('../tools/blender-reference/install.mjs', import.meta.url))], { stdio: 'inherit' });
