import { Matrix, Vector3, VertexData } from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { nodeId, deleted, hasMesh } from '../editors/object/identity.js';
import { arrayDefinition, realize } from './array.js';
import { blenderModifierDefinitions, evaluation, estimatedFaces } from './blender.js';
import { evaluateHere } from './evaluator.js';
import { objectMesh } from '../editors/object/object-mesh.js';
import { mesh_batch_cache_vertex_data } from '../draw/mesh-batch-cache.js';
import { mesh_serialize } from '../blenkernel/mesh/mesh.js';
export const modifierDefinitions=new Map([...blenderModifierDefinitions,arrayDefinition].map(d=>[d.id,d]));
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
// More faces than this, by a stack's estimate, are asked about before evaluating.
const ASK_FACES=4e6;
// Gives fn's value, or what its promise resolves to, to ok, and its error to fail: without jobs, evaluations are
// synchronous (tests).
const settle=(fn,ok,fail)=>{let value;try{value=fn();}catch(error){return fail(error);}return value instanceof Promise?value.then(ok,fail):ok(value);};
const then=(value,fn)=>value instanceof Promise?value.then(fn):fn(value);
// Errors that go back to what evaluated last: the user stopped the evaluation, or the module failed.
const reverts=error=>error.by==='user'||error.name==='EvaluationFailed';
// `evaluate` runs Blender's modifiers (evaluator.js); `jobs` (wm-jobs.js) runs evaluations off the main thread.
export function createModifierSystem(world,{commit=()=>{},notify=console.warn,evaluate:evaluator=evaluateHere,jobs=null}={}){
  const cache=new Map(),errors=new Map(),listeners=new Set(),requested=new Map(),good=new Map();let applying=false;
  const emit=()=>listeners.forEach(fn=>fn());
  // What a finished evaluation drew, for views drawn on demand.
  const drawnListeners=new Set();
  const target=id=>world.objects.find(n=>nodeId(n)===id&&!deleted(n));
  const run=(owner,name,work)=>jobs?jobs.run(owner,name,work):work();
  function registerChannels(node,modifier){
    const definition=modifierDefinitions.get(modifier.type);if(!definition)return;
    for(const [path,def] of Object.entries(definition.schema))if(def.animatable!==false)world.animation?.register({id:'modifier:'+nodeId(node)+':'+modifier.id,path,label:def.label,group:node.name+' › '+modifier.name,options:def.options,
      available:()=>!deleted(node)&&modifierStack(node).some(m=>m.id===modifier.id),
      get:()=>modifierStack(node).find(m=>m.id===modifier.id)?.values[path]??def.default,
      set:value=>{const m=modifierStack(node).find(m=>m.id===modifier.id);if(m)m.values[path]=valid(value,def);}
    });
  }
  // The geometry before modifiers: the object's Mesh when it has one, else what it draws.
  const meshBase=node=>node.metadata.wbCreation?.mesh||node.metadata.wbCreation?.operator?mesh_batch_cache_vertex_data(objectMesh(node)).serialize():VertexData.ExtractFromMesh(node).serialize();
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
  // A stack entry with its texture's settings (textures.js), which the module's Tex for it takes.
  const textureOf=m=>(m.values.texture&&world.textures?.byId(m.values.texture)?.values)||null;
  const withTexture=m=>(m.values.texture?{...m,texture:textureOf(m)}:m);
  const jobName=(node,modifiers)=>node.name+' | '+modifiers.map(m=>m.name).join(', ');
  const blenderModifiers=stack=>stack.filter(m=>m.showViewport&&modifierDefinitions.get(m.type)?.mesh);
  // Work running Blender's modifiers on a Mesh, copied now. It asks first when they would make very many faces.
  function blenderWork(mesh,modifiers,selectmode){
    const input=evaluation(mesh,modifiers.map(withTexture),selectmode),faces=estimatedFaces(mesh,modifiers);
    const question=`About ${Math.round(faces).toLocaleString('en-US')} faces, which can take very long or run out of memory`;
    return (signal,job)=>then(faces>ASK_FACES?job?.ask(question):null,()=>evaluator(input,signal));
  }
  const objectWork=(node,modifiers)=>blenderWork(objectMesh(node,VertexData.Parse(base(node))),modifiers);
  // Blender's modifiers run first, together, in the module on the object's Mesh; Bylonder's then take their result.
  function evaluate(node,stack,signal,job){
    const visible=stack.filter(m=>m.showViewport),definitions=visible.map(m=>modifierDefinitions.get(m.type));
    if(!definitions.every(Boolean))throw Error('Unsupported modifier: '+visible[definitions.indexOf(undefined)].type);
    const leading=definitions.findIndex(d=>!d.mesh),count=leading<0?visible.length:leading;
    if(definitions.slice(count).some(d=>d.mesh))throw Error('Blender modifiers go before '+definitions[count].name+' in the stack.');
    const after=visible.slice(count);
    const finish=mesh=>{
      // Bylonder's modifiers take serialized data; drawing takes typed arrays, which serializing a big mesh is slow to leave.
      const data=mesh&&mesh_batch_cache_vertex_data(mesh);
      let result={data:data?(after.length?data.serialize():data):base(node),matrices:[Matrix.Identity()]};
      for(const modifier of after)result=modifierDefinitions.get(modifier.type).evaluate(result,modifier,context(node,modifier));
      return result;
    };
    return count?then(objectWork(node,visible.slice(0,count))(signal,job),finish):finish(null);
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
  function draw(node,result,request){
    applying=true;
    try{
      showLooseEdges(node,!request.stack.some(m=>m.showViewport));
      const instances=authoredInstances(node);
      node.thinInstanceSetBuffer('matrix',null);node.makeGeometryUnique();VertexData.Parse(result.data).applyToMesh(node);node.refreshBoundingInfo();
      setInstances(node,instances?result.matrices.flatMap(m=>instances.map(instance=>m.multiply(instance))):result.matrices);
      cache.set(node,{signature:request.signature,geometry:node.geometry,result,base:request.base,creation:request.creation});
      good.set(node,request.stack);
    }finally{applying=false;}
    drawnListeners.forEach(fn=>fn(node));
  }
  function signature(node){
    return JSON.stringify([modifierStack(node),modifierStack(node).map(m=>{const c=context(node,m);return [c.objectMatrix?.asArray(),c.curvePaths,textureOf(m)];})]);
  }
  function report(node,error){const text=error.message;if(errors.get(nodeId(node))!==text){errors.set(nodeId(node),text);notify(text);emit();}}
  // Goes back to the stack that evaluated last, as an undo step. When that is the stack as it is (the geometry made
  // the evaluation too much), Blender's modifiers are hidden in the viewport instead.
  function revert(node,name,error){
    const last=good.get(node),stack=modifierStack(node);
    if(last&&JSON.stringify(last)!==JSON.stringify(stack))node.metadata.wbModifiers=structuredClone(last);
    else for(const m of blenderModifiers(stack))m.showViewport=false;
    notify(name+': '+(error.by==='user'?'cancelled':error.message));commit();emit();
  }
  // Evaluates an object's stack as a job, drawing the last result until it is done.
  function start(node,signature,base){
    const stack=structuredClone(modifierStack(node)),request={signature,base,creation:node.metadata.wbCreation,stack},name=jobName(node,blenderModifiers(stack));
    const done=()=>{request.done=true;if(requested.get(node)===request)requested.delete(node);};
    requested.set(node,request);
    request.promise=settle(()=>run(node,name,(signal,job)=>evaluate(node,stack,signal,job)),result=>{
      done();if(node.isDisposed())return;draw(node,result,request);errors.delete(nodeId(node));
    },error=>{
      if(error.by==='superseded')return done();
      // A failed stack stays requested, so it is not evaluated again until it changes.
      if(!reverts(error)){request.done=true;return report(node,error);}
      done();revert(node,name,error);
    });
  }
  const api={
    definitions:modifierDefinitions,stack:modifierStack,errors,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    onDrawn(fn){drawnListeners.add(fn);return()=>drawnListeners.delete(fn);},
    add(node,type='GN_ARRAY',values={}){
      if(!node||!hasMesh(node)||node.skeleton||node.morphTargetManager)throw Error('Modifiers require a static mesh.');
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
    // Applies a modifier, as a job of its own: a promise with jobs.
    apply(node,id){
      const modifier=modifierStack(node).find(m=>m.id===id);if(!modifier)return;
      const one=[{...modifier,showViewport:true}],blender=!!modifierDefinitions.get(modifier.type).mesh,from=node.metadata.wbModifierBase;
      return then(run({},'Apply '+jobName(node,one),blender?objectWork(node,one):(signal,job)=>evaluate(node,one,signal,job)),result=>{
        if(node.isDisposed()||node.metadata.wbModifierBase!==from||!modifierStack(node).includes(modifier))throw Error(node.name+' changed while applying '+modifier.name);
        if(blender){node.metadata.wbModifierBase=mesh_batch_cache_vertex_data(result).serialize();node.metadata.wbCreation={mesh:mesh_serialize(result)};}
        else{const data=realize(result.data,result.matrices);node.metadata.wbModifierBase=data;node.metadata.wbCreation={vertices:data,material:node.material?.name||null};}
        node.metadata.wbModifiers=modifierStack(node).filter(m=>m.id!==id);cache.delete(node);api.refresh();commit();emit();
      });
    },
    // An object's Blender modifiers in Edit Mode, on a Mesh of its edit mesh in a select mode: the final Mesh, null
    // without modifiers or when they fail, or undefined when a newer evaluation replaced this one; a promise with jobs.
    editFinal(node,mesh,selectmode){
      const stack=structuredClone(modifierStack(node)),modifiers=blenderModifiers(stack),name=jobName(node,modifiers);
      if(!modifiers.length)return null;
      return settle(()=>run(node,name,blenderWork(mesh,modifiers,selectmode)),final=>{good.set(node,stack);return final;},error=>{
        if(error.by==='superseded')return undefined;
        if(reverts(error))revert(node,name,error);else notify(error.message);
        return null;
      });
    },
    copyToSelected(node,id,nodes){const m=modifierStack(node).find(m=>m.id===id);if(m)for(const other of nodes)if(other!==node&&hasMesh(other))api.add(other,m.type,structuredClone(m.values));},
    refresh(){
      if(applying)return;
      for(const node of world.objects){
        // Files saved before Blender's Array came keep Bylonder's as ARRAY.
        for(const m of node.metadata?.wbModifiers||[])if(m.type==='ARRAY'&&'shape' in m.values)m.type='GN_ARRAY';
        // Edit Mode draws the object itself, with Blender's modifiers evaluated on the edit mesh.
        if(node.isDisposed()||deleted(node)||!hasMesh(node)||node.metadata?.editing)continue;
        const stack=modifierStack(node),prior=cache.get(node);
        if(!stack.length&&!prior)continue;
        if(!stack.length&&prior&&!node.metadata.wbModifierBase){restoreInstances(node);VertexData.Parse(prior.base).applyToMesh(node);cache.delete(node);continue;}
        try{
          for(const modifier of stack)registerChannels(node,modifier);
          if(prior&&(node.geometry!==prior.geometry||node.metadata.wbCreation!==prior.creation)&&node.metadata.wbModifierBase===prior.base){node.metadata.wbModifierBase=meshBase(node);cache.delete(node);}
          const sig=signature(node),from=node.metadata.wbModifierBase,request=requested.get(node),drawn=cache.get(node);
          if(drawn?.signature===sig&&drawn.base===from){if(request){requested.delete(node);jobs?.cancel(node);}continue;}
          if(request?.signature!==sig||request.base!==from)start(node,sig,from);
        }catch(error){report(node,error);}
      }
    },
    // Resolves once every object's stack is drawn as it now is, as a render needs it.
    async settled(){for(;;){api.refresh();const pending=[...requested.values()].filter(r=>!r.done).map(r=>r.promise);if(!pending.length)return;await Promise.all(pending);}},
    // An object's stack as an export keeps it live (the modifier kernels polyfill): the Mesh Blender's modifiers start
    // from, as the module takes it, and each modifier's type, settings and their DNA layouts; null unless all of the
    // modifiers it shows are Blender's.
    live(node){
      const stack=modifierStack(node).filter(m=>m.showViewport),definitions=stack.map(m=>modifierDefinitions.get(m.type)?.mesh);
      if(!stack.length||!definitions.every(Boolean))return null;
      const mesh=objectMesh(node,VertexData.Parse(base(node)));
      return {mesh,modifiers:stack.map((m,i)=>({id:m.id,kind:m.type,type:definitions[i].type,values:structuredClone(m.values),layouts:definitions[i].layouts(m.values)}))};
    },
    source:node=>structuredClone(node.metadata?.wbModifierBase||VertexData.ExtractFromMesh(node).serialize()),
    dispose(){for(const node of requested.keys())jobs?.cancel(node);for(const [node] of cache)if(!node.isDisposed()){restoreInstances(node);if(node.metadata?.wbModifierBase)VertexData.Parse(node.metadata.wbModifierBase).applyToMesh(node);}cache.clear();listeners.clear();}
  };
  return api;
}
