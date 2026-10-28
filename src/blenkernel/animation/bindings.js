import { address } from './model.js';
import { nodeId, deleted } from '../../editors/object/identity.js';

export function registerStore(animation, id, title, store) {
  for(const [key,def] of Object.entries(store.schema)) {
    if(def.animatable===false)continue;
    const value=store.values[key];
    if(['number','boolean','string'].includes(typeof value))animation.register({id:'store:'+id,path:key,label:def.label||key,group:title,options:def.options,get:()=>store.values[key],set:value=>store.set(key,value)});
  }
}
export function registerObjects(animation, objects) {
  for(const node of objects){
    if(node.isDisposed()||deleted(node))continue;
    for(const property of ['position','rotation','scaling'])for(const axis of ['x','y','z'])animation.register({
      id:'object:'+nodeId(node),path:property+'.'+axis,group:node.name,label:({position:'Location',rotation:'Rotation',scaling:'Scale'})[property]+' '+axis.toUpperCase(),transform:true,target:node,property:property+'.'+axis,
      available:()=>!node.isDisposed()&&!deleted(node),
      get:()=>property==='rotation'&&node.rotationQuaternion?node.rotationQuaternion.toEulerAngles()[axis]:node[property][axis],
      set:value=>{if(property==='rotation'&&node.rotationQuaternion){node.rotation.copyFrom(node.rotationQuaternion.toEulerAngles());node.rotationQuaternion=null;}node[property][axis]=value;}
    });
  }
}
export const objectRefs=(nodes,property)=>nodes.flatMap(node=>(property?[property]:['position','rotation','scaling']).flatMap(prop=>['x','y','z'].map(axis=>address('object:'+nodeId(node),prop+'.'+axis))));

export function bindProperties(animation,target,{id,title=id,properties}) {
  if(!id)throw Error('Animated targets require a stable id');
  const schema={};
  const expanded = {};
  for(const [path,definition] of Object.entries(properties)){
    if(path.split('.').some(p=>['__proto__','prototype','constructor'].includes(p)))throw Error('Invalid property path');
    const value=path.split('.').reduce((o,k)=>o[k],target);
    if(value&&typeof value==='object'){
      const components=['x','y','z','w','r','g','b','a'].filter(k=>typeof value[k]==='number');
      if(!components.length)throw Error('Choose scalar or vector/color properties: '+path);
      for(const component of components)expanded[path+'.'+component]={...definition,label:(definition.label||path)+' '+component.toUpperCase()};
    }else expanded[path]=definition;
  }
  for(const [path,definition] of Object.entries(expanded)){
    const parts=path.split('.');if(parts.some(p=>['__proto__','prototype','constructor'].includes(p)))throw Error('Invalid property path');
    const owner=()=>parts.slice(0,-1).reduce((value,key)=>value[key],target),key=parts.at(-1);
    const get=()=>owner()[key],set=value=>{owner()[key]=value;};
    const def=typeof definition==='object'?definition:{};
    schema[path]={default:get(),...def};
    if(def.animatable!==false)animation.register({id,path,label:def.label||path,group:title,get,set,target,property:path,available:()=>!target.isDisposed?.(),options:def.options});
  }
  return {id,title,schema,target,ref:path=>address(id,path)};
}
