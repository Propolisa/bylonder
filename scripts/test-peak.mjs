// Preloaded into every Node process a unit test starts (scripts/run-tests.mjs): appends the process's peak memory in MB
// to TEST_PEAK_FILE on exit, so the runner knows how much memory each test needs.
import { appendFileSync } from 'node:fs';

process.on('exit', () => appendFileSync(process.env.TEST_PEAK_FILE, `${Math.ceil(process.resourceUsage().maxRSS / 1024)}\n`));
