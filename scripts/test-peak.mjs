// Preloaded into every Node process a unit test starts (scripts/run-tests.mjs): appends the process's start and end
// times and its peak memory in MB to TEST_PEAK_FILE on exit, so the runner knows how much memory each test needs with
// the processes it ran at once. A process started without the variable (a child given an environment of its own)
// reports nothing.
import { appendFileSync } from 'node:fs';

const file = process.env.TEST_PEAK_FILE;
if (file) process.on('exit', () => appendFileSync(file, `${performance.timeOrigin} ${Date.now()} ${Math.ceil(process.resourceUsage().maxRSS / 1024)}\n`));
