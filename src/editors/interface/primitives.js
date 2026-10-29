import { format, parse, editText } from '../../blenkernel/unit.js';
import { h,defineComponent } from 'vue';
import { NumberField } from './components/ui/number-field/index.js';
import { Color3 } from '@babylonjs/core';
import { iconButton } from './icons.js';
import { channelButton, hoverButton, leaveButton } from '../animation/keyframing-button.js';
// A Bylonder property row (the rows of Bylonder's own panels): label, value and keyframe decorator.
// Numbers are Blender's number button (NumberField), with the field's step and unit.
const numberMeta=field=>({type:field.integer?'I':'F',min:field.min,max:field.max,soft_min:field.min,soft_max:field.max,
  step:field.integer?(field.step??1):((field.step??0.01)*100)/(field.unit==='angle'?Math.PI/180:1),unit:field.unit==='length'?'LENGTH':field.unit==='angle'?'ROTATION':undefined,description:field.description});
export const PropertyRow=defineComponent({props:['field','animation','commit'],setup(props){
  const value=()=>props.field.get();
  const display=v=>props.field.integer?String(Math.round(v)):format(v,props.field.unit);
  const set=(v,finish=true)=>{const field=props.field;if(field.disabled?.())return;if(typeof field.default==='number'){if(!Number.isFinite(v))return;v=Math.max(field.min??-1e9,Math.min(field.max??1e9,v));if(field.integer)v=Math.round(v);}props.animation?.pause();field.set(v,finish);if(finish)props.commit?.();};
  const refs=()=>props.field.refs?.()||[];
  // The row as a button: I and its context menu key it as Blender's button operators do (keyframing-button.js).
  const button=channelButton(props.animation,refs,()=>set(props.field.default));
  const context=e=>{e.preventDefault();button.menu(e);};
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
    return h('div',{class:['bl-property',{'bl-checkbox-row':typeof current==='boolean'}],'data-animation':status,title,onContextmenu:context,onPointerenter:()=>hoverButton(button),onPointerleave:()=>leaveButton(button)},[
      h('label',field.label),control,
      field.lock?iconButton(field.lock.get()?'LOCKED':'UNLOCKED',`${field.lock.get()?'Unlock':'Lock'} ${field.label}`,()=>{field.lock.set(!field.lock.get());props.commit?.();}):null,
      list.length?h('button',{class:'bl-decorator',title:`${status==='keyed'?'Delete':'Insert'} Keyframe · ${field.label}\n${title}`,'aria-label':`Keyframe ${field.label}`,onClick:()=>button.run(status==='keyed'?'anim.keyframe_delete_button':'anim.keyframe_insert_button')},status==='none'?'•':status==='keyed'?'◆':'◇'):h('span',{class:'bl-decorator-space'})
    ]);
  };
}});
