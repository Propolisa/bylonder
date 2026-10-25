import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const files={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name.endsWith('.d.ts'))files['file:///'+file]=await readFile(file,'utf8')}}
await walk('node_modules/@babylonjs/core');await mkdir('public',{recursive:true});await writeFile('public/babylon-types.json',JSON.stringify(files));console.log(Object.keys(files).length+' Babylon declaration modules bundled');
