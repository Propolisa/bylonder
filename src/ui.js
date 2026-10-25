import { mountProperties } from './properties/editor.js';
import { registerObjects } from './animation/bindings.js';
export function createUI(world,editor,storage,history,systems,properties=[]){
  const context={world,editor,storage,history,systems,properties},views=new Set();
  const create=(host,id)=>{const view=mountProperties(host,context,id,world.dock?.header(id));views.add(view);return {refresh:view.refresh,context:view.context,dispose(){view.dispose();views.delete(view);}};};
  const primary=create(document.querySelector('#pane'),'properties');
  return {create,context:primary.context,refresh(){
    document.querySelector('#group').disabled=editor.selection.size<2;
    document.querySelector('#ungroup').disabled=!editor.selection.roots.some(n=>n.metadata?.group);
    world.outliner?.refresh();for(const view of views)view.refresh();
  },dispose(){for(const view of views)view.dispose();views.clear();}};
}
