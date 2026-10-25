export function decorateProperty(binding, animation, references, {label,commit=()=>{}}={}) {
  const element=binding.element;
  element.classList.add('animated-property');
  const button=document.createElement('button');button.className='keyframe-button';button.type='button';
  element.append(button);
  const refs=()=>typeof references==='function'?references():references;
  const refresh=()=>{
    const list=refs(),states=list.map(ref=>animation.state(ref));
    const state=states.includes('changed')?'changed':states.includes('keyed')?'keyed':states.includes('animated')?'animated':'none';
    element.dataset.animation=state;button.textContent=state==='keyed'?'◆':'◇';button.disabled=!list.length||states.every(s=>s==='unavailable');
    const detail=list.map(ref=>{const ch=animation.channels.get(ref);return ch?`${ch.label}: ${JSON.stringify(ch.get())}\n${ch.id} → ${ch.path}`:ref;}).join('\n');
    element.title=`${label||''}\n${detail}\n${state} at frame ${Math.round(animation.time.frame)}. I: insert; Alt-I: delete key. Right-click for animation options.`;
    button.title=`${state==='keyed'?'Delete':'Insert'} keyframe · ${label||''}\n${detail}`;button.setAttribute('aria-label',button.title);
  };
  const remove=()=>animation.deleteKeys(refs().map(ref=>({ref,frame:Math.round(animation.time.frame)})));
  button.onclick=e=>{e.stopPropagation();animation.state(refs()[0])==='keyed'?remove():animation.insert(refs());};
  let hover=false;
  const key=e=>{if(e.target.closest('input,textarea,select,[contenteditable=true]')||!hover||e.key.toLowerCase()!=='i'||e.ctrlKey||e.metaKey)return;e.preventDefault();e.stopImmediatePropagation();e.altKey?remove():animation.insert(refs());};
  element.addEventListener('pointerenter',()=>hover=true);element.addEventListener('pointerleave',()=>hover=false);
  window.addEventListener('keydown',key,true);
  const menu=document.createElement('dialog');menu.className='animation-menu';document.body.append(menu);
  for(const [title,fn] of [['Insert keyframe',()=>animation.insert(refs())],['Delete keyframe',remove],['Clear animation',()=>animation.clear(refs())],['Copy data path',()=>navigator.clipboard?.writeText(refs().join('\n'))]]){
    const item=document.createElement('button');item.textContent=title;item.onclick=()=>{fn();menu.close();};menu.append(item);
  }
  const close=document.createElement('button');close.textContent='Close';close.onclick=()=>menu.close();menu.append(close);
  element.addEventListener('contextmenu',e=>{e.preventDefault();menu.showModal();});
  const unsubscribe=animation.subscribe(refresh);refresh();
  return {refresh,dispose(){unsubscribe();window.removeEventListener('keydown',key,true);menu.remove();}};
}
