import { mapArea, removeArea, validAreaTree } from './area-tree.js';
import { icon } from '../interface/icons.js';
import { openMenu as openPopup } from '../interface/menu.js';
import { createApp, h, reactive, nextTick, watch, Teleport } from 'vue';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import './dock.css';
import { validateLayout, swapSections, focusedSection } from './model.js';

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

// An item with `overlap` draws under its header, as an editor whose header overlaps its main region (region overlap);
// one with `blenderHeader` has Blender's header, whose editor type menu chooses the area's editor (`editor-type`).
// `screens` are further screens ({ name: { tree, defaults, headerless } }, Blender's workspaces' screens) over the same
// items; `tree` and `defaults` are the first screen's. A screen's `headerless` items hide their header.
export function mountDock({host, items, tree: firstTree, defaults: firstDefaults, screens={}, storageKey, bareFocus=false, focus: defaultFocus=null}) {
  items=[...items];
  const headers=new Map();
  const header=id=>{if(!headers.has(id))headers.set(id,Object.assign(document.createElement('div'),{className:'dock-header-content'}));return headers.get(id);};
  const baseCount=items.length,factories=new Map(),instances=new Map();
  const ids=items.map(item=>item.id), panels=new Map(), slots=new Map();
  let saved={}, menuElement, hovered=null, frameId, disposed=false;
  // The header's context menu (screen.region_context_menu), which the app gives (onHeaderMenu); an area edge's
  // (screen.area_options, onEdgeMenu); an area dropped on another by its header (screen.area_swap, onSwap).
  let headerMenu=()=>{},edgeMenu=()=>{},swapAreas=(a,b)=>swap(a,b);
  try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))saved=value;}catch{}
  const state=reactive({drop:null,drawer:null,screen:null,layout:null,remember:saved.remember!==false,focus:null,tree:structuredClone(firstTree),factoryCount:0,width:0,height:0,content:null});
  const screenOf=()=>screens[state.screen]??{tree:firstTree,defaults:firstDefaults};
  const tree=()=>screenOf().tree,defaults=()=>screenOf().defaults();
  // Each screen keeps its own layout; the first screen's under 'main'.
  const key=()=>state.screen??'main';
  const extras=Array.isArray(saved.extras)?saved.extras.slice(0,20):[];
  for(const extra of extras)if(typeof extra.id==='string'&&extra.id.startsWith('area:')&&items.slice(0,baseCount).some(item=>item.id===extra.type)){
    const element=document.createElement('section'),original=items.find(item=>item.id===extra.type);items.push({...extra,title:original.title,overlap:original.overlap,blenderHeader:original.blenderHeader,element});ids.push(extra.id);
  }
  const load=()=>{
    const initial=defaults();initial.order=[...initial.order,...ids.slice(baseCount)];initial.hidden=[...initial.hidden,...ids.slice(baseCount)];
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
      panel.classList.toggle('dock-in-drawer',!!element.closest('.dock-drawer'));
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
    saved={remember:state.remember};state.layout=structuredClone(defaults());state.layout.order.push(...ids.slice(baseCount));state.layout.hidden.push(...ids.slice(baseCount));state.tree=structuredClone(tree());state.focus=defaultFocus;
    persist();closeMenu();host.dispatchEvent(new CustomEvent('dock-reset',{bubbles:true}));
  };
  const button=(label,fn,title,attrs={})=>h('button',{type:'button',onClick:fn,title,...attrs},label);
  const select=(value,change,options,label)=>h('select',{value,'aria-label':label,onChange:e=>change(e.target.value)},options.map(([id,title])=>h('option',{value:id},title)));
  function renderNode(node,extent=state.content){
    if(typeof node==='number'){
      const id=state.layout.order[node];
      return h('div',{'data-section':id,class:['dock-leaf',{bare:items.find(item=>item.id===id)?.bare,overlap:items.find(item=>item.id===id)?.overlap,'no-header':screenOf().headerless?.includes(id)}],onPointerenter:()=>hovered=node,onEditorType:e=>editorType(e.detail,node)},[
        h('div',{class:'dock-heading','data-touch-hold-drag':'',onContextmenu:e=>{e.preventDefault();e.stopPropagation();headerMenu(id,e);},
          'onBl-hold-drag':e=>carry(id,e.detail),onTouchmove:e=>{if(carried)e.preventDefault();}},[
          // An editor whose header is not Blender's yet has the screen's editor type button in place of Blender's.
          items.find(item=>item.id===id)?.blenderHeader?null:h('button',{type:'button',class:'dock-editor-type',title:'Editor Type · '+(items.find(item=>item.id===id)?.title||''),'aria-label':'Editor Type',onClick:e=>openPopup(editorChoices(node),e.currentTarget,'Editor Type')},[icon((items.find(item=>item.id===(items.find(i=>i.id===id)?.type||id))||{}).icon||'properties')]),
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
    const fold=areas&&folded(node,areas.pixels,horizontal);
    if(fold!==null&&fold!==undefined)return renderFolded(node,fold,horizontal,extent);
    return h(Splitpanes,{horizontal,maximizePanes:false,pushOtherPanes:false,onResize:schedule,onResized:event=>{
      if(live.every(Boolean)){state.layout.sizes[node.id]=event.panes.map(p=>Math.max(1,p.size));persist();}
    }},{default:()=>node.children.map((child,i)=>h(Pane,{key:i,size:available[i]?(available[1-i]?(areas?.percent??state.layout.sizes[node.id])[i]:100):0,minSize:available[i]&&available[1-i]?minSize(horizontal):0,maxSize:available[i]?100:0,class:{'dock-collapsed':!live[i]}},{default:()=>renderNode(child,childExtent(i))}))});
  }
  // Folding (docs/mobile.md Layout): a split's area smaller than Blender's minimum for it, which scales with Resolution
  // Scale, shows as a strip on the split's edge, and opens from there as a drawer over its neighbour. An area's minimum
  // width is the width Blender gives panels (UI_SIDEBAR_PANEL_WIDTH, 11 widget units), its height its header and one
  // more; a split's adds or takes the most of its areas'.
  const token=name=>parseFloat(getComputedStyle(host).getPropertyValue(name));
  const minimum=(node,horizontal)=>{
    if(typeof node==='number')return horizontal?2*token('--bl-header-h'):11*token('--bl-row');
    const shown=node.children.filter(hasVisible).map(child=>minimum(child,horizontal));
    return state.layout.horizontal[node.id]===horizontal?shown.reduce((a,b)=>a+b,0):Math.max(0,...shown);
  };
  // The child of a split that folds: the smaller one under its minimum, while the other fits.
  const folded=(node,pixels,horizontal)=>{
    const short=pixels.map((size,i)=>size<minimum(node.children[i],horizontal));
    if(!short.some(Boolean))return null;
    const i=short.every(Boolean)?(pixels[0]<pixels[1]?0:1):short.indexOf(true);
    return i;
  };
  const leaves=node=>typeof node==='number'?(visible(node)?[node]:[]):node.children.flatMap(leaves);
  const itemOf=slot=>items.find(item=>item.id===state.layout.order[slot]);
  // The drawer's size: the area's share of startup.blend's 1920 x 1080 window at Resolution Scale, within the split.
  const drawerSize=(node,i,horizontal,total)=>{
    const [a,b]=state.layout.sizes[node.id],share=(i?b:a)/(a+b),reference=(horizontal?1080:1920)*token('--bl-row')/20;
    return Math.min(0.9*total,Math.max(minimum(node.children[i],horizontal),share*reference));
  };
  function renderFolded(node,i,horizontal,extent){
    const child=node.children[i],other=node.children[1-i],open=state.drawer===node.id,strip=token('--bl-header-h');
    const total=horizontal?extent.height:extent.width,size=drawerSize(node,i,horizontal,total);
    const titles=leaves(child).map(slot=>itemOf(slot)?.title).join(', ');
    const handle=h('button',{type:'button',class:'dock-fold','aria-label':titles,'aria-expanded':open,title:titles,onClick:()=>{state.drawer=open?null:node.id;}},
      leaves(child).map(slot=>icon(itemOf(slot)?.icon||'properties')));
    const rest=h('div',{class:'dock-fold-rest'},[renderNode(other,horizontal?{...extent,height:total-strip}:{...extent,width:total-strip})]);
    const side=horizontal?(i?'bottom':'top'):(i?'right':'left');
    const drawer=open?[h('div',{class:'dock-drawer-backdrop',onPointerdown:()=>{state.drawer=null;}}),
      h('div',{class:['dock-drawer',side],style:{[horizontal?'height':'width']:size+'px'}},[renderNode(child,horizontal?{...extent,height:size}:{...extent,width:size})])]:[];
    return h('div',{class:['dock-folded',horizontal?'horizontal':'vertical']},i?[rest,handle,...drawer]:[handle,rest,...drawer]);
  }
  const setFactory=(type,factory)=>{factories.set(type,factory);state.factoryCount=factories.size;for(const item of items)if(item.type===type&&!instances.has(item.id))instances.set(item.id,factory(item.element,item.id));};
  const split=(slot,horizontal)=>{
    const original=items.find(item=>item.id===state.layout.order[slot]),type=original.type||original.id;
    const selected=factories.has(type)?type:factories.has('properties')?'properties':null;
    if(!selected)return;
    const id='area:'+crypto.randomUUID(),element=document.createElement('section'),item={id,type:selected,title:items.find(i=>i.id===selected).title,overlap:items.find(i=>i.id===selected).overlap,blenderHeader:items.find(i=>i.id===selected).blenderHeader,element};
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
  // The editors an area can show, a node tree type's by its own label.
  const editorChoices=slot=>items.slice(0,baseCount).flatMap(item=>item.variants?item.variants.map(v=>({label:v.label,icon:v.icon,run:()=>{chooseEditor(slot,item.id);v.run();}})):[{label:item.title,icon:item.icon,run:()=>chooseEditor(slot,item.id)}]);
  // Blender's editor type menu in an area's header (tree-menu.js), by the editors' labels.
  const editorType=(detail,slot)=>{
    const choice=editorChoices(slot).find(c=>c.label===detail.label);
    detail.available=!!choice;
    if(choice&&detail.choose)choice.run();
  };
  const swap=(a,b)=>{const order=state.layout.order,i=order.indexOf(a),j=order.indexOf(b);if(i<0||j<0||i===j)return;[order[i],order[j]]=[order[j],order[i]];persist();};
  // The two areas of a split, when that is all it holds: they join as Blender joins two areas sharing a whole edge.
  const siblings=(a,b)=>{const pair=[a,b].map(id=>state.layout.order.indexOf(id)).sort().join();const find=node=>typeof node!=='number'&&([...node.children].sort().join()===pair||node.children.some(find));return find(state.tree);};
  // An area carried by its header (docs/mobile.md Area management): a finger's hold and drag (wm-touch.js), dropped
  // on another area to swap them; its drop highlight is Blender's for screen.area_swap.
  let carried=null;
  const areaAt=(x,y)=>document.elementsFromPoint(x,y).map(el=>el.closest('[data-section]')?.dataset.section).find(Boolean)??null;
  function carry(id,{phase,x,y}){
    if(phase==='arm'){carried=id;return;}
    const target=phase==='move'||phase==='end'?areaAt(x,y):null,other=target&&target!==id?target:null;
    if(phase==='end'&&other)swapAreas(id,other);
    if(phase==='end'||phase==='cancel'){carried=null;state.drop=null;return;}
    const leaf=other&&root.querySelector(`.dock-leaf[data-section="${CSS.escape(other)}"]`)?.getBoundingClientRect();
    state.drop=leaf?{left:leaf.left+'px',top:leaf.top+'px',width:leaf.width+'px',height:leaf.height+'px'}:null;
  }
  // A long press or right click on an area edge: the areas on its two sides (left or top first), found as Blender
  // finds them (screen_area_edge_from_cursor), past the edge's touch margin.
  root.addEventListener('contextmenu',event=>{
    const splitter=event.target.closest?.('.splitpanes__splitter');
    if(!splitter)return;
    event.preventDefault();event.stopPropagation();
    const vertical=splitter.parentElement.classList.contains('splitpanes--vertical'),r=splitter.getBoundingClientRect(),margin=token('--bl-edge-margin')+2;
    const areas=vertical?[areaAt(r.left-margin,event.clientY),areaAt(r.right+margin,event.clientY)]:[areaAt(event.clientX,r.top-margin),areaAt(event.clientX,r.bottom+margin)];
    if(areas.every(Boolean))edgeMenu({areas,vertical,joinable:siblings(...areas)},event);
  });
  const closeArea=slot=>{if(typeof state.tree==='number')return;const next=removeArea(state.tree,slot);if(next===null)return;state.tree=next;const id=state.layout.order[slot];if(!state.layout.hidden.includes(id))state.layout.hidden.push(id);state.focus=null;persist();};
  const labels={animation:'Timeline split',root:'Main split',main:'Output split',editors:'Editor split',inspector:'Inspector split'};
  const app=createApp({setup(){
    watch(()=>JSON.stringify([state.layout,state.focus]),()=>nextTick(position),{flush:'post'});
    return ()=>h('div',{class:'dock-shell'},[
      state.drop&&h('div',{class:'dock-drop',style:state.drop},icon('area_swap')),
      h('div',{class:'dock-splits'},focus()?h('div',{class:'dock-focus-space'},bareFocus?[]:[renderNode(state.layout.order.indexOf(focus()))]):h('div',{key:JSON.stringify([state.layout.hidden,state.layout.order]),class:'dock-split-tree',ref:el=>el&&observer.observe(el)},[renderNode(state.tree)])),
      h(Teleport,{to:document.body},[h('dialog',{class:'dock-dialog',ref:el=>menuElement=el,onClick:e=>{if(e.target===menuElement)closeMenu();}},[
        h('div',{class:'dock-dialog-title'},[h('strong','Workspace Layout'),button('×',closeMenu,'Close layout')]),
        h('label',[h('input',{type:'checkbox',checked:state.remember,onChange:e=>{state.remember=e.target.checked;persist();}}),'Remember on this device']),
        button('Use split view',()=>{state.focus=null;state.layout.order.forEach((id,slot)=>ensureArea(slot));state.layout.hidden=[];persist();closeMenu();}),
        h('details',[h('summary','Areas'),h('div',{class:'dock-arrangement'},[
          ...items.map(item=>h('label',[h('input',{type:'checkbox',checked:!state.layout.hidden.includes(item.id),onChange:()=>toggle(item.id)}),item.title])),
          ...state.layout.order.map((id,slot)=>h('label',['Area '+(slot+1),select(id,value=>{swapSections(state.layout,slot,value);persist();},items.map(item=>[item.id,item.title]),'Editor Type'),button('⋮',e=>{closeMenu();headerMenu(id,e);},'Area Options')])),
          ...Object.keys(state.layout.horizontal).map(key=>h('label',[labels[key]||key,select(String(state.layout.horizontal[key]),value=>{state.layout.horizontal[key]=value==='true';persist();},[['false','Side by side'],['true','Stacked']],labels[key]||key)]))
        ])]),
        button('Reset layout',reset)
      ])])
    ]);
  }});
  app.mount(root);nextTick(position);
  const keyboard=event=>{if((event.ctrlKey||event.metaKey)&&event.code==='Space'&&hovered!==null){event.preventDefault();event.stopPropagation();const id=state.layout.order[hovered];state.focus=state.focus===id?null:id;persist();}};
  host.addEventListener('keydown',keyboard,true);
  host.addEventListener('pointerover',event=>{const panel=event.target.closest('.dock-content');if(panel)hovered=state.layout.order.indexOf(panel.dataset.section);});
  const unlock=()=>host.classList.remove('dock-resizing');
  root.addEventListener('pointerdown',event=>{if(event.target.closest('.splitpanes__splitter'))host.classList.add('dock-resizing');});
  window.addEventListener('pointerup',unlock);window.addEventListener('pointercancel',unlock);window.addEventListener('blur',unlock);
  // Blender's workspace switch: another screen over the same areas.
  const setScreen=name=>{const next=name in screens?name:null;if(next===state.screen)return;persist();state.screen=next;load();persist();};
  return {show,toggle,reset,openMenu,setFactory,header,setScreen,onHeaderMenu(fn){headerMenu=fn;},onEdgeMenu(fn){edgeMenu=fn;},onSwap(fn){swapAreas=fn;},swap,join(keep,remove){if(siblings(keep,remove))closeArea(state.layout.order.indexOf(remove));},get hovered(){return hovered===null?null:state.layout.order[hovered];},get screen(){return state.screen;},get areas(){return leaves(state.tree).map(slot=>state.layout.order[slot]);},get maximized(){return focus();},maximize(id){state.focus=state.focus===id?null:id;persist();},split(id,horizontal){if(state.factoryCount)split(state.layout.order.indexOf(id),horizontal);},close(id){if(typeof state.tree!=='number')closeArea(state.layout.order.indexOf(id));},dispose(){disposed=true;cancelAnimationFrame(frameId);observer.disconnect();instances.forEach(instance=>instance?.dispose?.());host.removeEventListener('keydown',keyboard,true);app.unmount();window.removeEventListener('pointerup',unlock);window.removeEventListener('pointercancel',unlock);window.removeEventListener('blur',unlock);}};
}
