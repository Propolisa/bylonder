import { mountDock } from './dock.js';
import { RUNTIME_LAYOUT_KEY } from './model.js';
import { treeTypes } from '../space_node/node-editor.js';
// Split positions of the Layout screen in Blender's startup.blend, from its area vertices in pixels (1920 x 1080
// window, vertex ranges 1919 and 1033): Blender scales them with the window, so they are fractions here.
const share=(a,b)=>[100*a/(a+b),100*b/(a+b)];
const LAYOUT_SPLITS={root:share(1577,342),animation:share(956,77),inspector:share(191,842)};
// The Scripting screen: the 3D Viewport over the Python Console and Info, the Text Editor, and the Outliner over the
// Properties editor (Blender's two Outliners are one here).
const SCRIPTING_SPLITS={root:share(561,1358),left:share(395,638),console:share(466,172),rest:share(1016,342),side:share(425,608)};
const SCRIPTING_AREAS=['viewport','console','info','text','objects','properties'];
// The Shading screen: the File Browser, the 3D Viewport over the Shader Editor, and the Outliner over the Properties
// editor (Blender's Image Editor under the File Browser is not there yet, so the File Browser takes its column).
const SHADING_SPLITS={root:share(292,1627),rest:share(1285,342),middle:share(516,517),side:share(191,842)};
const SHADING_AREAS=['files','viewport','nodes','objects','properties'];
export function mountRuntimeLayout(){
  const host=document.querySelector('main');host.classList.add('runtime-dock');
  const viewport=document.createElement('section');viewport.id='viewport-section';
  const panel=document.querySelector('#panel');
  const properties=document.createElement('section');properties.id='properties-section';properties.append(document.querySelector('#pane'));
  for(const child of [...host.children]){
    if(child===panel)continue;
    if(['gesture-cursor','gesture-guide'].includes(child.id))document.body.append(child);
    else viewport.append(child);
  }
  const timeline=document.createElement('section');timeline.id='timeline-section';
  const dopesheet=document.createElement('section');dopesheet.id='dopesheet-section';
  const graph=document.createElement('section');graph.id='graph-section';
  const nodes=document.createElement('section');nodes.id='nodes-section';
  const sequencer=document.createElement('section');sequencer.id='sequencer-section';
  const files=document.createElement('section');files.id='files-section';
  const [text,pythonConsole,info]=['text','console','info'].map(id=>Object.assign(document.createElement('section'),{id:id+'-section'}));
  const variants=Object.entries(treeTypes).map(([id,t])=>({label:t.label,icon:t.icon,run:()=>nodes.dispatchEvent(new CustomEvent('node-tree',{detail:id}))}));
  const items=[{id:'viewport',title:'3D Viewport',icon:'view3d',element:viewport,overlap:true},{id:'objects',title:'Outliner',icon:'outliner',element:panel},{id:'properties',title:'Properties',icon:'properties',element:properties},{id:'timeline',title:'Timeline',icon:'time',element:timeline},{id:'dopesheet',title:'Dope Sheet',icon:'action',element:dopesheet},{id:'graph',title:'Graph Editor',icon:'graph',element:graph},{id:'nodes',title:'Node Editor',icon:'nodetree',element:nodes,variants},{id:'sequencer',title:'Video Sequencer',icon:'sequence',element:sequencer},{id:'files',title:'File Browser',icon:'filebrowser',element:files},{id:'text',title:'Text Editor',icon:'text',element:text},{id:'console',title:'Python Console',icon:'console',element:pythonConsole},{id:'info',title:'Info',icon:'info',element:info}];
  const scripting={
    tree:{id:'root',children:[{id:'left',children:[0,{id:'console',children:[1,2]}]},{id:'rest',children:[3,{id:'side',children:[4,5]}]}]},
    defaults:()=>({order:[...SCRIPTING_AREAS,...items.map(x=>x.id).filter(id=>!SCRIPTING_AREAS.includes(id))],hidden:items.map(x=>x.id).filter(id=>!SCRIPTING_AREAS.includes(id)),sizes:structuredClone(SCRIPTING_SPLITS),horizontal:{root:false,left:true,console:true,rest:false,side:true}}),
    headerless:['info'],
  };
  const shading={
    tree:{id:'root',children:[0,{id:'rest',children:[{id:'middle',children:[1,2]},{id:'side',children:[3,4]}]}]},
    defaults:()=>({order:[...SHADING_AREAS,...items.map(x=>x.id).filter(id=>!SHADING_AREAS.includes(id))],hidden:items.map(x=>x.id).filter(id=>!SHADING_AREAS.includes(id)),sizes:structuredClone(SHADING_SPLITS),horizontal:{root:false,rest:false,middle:true,side:true}}),
  };
  const dock = mountDock({host,items,storageKey:RUNTIME_LAYOUT_KEY,tree:{id:'root',children:[{id:'animation',children:[0,3]},{id:'inspector',children:[1,2]}]},defaults:profile=>({order:items.map(x=>x.id),hidden:profile==='desktop'?['dopesheet','graph','nodes','sequencer','files','text','console','info']:['objects','properties','timeline','dopesheet','graph','nodes','sequencer','files','text','console','info'],sizes:structuredClone(LAYOUT_SPLITS),horizontal:{animation:true,root:profile==='portrait',inspector:true}}),screens:{scripting,shading}});
  return dock;
}
