import assert from 'node:assert/strict';
import { NullEngine, Scene, Mesh } from '@babylonjs/core';
import { textGeometry } from '../src/blenkernel/text/geometry.js';
import { applyText, textDefaults } from '../src/blenkernel/text/text.js';
import { snapshot, apply, createHistory } from '../src/editors/undo/storage.js';
import { sceneMain } from './scene-main.js';
const engine = new NullEngine(), scene = new Scene(engine);
const ring = points => [{command:'moveTo',args:points[0]},...points.slice(1).map(args=>({command:'lineTo',args})),{command:'closePath',args:[]}];
const font = {unitsPerEm:1,layout:()=>({glyphs:[{path:{commands:[...ring([[0,0],[3,0],[3,3],[0,3]]),...ring([[1,1],[1,2],[2,2],[2,1]])]}}],positions:[{xAdvance:3,xOffset:0,yOffset:0}]})};
const data = textGeometry(font,{...textDefaults,text:'O',depth:0.2},scene);
let frontArea = 0;
for(let i=0;i<data.indices.length;i+=3){
  const points=data.indices.slice(i,i+3).map(index=>data.positions.slice(index*3,index*3+3));
  if(points.every(p=>Math.abs(p[2])<1e-8)){
    const [a,b,c]=points;
    frontArea+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  }
}
assert.equal(frontArea,8,'Counter must remain hollow');
assert(data.positions.every(Number.isFinite));
const node=new Mesh('Text',scene), objects=[node];objects.scene=scene;
node.metadata={wbId:'text'};
applyText(node,{data,values:{...textDefaults,text:'O'}});
const history=createHistory(objects,()=>{},{main:sceneMain({scene,objects})});
applyText(node,{data:textGeometry(font,{...textDefaults,text:'O',size:2},scene),values:{...textDefaults,text:'O',size:2}});
history.commit();history.undo();
assert.equal(node.metadata.wbCreation.text.size,1);
assert.equal(node.getBoundingInfo().boundingBox.maximum.x,3);
const restored=[];restored.scene=scene;
apply(restored,snapshot(objects));
assert.equal(restored[0].metadata.wbCreation.text.text,'O');
assert.equal(restored[0].getTotalVertices(),node.getTotalVertices());
scene.dispose();engine.dispose();
console.log('Text: hollow extrusion, geometry undo and persisted restoration passed');
