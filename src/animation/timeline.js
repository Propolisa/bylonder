import { createApp,h,reactive } from 'vue';
import { address } from './model.js';
import './timeline.css';
export function mountTimeline(host,animation,{insert,undo,redo}) {
  const state=reactive({revision:0,selected:[],filter:'',zoom:1,offset:0,delta:1,interpolation:'BEZIER'});
  const unsubscribe=animation.subscribe(()=>state.revision++);
  const selected=(ref,frame)=>state.selected.some(s=>s.ref===ref&&s.frame===frame);
  const remove=()=>{animation.deleteKeys(state.selected);state.selected=[];};
  const move=duplicate=>{animation.editKeys(state.selected,{offset:Number(state.delta),duplicate});state.selected=state.selected.map(s=>({...s,frame:s.frame+Number(state.delta)}));};
  const jump=direction=>{const frames=[...new Set(animation.action.tracks.flatMap(t=>t.keys.map(k=>k.frame)))].sort((a,b)=>a-b);animation.seek(direction<0?frames.filter(f=>f<animation.action.frame).at(-1)??animation.action.start:frames.find(f=>f>animation.action.frame)??animation.action.end);};
  const button=(icon,title,fn,attrs={})=>h('button',{title,'aria-label':title,onClick:fn,...attrs},icon);
  const numeric=(title,value,onChange,attrs={})=>h('input',{type:'number',title:`${title}: ${value}`,'aria-label':title,value,onChange:e=>{const n=Number(e.target.value);if(Number.isFinite(n))onChange(n);},...attrs});
  const keydown=e=>{
    if(e.target.closest('input,select,textarea'))return;
    const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
    if(k===' '){e.preventDefault();animation.play();}
    else if(k==='delete'||k==='x'){e.preventDefault();remove();}
    else if(k==='i'){e.preventDefault();e.altKey?remove():insert();}
    else if(k==='a'&&!mod){e.preventDefault();state.selected=animation.action.tracks.flatMap(t=>t.keys.map(k=>({ref:address(t.id,t.path),frame:k.frame})));}
    else if(k==='d'&&e.shiftKey){e.preventDefault();move(true);}
    else if(k==='arrowleft'||k==='arrowright'){e.preventDefault();const dir=k==='arrowleft'?-1:1;e.shiftKey?animation.seek(dir<0?animation.action.start:animation.action.end):animation.seek(Math.round(animation.action.frame)+dir);}
    else if(k==='arrowup'||k==='arrowdown'){e.preventDefault();jump(k==='arrowup'?1:-1);}
    else if(k==='home'){e.preventDefault();state.zoom=1;state.offset=0;}
    else if(k==='z'&&mod){e.preventDefault();e.shiftKey?redo():undo();}
    e.stopPropagation();
  };
  const app=createApp({setup(){return()=>{
    state.revision;
    const action=animation.action,start=action.start+state.offset,span=(action.end-action.start)/state.zoom;
    const x=frame=>100*(frame-start)/span;
    const tracks=action.tracks.filter(t=>{const ch=animation.channels.get(address(t.id,t.path));return `${ch?.group||t.id} ${ch?.label||t.path}`.toLowerCase().includes(state.filter.toLowerCase());});
    const seek=e=>{if(e.target.closest('.timeline-key'))return;const rect=e.currentTarget.getBoundingClientRect();animation.seek(start+(e.clientX-rect.left)/rect.width*span);};
    const drag=e=>{if(e.button!==0)return;seek(e);const el=e.currentTarget;el.setPointerCapture(e.pointerId);el.onpointermove=event=>{if(el.hasPointerCapture(event.pointerId))seek(event);};el.onpointerup=event=>{el.releasePointerCapture(event.pointerId);el.onpointermove=null;};};
    const keyPointer=(e,ref,frame)=>{
      e.stopPropagation();const el=e.currentTarget;el.focus();
      if(e.shiftKey)state.selected=selected(ref,frame)?state.selected.filter(s=>s.ref!==ref||s.frame!==frame):[...state.selected,{ref,frame}];
      else if(!selected(ref,frame))state.selected=[{ref,frame}];
      const origin=e.clientX,width=el.parentElement.clientWidth,selection=structuredClone([...state.selected].map(s=>({...s})));
      el.setPointerCapture(e.pointerId);
      el.onpointerup=event=>{el.releasePointerCapture(event.pointerId);const offset=Math.round((event.clientX-origin)/width*span);if(Math.abs(event.clientX-origin)>4&&offset){animation.editKeys(selection,{offset,duplicate:event.altKey});state.selected=selection.map(s=>({...s,frame:s.frame+offset}));}else animation.seek(frame);};
      el.onpointercancel=()=>{el.onpointerup=null;};
    };
    return h('section',{class:'timeline',tabindex:0,onKeydown:keydown},[
      h('header',{class:'timeline-header'},[
        h('span',{class:'timeline-action',title:`Action: ${action.name} · ${action.tracks.length} F-curves`},action.name),
        button('⏮','Jump to first frame (Shift-Left)',()=>animation.seek(action.start)),button('◀│','Previous keyframe',()=>jump(-1)),
        button(animation.playing?'Ⅱ':'▶','Play / pause (Space)',()=>animation.play(),{'aria-pressed':animation.playing}),button('│▶','Next keyframe',()=>jump(1)),button('⏭','Jump to last frame (Shift-Right)',()=>animation.seek(action.end)),
        button('●','Auto key transforms: '+(action.autoKey?'on':'off'),()=>animation.configure({autoKey:!action.autoKey}),{class:{record:true,enabled:action.autoKey},'aria-pressed':action.autoKey}),
        button('◆','Insert Location, Rotation & Scale keys for selected objects (I)',insert),
        button('↻','Loop playback: '+action.loop,()=>animation.configure({loop:!action.loop}),{'aria-pressed':action.loop}),
        numeric('Current frame',Math.round(action.frame),n=>animation.seek(n)),
        h('details',{class:'timeline-options'},[h('summary',{title:'Playback range, frame rate, keyframe editing and zoom'},'⋯'),h('div',[
          h('label',['Start',numeric('Start frame',action.start,n=>{if(n<action.end)animation.configure({start:Math.round(n)});})]),
          h('label',['End',numeric('End frame',action.end,n=>{if(n>action.start)animation.configure({end:Math.round(n)});})]),
          h('label',['FPS',numeric('Frames per second',action.fps,n=>{if(n>=1&&n<=240)animation.configure({fps:n});},{min:1,max:240})]),
          h('label',['Offset',numeric('Move selected keys by frames',state.delta,n=>state.delta=Math.round(n))]),
          button('↔','Move selected keys by offset',()=>move(false),{disabled:!state.selected.length}),button('⧉','Duplicate selected keys by offset (Shift-D)',()=>move(true),{disabled:!state.selected.length}),button('×','Delete selected keys (X / Delete)',remove,{disabled:!state.selected.length}),
          h('select',{title:'Selected keys: interpolation',value:state.interpolation,onChange:e=>{state.interpolation=e.target.value;animation.editKeys(state.selected,{interpolation:state.interpolation});}},['BEZIER','LINEAR','CONSTANT'].map(value=>h('option',{value},value==='BEZIER'?'Bézier · auto clamped':value==='LINEAR'?'Linear':'Constant'))),
          button('−','Zoom out',()=>state.zoom=Math.max(1,state.zoom/2)),button('+','Zoom in',()=>state.zoom=Math.min(64,state.zoom*2)),button('⌂','Frame playback range (Home)',()=>{state.zoom=1;state.offset=0;}),
          numeric('Timeline pan in frames',state.offset,n=>state.offset=n),button('↶','Undo',undo),button('↷','Redo',redo)
        ])])
      ]),
      h('div',{class:'timeline-body'},[
        h('div',{class:'timeline-row timeline-ruler'},[h('input',{placeholder:'Filter channels',value:state.filter,title:'Filter by target or property',onInput:e=>state.filter=e.target.value}),h('div',{class:'timeline-lane',onPointerdown:drag},Array.from({length:11},(_,i)=>h('span',{class:'timeline-tick',style:{left:i*10+'%'}},String(Math.round(start+span*i/10)))))]),
        ...tracks.map(track=>{const ref=address(track.id,track.path),ch=animation.channels.get(ref),missing=!ch?.available();return h('div',{class:['timeline-row',{missing}]},[
          h('div',{class:'timeline-channel',title:`${ch?.group||track.id} · ${ch?.label||track.path}\n${track.id} → ${track.path}${missing?'\nUnresolved target; keys retained.':''}`},[
            button(track.muted?'○':'●','Mute / unmute channel',()=>animation.mute(ref)),h('span',`${ch?.group||track.id} · ${ch?.label||track.path}`)]),
          h('div',{class:'timeline-lane',onPointerdown:drag},[
            ...track.keys.filter(k=>x(k.frame)>=0&&x(k.frame)<=100).map(k=>h('button',{class:['timeline-key',{selected:selected(ref,k.frame)}],style:{left:x(k.frame)+'%'},title:`${ch?.label||track.path}\nFrame ${k.frame} · Value ${JSON.stringify(k.value)}\n${k.interpolation} · Drag to move; Alt-drag to duplicate; Shift to select`,'aria-label':`Key at frame ${k.frame}`,onPointerdown:e=>keyPointer(e,ref,k.frame)},'◆')),
            h('i',{class:'timeline-playhead',style:{left:x(action.frame)+'%'}})
          ])
        ]);}),
        !tracks.length?h('div',{class:'timeline-empty'},'Select an object and press I, or key a property with ◇.'):null
      ])
    ]);
  };}});
  app.mount(host);
  return {dispose(){unsubscribe();app.unmount();}};
}
