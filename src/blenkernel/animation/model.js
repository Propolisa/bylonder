import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { createSceneTime, validateTime } from '../scene/time.js';

export const address = (id, path) => JSON.stringify([id, path]);
const scalar = value => ['number','boolean','string'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const clone = value => structuredClone(value);
const modes = ['BEZIER','LINEAR','CONSTANT'];
// Action: Blender's Action datablock reduced to what we use, a name and F-Curve-like tracks.
export function validateAction(input) {
  if (!input) return {name:'Action',tracks:[]};
  if (!Array.isArray(input.tracks) || input.tracks.length > 10000) throw Error('Invalid animation action');
  const result = {name:input.name,tracks:clone(input.tracks)};
  if(typeof result.name!=="string"||result.name.length>200)throw Error("Invalid action settings");
  const ids = new Set(); let count = 0;
  for (const track of result.tracks) {
    if (typeof track.id !== 'string' || typeof track.path !== 'string' || !Array.isArray(track.keys)) throw Error('Invalid animation channel');
    const id = address(track.id,track.path);
    if(ids.has(id)) throw Error('Duplicate animation channel'); ids.add(id);
    const frames = new Set();
    for(const key of track.keys) {
      if(!Number.isInteger(key.frame) || Math.abs(key.frame)>1e6 || frames.has(key.frame) || !scalar(key.value) || !modes.includes(key.interpolation)) throw Error('Invalid keyframe');
      frames.add(key.frame); if(++count>100000) throw Error('Too many keyframes');
    }
    track.keys.sort((a,b)=>a.frame-b.frame);
  }
  return result;
}
// Saved animation payload. v2: {version:2, action:{name,tracks}, time:{...scene time}}. v1 kept range and fps on the action.
export function parseAnimation(input) {
  if (!input) return {action:validateAction(),time:validateTime()};
  if (input.version === 1) {
    const {start,end,fps,frame,loop,autoKey}=input;
    return {action:validateAction(input),time:validateTime({frameStart:start,frameEnd:end,fps,frameCurrent:frame,loop,autoKey,framePreviewStart:start,framePreviewEnd:end})};
  }
  if (input.version !== 2) throw Error('Invalid animation action');
  return {action:validateAction(input.action),time:validateTime(input.time)};
}
export function compileTrack(track, fps) {
  const numeric = !track.discrete && track.keys.every(key=>typeof key.value === 'number');
  const animation = new Animation(address(track.id,track.path),'value',fps,Animation.ANIMATIONTYPE_FLOAT,Animation.ANIMATIONLOOPMODE_CONSTANT);
  const keys=track.keys.map((key,i)=>({frame:key.frame,value:numeric?key.value:i,...(!numeric||key.interpolation==='CONSTANT'?{interpolation:1}:{})}));
  const slope = i => {
    if(i===0||i===keys.length-1)return 0;
    const a=(keys[i].value-keys[i-1].value)/(keys[i].frame-keys[i-1].frame),b=(keys[i+1].value-keys[i].value)/(keys[i+1].frame-keys[i].frame);
    return a*b<=0?0:Math.sign(a)*Math.min(Math.abs((a+b)/2),3*Math.min(Math.abs(a),Math.abs(b)));
  };
  if(numeric)for(let i=0;i<keys.length-1;i++)if(track.keys[i].interpolation==='BEZIER'){
    keys[i].outTangent=slope(i);keys[i+1].inTangent=slope(i+1);
  }
  animation.setKeys(keys);
  return {animation,decode:value=>numeric?value:track.keys[Math.max(0,Math.min(track.keys.length-1,Math.round(value)))].value};
}
// Validates any saved payload version and returns it as v2.
export const normalizeAnimation = input => { const {action,time} = parseAnimation(input); return {version:2,action,time}; };
// Legacy aliases on the action (start, end, fps, frame, loop, autoKey) read scene time; kept for user code.
const legacy={start:'frameStart',end:'frameEnd',fps:'fps',loop:'loop',autoKey:'autoKey'};
const withAliases=(action,time)=>Object.defineProperties(action,{...Object.fromEntries(Object.entries(legacy).map(([k,v])=>[k,{get:()=>time.state[v],enumerable:false,configurable:true}])),frame:{get:()=>time.frame,enumerable:false,configurable:true}});
export function createAnimationModel(onChange=()=>{},{time=createSceneTime()}={}) {
  const channels=new Map(),listeners=new Set(),compiled=new Map(),pose=new Map();
  let action=withAliases(validateAction(),time),evaluating=false,quiet=false,commit=()=>{},revision=0;
  const notify=()=>{revision++;listeners.forEach(fn=>fn());};
  const trackFor=ref=>action.tracks.find(t=>address(t.id,t.path)===ref);
  const curve=track=>{const ref=address(track.id,track.path);if(!compiled.has(ref))compiled.set(ref,compileTrack(track,time.state.fps));return compiled.get(ref);};
  const changed=()=>{compiled.clear();onChange(api.serialize());notify();};
  const evaluate=()=>{
    evaluating=true;
    try{for(const track of action.tracks){const ref=address(track.id,track.path),channel=channels.get(ref);if(channel?.available()&&track.keys.length&&!track.muted){const c=curve(track);const value=c.decode(c.animation.evaluate(time.frame));if(typeof value===typeof channel.get())channel.set(value);pose.set(ref,channel.get());}}
    }finally{evaluating=false;}
    notify();
  };
  time.subscribe(kind=>{
    if(quiet)return;
    if(kind==='frame')evaluate();
    else if(kind==='settings'){changed();commit();}
    else notify();
  });
  const api={
    channels,
    ref:address,
    time,get action(){return action;},get playing(){return time.playing;},get evaluating(){return evaluating;},get revision(){return revision;},
    setCommit(fn){commit=fn;},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    register({id,path,label=path,group=id,get,set,available=()=>true,transform=false,options}){
      const ref=address(id,path);
      if(channels.has(ref)){Object.assign(channels.get(ref),{label,group,get,set,available,transform,options});return ref;}
      if(!scalar(get()))throw Error('Animation channels must be scalar: '+ref);
      channels.set(ref,{id,path,label,group,get,set,available,transform,options});pose.set(ref,clone(get()));notify();return ref;
    },
    removeTarget(id){for(const [ref,ch] of channels)if(ch.id===id){channels.delete(ref);pose.delete(ref);}notify();},
    track:trackFor,
    state(ref){const channel=channels.get(ref),track=trackFor(ref);if(!channel?.available())return 'unavailable';if(!track?.keys.length)return 'none';const c=curve(track),value=c.decode(c.animation.evaluate(time.frame));if(JSON.stringify(channel.get())!==JSON.stringify(value))return 'changed';return track.keys.some(k=>k.frame===time.frame)?'keyed':'animated';},
    insert(refs,frame=Math.round(time.frame),value){
      if(!Number.isInteger(frame)||Math.abs(frame)>1e6)throw Error('Invalid keyframe frame');
      api.pause();
      for(const ref of Array.isArray(refs)?refs:[refs]){
        const channel=channels.get(ref);if(!channel?.available())continue;
        const next=value===undefined?clone(channel.get()):value;if(!scalar(next)||typeof next!==typeof channel.get())throw Error('Invalid animation value');
        let track=trackFor(ref);if(!track){track={id:channel.id,path:channel.path,discrete:!!channel.options||typeof next!=='number',keys:[]};action.tracks.push(track);}
        const old=track.keys.find(k=>k.frame===frame),key={frame,value:next,interpolation:old?.interpolation||(!track.discrete?'BEZIER':'CONSTANT')};
        track.keys=track.keys.filter(k=>k.frame!==frame);track.keys.push(key);track.keys.sort((a,b)=>a.frame-b.frame);
      }
      changed();commit();
    },
    deleteKeys(selected){api.pause();for(const {ref,frame} of selected){const track=trackFor(ref);if(track)track.keys=track.keys.filter(k=>k.frame!==frame);}action.tracks=action.tracks.filter(t=>t.keys.length);changed();commit();},
    clear(refs){for(const ref of Array.isArray(refs)?refs:[refs])action.tracks=action.tracks.filter(t=>address(t.id,t.path)!==ref);changed();commit();},
    editKeys(selected,{offset=0,duplicate=false,interpolation}={}){
      if(!Number.isFinite(offset)||(interpolation&&!modes.includes(interpolation)))throw Error('Invalid keyframe edit');
      if(selected.some(s=>Math.abs(s.frame+Math.round(offset))>1e6))throw Error('Keyframe out of range');
      api.pause();
      for(const track of action.tracks){const ref=address(track.id,track.path),frames=selected.filter(s=>s.ref===ref).map(s=>s.frame),moving=track.keys.filter(k=>frames.includes(k.frame)).map(k=>({...k,frame:k.frame+Math.round(offset),...(interpolation?{interpolation}:{})}));
        track.keys=track.keys.filter(k=>(duplicate||!frames.includes(k.frame))&&!moving.some(m=>m.frame===k.frame));track.keys.push(...moving);track.keys.sort((a,b)=>a.frame-b.frame);
      }
      changed();evaluate();commit();
    },
    // Legacy: routes start/end/fps/frame/loop/autoKey to scene time, name to the action.
    configure(patch){
      const {name,frame,...rest}=patch,mapped=Object.fromEntries(Object.entries(rest).map(([k,v])=>[legacy[k]||k,v]));
      if(name!==undefined){action=withAliases(validateAction({...action,name}),time);changed();commit();}
      if(Object.keys(mapped).length)time.configure(mapped);
      if(frame!==undefined)time.seek(frame);
    },
    seek(frame){time.seek(frame);},
    play(){time.play();},
    pause(){time.pause();},
    tick(now){time.tick(now);},
    captureEdits(){if(evaluating||time.playing)return;const refs=[];for(const [ref,ch] of channels)if(ch.available()){const value=clone(ch.get());if(time.state.autoKey&&ch.transform&&JSON.stringify(pose.get(ref))!==JSON.stringify(value))refs.push(ref);pose.set(ref,value);}if(refs.length){const fn=commit;commit=()=>{};api.insert(refs);commit=fn;}notify();},
    serialize(){return {version:2,action:clone({name:action.name,tracks:action.tracks}),time:time.serialize()};},
    load(data,{apply=true}={}){const parsed=parseAnimation(data);action=withAliases(parsed.action,time);compiled.clear();quiet=true;try{time.load(parsed.time);}finally{quiet=false;}if(apply)evaluate();else{for(const [ref,ch] of channels)if(ch.available())pose.set(ref,clone(ch.get()));notify();}},
    changed(){changed();},
    mute(ref){const track=trackFor(ref);if(track){track.muted=!track.muted;changed();evaluate();commit();}},
    toAnimationGroup(scene,name=action.name){
      const fps=time.state.fps;
      const group=new AnimationGroup(name,scene);
      for(const track of action.tracks){const channel=channels.get(address(track.id,track.path));if(!channel?.available()||!track.keys.length||track.muted)continue;
        const {animation,decode}=compileTrack(track,fps),target={};
        Object.defineProperty(target,'value',{get:()=>channel.get(),set:value=>channel.set(decode(value))});
        group.addTargetedAnimation(animation,target);
      }
      return group;
    },
    evaluate,
    dispose(){listeners.clear();channels.clear();compiled.clear();},
  };
  return api;
}
