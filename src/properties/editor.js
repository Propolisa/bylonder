import { createApp,h,reactive,watch,Teleport } from 'vue';
import { Panel,PropertyRow } from './primitives.js';
import { icon,iconButton } from './icons.js';
import { propertyContexts,propertyPanels } from './registry.js';
import { arrayFields } from '../modifiers/array.js';
import { nodeId,deleted } from '../objects/identity.js';
import { address } from '../animation/model.js';
import { materialPanels } from '../materials/panel.js';
import { createPreview } from '../materials/preview.js';
import { bindGraph } from '../graphs/bindings.js';
import { geometryGraph } from '../graphs/geometry-nodes.js';
import { particlePanels, compositingPanel } from '../graphs/panels.js';
import { scenePanels, worldPanels } from '../scene/panels.js';
import './style.css';
export function mountProperties(host,{world,editor,history,storage,systems,properties,files=[]},areaId='properties',header){
  const key='workbench:properties:'+areaId;let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
  const preview=createPreview();
  const state=reactive({context:saved.context||'object',closed:saved.closed||[],opened:saved.opened||[],panels:[],pinned:null,revision:0,add:false,search:'',activeModifier:null,previewUrl:'',previewFor:null});
  watch(()=>[state.context,state.closed,state.opened],()=>{try{localStorage.setItem(key,JSON.stringify({context:state.context,closed:state.closed,opened:state.opened}));}catch{}},{deep:true});
  const active=()=>state.pinned?world.objects.find(n=>nodeId(n)===state.pinned&&!deleted(n)):editor.selection.nodes.at(-1);
  const commit=()=>{history.commit();editor.selection.sync();state.revision++;};
  const row=field=>h(PropertyRow,{key:field.id||field.label,field,animation:world.animation,commit});
  const panel=(id,title,content,{subpanel=false,actions,defaultClosed=false}={})=>{if(!state.panels.includes(id))state.panels.push(id);return h(Panel,{key:id,panelId:id,title,state,subpanel,actions,defaultClosed},{default:content});};
  const transform=()=>{
    const node=active();if(!node)return h('p',{class:'bl-message'},'No active object.');
    return panel('transform','Transform',()=>[
      ...[['position','Location','length'],['rotation','Rotation','angle'],['scaling','Scale',null]].map(([property,label,unit])=>h('div',{class:'bl-vector'},['x','y','z'].map((axis,i)=>{
        const path=property+'.'+axis,ref=address('object:'+nodeId(node),path),get=()=>world.animation.channels.get(ref)?.get()??node[property][axis];
        return row({id:path,label:(i===0?label+' ':'')+axis.toUpperCase(),default:property==='scaling'?1:0,unit,step:property==='rotation'?Math.PI/180:0.01,min:property==='scaling'?0.001:undefined,
          get,set:value=>{world.animation.channels.get(ref)?.set(value);editor.selection.sync();},refs:()=>[ref],disabled:()=>!!node.metadata?.wbTransformLocks?.[path],
          lock:{get:()=>!!node.metadata?.wbTransformLocks?.[path],set:value=>{node.metadata.wbTransformLocks={...node.metadata.wbTransformLocks,[path]:value};}}
        });
      }))),
      h('div',{class:'bl-property',title:'XYZ Euler · radians in Babylon, degrees in this editor'},[h('label','Rotation Mode'),h('span',{class:'bl-number'},'XYZ Euler'),h('span')])
    ]);
  };
  const modifierPanel=(node,modifier,index)=>{
    const id='modifier.'+modifier.id,values=modifier.values,definition=world.modifiers.definitions.get(modifier.type);
    if(!definition)return h('p',{class:'bl-error'},'Unknown modifier '+modifier.type);
    const field=path=>{const def=definition.schema[path];return row({...def,id:id+'.'+path,get:()=>modifier.values[path],set:(value,finish)=>world.modifiers.set(node,modifier.id,path,value,{finish:false}),refs:()=>def.animatable===false?[]:[address('modifier:'+nodeId(node)+':'+modifier.id,path)],choices:()=>world.objects.filter(n=>n!==node&&!deleted(n)&&(def.reference!=='curve'||n.metadata?.wbCurve)).map(n=>[nodeId(n),n.name])});};
    const vector=(path,label)=>h('div',{class:'bl-vector'},['x','y','z'].map((axis,i)=>{const def=definition.schema[path+'.'+axis];return row({...def,id:id+'.'+path+'.'+axis,label:(i===0?label+' ':'')+axis.toUpperCase(),get:()=>modifier.values[path+'.'+axis],set:value=>world.modifiers.set(node,modifier.id,path+'.'+axis,value,{finish:false}),refs:()=>[address('modifier:'+nodeId(node)+':'+modifier.id,path+'.'+axis)]});}));
    const actions=()=>[
      iconButton(modifier.showViewport?'RESTRICT_VIEW_OFF':'RESTRICT_VIEW_ON','Display modifier in viewport',()=>world.modifiers.update(node,modifier.id,{showViewport:!modifier.showViewport}),{'aria-pressed':modifier.showViewport}),
      h('details',{class:'bl-modifier-menu'},[h('summary',{title:'Modifier operations'},'⌄'),h('div',[
        ...[['Apply',()=>world.modifiers.apply(node,modifier.id)],['Duplicate',()=>world.modifiers.duplicate(node,modifier.id)],['Copy to Selected',()=>world.modifiers.copyToSelected(node,modifier.id,editor.selection.nodes)],['Move Up',()=>world.modifiers.move(node,modifier.id,index-1)],['Move Down',()=>world.modifiers.move(node,modifier.id,index+1)],['Move to First',()=>world.modifiers.move(node,modifier.id,0)],['Move to Last',()=>world.modifiers.move(node,modifier.id,world.modifiers.stack(node).length-1)]].map(([label,run])=>h('button',{onClick:e=>{e.target.closest('details').open=false;try{run();}catch(error){world.notify(error.message);}}},label))
      ])]),iconButton('REMOVE','Remove modifier',()=>world.modifiers.remove(node,modifier.id))
    ];
    const content=()=>{
      if(modifier.type==='NODES'){const rows=bindGraph(world.animation,{id:'modifier:'+nodeId(node)+':'+modifier.id+':graph',title:node.name+' › '+modifier.name,graph:()=>geometryGraph(modifier),kind:'geometry',onChange:()=>{modifier.revision=(modifier.revision||0)+1;world.modifiers.refresh();}}).map(f=>row({...f,default:undefined}));return [...(rows.length?rows:[h('p',{class:'bl-message'},'Add Input blocks to the node group to expose values here.')]),h('button',{type:'button',class:'bl-wide-button',onClick:()=>world.openNodeEditor?.('geometry')},[icon('GEOMETRY_NODES'),'Edit in Geometry Node Editor'])];}
      if(modifier.type!=='ARRAY')return Object.keys(definition.schema).filter(path=>!definition.schema[path].hidden).map(field);
      const p=values,result=[field('shape')];
      if(['Circle','Curve'].includes(p.shape))result.push(field('countMethod'));
      if(!['Circle','Curve'].includes(p.shape)||p.countMethod==='Count')result.push(field('count'));
      if(p.shape==='Line'){result.push(field('offsetMethod'),vector(p.offsetMethod==='Relative'?'offset':'translation',p.offsetMethod==='Relative'?'Offset':'Translation'),vector('rotation','Rotation'),vector('scale','Scale'));}
      if(p.shape==='Circle'){if(p.countMethod==='Distance')result.push(field('angularDistance'));result.push(field('centralAxis'),field('circleSegment'),field('radius'));if(p.circleSegment==='Arc')result.push(field('sweepAngle'));}
      if(p.shape==='Curve'){if(p.countMethod==='Distance')result.push(field('distance'));result.push(field('perCurve'),field('curveObject'));}
      if(p.shape==='Transform'){result.push(field('transformReference'));if(p.transformReference==='Object')result.push(field('transformObject'),field('relativeSpace'));else result.push(vector('translation','Translation'),vector('rotation','Rotation'),vector('scale','Scale'));}
      result.push(field('realizeInstances'));
      if(['Circle','Curve'].includes(p.shape))result.push(panel(id+'.align','Align Rotation',()=>[field('alignRotation'),...(p.alignRotation?[vector('localRotation','Local Rotation')]:[])],{subpanel:true}));
      result.push(panel(id+'.random','Randomize',()=>[field('randomize'),...(p.randomize?[vector('randomOffset','Offset'),vector('randomRotation','Rotation'),field('scaleAxes'),...(p.scaleAxes==='Uniform'?[field('randomScale.x')]:[vector('randomScale','Scale')]),field('flipping'),...(p.flipping?[field('flipX'),field('flipY'),field('flipZ')]:[]),field('excludeFirst'),field('excludeLast'),field('seed')]:[])],{subpanel:true}));
      if(p.realizeInstances)result.push(panel(id+'.merge','Merge',()=>[field('merge'),...(p.merge?[field('mergeDistance')]:[])],{subpanel:true}));
      return result;
    };
    return h('div',{class:{'active-modifier':state.activeModifier===modifier.id},onClick:()=>state.activeModifier=modifier.id},[panel(id,modifier.name,()=>[
      h('div',{class:'bl-datablock'},[icon(definition.icon,{class:'bl-icon bl-modifier-color'}),h('input',{value:modifier.name,title:'Modifier name',onChange:e=>world.modifiers.update(node,modifier.id,{name:e.target.value||definition.name})})]),...content()
    ],{actions})]);
  };
  const modifiers=()=>{
    const node=active();if(!node?.getTotalVertices?.())return h('p',{class:'bl-message'},'Select a mesh to add modifiers.');
    return [h('button',{class:'bl-add-modifier',onClick:()=>state.add=!state.add,title:'Add Modifier (Shift-A)'},[icon('ADD'),' Add Modifier']),state.add?h('div',{class:'bl-add-menu'},[
      h('input',{placeholder:'Search…',value:state.search,onInput:e=>state.search=e.target.value}),h('strong','Generate'),
      ...[...world.modifiers.definitions.values()].filter(d=>d.name.toLowerCase().includes(state.search.toLowerCase())).map(d=>h('button',{onClick:()=>{try{const m=world.modifiers.add(node,d.id);state.activeModifier=m.id;state.add=false;}catch(error){world.notify(error.message);}}},[icon(d.icon,{class:'bl-icon bl-modifier-color'}),d.name]))
    ]):null,...world.modifiers.stack(node).map((m,i)=>modifierPanel(node,m,i)),world.modifiers.errors.get(nodeId(node))?h('p',{class:'bl-message bl-error'},world.modifiers.errors.get(nodeId(node))):null];
  };
  const scene=()=>[
    ...(world.sceneSettings?scenePanels({world,row,panel}):[]),
    ...(world.compositor?[compositingPanel({world,row,panel})]:[]),
    ...systems.map(system=>panel('store.'+system.id,system.title,()=>Object.entries(system.store.schema).map(([path,def])=>row({...def,id:'store.'+system.id+'.'+path,label:def.label||path,get:()=>system.store.values[path],set:value=>system.store.set(path,value),refs:()=>def.animatable===false?[]:[address('store:'+system.id,path)]})))),
    ...properties.map(definition=>panel('data.'+definition.id,definition.title,()=>Object.entries(definition.schema).map(([path,def])=>{const parts=path.split('.'),owner=()=>parts.slice(0,-1).reduce((o,k)=>o[k],definition.target),key=parts.at(-1);return row({...def,id:definition.id+'.'+path,label:def.label||path,get:()=>owner()[key],set:value=>owner()[key]=value,refs:()=>def.animatable===false?[]:[address(definition.id,path)]});}))),
    panel('local','Local State',()=>[row({label:'Remember Scene Edits',default:false,get:()=>storage.enabled,set:value=>storage.set(value)}),h('button',{onClick:()=>storage.clear()},'Forget Saved Scene Edits')])
  ];
  const sceneLevel=()=>state.context==='scene'||state.context==='world';
  const breadcrumb=node=>{
    const sceneName=world.sceneSettings?.state.name||'Scene',w=world.worlds?.active();
    if(state.context==='world')return [icon('SCENE_DATA'),h('span',{class:'bl-crumb'},sceneName),icon('RIGHTARROW_THIN',{class:'bl-icon bl-crumb-sep'}),icon('WORLD'),h('span',{class:'bl-context-name'},w?.name||'')];
    if(sceneLevel()||!node)return [icon('SCENE_DATA'),h('span',{class:'bl-context-name',title:sceneName},sceneName)];
    return [icon('OBJECT_DATA',{class:'bl-icon bl-object-color'}),h('span',{class:'bl-context-name',title:node.name},node.name)];
  };
  const app=createApp({setup(){return()=>{state.revision;const node=active();return h('section',{class:'bl-properties',onKeydown:e=>{if(e.target.closest('input,textarea,select'))return;if(e.shiftKey&&e.key.toLowerCase()==='a'&&state.context==='modifiers'){e.preventDefault();e.stopPropagation();state.add=true;}else if(e.ctrlKey&&e.key==='Tab'){e.preventDefault();e.stopPropagation();const ids=[...propertyContexts.keys()],i=ids.indexOf(state.context);state.context=ids[(i+(e.shiftKey?-1:1)+ids.length)%ids.length];}}},[
      (header?(c=>h(Teleport,{to:header},[c])):(c=>c))(h('div',{class:'bl-header'},[...breadcrumb(node),iconButton(state.pinned?'PINNED':'UNPINNED',state.pinned?'Unpin Properties context':'Pin Properties context',()=>state.pinned=state.pinned?null:node?nodeId(node):null,{'aria-pressed':!!state.pinned})])),
      h('div',{class:'bl-body'},[
        h('nav',{class:'bl-tabs',role:'tablist','aria-label':'Properties context'},[...propertyContexts.values()].map(context=>iconButton(context.icon,context.title,()=>state.context=context.id,{role:'tab','aria-selected':state.context===context.id,style:{color:context.color}}))),
        h('div',{class:'bl-region'},[
          node&&!sceneLevel()?h('div',{class:'bl-datablock'},[icon('OBJECT_DATA',{class:'bl-icon bl-object-color'}),h('input',{value:node.name,title:'Object name',onChange:e=>{node.name=e.target.value||node.name;commit();}})]):null,
          state.context==='object'?transform():state.context==='modifiers'?modifiers():state.context==='scene'?scene():state.context==='world'&&world.worlds?worldPanels({world,row,panel,files}):state.context==='material'&&world.materials?materialPanels({world,editor,node,row,panel,state,preview}):state.context==='particles'&&world.particles?particlePanels({world,node,row,panel}):null,
          ...[...propertyPanels.values()].filter(p=>p.context===state.context&&(!p.poll||p.poll({world,node}))).map(p=>panel(p.id,p.title,()=>p.render({world,node,row,panel,commit})))
        ])
      ])
    ]);};}});
  app.mount(host);
  const unsubscribers=[world.modifiers.subscribe(()=>state.revision++),...[world.materials,world.particles,world.compositor,world.sceneSettings,world.worlds].filter(Boolean).map(source=>source.subscribe(()=>state.revision++)),...systems.map(s=>s.store.subscribe(()=>state.revision++))];
  return {refresh(){state.revision++;},context(id){state.context=id;},dispose(){unsubscribers.forEach(fn=>fn());preview.dispose();app.unmount();}};
}
