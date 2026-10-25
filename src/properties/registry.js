export const propertyContexts=new Map([
  ['object',{id:'object',title:'Object',icon:'OBJECT_DATA',color:'#e19650'}],
  ['modifiers',{id:'modifiers',title:'Modifiers',icon:'MODIFIER',color:'#77a4df'}],
  ['scene',{id:'scene',title:'Scene',icon:'SCENE_DATA',color:'#b8b8b8'}]
]);
export const propertyPanels=new Map();
export function registerPropertiesContext(definition){propertyContexts.set(definition.id,definition);}
export function registerPropertiesPanel(definition){if(!definition.id||!definition.context||!definition.render)throw Error('Panel needs id, context and render');propertyPanels.set(definition.id,definition);}
