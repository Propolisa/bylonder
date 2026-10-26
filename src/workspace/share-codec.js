import { normalizeAnimation } from '../animation/model.js';
import { gzipSync, Gunzip, strToU8, strFromU8 } from 'fflate';
import { validateFiles, normalizePath } from './project-model.js';
import { storedScenes } from './scenes.js';
const MAX_BYTES=8*1024*1024, MAX_HASH=128*1024;
function validate(payload){
  if(payload?.version!==1||typeof payload.name!=='string'||payload.name.length>200)throw Error('Invalid shared project.');
  validateFiles(payload.files);
  if(Object.keys(payload.files).length>2000)throw Error('Too many files in shared project.');
  if(!Array.isArray(payload.folders)||payload.folders.length>2000)throw Error('Invalid shared folders.');
  payload.folders.forEach(normalizePath);
  if(!payload.settings||typeof payload.settings!=='object'||Array.isArray(payload.settings))throw Error('Invalid project settings.');
  payload.settings={...payload.settings,remember:!!payload.settings.remember};
  if(!payload.overrides||typeof payload.overrides!=='object'||Array.isArray(payload.overrides))throw Error('Invalid scene overrides.');
  if(payload.animation) payload.animation=normalizeAnimation(payload.animation);
  if(payload.scenes&&(!Array.isArray(payload.scenes)||payload.scenes.some(s=>typeof s?.id!=='string'||typeof s.name!=='string')))throw Error('Invalid scenes.');
  return payload;
}
const sharedScenes=(project,includeOverrides)=>{const stored=storedScenes(project);return stored.scenes?{scene:stored.scene,scenes:stored.scenes.map(s=>includeOverrides||!s.overrides?s:{...s,overrides:{}})}:{};};
export function encodeProject(project,{includeOverrides=true,overrides=project.overrides}={}){
  const payload={animation:project.animation||null,version:1,name:project.name,files:project.files,folders:project.folders||[],sourceVersion:project.head||null,settings:{...project.settings,remember:includeOverrides},overrides:includeOverrides?(overrides||{}):{},...sharedScenes(project,includeOverrides)};
  validate(payload);
  const bytes=strToU8(JSON.stringify(payload));
  if(bytes.length>MAX_BYTES)throw Error('Project is too large for a link. Export a project ZIP instead.');
  const compressed=gzipSync(bytes,{level:9});
  let binary='';for(let i=0;i<compressed.length;i+=32768)binary+=String.fromCharCode(...compressed.subarray(i,i+32768));
  const hash='#project=v1.'+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(hash.length>MAX_HASH)throw Error('Project exceeds the 128 KB link limit. Export a project ZIP instead.');
  return hash;
}
export function decodeProject(hash){
  if(!hash.startsWith('#project=v1.')||hash.length>MAX_HASH)throw Error('Unsupported or oversized project link.');
  const encoded=hash.slice(12);if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error('Malformed project link.');
  const input=Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  let size=0;const chunks=[];
  const unzip=new Gunzip(chunk=>{size+=chunk.length;if(size>MAX_BYTES)throw Error('Shared project exceeds the decoded size limit.');chunks.push(chunk);});
  for(let i=0;i<input.length;i+=1024)unzip.push(input.subarray(i,i+1024),i+1024>=input.length);
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return validate(JSON.parse(strFromU8(bytes)));
}
