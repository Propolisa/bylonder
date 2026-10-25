// Blender's tab order: scene-level tabs (Render, Output, View Layer, Scene, World, Collection), then object-level tabs.
export const propertyContexts=new Map([
  ['render',{id:'render',title:'Render',icon:'SCENE',color:'#b8b8b8',scene:true}],
  ['output',{id:'output',title:'Output',icon:'OUTPUT',color:'#b8b8b8',scene:true}],
  ['view_layer',{id:'view_layer',title:'View Layer',icon:'RENDERLAYERS',color:'#b8b8b8',scene:true}],
  ['scene',{id:'scene',title:'Scene',icon:'SCENE_DATA',color:'#b8b8b8',scene:true}],
  ['world',{id:'world',title:'World',icon:'WORLD',color:'#ea7581',scene:true}],
  ['collection',{id:'collection',title:'Collection',icon:'OUTLINER_COLLECTION',color:'#e6e6e6',scene:true}],
  ['object',{id:'object',title:'Object',icon:'OBJECT_DATA',color:'#e19650'}],
  ['modifiers',{id:'modifiers',title:'Modifiers',icon:'MODIFIER',color:'#77a4df'}],
  ['particles',{id:'particles',title:'Particles',icon:'PARTICLES',color:'#e6e6e6'}],
  ['material',{id:'material',title:'Material',icon:'MATERIAL',color:'#ea7581'}]
]);
export const propertyPanels=new Map();
export function registerPropertiesContext(definition){propertyContexts.set(definition.id,definition);}
export function registerPropertiesPanel(definition){if(!definition.id||!definition.context||!definition.render)throw Error('Panel needs id, context and render');propertyPanels.set(definition.id,definition);}
