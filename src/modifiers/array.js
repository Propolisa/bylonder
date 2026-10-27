import { evaluateInstances } from './node-geometry.js';
import { Matrix, Quaternion, Vector3, VertexData } from '@babylonjs/core';
const number=(label,value,options={})=>({label,default:value,...options});
const choice=(label,value,values)=>({label,default:value,options:Object.fromEntries(values.map(v=>[v,v]))});
const vector=(label,value,unit)=>Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,number(label+' '+axis.toUpperCase(),value[i],{unit,step:unit==='angle'?Math.PI/180:0.01})]));
export const arraySchema={
  shape:choice('Shape','Line',['Line','Circle','Curve','Transform']),
  count:number('Count',2,{min:1,max:10000,step:1,integer:true}),
  offsetMethod:choice('Offset Method','Relative',['Relative','Offset','Endpoint']),
  countMethod:choice('Count Method','Count',['Count','Distance']),
  offset:vector('Offset',[1,0,0]),translation:vector('Translation',[1,0,0],'length'),rotation:vector('Rotation',[0,0,0],'angle'),scale:vector('Scale',[1,1,1]),
  centralAxis:choice('Central Axis','Z',['X','Y','Z']),circleSegment:choice('Circle Segment','Full',['Full','Arc']),radius:number('Radius',1,{min:0,unit:'length'}),sweepAngle:number('Sweep Angle',Math.PI,{unit:'angle'}),angularDistance:number('Angular Distance',Math.PI/4,{min:0.0001,unit:'angle'}),
  distance:number('Distance',1,{min:0.0001,unit:'length'}),perCurve:{label:'Per Curve',default:true},curveObject:{label:'Curve Object',default:'',reference:'curve',animatable:false},
  transformReference:choice('Transform Reference','Input',['Input','Object']),transformObject:{label:'Transform Object',default:'',reference:'object',animatable:false},relativeSpace:{label:'Relative Space',default:true},
  realizeInstances:{label:'Realize Instances',default:false},alignRotation:{label:'Align Rotation',default:true},localRotation:vector('Local Rotation',[0,0,0],'angle'),
  randomize:{label:'Randomize',default:false},randomOffset:vector('Offset',[0,0,0],'length'),randomRotation:vector('Rotation',[0,0,0],'angle'),scaleAxes:choice('Scale Axes','Uniform',['Uniform','Axes']),randomScale:vector('Scale',[0,0,0]),flipping:{label:'Flipping',default:false},flipX:{label:'X',default:false},flipY:{label:'Y',default:false},flipZ:{label:'Z',default:false},excludeFirst:{label:'Exclude First',default:false},excludeLast:{label:'Exclude Last',default:false},seed:number('Seed',0,{step:1,integer:true}),
  merge:{label:'Merge',default:false},mergeDistance:number('Distance',0.001,{min:0,unit:'length'})
};
export function flattenSchema(schema,prefix=''){
  return Object.fromEntries(Object.entries(schema).flatMap(([key,def])=>Object.hasOwn(def,'default')?[[prefix+key,def]]:Object.entries(flattenSchema(def,prefix+key+'.'))));
}
export const arrayFields=flattenSchema(arraySchema);
export const arrayDefaults=()=>Object.fromEntries(Object.entries(arrayFields).map(([key,def])=>[key,def.default]));
const vec=(p,key)=>new Vector3(...['x','y','z'].map(axis=>p[key+'.'+axis]));
const rotation=v=>Quaternion.FromEulerAngles(v.x,v.y,v.z);
function random(seed,index,component){let h=(seed^Math.imul(index+1,0x9e3779b9)^Math.imul(component+1,0x85ebca6b))>>>0;h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return ((h^(h>>>16))>>>0)/4294967296;}
const limits=count=>{if(!Number.isFinite(count)||count<1||count>10000)throw Error('Array requires 1–10,000 instances.');return Math.floor(count);};
function alignment(tangent,up){
  const x=tangent.normalizeToNew();let z=up.subtract(x.scale(Vector3.Dot(up,x))).normalize();
  if(z.lengthSquared()<1e-8)z=Vector3.Cross(x,Math.abs(x.y)<0.9?Vector3.Up():Vector3.Right()).normalize();
  const y=Vector3.Cross(z,x).normalize();return Quaternion.RotationQuaternionFromAxis(x,y,z);
}
function curveSamples(paths,p){
  const segments=paths.map(path=>{const points=path.points.map(v=>Vector3.FromArray(v));if(path.closed&&points.length>1)points.push(points[0]);const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Vector3.Distance(points[i-1],points[i]));return {points,distances,length:distances.at(-1),closed:path.closed};}).filter(path=>path.length>1e-9);
  if(!segments.length)throw Error('Curve Object has no non-zero-length splines.');
  const sample=(path,d)=>{let i=1;while(i<path.distances.length-1&&path.distances[i]<d)i++;const start=path.points[i-1],end=path.points[i];return {position:Vector3.Lerp(start,end,(d-path.distances[i-1])/(path.distances[i]-path.distances[i-1])),tangent:end.subtract(start)};};
  const result=[];
  const distribute=(length,closed,read)=>{const count=limits(p.countMethod==='Distance'?Math.floor(length/p.distance)+(closed?0:1):p.count);for(let i=0;i<count;i++){const d=p.countMethod==='Distance'?i*p.distance:length*i/Math.max(1,count-(closed?0:1));result.push(read(d));}};
  if(p.perCurve)for(const path of segments)distribute(path.length,path.closed,d=>sample(path,d));
  else{const total=segments.reduce((sum,path)=>sum+path.length,0);distribute(total,false,d=>{for(const path of segments){if(d<=path.length)return sample(path,d);d-=path.length;}return sample(segments.at(-1),segments.at(-1).length);});}
  return result;
}
export function arrayMatrices(p,bounds,{objectMatrix,curvePaths}={}){
  const matrices=[];let count=limits(p.count),step=Matrix.Identity();
  if(p.shape==='Transform'){
    if(p.transformReference==='Object'){if(!objectMatrix)throw Error('Choose a Transform Object.');step=objectMatrix;}
    else step=Matrix.Compose(vec(p,'scale'),rotation(vec(p,'rotation')),vec(p,'translation'));
    let matrix=Matrix.Identity();for(let i=0;i<count;i++){matrices.push(matrix);matrix=matrix.multiply(step);}
  }else if(p.shape==='Line'){
    const offset=p.offsetMethod==='Relative'?vec(p,'offset').multiply(bounds):vec(p,'translation').scale(p.offsetMethod==='Endpoint'?1/Math.max(1,count-1):1);
    for(let i=0;i<count;i++)matrices.push(Matrix.Compose(new Vector3(...['x','y','z'].map(axis=>Math.pow(p['scale.'+axis],i))),rotation(vec(p,'rotation').scale(i)),offset.scale(i)));
  }else{
    let samples;
    const up={X:Vector3.Right(),Y:Vector3.Up(),Z:Vector3.Forward()}[p.centralAxis]||Vector3.Forward();
    if(p.shape==='Circle'){
      const full=p.circleSegment==='Full',sweep=full?Math.PI*2:p.sweepAngle;
      if(p.countMethod==='Distance')count=limits(Math.max(1,Math.floor(Math.abs(sweep)/p.angularDistance)+(full?0:1)));
      const a=p.centralAxis==='X'?Vector3.Up():Vector3.Right(),b=Vector3.Cross(up,a);
      samples=Array.from({length:count},(_,i)=>{const angle=p.countMethod==='Distance'?i*p.angularDistance*Math.sign(sweep||1):sweep*i/Math.max(1,count-(full?0:1));return {position:a.scale(Math.cos(angle)*p.radius).add(b.scale(Math.sin(angle)*p.radius)),tangent:a.scale(-Math.sin(angle)).add(b.scale(Math.cos(angle)))};});
    }else if(p.shape==='Curve'){
      if(!curvePaths)throw Error('Choose a Curve Object registered with workbench.curve().');samples=curveSamples(curvePaths,p);
    }else throw Error('Unknown Array shape');
    for(const sample of samples){const q=p.alignRotation?alignment(sample.tangent,p.shape==='Curve'?Vector3.Forward():up):Quaternion.Identity();matrices.push(Matrix.Compose(Vector3.One(),rotation(vec(p,'localRotation')).multiply(q),sample.position));}
  }
  if(p.randomize)for(let i=0;i<matrices.length;i++){
    if((p.excludeFirst&&i===0)||(p.excludeLast&&i===matrices.length-1))continue;
    const unit=c=>random(p.seed|0,i,c)*2-1;
    const translate=vec(p,'randomOffset').multiply(new Vector3(unit(0),unit(1),unit(2))),rotate=vec(p,'randomRotation').multiply(new Vector3(unit(3),unit(4),unit(5)));
    const scale=new Vector3(...['x','y','z'].map((axis,j)=>(1+unit(p.scaleAxes==='Uniform'?6:6+j)*p['randomScale.'+(p.scaleAxes==='Uniform'?'x':axis)])*(p.flipping&&p['flip'+axis.toUpperCase()]&&random(p.seed|0,i,9+j)<0.5?-1:1)));
    matrices[i]=Matrix.Compose(scale,rotation(rotate),translate).multiply(matrices[i]);
  }
  return matrices;
}
export function geometryBounds(data,matrices=[Matrix.Identity()]){
  const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
  for(const matrix of matrices)for(let i=0;i<data.positions.length;i+=3){const p=Vector3.TransformCoordinates(Vector3.FromArray(data.positions,i),matrix);min.minimizeInPlace(p);max.maximizeInPlace(p);}return max.subtract(min);
}
export function realize(data,matrices){
  if(data.positions.length/3*matrices.length>1000000)throw Error('Evaluated mesh exceeds 1,000,000 vertices. Reduce Count or disable Realize Instances.');
  return evaluateInstances(data,matrices);
}
export function mergeVertices(data,distance){
  if(distance<=0)return data;
  const out=structuredClone(data),cells=new Map(),representatives=[],canonical=[];
  for(let i=0;i<data.positions.length;i+=3){const p=Vector3.FromArray(data.positions,i),cell=p.asArray().map(v=>Math.floor(v/distance));let found=-1;
    for(let x=-1;x<=1&&found<0;x++)for(let y=-1;y<=1&&found<0;y++)for(let z=-1;z<=1&&found<0;z++)for(const j of cells.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[])if(Vector3.DistanceSquared(p,Vector3.FromArray(data.positions,j*3))<=distance*distance){found=j;break;}
    if(found<0){found=i/3;const key=cell.join(',');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(found);}canonical.push(found);
  }
  const remap=new Map(),indices=[];const attributes=Object.entries(data).filter(([key,value])=>Array.isArray(value)&&key!=='indices'&&value.length&&value.length%(data.positions.length/3)===0);
  for(const [key] of attributes)out[key]=[];
  for(let i=0;i<canonical.length;i++){
    const origin=canonical[i],signature=JSON.stringify([origin,...attributes.filter(([key])=>key!=='positions').map(([key,values])=>values.slice(i*values.length/canonical.length,(i+1)*values.length/canonical.length))]);
    if(!remap.has(signature)){remap.set(signature,representatives.length);representatives.push(i);for(const [key,values] of attributes){const stride=values.length/canonical.length,start=(key==='positions'?origin:i)*stride;out[key].push(...values.slice(start,start+stride));}}
    indices[i]=remap.get(signature);
  }
  out.indices=[];for(let i=0;i<data.indices.length;i+=3){const triangle=data.indices.slice(i,i+3).map(j=>indices[j]);if(new Set(triangle).size===3)out.indices.push(...triangle);}return out;
}
export const arrayDefinition={id:'GN_ARRAY',name:'Array (Nodes)',category:'Generate',icon:'MOD_ARRAY',schema:arrayFields,defaults:arrayDefaults,evaluate(input,modifier,context){
  const p=modifier.values,transforms=arrayMatrices(p,geometryBounds(input.data,input.matrices),context);
  if(input.matrices.length*transforms.length>10000)throw Error('Modifier stack exceeds 10,000 instances.');
  const matrices=transforms.flatMap(transform=>input.matrices.map(matrix=>matrix.multiply(transform)));
  if(!p.realizeInstances)return {...input,matrices};
  let data=realize(input.data,matrices);if(p.merge)data=mergeVertices(data,p.mergeDistance);return {data,matrices:[Matrix.Identity()]};
}};
