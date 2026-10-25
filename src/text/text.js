import { Mesh } from '@babylonjs/core';
import { loadFont } from './fonts.js';
import { textGeometry } from './geometry.js';
export const textSchema = {
  text: {default:'Text'}, family: {default:'Roboto'}, weight: {default:400,min:100,max:900,step:100}, italic:{default:false},
  size:{default:1,min:0.05,max:20,step:0.05}, depth:{default:0.15,min:0.01,max:5,step:0.01},
  spacing:{default:0,min:-0.2,max:2,step:0.01}, lineHeight:{default:1.2,min:0.5,max:3,step:0.05},
  resolution:{default:8,min:2,max:32,step:1}, align:{default:'left',options:{Left:'left',Center:'center',Right:'right'}},
};
export const textDefaults = Object.fromEntries(Object.entries(textSchema).map(([key,field])=>[key,field.default]));
export async function prepareText(options, scene) {
  const values = {...textDefaults,...options};
  if (typeof values.text !== 'string' || typeof values.family !== 'string') throw Error('Text and family must be strings.');
  for (const [key, schema] of Object.entries(textSchema)) if (typeof schema.default === 'number' && (!Number.isFinite(values[key]) || values[key] < schema.min || values[key] > schema.max)) throw Error('Invalid text option: ' + key);
  values.resolution = Math.round(values.resolution);
  if(values.text.length>2000) throw Error('Text is limited to 2,000 characters per object.');
  const {font,previewFamily} = await loadFont(values);
  return {data:textGeometry(font,values,scene),values,previewFamily};
}
export function applyText(node, prepared) {
  prepared.data.applyToMesh(node);
  node.metadata = {...node.metadata,wbCreation:{text:prepared.values,vertices:prepared.data.serialize(),material:node.material?.name||null}};
  node.refreshBoundingInfo();
}
export async function createText(name, options, scene) {
  const prepared = await prepareText(options,scene);
  const node = new Mesh(name,scene);
  node.metadata = {editable:true,wbId:crypto.randomUUID()};
  applyText(node,prepared);
  return node;
}

const generations = new WeakMap();
export async function updateText(node, options) {
  const generation = (generations.get(node) || 0) + 1;
  generations.set(node, generation);
  const prepared = await prepareText({...node.metadata?.wbCreation?.text,...options},node.getScene());
  if (!node.isDisposed() && generations.get(node) === generation) applyText(node,prepared);
  return node;
}
