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
// The Modeling and Sculpting screens: the 3D Viewport, and the Outliner over the Properties editor as in Layout.
const MODELING_AREAS=['viewport','objects','properties'];
// The Geometry Nodes screen: the 3D Viewport over the Geometry Node Editor over the Timeline, and the Outliner over the
// Properties editor (Blender's Spreadsheet left of the 3D Viewport is not there yet, so the 3D Viewport takes its row).
const GEOMETRY_NODES_SPLITS={root:LAYOUT_SPLITS.root,main:share(476,557),lower:share(480,77),inspector:LAYOUT_SPLITS.inspector};
const GEOMETRY_NODES_AREAS=['viewport','nodes','timeline','objects','properties'];
const hiddenBut=(items,areas)=>items.map(x=>x.id).filter(id=>!areas.includes(id));
const areaOrder=(items,areas)=>[...areas,...hiddenBut(items,areas)];
export function mountRuntimeLayout(){
  const host=document.querySelector('main');host.classList.add('runtime-dock');
  const viewport=document.createElement('section');viewport.id='viewport-section';
  const panel=document.querySelector('#panel');
  const properties=document.createElement('section');properties.id='properties-section';properties.append(document.querySelector('#pane'));
  for(const child of [...host.children]){
    if(child===panel)continue;
    viewport.append(child);
  }
  const timeline=document.createElement('section');timeline.id='timeline-section';
  const dopesheet=document.createElement('section');dopesheet.id='dopesheet-section';
  const graph=document.createElement('section');graph.id='graph-section';
  const drivers=document.createElement('section');drivers.id='drivers-section';
  const nodes=document.createElement('section');nodes.id='nodes-section';
  const sequencer=document.createElement('section');sequencer.id='sequencer-section';
  const files=document.createElement('section');files.id='files-section';
  const [text,pythonConsole,info,preferences]=['text','console','info','preferences'].map(id=>Object.assign(document.createElement('section'),{id:id+'-section'}));
  const variants=Object.entries(treeTypes).map(([id,t])=>({label:t.label,icon:t.icon,run:()=>nodes.dispatchEvent(new CustomEvent('node-tree',{detail:id}))}));
  const items=[{id:'viewport',blenderHeader:true,title:'3D Viewport',icon:'view3d',element:viewport,overlap:true},{id:'objects',blenderHeader:true,title:'Outliner',icon:'outliner',element:panel},{id:'properties',blenderHeader:true,title:'Properties',icon:'properties',element:properties},{id:'timeline',blenderHeader:true,title:'Timeline',icon:'time',element:timeline},{id:'dopesheet',blenderHeader:true,title:'Dope Sheet',icon:'action',element:dopesheet},{id:'graph',blenderHeader:true,title:'Graph Editor',icon:'graph',element:graph},{id:'drivers',blenderHeader:true,title:'Drivers',icon:'driver',element:drivers},{id:'nodes',title:'Node Editor',icon:'nodetree',element:nodes,variants},{id:'sequencer',title:'Video Sequencer',icon:'sequence',element:sequencer},{id:'files',title:'File Browser',icon:'filebrowser',element:files},{id:'text',blenderHeader:true,title:'Text Editor',icon:'text',element:text},{id:'console',title:'Python Console',icon:'console',element:pythonConsole},{id:'info',title:'Info',icon:'info',element:info},{id:'preferences',blenderHeader:true,title:'Preferences',icon:'preferences',element:preferences}];
  const scripting={
    tree:{id:'root',children:[{id:'left',children:[0,{id:'console',children:[1,2]}]},{id:'rest',children:[3,{id:'side',children:[4,5]}]}]},
    defaults:()=>({order:areaOrder(items,SCRIPTING_AREAS),hidden:hiddenBut(items,SCRIPTING_AREAS),sizes:structuredClone(SCRIPTING_SPLITS),horizontal:{root:false,left:true,console:true,rest:false,side:true}}),
    headerless:['info'],
  };
  const shading={
    tree:{id:'root',children:[0,{id:'rest',children:[{id:'middle',children:[1,2]},{id:'side',children:[3,4]}]}]},
    defaults:()=>({order:areaOrder(items,SHADING_AREAS),hidden:hiddenBut(items,SHADING_AREAS),sizes:structuredClone(SHADING_SPLITS),horizontal:{root:false,rest:false,middle:true,side:true}}),
  };
  const modeling={
    tree:{id:'root',children:[0,{id:'inspector',children:[1,2]}]},
    defaults:()=>({order:areaOrder(items,MODELING_AREAS),hidden:hiddenBut(items,MODELING_AREAS),sizes:{root:LAYOUT_SPLITS.root,inspector:LAYOUT_SPLITS.inspector},horizontal:{root:false,inspector:true}}),
  };
  const geometryNodes={
    tree:{id:'root',children:[{id:'main',children:[0,{id:'lower',children:[1,2]}]},{id:'inspector',children:[3,4]}]},
    defaults:()=>({order:areaOrder(items,GEOMETRY_NODES_AREAS),hidden:hiddenBut(items,GEOMETRY_NODES_AREAS),sizes:structuredClone(GEOMETRY_NODES_SPLITS),horizontal:{root:false,main:true,lower:true,inspector:true}}),
  };
  const dock = mountDock({host,items,storageKey:RUNTIME_LAYOUT_KEY,tree:{id:'root',children:[{id:'animation',children:[0,3]},{id:'inspector',children:[1,2]}]},defaults:profile=>({order:items.map(x=>x.id),hidden:profile==='desktop'?['dopesheet','graph','drivers','nodes','sequencer','files','text','console','info','preferences']:['objects','properties','timeline','dopesheet','graph','drivers','nodes','sequencer','files','text','console','info','preferences'],sizes:structuredClone(LAYOUT_SPLITS),horizontal:{animation:true,root:profile==='portrait',inspector:true}}),screens:{scripting,shading,modeling,'geometry-nodes':geometryNodes}});
  return dock;
}
