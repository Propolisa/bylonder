import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';

export const address = (id, path) => JSON.stringify([id, path]);
const scalar = value => ['number','boolean','string'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const clone = value => structuredClone(value);
const modes = ['BEZIER','LINEAR','CONSTANT'];
export function validateAction(input) {
  if (!input) return {version:1,name:'Action',start:1,end:250,fps:24,frame:1,loop:true,autoKey:false,tracks:[]};
  if (input.version !== 1 || !Array.isArray(input.tracks) || input.tracks.length > 10000) throw Error('Invalid animation action');
  const result = clone(input);
  if(typeof result.name!=="string"||result.name.length>200||typeof result.loop!=="boolean"||typeof result.autoKey!=="boolean")throw Error("Invalid action settings");
  for (const key of ['start','end','frame','fps']) if (!Number.isFinite(result[key])) throw Error('Invalid animation range');
  if (result.start >= result.end || result.fps < 1 || result.fps > 240 || Math.abs(result.start)>1e6 || Math.abs(result.end)>1e6) throw Error('Invalid animation range');
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
export function createAnimationModel(onChange=()=>{}) {
  const channels=new Map(),listeners=new Set(),compiled=new Map(),pose=new Map();
  let action=validateAction(),playing=false,evaluating=false,previousTime=null,commit=()=>{},revision=0;
  const notify=()=>{revision++;listeners.forEach(fn=>fn());};
  const trackFor=ref=>action.tracks.find(t=>address(t.id,t.path)===ref);
  const curve=track=>{const ref=address(track.id,track.path);if(!compiled.has(ref))compiled.set(ref,compileTrack(track,action.fps));return compiled.get(ref);};
  const changed=()=>{compiled.clear();onChange(api.serialize());notify();};
  const evaluate=()=>{
    evaluating=true;
    try{for(const track of action.tracks){const ref=address(track.id,track.path),channel=channels.get(ref);if(channel?.available()&&track.keys.length&&!track.muted){const c=curve(track);const value=c.decode(c.animation.evaluate(action.frame));if(typeof value===typeof channel.get())channel.set(value);pose.set(ref,channel.get());}}
    }finally{evaluating=false;}
    notify();
  };
  const api={
    channels,
    ref:address,
    get action(){return action;},get playing(){return playing;},get evaluating(){return evaluating;},get revision(){return revision;},
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
    state(ref){const channel=channels.get(ref),track=trackFor(ref);if(!channel?.available())return 'unavailable';if(!track?.keys.length)return 'none';const c=curve(track),value=c.decode(c.animation.evaluate(action.frame));if(JSON.stringify(channel.get())!==JSON.stringify(value))return 'changed';return track.keys.some(k=>k.frame===action.frame)?'keyed':'animated';},
    insert(refs,frame=Math.round(action.frame),value){
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
    configure(patch){action=validateAction({...action,...patch});changed();commit();},
    seek(frame){if(!Number.isFinite(frame))return;api.pause();action.frame=Math.round(Math.max(-1e6,Math.min(1e6,frame)));evaluate();},
    play(){playing=!playing;previousTime=null;notify();},
    pause(){if(playing){playing=false;previousTime=null;notify();}},
    tick(time){if(!playing)return;if(previousTime===null){previousTime=time;return;}action.frame+=(time-previousTime)/1000*action.fps;previousTime=time;
      if(action.frame>action.end){if(action.loop)action.frame=action.start+(action.frame-action.start)%(action.end-action.start);else{action.frame=action.end;api.pause();}}evaluate();},
    captureEdits(){if(evaluating||playing)return;const refs=[];for(const [ref,ch] of channels)if(ch.available()){const value=clone(ch.get());if(action.autoKey&&ch.transform&&JSON.stringify(pose.get(ref))!==JSON.stringify(value))refs.push(ref);pose.set(ref,value);}if(refs.length){const fn=commit;commit=()=>{};api.insert(refs);commit=fn;}notify();},
    serialize(){return clone({...action,frame:Math.round(action.frame)});},
    load(data,{apply=true}={}){api.pause();action=validateAction(data);compiled.clear();if(apply)evaluate();else{for(const [ref,ch] of channels)if(ch.available())pose.set(ref,clone(ch.get()));notify();}},
    changed(){changed();},
    mute(ref){const track=trackFor(ref);if(track){track.muted=!track.muted;changed();evaluate();commit();}},
    toAnimationGroup(scene,name=action.name){
      const group=new AnimationGroup(name,scene);
      for(const track of action.tracks){const channel=channels.get(address(track.id,track.path));if(!channel?.available()||!track.keys.length||track.muted)continue;
        const {animation,decode}=compileTrack(track,action.fps),target={};
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
