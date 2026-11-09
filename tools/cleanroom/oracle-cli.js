// node oracle.mjs < request.json > response.json: a request, or an array of them, answered in order.
import './stdout-answers-only.js';
import { text } from 'node:stream/consumers';
import { answer } from './oracle.js';

const input = JSON.parse(await text(process.stdin));
const output = Array.isArray(input) ? input.map(answer) : answer(input);
process.stdout.write(JSON.stringify(output) + '\n');
