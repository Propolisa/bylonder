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
export function mountRuntimeLayout(){
  const host=document.querySelector('main');host.classList.add('runtime-dock');
  const viewport=document.createElement('section');viewport.id='viewport-section';
  const panel=document.querySelector('#panel');
  const properties=document.createElement('section');properties.id='properties-section';properties.append(document.querySelector('#pane'));
  for(const child of [...host.children]){
    if(child===panel)continue;
    if(['gesture-cursor','gesture-guide','object-context'].includes(child.id))document.body.append(child);
    else viewport.append(child);
  }
  panel.querySelector('.panel-heading')?.remove();
  const timeline=document.createElement('section');timeline.id='timeline-section';
  const dopesheet=document.createElement('section');dopesheet.id='dopesheet-section';
  const graph=document.createElement('section');graph.id='graph-section';
  const drivers=document.createElement('section');drivers.id='drivers-section';
  const nodes=document.createElement('section');nodes.id='nodes-section';
  const sequencer=document.createElement('section');sequencer.id='sequencer-section';
  const files=document.createElement('section');files.id='files-section';
  const [text,pythonConsole,info]=['text','console','info'].map(id=>Object.assign(document.createElement('section'),{id:id+'-section'}));
  const variants=Object.entries(treeTypes).map(([id,t])=>({label:t.label,icon:t.icon,run:()=>nodes.dispatchEvent(new CustomEvent('node-tree',{detail:id}))}));
  const items=[{id:'viewport',title:'3D Viewport',icon:'view3d',element:viewport,overlap:true},{id:'objects',title:'Outliner',icon:'outliner',element:panel},{id:'properties',title:'Properties',icon:'properties',element:properties},{id:'timeline',title:'Timeline',icon:'time',element:timeline},{id:'dopesheet',title:'Dope Sheet',icon:'action',element:dopesheet},{id:'graph',title:'Graph Editor',icon:'graph',element:graph},{id:'drivers',title:'Drivers',icon:'driver',element:drivers},{id:'nodes',title:'Node Editor',icon:'nodetree',element:nodes,variants},{id:'sequencer',title:'Video Sequencer',icon:'sequence',element:sequencer},{id:'files',title:'File Browser',icon:'filebrowser',element:files},{id:'text',title:'Text Editor',icon:'text',element:text},{id:'console',title:'Python Console',icon:'console',element:pythonConsole},{id:'info',title:'Info',icon:'info',element:info}];
  const scripting={
    tree:{id:'root',children:[{id:'left',children:[0,{id:'console',children:[1,2]}]},{id:'rest',children:[3,{id:'side',children:[4,5]}]}]},
    defaults:()=>({order:[...SCRIPTING_AREAS,...items.map(x=>x.id).filter(id=>!SCRIPTING_AREAS.includes(id))],hidden:items.map(x=>x.id).filter(id=>!SCRIPTING_AREAS.includes(id)),sizes:structuredClone(SCRIPTING_SPLITS),horizontal:{root:false,left:true,console:true,rest:false,side:true}}),
    headerless:['info'],
  };
  const dock = mountDock({host,items,storageKey:RUNTIME_LAYOUT_KEY,tree:{id:'root',children:[{id:'animation',children:[0,3]},{id:'inspector',children:[1,2]}]},defaults:profile=>({order:items.map(x=>x.id),hidden:profile==='desktop'?['dopesheet','graph','drivers','nodes','sequencer','files','text','console','info']:['objects','properties','timeline','dopesheet','graph','drivers','nodes','sequencer','files','text','console','info'],sizes:structuredClone(LAYOUT_SPLITS),horizontal:{animation:true,root:profile==='portrait',inspector:true}}),screens:{scripting}});
  const menu=document.createElement('details');menu.className='scene-menu';
  const summary=document.createElement('summary');summary.textContent='⋯';summary.setAttribute('aria-label','Scene options');
  const content=document.createElement('div');content.className='scene-menu-content';
  const heading=text=>{const label=document.createElement('div');label.className='menu-label';label.textContent=text;content.append(label);};
  heading('View');
  content.append(document.querySelector('.views'));
  content.append(document.querySelector('#frame'));
  heading('Scene');
  for(const id of ['scene-mode','inspector','help'])content.append(document.getElementById(id));
  const layout=document.createElement('button');layout.textContent='Arrange panels';layout.onclick=()=>dock.openMenu();content.append(layout);
  menu.append(summary,content);
  dock.toolbar.append(document.querySelector('#add-mesh'),menu);
  document.querySelector('body>header').hidden=true;
  content.addEventListener('click',event=>{if(event.target.closest('button'))menu.open=false;});
  return dock;
}
