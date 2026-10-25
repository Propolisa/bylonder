import { mountDock } from '../layout/dock.js';
export function mountWorkspaceLayout() {
  const host=document.querySelector('#workspace');
  document.querySelector('#splitter')?.remove();
  const items=[['files','Files','explorer'],['code','Code','code-pane'],['scene','Scene','preview-pane'],['output','Output','output']].map(([id,title,element])=>({id,title,element:document.getElementById(element)}));
  return mountDock({host,items,storageKey:'workbench:layout:workspace:v1',tree:{id:'root',children:[0,{id:'main',children:[{id:'editors',children:[1,2]},3]}]},defaults:profile=>({order:items.map(x=>x.id),hidden:profile==='desktop'?[]:profile==='landscape'?['files','output']:['files','code','output'],sizes:{root:[16,84],main:[80,20],editors:profile==='landscape'?[35,65]:[46,54]},horizontal:{root:false,main:true,editors:profile==='portrait'}})});
}
