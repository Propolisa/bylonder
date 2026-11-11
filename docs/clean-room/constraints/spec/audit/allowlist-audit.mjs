// Runs the clean room's audit.mjs unchanged on a copy of a transcript in which allowlisted paths are replaced by
// placeholders, so only commands that reach other paths stay flagged.
// usage: node allowlist-audit.mjs <audit.mjs> <transcript.jsonl> <out.jsonl>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const ALLOW = [
  ['<BLENDER>', 'Users/nifty/Downloads/bylonder/.tools/blender/blender-5.2.3-windows-x64/blender.exe'],
  ['<WORK>', 'Users/nifty/Downloads/bylonder-constraints-spec'],
];
const variants = (path) => [`/c/${path}`, `C:/${path}`, `C:\${path.replaceAll('/', '\')}`, `C:\\${path.replaceAll('/', '\\')}`];
let text = readFileSync(process.argv[3], 'utf8');
for (const [token, path] of ALLOW) for (const v of variants(path)) text = text.split(v).join(token);
writeFileSync(process.argv[4], text);
process.stdout.write(`allowlist: ${JSON.stringify(ALLOW.map(([t, p]) => `${t} = C:/${p}`))}\n`);
process.stdout.write(execFileSync('node', [process.argv[2], process.argv[4]], { encoding: 'utf8', maxBuffer: 1 << 26 }));
