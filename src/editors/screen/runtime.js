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
// The Shading screen: the File Browser over the Image Editor, the 3D Viewport over the Shader Editor, and the Outliner
// over the Properties editor.
const SHADING_SPLITS={root:share(292,1627),left:share(516,517),rest:share(1285,342),middle:share(516,517),side:share(191,842)};
const SHADING_AREAS=['files','image','viewport','nodes','objects','properties'];
// The UV Editing and Texture Paint screens: the Image Editor (as the UV Editor, or painting) beside the 3D Viewport, and
// the Outliner over the Properties editor. Each screen's Image Editor shows its own mode (SpaceImage.mode).
const IMAGE_SPLITS={root:LAYOUT_SPLITS.root,main:share(789,787),inspector:LAYOUT_SPLITS.inspector};
const IMAGE_AREAS=['image','viewport','objects','properties'];
export const IMAGE_MODES={shading:'VIEW','uv-editing':'UV','texture-paint':'PAINT'};
// The Modeling and Sculpting screens: the 3D Viewport, and the Outliner over the Properties editor as in Layout.
const MODELING_AREAS=['viewport','objects','properties'];
// The Geometry Nodes screen: the Spreadsheet beside the 3D Viewport, over the Geometry Node Editor over the Timeline,
// and the Outliner over the Properties editor.
const GEOMETRY_NODES_SPLITS={root:LAYOUT_SPLITS.root,main:share(476,557),top:share(657,920),lower:share(480,77),inspector:LAYOUT_SPLITS.inspector};
const GEOMETRY_NODES_AREAS=['spreadsheet','viewport','nodes','timeline','objects','properties'];
// The 2D Animation template's screens (bl_app_templates_system/2D_Animation/startup.blend): 2D Animation's 3D Viewport
// over the Dope Sheet beside the Outliner over the Properties editor, and 2D Full Canvas's 3D Viewport over the Dope Sheet.
const ANIMATION_2D_SPLITS={root:share(1583,330),main:share(856,172),inspector:share(179,849)};
const ANIMATION_2D_AREAS=['viewport','dopesheet','objects','properties'];
const FULL_CANVAS_SPLITS={main:share(962,87)};
const FULL_CANVAS_AREAS=['viewport','dopesheet'];
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
  const spreadsheet=document.createElement('section');spreadsheet.id='spreadsheet-section';
  const sequencer=document.createElement('section');sequencer.id='sequencer-section';
  const files=document.createElement('section');files.id='files-section';
  const [text,pythonConsole,info,image,preferences]=['text','console','info','image','preferences'].map(id=>Object.assign(document.createElement('section'),{id:id+'-section'}));
  // Blender's SpaceImage is the Image Editor and the UV Editor (its editor type menu's two entries, Area.ui_type).
  const imageModes=[['Image Editor','image','VIEW'],['UV Editor','uv','UV']].map(([label,icon,mode])=>({label,icon,run:()=>image.dispatchEvent(new CustomEvent('image-mode',{detail:mode}))}));
  const variants=Object.entries(treeTypes).map(([id,t])=>({label:t.label,icon:t.icon,run:()=>nodes.dispatchEvent(new CustomEvent('node-tree',{detail:id}))}));
  const items=[{id:'viewport',blenderHeader:true,title:'3D Viewport',icon:'view3d',element:viewport,overlap:true},{id:'objects',blenderHeader:true,title:'Outliner',icon:'outliner',element:panel},{id:'properties',blenderHeader:true,title:'Properties',icon:'properties',element:properties},{id:'timeline',blenderHeader:true,title:'Timeline',icon:'time',element:timeline},{id:'dopesheet',blenderHeader:true,title:'Dope Sheet',icon:'action',element:dopesheet},{id:'graph',blenderHeader:true,title:'Graph Editor',icon:'graph',element:graph},{id:'drivers',blenderHeader:true,title:'Drivers',icon:'driver',element:drivers},{id:'nodes',title:'Node Editor',icon:'nodetree',element:nodes,variants},{id:'spreadsheet',blenderHeader:true,title:'Spreadsheet',icon:'spreadsheet',element:spreadsheet},{id:'sequencer',title:'Video Sequencer',icon:'sequence',element:sequencer},{id:'files',title:'File Browser',icon:'filebrowser',element:files},{id:'text',blenderHeader:true,title:'Text Editor',icon:'text',element:text},{id:'image',blenderHeader:true,title:'Image Editor',icon:'image',element:image,variants:imageModes},{id:'console',title:'Python Console',icon:'console',element:pythonConsole},{id:'info',title:'Info',icon:'info',element:info},{id:'preferences',blenderHeader:true,title:'Preferences',icon:'preferences',element:preferences}];
  const scripting={
    tree:{id:'root',children:[{id:'left',children:[0,{id:'console',children:[1,2]}]},{id:'rest',children:[3,{id:'side',children:[4,5]}]}]},
    defaults:()=>({order:areaOrder(items,SCRIPTING_AREAS),hidden:hiddenBut(items,SCRIPTING_AREAS),sizes:structuredClone(SCRIPTING_SPLITS),horizontal:{root:false,left:true,console:true,rest:false,side:true}}),
    headerless:['info'],
  };
  const shading={
    tree:{id:'root',children:[{id:'left',children:[0,1]},{id:'rest',children:[{id:'middle',children:[2,3]},{id:'side',children:[4,5]}]}]},
    defaults:()=>({order:areaOrder(items,SHADING_AREAS),hidden:hiddenBut(items,SHADING_AREAS),sizes:structuredClone(SHADING_SPLITS),horizontal:{root:false,left:true,rest:false,middle:true,side:true}}),
  };
  const imageScreen={
    tree:{id:'root',children:[{id:'main',children:[0,1]},{id:'inspector',children:[2,3]}]},
    defaults:()=>({order:areaOrder(items,IMAGE_AREAS),hidden:hiddenBut(items,IMAGE_AREAS),sizes:structuredClone(IMAGE_SPLITS),horizontal:{root:false,main:false,inspector:true}}),
  };
  const modeling={
    tree:{id:'root',children:[0,{id:'inspector',children:[1,2]}]},
    defaults:()=>({order:areaOrder(items,MODELING_AREAS),hidden:hiddenBut(items,MODELING_AREAS),sizes:{root:LAYOUT_SPLITS.root,inspector:LAYOUT_SPLITS.inspector},horizontal:{root:false,inspector:true}}),
  };
  const geometryNodes={
    tree:{id:'root',children:[{id:'main',children:[{id:'top',children:[0,1]},{id:'lower',children:[2,3]}]},{id:'inspector',children:[4,5]}]},
    defaults:()=>({order:areaOrder(items,GEOMETRY_NODES_AREAS),hidden:hiddenBut(items,GEOMETRY_NODES_AREAS),sizes:structuredClone(GEOMETRY_NODES_SPLITS),horizontal:{root:false,main:true,top:false,lower:true,inspector:true}}),
  };
  const animation2d={
    tree:{id:'root',children:[{id:'main',children:[0,1]},{id:'inspector',children:[2,3]}]},
    defaults:()=>({order:areaOrder(items,ANIMATION_2D_AREAS),hidden:hiddenBut(items,ANIMATION_2D_AREAS),sizes:structuredClone(ANIMATION_2D_SPLITS),horizontal:{root:false,main:true,inspector:true}}),
  };
  const fullCanvas={
    tree:{id:'main',children:[0,1]},
    defaults:()=>({order:areaOrder(items,FULL_CANVAS_AREAS),hidden:hiddenBut(items,FULL_CANVAS_AREAS),sizes:structuredClone(FULL_CANVAS_SPLITS),horizontal:{main:true}}),
  };
  const dock = mountDock({host,items,storageKey:RUNTIME_LAYOUT_KEY,tree:{id:'root',children:[{id:'animation',children:[0,3]},{id:'inspector',children:[1,2]}]},defaults:profile=>({order:items.map(x=>x.id),hidden:profile==='desktop'?['dopesheet','graph','drivers','nodes','spreadsheet','sequencer','files','text','image','console','info','preferences']:['objects','properties','timeline','dopesheet','graph','drivers','nodes','spreadsheet','sequencer','files','text','image','console','info','preferences'],sizes:structuredClone(LAYOUT_SPLITS),horizontal:{animation:true,root:profile==='portrait',inspector:true}}),screens:{scripting,shading,modeling,'geometry-nodes':geometryNodes,'uv-editing':imageScreen,'texture-paint':imageScreen,'2d-animation':animation2d,'2d-full-canvas':fullCanvas}});
  return dock;
}
