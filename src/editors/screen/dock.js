import { mapArea, removeArea, validAreaTree } from './area-tree.js';
import { paneIcon } from './icons.js';
import { icon } from '../interface/icons.js';
import { openMenu as openPopup } from '../interface/menu.js';
import { createApp, h, reactive, nextTick, watch, Teleport } from 'vue';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import './dock.css';
import { profile, validateLayout, swapSections, focusedSection } from './model.js';

// Pane sizes (percent of the panes, and pixels) of a split `size` px long whose first pane takes `share` of it, as
// Blender places areas: the edge between them is a screen vertex at that share of the vertex range, rounded from the
// left or bottom (screen_geom_vertices_scale), and each area sits 2 px inside its vertices, 1 px below the top bar
// (area_calc_totrct). So areas are 3 px apart, the splitter's width.
const SPLITTER=3;
export function areaSizes([a,b],size,horizontal,top){
  const range=size+(horizontal&&top?2:3),panes=size-SPLITTER;
  const edge=share=>Math.floor(share*range+0.5)-SPLITTER;
  const first=horizontal?panes-edge(b/(a+b)):edge(a/(a+b));
  return {pixels:[first,panes-first],percent:[100*first/panes,100*(panes-first)/panes]};
}

// An item with `overlap` draws under its header, as an editor whose header overlaps its main region (region overlap).
// `screens` are further screens ({ name: { tree, defaults, headerless } }, Blender's workspaces' screens) over the same
// items; `tree` and `defaults` are the first screen's. A screen's `headerless` items hide their header.
export function mountDock({host, items, tree: firstTree, defaults: firstDefaults, screens={}, storageKey, bareFocus=false, focus: defaultFocus=null}) {
  items=[...items];
  const headers=new Map();
  const header=id=>{if(!headers.has(id))headers.set(id,Object.assign(document.createElement('div'),{className:'dock-header-content'}));return headers.get(id);};
  const baseCount=items.length,factories=new Map(),instances=new Map();
  const ids=items.map(item=>item.id), panels=new Map(), slots=new Map();
  const coarse=matchMedia('(pointer:coarse)');
  const currentProfile=()=>{
    let width=innerWidth,height=innerHeight;
    try{width=parent.innerWidth;height=parent.innerHeight;}catch{}
    if(coarse.matches) return (screen.orientation?.type||'').startsWith('landscape')||(!screen.orientation&&screen.width>screen.height)?'landscape':'portrait';
    return profile(width,height,false);
  };
  let saved={}, menuElement, hovered=null, frameId, disposed=false;
  try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
  const state=reactive({profile:currentProfile(),screen:null,layout:null,remember:saved.remember!==false,focus:null,tree:structuredClone(firstTree),area:null,factoryCount:0,width:0,height:0,content:null});
  const screenOf=()=>screens[state.screen]??{tree:firstTree,defaults:firstDefaults};
  const tree=()=>screenOf().tree,defaults=profile=>screenOf().defaults(profile);
  // Each screen keeps its own layout per profile; the first screen's under the profile's name.
  const key=()=>state.screen?state.screen+':'+state.profile:state.profile;
  const extras=Array.isArray(saved.extras)?saved.extras.slice(0,20):[];
  for(const extra of extras)if(typeof extra.id==='string'&&extra.id.startsWith('area:')&&items.slice(0,baseCount).some(item=>item.id===extra.type)){
    const element=document.createElement('section'),original=items.find(item=>item.id===extra.type);items.push({...extra,title:original.title,overlap:original.overlap,element});ids.push(extra.id);
  }
  const load=()=>{
    const initial=defaults(state.profile);initial.order=[...initial.order,...ids.slice(baseCount)];initial.hidden=[...initial.hidden,...ids.slice(baseCount)];
    const stored=saved[key()];
    state.layout=validateLayout(stored,initial,ids);
    state.tree=validAreaTree(stored?.tree,ids.length)?stored.tree:structuredClone(tree());
    if(stored?.sizes)for(const [split,pair] of Object.entries(stored.sizes))if(Array.isArray(pair)&&pair.length===2&&pair.every(n=>Number.isFinite(n)&&n>0))state.layout.sizes[split]=pair;
    if(stored?.horizontal)Object.assign(state.layout.horizontal,stored.horizontal);
    state.focus=!stored?defaultFocus:ids.includes(stored.focus)?stored.focus:null;
  };
  load();
  host.classList.add('dock');
  for(const item of items){
    const panel=document.createElement('div');
    panel.className='dock-content';panel.dataset.section=item.id;panel.hidden=true;
    panel.append(item.element);host.append(panel);panels.set(item.id,panel);
  }
  const root=document.createElement('div');root.className='dock-root';host.prepend(root);
  const focus=()=>focusedSection(state.layout,state.focus);
  const visible=slot=>!state.layout.hidden.includes(state.layout.order[slot]);
  const hasVisible=node=>typeof node==='number'?visible(node):node.children.some(hasVisible);
  function position(){
    if(disposed)return;
    const base=host.getBoundingClientRect(), focused=focus();
    const space=root.querySelector('.dock-splits');
    for(let slot=0;slot<ids.length;slot++){
      const id=state.layout.order[slot],panel=panels.get(id);
      const show=focused?id===focused:visible(slot);
      const element=focused&&bareFocus?space:slots.get(slot);
      panel.hidden=!show||!element;
      if(panel.hidden)continue;
      const overlap=!focused&&items.find(item=>item.id===id)?.overlap;
      panel.classList.toggle('dock-overlap',!!overlap);
      const rect=(overlap?element.parentElement:element).getBoundingClientRect();
      Object.assign(panel.style,{left:rect.left-base.left+'px',top:rect.top-base.top+'px',width:Math.max(0,rect.width)+'px',height:Math.max(0,rect.height)+'px'});
    }
  }
  const schedule=()=>{cancelAnimationFrame(frameId);frameId=requestAnimationFrame(position);};
  const observer=new ResizeObserver(()=>{
    state.width=host.clientWidth;state.height=host.clientHeight;
    const tree=root.querySelector('.dock-split-tree');
    if(tree&&(tree.clientWidth!==state.content?.width||tree.clientHeight!==state.content?.height))state.content={width:tree.clientWidth,height:tree.clientHeight,top:true};
    schedule();
  });observer.observe(host);
  // Blender keeps each area at least one header high (screen_geom_vertices_scale).
  const minSize=horizontal=>{const header=parseFloat(getComputedStyle(host).getPropertyValue('--bl-header-h'))||26,length=horizontal?state.height:state.width;return length?Math.min(50,100*header/length):8;};
  const persist=()=>{
    saved[key()]={...JSON.parse(JSON.stringify(state.layout)),focus:state.focus,tree:JSON.parse(JSON.stringify(state.tree))};saved.remember=state.remember;saved.extras=items.slice(baseCount).map(({id,type})=>({id,type}));
    try{localStorage.setItem(storageKey,JSON.stringify(state.remember?saved:{remember:false}));}catch{}
    position();nextTick(()=>{position();schedule();});
  };
  const ensureArea=slot=>{
    const contains=node=>typeof node==='number'?node===slot:node.children.some(contains);
    if(contains(state.tree))return;const id='split:'+crypto.randomUUID();state.tree={id,children:[state.tree,slot]};state.layout.sizes[id]=[70,30];state.layout.horizontal[id]=true;
  };
  const show=(id,exclusive=false)=>{ensureArea(state.layout.order.indexOf(id));state.focus=exclusive?id:null;state.layout.hidden=state.layout.hidden.filter(x=>x!==id);persist();};
  const toggle=id=>{
    state.focus=null;
    if(state.layout.hidden.includes(id)){ensureArea(state.layout.order.indexOf(id));state.layout.hidden=state.layout.hidden.filter(x=>x!==id);}
    else if(state.layout.hidden.length<ids.length-1)state.layout.hidden.push(id);
    persist();
  };
  const closeMenu=()=>menuElement?.close();
  const openMenu=()=>{if(!menuElement.open)menuElement.showModal();};
  const reset=()=>{
    saved={remember:state.remember};state.layout=structuredClone(defaults(state.profile));state.layout.order.push(...ids.slice(baseCount));state.layout.hidden.push(...ids.slice(baseCount));state.tree=structuredClone(tree());state.focus=defaultFocus;
    persist();closeMenu();host.dispatchEvent(new CustomEvent('dock-reset',{bubbles:true}));
  };
  const button=(label,fn,title,attrs={})=>h('button',{type:'button',onClick:fn,title,...attrs},label);
  const select=(value,change,options,label)=>h('select',{value,'aria-label':label,onChange:e=>change(e.target.value)},options.map(([id,title])=>h('option',{value:id},title)));
  function renderNode(node,extent=state.content){
    if(typeof node==='number'){
      const id=state.layout.order[node];
      return h('div',{class:['dock-leaf',{bare:items.find(item=>item.id===id)?.bare,overlap:items.find(item=>item.id===id)?.overlap,'no-header':screenOf().headerless?.includes(id)}],onPointerenter:()=>hovered=node,onContextmenu:e=>openArea(e,node)},[
        h('div',{class:'dock-heading',onContextmenu:e=>openArea(e,node)},[
          h('button',{type:'button',class:'dock-editor-type',title:'Editor Type · '+(items.find(item=>item.id===id)?.title||''),'aria-label':'Editor Type',onClick:e=>editorMenu(e.currentTarget,node)},[icon((items.find(item=>item.id===(items.find(i=>i.id===id)?.type||id))||{}).icon||'properties')]),
          h('div',{class:'dock-header-host',ref:el=>{const content=header(id);if(el&&content.parentElement!==el)el.replaceChildren(content);}}),
          h('span',{class:'dock-corner',title:'Drag inward to split; drag into another area to join; Ctrl-drag to swap',onPointerdown:e=>corner(e,node)})
        ]),
        h('div',{class:'dock-slot',ref:el=>{
          const old=slots.get(node);if(old&&old!==el)observer.unobserve(old);
          if(el){slots.set(node,el);observer.observe(el);}else slots.delete(node);
          schedule();
        }})
      ]);
    }
    const live=node.children.map(hasVisible),available=live.some(Boolean)?live:[true,true],horizontal=state.layout.horizontal[node.id];
    const areas=extent&&live.every(Boolean)?areaSizes(state.layout.sizes[node.id],horizontal?extent.height:extent.width,horizontal,extent.top):null;
    const childExtent=i=>areas&&(horizontal?{...extent,height:areas.pixels[i],top:extent.top&&i===0}:{...extent,width:areas.pixels[i]});
    return h(Splitpanes,{horizontal,maximizePanes:false,pushOtherPanes:false,onResize:schedule,onResized:event=>{
      if(live.every(Boolean)){state.layout.sizes[node.id]=event.panes.map(p=>Math.max(1,p.size));persist();}
    }},{default:()=>node.children.map((child,i)=>h(Pane,{key:i,size:available[i]?(available[1-i]?(areas?.percent??state.layout.sizes[node.id])[i]:100):0,minSize:available[i]&&available[1-i]?minSize(horizontal):0,maxSize:available[i]?100:0,class:{'dock-collapsed':!live[i]}},{default:()=>renderNode(child,childExtent(i))}))});
  }
  const setFactory=(type,factory)=>{factories.set(type,factory);state.factoryCount=factories.size;for(const item of items)if(item.type===type&&!instances.has(item.id))instances.set(item.id,factory(item.element,item.id));};
  const split=(slot,horizontal)=>{
    const original=items.find(item=>item.id===state.layout.order[slot]),type=original.type||original.id;
    const selected=factories.has(type)?type:factories.has('properties')?'properties':null;
    if(!selected)return;
    const id='area:'+crypto.randomUUID(),element=document.createElement('section'),item={id,type:selected,title:items.find(i=>i.id===selected).title,overlap:items.find(i=>i.id===selected).overlap,element};
    const index=ids.length;items.push(item);ids.push(id);state.layout.order.push(id);
    const panel=document.createElement('div');panel.className='dock-content';panel.dataset.section=id;panel.append(element);host.append(panel);panels.set(id,panel);instances.set(id,factories.get(selected)(element,id));
    const splitId='split:'+crypto.randomUUID();state.tree=mapArea(state.tree,slot,()=>({id:splitId,children:[slot,index]}));state.layout.horizontal[splitId]=horizontal;state.layout.sizes[splitId]=[50,50];state.focus=null;persist();
  };
  const corner=(event,slot)=>{
    if(event.button!==0)return;event.preventDefault();const el=event.currentTarget,start={x:event.clientX,y:event.clientY};let canceled=false;
    const escape=e=>{if(e.key==='Escape')canceled=true;};window.addEventListener('keydown',escape);el.setPointerCapture(event.pointerId);
    el.onpointerup=e=>{window.removeEventListener('keydown',escape);el.releasePointerCapture(e.pointerId);if(canceled)return;
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.dock-content'),other=target?state.layout.order.indexOf(target.dataset.section):-1;
      if(other>=0&&other!==slot){if(e.ctrlKey){[state.layout.order[slot],state.layout.order[other]]=[state.layout.order[other],state.layout.order[slot]];persist();}else closeArea(other);}
      else if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>20)split(slot,Math.abs(e.clientY-start.y)>Math.abs(e.clientX-start.x));
    };el.onpointercancel=()=>window.removeEventListener('keydown',escape);
  };
  const chooseEditor=(slot,id)=>{const old=state.layout.order[slot];if(old===id)return;swapSections(state.layout,slot,id);if(state.layout.hidden.includes(id))state.layout.hidden=[...state.layout.hidden.filter(x=>x!==id),old];persist();};
  const editorMenu=(button,slot)=>openPopup(items.slice(0,baseCount).flatMap(item=>item.variants?item.variants.map(v=>({label:v.label,icon:v.icon,run:()=>{chooseEditor(slot,item.id);v.run();}})):[{label:item.title,icon:item.icon,run:()=>chooseEditor(slot,item.id)}]),button,'Editor Type');
  const closeArea=slot=>{if(typeof state.tree==='number')return;const next=removeArea(state.tree,slot);if(next===null)return;state.tree=next;const id=state.layout.order[slot];if(!state.layout.hidden.includes(id))state.layout.hidden.push(id);state.focus=null;persist();};
  const openArea=(event,slot)=>{event.preventDefault();event.stopPropagation();state.area=slot;const id=state.layout.order[slot];openPopup([{label:'Vertical Split',icon:'area_swap',enabled:()=>!!state.factoryCount,run:()=>split(slot,false)},{label:'Horizontal Split',enabled:()=>!!state.factoryCount,run:()=>split(slot,true)},'-',{label:state.focus===id?'Back to Previous':'Toggle Maximize Area',icon:'fullscreen_enter',keys:'Ctrl Space',run:()=>{state.focus=state.focus===id?null:id;persist();}},'-',{label:'Close Area',icon:'area_join',enabled:()=>typeof state.tree!=='number',run:()=>closeArea(slot)}],{x:event.clientX,y:event.clientY},'Area');};
  const labels={animation:'Timeline split',root:'Main split',main:'Output split',editors:'Editor split',inspector:'Inspector split'};
  const app=createApp({setup(){
    watch(()=>JSON.stringify([state.layout,state.focus]),()=>nextTick(position),{flush:'post'});
    return ()=>h('div',{class:'dock-shell'},[
      h('nav',{class:'dock-tabs','aria-label':'Workspace sections'},[
        ...items.map(item=>button([paneIcon(item.id),h('span',{class:'dock-tab-label'},item.title)],()=>show(item.id,true),item.title+' · Focus pane; use Layout for split view',{'aria-label':item.title,class:{active:focus()?focus()===item.id:!state.layout.hidden.includes(item.id)},'aria-pressed':focus()?focus()===item.id:!state.layout.hidden.includes(item.id)})),
        button('Layout',openMenu,'Arrange panels',{class:'dock-layout-button'})
      ]),
      h('div',{class:'dock-splits'},focus()?h('div',{class:'dock-focus-space'},bareFocus?[]:[renderNode(state.layout.order.indexOf(focus()))]):h('div',{key:JSON.stringify([state.layout.hidden,state.layout.order]),class:'dock-split-tree',ref:el=>el&&observer.observe(el)},[renderNode(state.tree)])),
      h(Teleport,{to:document.body},[h('dialog',{class:'dock-dialog',ref:el=>menuElement=el,onClick:e=>{if(e.target===menuElement)closeMenu();}},[
        h('div',{class:'dock-dialog-title'},[h('strong','Workspace Layout'),button('×',closeMenu,'Close layout')]),
        h('label',[h('input',{type:'checkbox',checked:state.remember,onChange:e=>{state.remember=e.target.checked;persist();}}),'Remember on this device']),
        button('Use split view',()=>{state.focus=null;state.layout.order.forEach((id,slot)=>ensureArea(slot));state.layout.hidden=[];persist();closeMenu();}),
        h('details',[h('summary','Areas'),h('div',{class:'dock-arrangement'},[
          ...items.map(item=>h('label',[h('input',{type:'checkbox',checked:!state.layout.hidden.includes(item.id),onChange:()=>toggle(item.id)}),item.title])),
          ...state.layout.order.map((id,slot)=>h('label',['Area '+(slot+1),select(id,value=>{swapSections(state.layout,slot,value);persist();},items.map(item=>[item.id,item.title]),'Editor Type'),button('⋮',e=>{closeMenu();openArea(e,slot);},'Area Options')])),
          ...Object.keys(state.layout.horizontal).map(key=>h('label',[labels[key]||key,select(String(state.layout.horizontal[key]),value=>{state.layout.horizontal[key]=value==='true';persist();},[['false','Side by side'],['true','Stacked']],labels[key]||key)]))
        ])]),
        button('Reset layout',reset)
      ])])
    ]);
  }});
  app.mount(root);nextTick(position);
  const resize=()=>{const next=currentProfile();if(next!==state.profile){persist();state.profile=next;load();}nextTick(position);};
  window.addEventListener('resize',resize);coarse.addEventListener('change',resize);
  const keyboard=event=>{if((event.ctrlKey||event.metaKey)&&event.code==='Space'&&hovered!==null){event.preventDefault();event.stopPropagation();const id=state.layout.order[hovered];state.focus=state.focus===id?null:id;persist();}};
  host.addEventListener('keydown',keyboard,true);
  host.addEventListener('pointerover',event=>{const panel=event.target.closest('.dock-content');if(panel)hovered=state.layout.order.indexOf(panel.dataset.section);});
  const unlock=()=>host.classList.remove('dock-resizing');
  root.addEventListener('pointerdown',event=>{if(event.target.closest('.splitpanes__splitter'))host.classList.add('dock-resizing');});
  window.addEventListener('pointerup',unlock);window.addEventListener('pointercancel',unlock);window.addEventListener('blur',unlock);
  // Blender's workspace switch: another screen over the same areas.
  const setScreen=name=>{const next=name in screens?name:null;if(next===state.screen)return;persist();state.screen=next;load();persist();};
  return {show,toggle,reset,openMenu,setFactory,header,setScreen,get screen(){return state.screen;},get profile(){return state.profile;},get maximized(){return focus();},maximize(id){state.focus=state.focus===id?null:id;persist();},split(id,horizontal){if(state.factoryCount)split(state.layout.order.indexOf(id),horizontal);},close(id){if(typeof state.tree!=='number')closeArea(state.layout.order.indexOf(id));},dispose(){disposed=true;cancelAnimationFrame(frameId);observer.disconnect();instances.forEach(instance=>instance?.dispose?.());host.removeEventListener('keydown',keyboard,true);app.unmount();window.removeEventListener('resize',resize);coarse.removeEventListener('change',resize);window.removeEventListener('pointerup',unlock);window.removeEventListener('pointercancel',unlock);window.removeEventListener('blur',unlock);}};
}
