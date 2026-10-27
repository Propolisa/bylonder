import { Matrix, Vector3, VertexData } from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { nodeId, deleted } from '../editors/object/identity.js';
import { arrayDefinition, realize } from './array.js';
import { blenderModifierDefinitions, evaluateBlenderModifiers } from './blender.js';
import { objectMesh } from '../editors/object/object-mesh.js';
import { mesh_batch_cache_vertex_data } from '../draw/mesh-batch-cache.js';
import { mesh_serialize } from '../blenkernel/mesh/mesh.js';
export const modifierDefinitions=new Map([...blenderModifierDefinitions,arrayDefinition].map(d=>[d.id,d]));
export function registerModifier(definition){if(!definition.id||!definition.schema||!definition.evaluate)throw Error('Invalid modifier definition');modifierDefinitions.set(definition.id,definition);}
export const modifierStack=node=>node.metadata?.wbModifiers||[];
const valid=(value,def)=>{
  if(typeof value!==typeof def.default)throw Error('Invalid modifier value');
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Modifier values must be finite');value=Math.max(def.min??-1e9,Math.min(def.max??1e9,value));if(def.integer)value=Math.round(value);}
  if(def.options&&!Object.values(def.options).includes(value))throw Error('Invalid modifier option');return value;
};
export function addModifier(node,type='GN_ARRAY',values={}){
  const definition=modifierDefinitions.get(type);if(!definition)throw Error('Unknown modifier: '+type);
  if(!node?.getTotalVertices?.()||node.skeleton||node.morphTargetManager)throw Error('Modifiers require a static mesh.');
  node.metadata||={};node.metadata.wbModifierBase||=VertexData.ExtractFromMesh(node).serialize();
  const modifier={id:crypto.randomUUID(),type,name:definition.name,showViewport:true,showRender:true,values:definition.defaults()};
  for(const [path,value] of Object.entries(values)){if(!definition.schema[path])throw Error('Unknown modifier property: '+path);modifier.values[path]=valid(value,definition.schema[path]);}
  node.metadata.wbModifiers=[...modifierStack(node),modifier];return modifier;
}
export function curve(node,input,{closed=false}={}){
  const paths=Array.isArray(input)&&input[0]?.points?input:[{points:input.getPoints?.()||input,closed}];
  node.metadata={...node.metadata,wbCurve:paths.map(path=>({closed:!!path.closed,points:path.points.map(p=>{const values=p.asArray?.()||p;if(!Array.isArray(values)||values.length!==3||!values.every(Number.isFinite))throw Error('Curve points require three finite coordinates');return [...values];})}))};return node;
}
export function createModifierSystem(world,{commit=()=>{},notify=console.warn}={}){
  const cache=new Map(),errors=new Map(),listeners=new Set();let applying=false;
  const emit=()=>listeners.forEach(fn=>fn());
  const target=id=>world.objects.find(n=>nodeId(n)===id&&!deleted(n));
  function registerChannels(node,modifier){
    const definition=modifierDefinitions.get(modifier.type);if(!definition)return;
    for(const [path,def] of Object.entries(definition.schema))if(def.animatable!==false)world.animation?.register({id:'modifier:'+nodeId(node)+':'+modifier.id,path,label:def.label,group:node.name+' › '+modifier.name,options:def.options,
      available:()=>!deleted(node)&&modifierStack(node).some(m=>m.id===modifier.id),
      get:()=>modifierStack(node).find(m=>m.id===modifier.id)?.values[path]??def.default,
      set:value=>{const m=modifierStack(node).find(m=>m.id===modifier.id);if(m)m.values[path]=valid(value,def);}
    });
  }
  const base=node=>{
    if(!node.metadata.wbModifierBase)node.metadata.wbModifierBase=VertexData.ExtractFromMesh(node).serialize();
    return node.metadata.wbModifierBase;
  };
  function context(node,modifier){
    const p=modifier.values,other=target(p.transformObject),curve=target(p.curveObject);
    const inverse=node.computeWorldMatrix(true).clone().invert();
    const objectMatrix=other?(p.relativeSpace?other.computeWorldMatrix(true).multiply(inverse):other.computeWorldMatrix(true).clone()):null;
    let curvePaths=curve?.metadata?.wbCurve;
    if(curvePaths){const transform=curve.computeWorldMatrix(true).multiply(inverse);curvePaths=curvePaths.map(path=>({...path,points:path.points.map(point=>{const v=Vector3.TransformCoordinates(Vector3.FromArray(point),transform);return v.asArray();})}));}
    return {objectMatrix,curvePaths};
  }
  const blenderMesh=(node,modifiers)=>evaluateBlenderModifiers(objectMesh(node,VertexData.Parse(base(node))),modifiers);
  // Blender's modifiers run first, together, in the module on the object's Mesh; Bylonder's then take their result.
  function evaluate(node,stack=modifierStack(node)){
    const visible=stack.filter(m=>m.showViewport),definitions=visible.map(m=>modifierDefinitions.get(m.type));
    if(!definitions.every(Boolean))throw Error('Unsupported modifier: '+visible[definitions.indexOf(undefined)].type);
    const leading=definitions.findIndex(d=>!d.mesh),count=leading<0?visible.length:leading;
    if(definitions.slice(count).some(d=>d.mesh))throw Error('Blender modifiers go before '+definitions[count].name+' in the stack.');
    const data=count?mesh_batch_cache_vertex_data(blenderMesh(node,visible.slice(0,count))).serialize():base(node);
    let result={data,matrices:[Matrix.Identity()]};
    for(const modifier of visible.slice(count))result=modifierDefinitions.get(modifier.type).evaluate(result,modifier,context(node,modifier));
    return result;
  }
  function draw(node,result){
    applying=true;
    try{
      node.thinInstanceSetBuffer('matrix',null);node.makeGeometryUnique();VertexData.Parse(result.data).applyToMesh(node);
      if(result.matrices.length!==1||!result.matrices[0].isIdentity()){
        const buffer=new Float32Array(result.matrices.length*16);result.matrices.forEach((m,i)=>m.copyToArray(buffer,i*16));node.thinInstanceSetBuffer('matrix',buffer,16,true);node.thinInstanceEnablePicking=true;node.thinInstanceRefreshBoundingInfo(true);
      }else node.refreshBoundingInfo();
      cache.set(node,{signature:signature(node),geometry:node.geometry,result,base:node.metadata.wbModifierBase,creation:node.metadata.wbCreation});
    }finally{applying=false;}
  }
  function signature(node){
    return JSON.stringify([modifierStack(node),modifierStack(node).map(m=>{const c=context(node,m);return [c.objectMatrix?.asArray(),c.curvePaths];})]);
  }
  const api={
    definitions:modifierDefinitions,stack:modifierStack,errors,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    add(node,type='GN_ARRAY',values={}){
      if(!node?.getTotalVertices?.()||node.skeleton||node.morphTargetManager)throw Error('Modifiers require a static mesh.');
      const definition=modifierDefinitions.get(type);if(!definition)throw Error('Unknown modifier');
      node.metadata||={};base(node);
      const id=crypto.randomUUID(),used=modifierStack(node).map(m=>m.name);let name=definition.name,n=1;while(used.includes(name))name=definition.name+'.'+String(n++).padStart(3,'0');
      const modifier={id,type,name,showViewport:true,showRender:true,values:definition.defaults()};
      for(const [path,value] of Object.entries(values)){if(!definition.schema[path])throw Error('Unknown modifier property: '+path);modifier.values[path]=valid(value,definition.schema[path]);}
      node.metadata.wbModifiers=[...modifierStack(node),modifier];registerChannels(node,modifier);api.refresh();commit();emit();return modifier;
    },
    set(node,id,path,value,{finish=true}={}){const modifier=modifierStack(node).find(m=>m.id===id);if(!modifier)return;const def=modifierDefinitions.get(modifier.type)?.schema[path];if(!def)throw Error('Unknown modifier property');modifier.values[path]=valid(value,def);api.refresh();if(finish)commit();emit();},
    update(node,id,patch){const modifier=modifierStack(node).find(m=>m.id===id);if(modifier){Object.assign(modifier,patch);api.refresh();commit();emit();}},
    remove(node,id){node.metadata.wbModifiers=modifierStack(node).filter(m=>m.id!==id);api.refresh();commit();emit();},
    move(node,id,index){const stack=modifierStack(node),old=stack.findIndex(m=>m.id===id);if(old<0)return;stack.splice(Math.max(0,Math.min(stack.length-1,index)),0,stack.splice(old,1)[0]);api.refresh();commit();emit();},
    duplicate(node,id){const source=modifierStack(node).find(m=>m.id===id);if(source){const copy=api.add(node,source.type,structuredClone(source.values));api.move(node,copy.id,modifierStack(node).indexOf(source)+1);return copy;}},
    apply(node,id){const modifier=modifierStack(node).find(m=>m.id===id);if(!modifier)return;const one=[{...modifier,showViewport:true}];
      if(modifierDefinitions.get(modifier.type).mesh){const mesh=blenderMesh(node,one);node.metadata.wbModifierBase=mesh_batch_cache_vertex_data(mesh).serialize();node.metadata.wbCreation={mesh:mesh_serialize(mesh)};}
      else{const result=evaluate(node,one),data=realize(result.data,result.matrices);node.metadata.wbModifierBase=data;node.metadata.wbCreation={vertices:data,material:node.material?.name||null};}node.metadata.wbModifiers=modifierStack(node).filter(m=>m.id!==id);cache.delete(node);api.refresh();commit();emit();},
    copyToSelected(node,id,nodes){const m=modifierStack(node).find(m=>m.id===id);if(m)for(const other of nodes)if(other!==node&&other.getTotalVertices?.())api.add(other,m.type,structuredClone(m.values));},
    refresh(){
      if(applying)return;
      for(const node of world.objects){
        // Files saved before Blender's Array came keep Bylonder's as ARRAY.
        for(const m of node.metadata?.wbModifiers||[])if(m.type==='ARRAY'&&'shape' in m.values)m.type='GN_ARRAY';
        if(node.isDisposed()||deleted(node)||!node.getTotalVertices?.())continue;
        const stack=modifierStack(node),prior=cache.get(node);
        if(!stack.length&&!prior)continue;
        if(!stack.length&&prior&&!node.metadata.wbModifierBase){node.thinInstanceSetBuffer('matrix',null);VertexData.Parse(prior.base).applyToMesh(node);cache.delete(node);continue;}
        try{
          for(const modifier of stack)registerChannels(node,modifier);
          if(prior&&(node.geometry!==prior.geometry||node.metadata.wbCreation!==prior.creation)&&node.metadata.wbModifierBase===prior.base){node.metadata.wbModifierBase=VertexData.ExtractFromMesh(node).serialize();cache.delete(node);}
          const sig=signature(node);if(cache.get(node)?.signature===sig&&cache.get(node)?.base===node.metadata.wbModifierBase)continue;
          draw(node,evaluate(node));errors.delete(nodeId(node));
        }catch(error){const text=error.message;if(errors.get(nodeId(node))!==text){errors.set(nodeId(node),text);notify(text);emit();}}
      }
    },
    source:node=>structuredClone(node.metadata?.wbModifierBase||VertexData.ExtractFromMesh(node).serialize()),
    evaluated:node=>evaluate(node),
    dispose(){for(const [node] of cache)if(!node.isDisposed()){node.thinInstanceSetBuffer('matrix',null);if(node.metadata?.wbModifierBase)VertexData.Parse(node.metadata.wbModifierBase).applyToMesh(node);}cache.clear();listeners.clear();}
  };
  return api;
}
