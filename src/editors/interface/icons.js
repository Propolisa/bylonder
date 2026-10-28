import { h } from 'vue';
import { iconStyle } from './icon.js';
const names={OBJECT_DATA:'object_data',MODIFIER:'modifier',MOD_ARRAY:'mod_array',SCENE_DATA:'scene_data',PINNED:'pinned',UNPINNED:'unpinned',LOCKED:'locked',UNLOCKED:'unlocked',RESTRICT_VIEW_OFF:'restrict_view_off',RESTRICT_VIEW_ON:'restrict_view_on',GRIP:'grip',PROPERTIES:'properties',OUTLINER:'outliner',VIEW3D:'view3d',ADD:'add',REMOVE:'remove'};
export const icon=(name,attrs={})=>h('span',{class:'bl-icon',style:iconStyle(names[name]||name),'aria-hidden':true,...attrs});
export const iconButton=(name,title,onClick,attrs={})=>h('button',{type:'button',class:'bl-icon-button',title,'aria-label':title,onClick,...attrs},icon(name));
