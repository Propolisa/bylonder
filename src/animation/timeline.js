import { createApp,h,reactive,Teleport } from 'vue';
import { address } from './model.js';
import { menuButton } from '../ui/menu.js';
import { icon } from '../properties/icons.js';
import './timeline.css';
export function mountTimeline(host,animation,{insert,undo,redo,header,names=id=>id}) {
  const state=reactive({revision:0,selected:[],filter:'',zoom:1,offset:0,channels:false});
  const unsubscribe=animation.subscribe(()=>state.revision++);
  const selected=(ref,frame)=>state.selected.some(s=>s.ref===ref&&s.frame===frame);
  const allKeys=()=>animation.action.tracks.flatMap(t=>t.keys.map(k=>({ref:address(t.id,t.path),frame:k.frame})));
  const remove=()=>{animation.deleteKeys(state.selected);state.selected=[];};
  const move=(delta,duplicate=false)=>{if(!state.selected.length||!delta)return;animation.editKeys(state.selected,{offset:delta,duplicate});state.selected=state.selected.map(s=>({...s,frame:s.frame+delta}));};
  const time=animation.time;
  const jump=direction=>{const frames=[...new Set(animation.action.tracks.flatMap(t=>t.keys.map(k=>k.frame)))].sort((a,b)=>a-b),[first,last]=time.range();animation.seek(direction<0?frames.filter(f=>f<time.frame).at(-1)??first:frames.find(f=>f>time.frame)??last);};
  // Start/End edit the preview range while it is enabled, as in Blender's Timeline header.
  const rangeKeys=()=>time.state.usePreviewRange?['framePreviewStart','framePreviewEnd']:['frameStart','frameEnd'];
  const setRange=(i,n)=>{const keys=rangeKeys(),[a,b]=time.range();if(n!==null&&(i?n>a:n<b))time.configure({[keys[i]]:n});};
  const ask=(label,value)=>{const n=Number(prompt(label,value));return Number.isFinite(n)?Math.round(n):null;};
  const label=(track,ch)=>({group:ch?.group||names(track.id)||track.id,name:ch?.label||track.path});
  const bar=header||null;
  const menus=[
    menuButton('Playback',()=>[
      {label:'Loop Playback',checked:()=>time.state.loop,run:()=>time.configure({loop:!time.state.loop})},
      '-',
      {label:'Set Start Frame…',run:()=>setRange(0,ask('Start frame',time.range()[0]))},
      {label:'Set End Frame…',run:()=>setRange(1,ask('End frame',time.range()[1]))},
      {label:'Use Preview Range',checked:()=>time.state.usePreviewRange,run:()=>time.configure({usePreviewRange:!time.state.usePreviewRange})},
    ]),
    menuButton('Keying',()=>[
      {label:'Auto Keying',checked:()=>time.state.autoKey,run:()=>time.configure({autoKey:!time.state.autoKey})},
      '-',
      {label:'Insert Keyframe',icon:'keyframe',keys:'I',run:insert},
      {label:'Delete Keyframes',keys:'Alt I',enabled:()=>state.selected.length>0,run:remove},
    ]),
    menuButton('View',()=>[
      {label:'Show Channels',checked:()=>state.channels,run:()=>state.channels=!state.channels},
      '-',
      {label:'Frame All',keys:'Home',run:()=>{state.zoom=1;state.offset=0;}},
      {label:'Zoom In',keys:'Ctrl +',run:()=>state.zoom=Math.min(64,state.zoom*2)},
      {label:'Zoom Out',keys:'Ctrl -',run:()=>state.zoom=Math.max(1,state.zoom/2)},
    ]),
    menuButton('Key',()=>[
      {label:'Select All',keys:'A',run:()=>state.selected=allKeys()},
      '-',
      {label:'Move…',enabled:()=>state.selected.length>0,run:()=>move(ask('Move selected keys by frames',10))},
      {label:'Duplicate…',keys:'Shift D',enabled:()=>state.selected.length>0,run:()=>move(ask('Duplicate selected keys, offset in frames',10),true)},
      {label:'Delete Keyframes',keys:'X',enabled:()=>state.selected.length>0,run:remove},
      '-',
      {label:'Interpolation Mode',items:[['BEZIER','Bézier'],['LINEAR','Linear'],['CONSTANT','Constant']].map(([interpolation,label])=>({label,enabled:()=>state.selected.length>0,run:()=>animation.editKeys(state.selected,{interpolation})}))},
      '-',
      {label:'Undo',keys:'Ctrl Z',run:undo},{label:'Redo',keys:'Shift Ctrl Z',run:redo},
    ]),
  ];
  const transport=document.createElement('div');transport.className='timeline-transport';
  if(bar)bar.append(...menus,transport);
  const button=(name,title,fn,attrs={})=>h('button',{type:'button',class:'bl-icon-button',title,'aria-label':title,onClick:fn,...attrs},icon(name));
  const numeric=(title,value,onChange,prefix)=>h('label',{class:'timeline-field',title:`${title}: ${value}`},[prefix?h('span',prefix):null,h('input',{type:'number','aria-label':title,value,onChange:e=>{const n=Number(e.target.value);if(Number.isFinite(n))onChange(Math.round(n));}})]);
  const keydown=e=>{
    if(e.target.closest('input,select,textarea'))return;
    const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
    if(k===' '){e.preventDefault();animation.play();}
    else if(k==='delete'||k==='x'){e.preventDefault();remove();}
    else if(k==='i'){e.preventDefault();e.altKey?remove():insert();}
    else if(k==='a'&&!mod){e.preventDefault();state.selected=e.altKey?[]:allKeys();}
    else if(k==='d'&&e.shiftKey){e.preventDefault();move(ask('Duplicate selected keys, offset in frames',10),true);}
    else if(k==='arrowleft'||k==='arrowright'){e.preventDefault();const dir=k==='arrowleft'?-1:1;e.shiftKey?animation.seek(time.range()[dir<0?0:1]):animation.seek(Math.round(time.frame)+dir);}
    else if(k==='arrowup'||k==='arrowdown'){e.preventDefault();jump(k==='arrowup'?1:-1);}
    else if(k==='home'){e.preventDefault();state.zoom=1;state.offset=0;}
    else if(mod&&(k==='+'||k==='=')){e.preventDefault();state.zoom=Math.min(64,state.zoom*2);}
    else if(mod&&k==='-'){e.preventDefault();state.zoom=Math.max(1,state.zoom/2);}
    else if(k==='z'&&mod){e.preventDefault();e.shiftKey?redo():undo();}
    e.stopPropagation();
  };
  const app=createApp({setup(){return()=>{
    state.revision;
    const action=animation.action,t=time.state,[first,last]=time.range(),preview=t.usePreviewRange,pad=Math.max(2,(t.frameEnd-t.frameStart)*0.04),start=t.frameStart-pad/state.zoom+state.offset,span=(t.frameEnd-t.frameStart+2*pad)/state.zoom;
    const x=frame=>100*(frame-start)/span;
    const tracks=action.tracks.filter(t=>{const ch=animation.channels.get(address(t.id,t.path)),l=label(t,ch);return `${l.group} ${l.name}`.toLowerCase().includes(state.filter.toLowerCase());});
    const step=[1,2,5,10,20,25,50,100,200,250,500,1000].find(s=>span/s<=12)||1000,ticks=[];
    for(let f=Math.ceil(start/step)*step;f<=start+span;f+=step)ticks.push(f);
    const seek=e=>{const rect=e.currentTarget.getBoundingClientRect();animation.seek(start+(e.clientX-rect.left)/rect.width*span);};
    const drag=e=>{if(e.button!==0||e.target.closest('.timeline-key'))return;if(!e.shiftKey)state.selected=[];seek(e);const el=e.currentTarget;el.setPointerCapture(e.pointerId);el.onpointermove=event=>{if(el.hasPointerCapture(event.pointerId))seek(event);};el.onpointerup=event=>{el.releasePointerCapture(event.pointerId);el.onpointermove=null;};};
    const wheel=e=>{e.preventDefault();if(e.ctrlKey||e.metaKey)state.zoom=Math.max(1,Math.min(64,state.zoom*(e.deltaY<0?1.25:0.8)));else state.offset+=Math.sign(e.deltaY||e.deltaX)*span*0.05;};
    const keyPointer=(e,entries,frame)=>{
      e.stopPropagation();const el=e.currentTarget;el.focus();
      const chosen=entries.every(s=>selected(s.ref,s.frame));
      if(e.shiftKey)state.selected=chosen?state.selected.filter(s=>!entries.some(t=>t.ref===s.ref&&t.frame===s.frame)):[...state.selected,...entries];
      else if(!chosen)state.selected=entries;
      const origin=e.clientX,width=el.parentElement.clientWidth,selection=state.selected.map(s=>({...s}));
      el.setPointerCapture(e.pointerId);
      el.onpointerup=event=>{el.releasePointerCapture(event.pointerId);const offset=Math.round((event.clientX-origin)/width*span);if(Math.abs(event.clientX-origin)>4&&offset){animation.editKeys(selection,{offset,duplicate:event.altKey});state.selected=selection.map(s=>({...s,frame:s.frame+offset}));}else animation.seek(frame);};
      el.onpointercancel=()=>{el.onpointerup=null;};
    };
    const diamond=(entries,frame,title)=>h('button',{class:['timeline-key',{selected:entries.every(s=>selected(s.ref,s.frame))}],style:{left:x(frame)+'%'},title,'aria-label':`Key at frame ${frame}`,onPointerdown:e=>keyPointer(e,entries,frame)});
    const lane=(children,attrs={})=>h('div',{class:'timeline-lane',onPointerdown:drag,onWheel:wheel,...attrs},[
      h('i',{class:['timeline-range',{preview}],style:{left:0,width:Math.max(0,x(first))+'%'}}),h('i',{class:['timeline-range',{preview}],style:{left:Math.min(100,x(last))+'%',right:0}}),
      ...ticks.map(f=>h('i',{class:'timeline-grid',style:{left:x(f)+'%'}})),...children]);
    const summary=new Map();for(const t of tracks)for(const k of t.keys){if(x(k.frame)<0||x(k.frame)>100)continue;if(!summary.has(k.frame))summary.set(k.frame,[]);summary.get(k.frame).push({ref:address(t.id,t.path),frame:k.frame});}
    const controls=h('div',{class:'timeline-controls'},[
      button('rec','Auto Keying',()=>time.configure({autoKey:!t.autoKey}),{class:['bl-icon-button','timeline-record',{enabled:t.autoKey}],'aria-pressed':t.autoKey}),
      h('span',{class:'bl-sep'}),
      h('span',{class:'bl-group'},[
        button('rew','Jump to Endpoint (Shift Left)',()=>animation.seek(first)),button('prev_keyframe','Jump to Keyframe (Down)',()=>jump(-1)),
        button(animation.playing?'pause':'play','Play Animation (Space)',()=>animation.play(),{'aria-pressed':animation.playing}),
        button('next_keyframe','Jump to Keyframe (Up)',()=>jump(1)),button('ff','Jump to Endpoint (Shift Right)',()=>animation.seek(last))]),
      h('span',{class:'bl-sep'}),
      numeric('Current Frame',Math.round(time.frame),n=>animation.seek(n)),
      h('span',{class:'bl-sep'}),
      button('preview_range','Use Preview Range',()=>time.configure({usePreviewRange:!preview}),{'aria-pressed':preview}),
      h('span',{class:['bl-group timeline-range-fields',{preview}]},[numeric(preview?'Preview Start Frame':'Start Frame',first,n=>setRange(0,n),'Start'),numeric(preview?'Preview End Frame':'End Frame',last,n=>setRange(1,n),'End')])
    ]);
    const frame=Math.round(time.frame);
    return h('section',{class:['timeline',{'show-channels':state.channels}],tabindex:0,onKeydown:keydown},[
      bar?h(Teleport,{to:transport},[controls]):h('header',{class:'timeline-header'},[h('div',{class:'timeline-menus',ref:el=>{if(el&&!el.childElementCount)el.append(...menus);}}),controls]),
      h('div',{class:'timeline-body'},[
        h('div',{class:'timeline-row timeline-ruler'},[
          h('div',{class:'timeline-channel'},[h('label',{class:'bl-search'},[icon('VIEWZOOM'),h('input',{value:state.filter,title:'Filter channels',onInput:e=>state.filter=e.target.value})])]),
          lane([...ticks.map(f=>h('span',{class:'timeline-tick',style:{left:x(f)+'%'}},String(f))),h('b',{class:'timeline-frame',style:{left:x(time.frame)+'%'}},String(frame))])
        ]),
        h('div',{class:'timeline-row timeline-summary'},[h('div',{class:'timeline-channel'},[h('span','Summary')]),lane([...summary].map(([f,entries])=>diamond(entries,f,`Frame ${f} · ${entries.length} keys`)))]),
        ...(state.channels?tracks:[]).map(track=>{const ref=address(track.id,track.path),ch=animation.channels.get(ref),missing=!ch?.available(),l=label(track,ch);return h('div',{class:['timeline-row',{missing}]},[
          h('div',{class:'timeline-channel',title:`${l.group} · ${l.name}${missing?'\nUnresolved target; keys retained.':''}`},[
            button(track.muted?'checkbox_dehlt':'checkbox_hlt','Mute / unmute channel',()=>animation.mute(ref)),h('span',{class:'timeline-group'},l.group),h('span',l.name)]),
          lane(track.keys.filter(k=>x(k.frame)>=0&&x(k.frame)<=100).map(k=>diamond([{ref,frame:k.frame}],k.frame,`${l.name}\nFrame ${k.frame} · ${JSON.stringify(k.value)}\n${k.interpolation} · Drag to move; Alt-drag to duplicate; Shift to select`)))
        ]);}),
        h('div',{class:'timeline-row timeline-fill'},[h('div',{class:'timeline-channel'}),lane([])]),
        h('i',{class:'timeline-playhead',style:{left:`calc(var(--channels) + (100% - var(--channels)) * ${x(time.frame)/100})`}})
      ])
    ]);
  };}});
  app.mount(host);
  return {dispose(){unsubscribe();app.unmount();menus.forEach(m=>m.remove());transport.remove();}};
}
