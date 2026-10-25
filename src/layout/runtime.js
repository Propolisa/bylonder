import { mountDock } from './dock.js';
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
  const items=[{id:'viewport',title:'3D Viewport',element:viewport},{id:'objects',title:'Outliner',element:panel},{id:'properties',title:'Properties',element:properties},{id:'timeline',title:'Timeline',element:timeline}];
  const dock = mountDock({host,items,storageKey:'workbench:layout:viewport:v1',tree:{id:'animation',children:[{id:'root',children:[0,{id:'inspector',children:[1,2]}]},3]},defaults:profile=>({order:items.map(x=>x.id),hidden:profile==='desktop'?[]:['objects','properties','timeline'],sizes:{animation:[76,24],root:[72,28],inspector:[45,55]},horizontal:{animation:true,root:profile==='portrait',inspector:true}})});
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
