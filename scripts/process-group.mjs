// A child process started with the processes it starts, so that stopping it stops them all: on POSIX it leads a
// process group of its own (spawn it with `detached: POSIX`), on Windows taskkill ends its tree.
import { spawn } from 'node:child_process';

export const POSIX = process.platform !== 'win32';
export const stop = (child) => (POSIX ? process.kill(-child.pid, 'SIGKILL') : spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']));
