import { mountDock } from '../editors/screen/dock.js';
export function mountWorkspaceLayout() {
  const host=document.querySelector('#workspace');
  document.querySelector('#splitter')?.remove();
  const items=[['files','File Browser','explorer','file_folder'],['code','Text Editor','code-pane','text'],['scene','Scene','preview-pane','view3d'],['output','Console','output','console']].map(([id,title,element,icon])=>({id,title,icon,bare:id==='scene',element:document.getElementById(element)}));
  return mountDock({host,items,storageKey:'workbench:layout:workspace:v1',bareFocus:true,tree:{id:'root',children:[0,{id:'main',children:[{id:'editors',children:[1,2]},3]}]},defaults:profile=>({order:items.map(x=>x.id),hidden:profile==='desktop'?[]:profile==='landscape'?['files','output']:['files','code','output'],sizes:{root:[16,84],main:[80,20],editors:profile==='landscape'?[35,65]:[46,54]},horizontal:{root:false,main:true,editors:profile==='portrait'}})});
}
