import { Matrix, Vector3, VertexData } from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { nodeId, deleted, hasMesh } from '../editors/object/identity.js';
import { arrayDefinition, realize } from './array.js';
import { blenderModifierDefinitions, sceneModifierDefinitions, asBlenderModifier, evaluateBlenderModifiers } from './blender.js';
import { objectMesh } from '../editors/object/object-mesh.js';
import { mesh_batch_cache_apply, mesh_batch_cache_vertex_data } from '../draw/mesh-batch-cache.js';
import { mesh_serialize } from '../blenkernel/mesh/mesh.js';
export const modifierDefinitions=new Map([...blenderModifierDefinitions,...sceneModifierDefinitions,arrayDefinition].map(d=>[d.id,d]));
export function registerModifier(definition){if(!definition.id||!definition.schema||!definition.evaluate)throw Error('Invalid modifier definition');modifierDefinitions.set(definition.id,definition);}
export const modifierStack=node=>node.metadata?.wbModifiers||[];
const valid=(value,def)=>{
  // A data-block pointer (a Displace modifier's texture) is its id, or null.
  if(def.id){if(value!==null&&typeof value!=='string')throw Error('Invalid modifier value');return value;}
  if(typeof value!==typeof def.default)throw Error('Invalid modifier value');
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Modifier values must be finite');value=Math.max(def.min??-1e9,Math.min(def.max??1e9,value));if(def.integer)value=Math.round(value);}
  if(def.options&&!Object.values(def.options).includes(value))throw Error('Invalid modifier option');return value;
};
export function addModifier(node,type='GN_ARRAY',values={}){
  const definition=modifierDefinitions.get(type);if(!definition)throw Error('Unknown modifier: '+type);
  if(!node||!hasMesh(node)||node.skeleton||node.morphTargetManager)throw Error('Modifiers require a static mesh.');
  node.metadata||={};node.metadata.wbModifierBase||=VertexData.ExtractFromMesh(node).serialize();
  const modifier={id:crypto.randomUUID(),type,name:definition.name,showViewport:true,showRender:true,values:definition.defaults()};
  for(const [path,value] of Object.entries(values)){if(!definition.schema[path])throw Error('Unknown modifier property: '+path);modifier.values[path]=valid(value,definition.schema[path]);}
  node.metadata.wbModifiers=[...modifierStack(node),modifier];return modifier;
}
export function curve(node,input,{closed=false}={}){
  const paths=Array.isArray(input)&&input[0]?.points?input:[{points:input.getPoints?.()||input,closed}];
  node.metadata={...node.metadata,wbCurve:paths.map(path=>({closed:!!path.closed,points:path.points.map(p=>{const values=p.asArray?.()||p;if(!Array.isArray(values)||values.length!==3||!values.every(Number.isFinite))throw Error('Curve points require three finite coordinates');return [...values];})}))};return node;
}
// Main holds Blender's modifiers (and Bylonder's that are one of Blender's, asBlenderModifier) and its depsgraph
// evaluates them; the view draws the evaluated Mesh (draw). The stack evaluates only Bylonder's own on top: on the
// geometry Main evaluated, or on the geometry Babylon built for an object whose Mesh Main does not hold.
export function createModifierSystem(world,{commit=()=>{},notify=console.warn}={}){
  const cache=new Map(),errors=new Map(),listeners=new Set(),evaluated=new Map();let applying=false;
  const emit=()=>listeners.forEach(fn=>fn());
  // What drew, for views drawn on demand.
  const drawnListeners=new Set();
  const drawn=node=>drawnListeners.forEach(fn=>fn(node));
  const target=id=>world.objects.find(n=>nodeId(n)===id&&!deleted(n));
  function registerChannels(node,modifier){
    const definition=modifierDefinitions.get(modifier.type);if(!definition)return;
    for(const [path,def] of Object.entries(definition.schema))if(def.animatable!==false)world.animation?.register({id:'modifier:'+nodeId(node)+':'+modifier.id,path,label:def.label,group:node.name+' › '+modifier.name,options:def.options,
      available:()=>!deleted(node)&&modifierStack(node).some(m=>m.id===modifier.id),
      get:()=>modifierStack(node).find(m=>m.id===modifier.id)?.values[path]??def.default,
      set:value=>{const m=modifierStack(node).find(m=>m.id===modifier.id);if(m){m.values[path]=valid(value,def);changed(node);}}
    });
  }
  // Bylonder's own modifiers shown in the viewport, which Main does not hold.
  const ownModifiers=stack=>stack.filter(m=>m.showViewport&&!asBlenderModifier(m));
  // The geometry Babylon built, before modifiers drew (an object whose Mesh Main does not hold).
  const meshBase=node=>node.metadata.wbCreation?.mesh||node.metadata.wbCreation?.operator?mesh_batch_cache_vertex_data(objectMesh(node)).serialize():VertexData.ExtractFromMesh(node).serialize();
  const babylonBase=node=>{
    if(!node.metadata.wbModifierBase)node.metadata.wbModifierBase=VertexData.ExtractFromMesh(node).serialize();
    return node.metadata.wbModifierBase;
  };
  // What Bylonder's modifiers start from: the Mesh Main evaluated, else Babylon's geometry.
  const base=node=>evaluated.get(node)??babylonBase(node);
  function context(node,modifier){
    const p=modifier.values,other=target(p.transformObject),curve=target(p.curveObject);
    const inverse=node.computeWorldMatrix(true).clone().invert();
    const objectMatrix=other?(p.relativeSpace?other.computeWorldMatrix(true).multiply(inverse):other.computeWorldMatrix(true).clone()):null;
    let curvePaths=curve?.metadata?.wbCurve;
    if(curvePaths){const transform=curve.computeWorldMatrix(true).multiply(inverse);curvePaths=curvePaths.map(path=>({...path,points:path.points.map(point=>{const v=Vector3.TransformCoordinates(Vector3.FromArray(point),transform);return v.asArray();})}));}
    return {objectMatrix,curvePaths};
  }
  // A stack entry with its texture's settings (textures.js), which the module's Tex for it takes.
  const textureOf=m=>(m.values.texture&&world.textures?.byId(m.values.texture)?.values)||null;
  const withTexture=m=>(m.values.texture?{...m,texture:textureOf(m)}:m);
  function evaluate(node,stack){
    const own=ownModifiers(stack),definitions=own.map(m=>modifierDefinitions.get(m.type));
    if(!definitions.every(Boolean))throw Error('Unsupported modifier: '+own[definitions.indexOf(undefined)].type);
    let result={data:base(node),matrices:[Matrix.Identity()]};
    own.forEach((modifier,i)=>{result=definitions[i].evaluate(result,modifier,context(node,modifier));});
    return result;
  }
  // The Mesh's loose edges draw as a line child (mesh_batch_cache_apply); modifiers draw their result instead.
  const showLooseEdges=(node,show)=>node.getChildMeshes(true).filter(c=>c.metadata?.drawOwner===node).forEach(c=>c.setEnabled(show));
  // Thin instances the object had before its modifiers drew (from project code), which modifier results are drawn in.
  const authored=new WeakMap();
  const authoredInstances=node=>{if(!authored.has(node))authored.set(node,node.thinInstanceCount?node.thinInstanceGetWorldMatrices().map(m=>m.clone()):null);return authored.get(node);};
  const setInstances=(node,matrices)=>{
    node.thinInstanceSetBuffer('matrix',null);
    if(!matrices||(matrices.length===1&&matrices[0].isIdentity()))return;
    const buffer=new Float32Array(matrices.length*16);matrices.forEach((m,i)=>m.copyToArray(buffer,i*16));node.thinInstanceSetBuffer('matrix',buffer,16,true);node.thinInstanceEnablePicking=true;node.thinInstanceRefreshBoundingInfo(true);
  };
  const restoreInstances=node=>{showLooseEdges(node,true);setInstances(node,authored.get(node));};
  function draw(node,result,entry){
    applying=true;
    try{
      showLooseEdges(node,false);
      const instances=authoredInstances(node);
      node.thinInstanceSetBuffer('matrix',null);node.makeGeometryUnique();VertexData.Parse(result.data).applyToMesh(node);node.refreshBoundingInfo();
      setInstances(node,instances?result.matrices.flatMap(m=>instances.map(instance=>m.multiply(instance))):result.matrices);
      cache.set(node,{...entry,geometry:node.geometry});
    }finally{applying=false;}
    drawn(node);
  }
  function signature(node){
    return JSON.stringify([ownModifiers(modifierStack(node)),ownModifiers(modifierStack(node)).map(m=>{const c=context(node,m);return [c.objectMatrix?.asArray(),c.curvePaths,textureOf(m)];})]);
  }
  function report(node,error){const text=error.message;if(errors.get(nodeId(node))!==text){errors.set(nodeId(node),text);notify(text);emit();}}
  function clearError(node){if(errors.delete(nodeId(node)))emit();}
  // A stack changed: Main takes the modifiers it holds, evaluates and draws them (main-sync.js); Bylonder's draw here.
  const changed=node=>{world.mainSync?.objectChanged(node);api.refresh();};
  const api={
    definitions:modifierDefinitions,stack:modifierStack,errors,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    onDrawn(fn){drawnListeners.add(fn);return()=>drawnListeners.delete(fn);},
    add(node,type='GN_ARRAY',values={}){
      if(!node||!hasMesh(node)||node.skeleton||node.morphTargetManager)throw Error('Modifiers require a static mesh.');
      const definition=modifierDefinitions.get(type);if(!definition)throw Error('Unknown modifier');
      node.metadata||={};
      const id=crypto.randomUUID(),used=modifierStack(node).map(m=>m.name);let name=definition.name,n=1;while(used.includes(name))name=definition.name+'.'+String(n++).padStart(3,'0');
      const modifier={id,type,name,showViewport:true,showRender:true,values:definition.defaults()};
      for(const [path,value] of Object.entries(values)){if(!definition.schema[path])throw Error('Unknown modifier property: '+path);modifier.values[path]=valid(value,definition.schema[path]);}
      node.metadata.wbModifiers=[...modifierStack(node),modifier];registerChannels(node,modifier);changed(node);commit();emit();return modifier;
    },
    set(node,id,path,value,{finish=true}={}){const modifier=modifierStack(node).find(m=>m.id===id);if(!modifier)return;const def=modifierDefinitions.get(modifier.type)?.schema[path];if(!def)throw Error('Unknown modifier property');modifier.values[path]=valid(value,def);changed(node);if(finish)commit();emit();},
    update(node,id,patch){const modifier=modifierStack(node).find(m=>m.id===id);if(modifier){Object.assign(modifier,patch);changed(node);commit();emit();}},
    remove(node,id){node.metadata.wbModifiers=modifierStack(node).filter(m=>m.id!==id);changed(node);commit();emit();},
    move(node,id,index){const stack=modifierStack(node),old=stack.findIndex(m=>m.id===id);if(old<0)return;stack.splice(Math.max(0,Math.min(stack.length-1,index)),0,stack.splice(old,1)[0]);changed(node);commit();emit();},
    duplicate(node,id){const source=modifierStack(node).find(m=>m.id===id);if(source){const copy=api.add(node,source.type,structuredClone(source.values));api.move(node,copy.id,modifierStack(node).indexOf(source)+1);return copy;}},
    // Applies a modifier: one Main holds becomes the object's Mesh as Blender evaluates it on its Mesh alone, one of
    // Bylonder's its geometry, realized.
    apply(node,id){
      const modifier=modifierStack(node).find(m=>m.id===id);if(!modifier)return;
      const one={...modifier,showViewport:true},blender=asBlenderModifier(one);
      if(blender){
        const mesh=evaluateBlenderModifiers(objectMesh(node,node.metadata.wbModifierBase&&VertexData.Parse(node.metadata.wbModifierBase)),[withTexture(blender)]);
        node.metadata.wbCreation={mesh:mesh_serialize(mesh)};delete node.metadata.wbModifierBase;
      }else{
        const result=evaluate(node,[one]),data=realize(result.data,result.matrices);
        node.metadata.wbModifierBase=data;node.metadata.wbCreation={vertices:data,material:node.material?.name||null};
      }
      node.metadata.wbModifiers=modifierStack(node).filter(m=>m.id!==id);cache.delete(node);evaluated.delete(node);changed(node);commit();emit();
    },
    copyToSelected(node,id,nodes){const m=modifierStack(node).find(m=>m.id===id);if(m)for(const other of nodes)if(other!==node&&hasMesh(other))api.add(other,m.type,structuredClone(m.values));},
    // The Mesh Main evaluated for an object (main-view.js), drawn with Bylonder's modifiers on it, and the errors its
    // modifiers reported.
    draw(node,mesh,messages=[]){
      const error=messages.find(Boolean);
      if(error)report(node,Error(error));else clearError(node);
      if(!ownModifiers(modifierStack(node)).length){
        if(cache.delete(node))restoreInstances(node);
        evaluated.delete(node);
        mesh_batch_cache_apply(mesh,node);
        drawn(node);
        return;
      }
      evaluated.set(node,mesh_batch_cache_vertex_data(mesh).serialize());
      cache.delete(node);
      api.refresh();
    },
    refresh(){
      if(applying)return;
      for(const node of world.objects){
        // Files saved before Blender's Array came keep Bylonder's as ARRAY.
        for(const m of node.metadata?.wbModifiers||[])if(m.type==='ARRAY'&&'shape' in m.values)m.type='GN_ARRAY';
        // Edit Mode draws the object itself, with Blender's modifiers evaluated on the edit mesh.
        if(node.isDisposed()||deleted(node)||!hasMesh(node)||node.metadata?.editing)continue;
        const stack=modifierStack(node),own=ownModifiers(stack),prior=cache.get(node);
        for(const modifier of stack)registerChannels(node,modifier);
        if(!own.length){
          if(prior){restoreInstances(node);VertexData.Parse(prior.base).applyToMesh(node);cache.delete(node);}
          continue;
        }
        try{
          // Babylon's geometry changed under the drawn result (project code rebuilt it).
          if(prior&&!evaluated.has(node)&&(node.geometry!==prior.geometry||node.metadata.wbCreation!==prior.creation)&&node.metadata.wbModifierBase===prior.base){node.metadata.wbModifierBase=meshBase(node);cache.delete(node);}
          const sig=signature(node),from=base(node),drawnAs=cache.get(node);
          if(drawnAs?.signature===sig&&drawnAs.base===from)continue;
          draw(node,evaluate(node,stack),{signature:sig,base:from,creation:node.metadata.wbCreation});
          clearError(node);
        }catch(error){report(node,error);}
      }
    },
    // Resolves once every object's stack is drawn as it now is, as a render needs it.
    async settled(){api.refresh();},
    // An object's stack as an export keeps it live (the modifier kernels polyfill): the Mesh Blender's modifiers start
    // from, as the module takes it, and each modifier's type, settings and their DNA layouts; null unless all of the
    // modifiers it shows are Blender's.
    live(node){
      const stack=modifierStack(node).filter(m=>m.showViewport),definitions=stack.map(m=>modifierDefinitions.get(m.type)?.mesh);
      if(!stack.length||!definitions.every(d=>d&&!d.scene))return null;
      const mesh=objectMesh(node,node.metadata.wbModifierBase&&VertexData.Parse(node.metadata.wbModifierBase));
      return {mesh,modifiers:stack.map((m,i)=>({id:m.id,kind:m.type,type:definitions[i].type,values:structuredClone(m.values),layouts:definitions[i].layouts(m.values)}))};
    },
    source:node=>structuredClone(node.metadata?.wbModifierBase||VertexData.ExtractFromMesh(node).serialize()),
    dispose(){for(const [node,{base}] of cache)if(!node.isDisposed()){restoreInstances(node);VertexData.Parse(base).applyToMesh(node);}cache.clear();evaluated.clear();listeners.clear();}
  };
  return api;
}
