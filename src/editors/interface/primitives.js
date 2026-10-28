import { format, parse, editText } from '../../blenkernel/unit.js';
import { h,defineComponent,computed } from 'vue';
import { NumberField } from './components/ui/number-field/index.js';
import { Color3 } from '@babylonjs/core';
import { icon,iconButton } from './icons.js';
export const Panel=defineComponent({props:['title','panelId','state','subpanel','actions','defaultClosed'],setup(props,{slots}){
  const closed=computed(()=>props.defaultClosed?!props.state.opened?.includes(props.panelId):props.state.closed?.includes(props.panelId));
  const toggle=event=>{if(props.defaultClosed&&!event?.ctrlKey){props.state.opened=closed.value?[...(props.state.opened||[]),props.panelId]:props.state.opened.filter(id=>id!==props.panelId);return;}if(event?.ctrlKey){props.state.closed=closed.value?props.state.panels.filter(id=>id!==props.panelId):props.state.panels.filter(id=>id.startsWith(props.panelId+'.'));}else props.state.closed=closed.value?props.state.closed.filter(id=>id!==props.panelId):[...(props.state.closed||[]),props.panelId];};
  return()=>h('section',{class:['bl-panel',{'bl-subpanel':props.subpanel}],tabindex:-1,onKeydown:event=>{if(event.key.toLowerCase()==='a'&&!event.target.closest('input,select')){event.preventDefault();event.stopPropagation();toggle(event);}}},[
    h('div',{class:'bl-panel-header',onClick:toggle,title:`${props.title} · Click to collapse; Ctrl-click to isolate`},[h('span',{class:'bl-disclosure'},closed.value?'▸':'▾'),h('span',props.title),h('span',{class:'bl-panel-actions',onClick:e=>e.stopPropagation()},props.actions?.()),icon('GRIP')]),
    !closed.value?h('div',{class:'bl-panel-content'},slots.default?.()):null
  ]);
}});
// A Bylonder property row (the rows of Bylonder's own panels and the redo panel): label, value and keyframe decorator.
// Numbers are Blender's number button (NumberField), with the field's step and unit.
const numberMeta=field=>({type:field.integer?'I':'F',min:field.min,max:field.max,soft_min:field.min,soft_max:field.max,
  step:field.integer?(field.step??1):((field.step??0.01)*100)/(field.unit==='angle'?Math.PI/180:1),unit:field.unit==='length'?'LENGTH':field.unit==='angle'?'ROTATION':undefined,description:field.description});
export const PropertyRow=defineComponent({props:['field','animation','commit'],setup(props){
  const value=()=>props.field.get();
  const display=v=>props.field.integer?String(Math.round(v)):format(v,props.field.unit);
  const set=(v,finish=true)=>{const field=props.field;if(field.disabled?.())return;if(typeof field.default==='number'){if(!Number.isFinite(v))return;v=Math.max(field.min??-1e9,Math.min(field.max??1e9,v));if(field.integer)v=Math.round(v);}props.animation?.pause();field.set(v,finish);if(finish)props.commit?.();};
  const refs=()=>props.field.refs?.()||[];
  const keyframe=()=>props.animation?.insert(refs());
  const deleteKey=()=>props.animation?.deleteKeys(refs().map(ref=>({ref,frame:Math.round(props.animation.time.frame)})));
  const context=e=>{e.preventDefault();const menu=document.createElement('dialog');menu.className='bl-context-menu';
    const entries=[['Reset to Default Value',()=>set(props.field.default)],['Copy Data Path',()=>navigator.clipboard?.writeText(refs().join('\n'))],...(refs().length?[['Insert Keyframe',keyframe],['Delete Keyframe',deleteKey],['Clear Keyframes',()=>props.animation.clear(refs())]]:[])];
    for(const [label,fn] of entries){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{fn();menu.close();};menu.append(b);}const close=document.createElement('button');close.textContent='Cancel';close.onclick=()=>menu.close();menu.append(close);menu.onclose=()=>menu.remove();document.body.append(menu);menu.showModal();};
  return()=>{
    const field=props.field,current=value(),list=refs(),status=list.length?props.animation.state(list[0]):'none',title=`${field.label}${field.description?'\n'+field.description:''}${list.length?'\n'+list.join('\n'):''}`;
    const number=typeof current==='number',disabled=field.disabled?.();
    let control;
    if(field.color)control=h('label',{class:'bl-color',title,style:{background:current?.toHexString?.()||'#000'}},[h('input',{type:'color',value:current?.toHexString?.()||'#000000',disabled,'aria-label':field.label,onInput:e=>set(Color3.FromHexString(e.target.value),false),onChange:e=>{field.set(Color3.FromHexString(e.target.value),true);props.commit?.();}})]);
    else if(field.reference)control=h('select',{value:current,title,disabled,onChange:e=>set(e.target.value)},[h('option',{value:''},''),...field.choices().map(([id,name])=>h('option',{value:id},name))]);
    else if(field.options)control=h('select',{value:current,disabled,title,onChange:e=>set(Object.values(field.options).find(v=>String(v)===e.target.value))},Object.entries(field.options).map(([label,v])=>h('option',{value:v},label)));
    else if(typeof current==='boolean')control=h('input',{type:'checkbox',checked:current,disabled,title,'aria-label':field.label,onChange:e=>set(e.target.checked)});
    else if(number)control=h(NumberField,{modelValue:current,meta:numberMeta(field),disabled:!!disabled,display,editText:v=>editText(v,field.unit),parse:t=>parse(t,field.unit),
      'onUpdate:modelValue':v=>set(v,false),onCommit:()=>{field.set(value(),true);props.commit?.();}});
    else control=h('input',{value:current,title,disabled,'aria-label':field.label,onChange:e=>set(e.target.value),onKeydown:e=>{e.stopPropagation();if(e.key==='Enter')e.target.blur();}});
    return h('div',{class:['bl-property',{'bl-checkbox-row':typeof current==='boolean'}],'data-animation':status,title,onContextmenu:context,onKeydown:e=>{if(e.target.matches('input,select'))return;if(e.key.toLowerCase()==='i'&&list.length){e.preventDefault();e.stopPropagation();e.altKey?deleteKey():keyframe();}}},[
      h('label',field.label),control,
      field.lock?iconButton(field.lock.get()?'LOCKED':'UNLOCKED',`${field.lock.get()?'Unlock':'Lock'} ${field.label}`,()=>{field.lock.set(!field.lock.get());props.commit?.();}):null,
      list.length?h('button',{class:'bl-decorator',title:`${status==='keyed'?'Delete':'Insert'} Keyframe · ${field.label}\n${title}`,'aria-label':`Keyframe ${field.label}`,onClick:()=>status==='keyed'?deleteKey():keyframe()},status==='none'?'•':status==='keyed'?'◆':'◇'):h('span',{class:'bl-decorator-space'})
    ]);
  };
}});
