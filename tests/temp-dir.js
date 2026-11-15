// A new temporary folder that goes when the process exits, however it exits (an assertion thrown, process.exit), so
// tests leave nothing behind in the system's temp folder.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
