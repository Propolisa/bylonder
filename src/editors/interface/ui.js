import { mountProperties } from '../space_buttons/editor.js';
export function createUI(world,editor,storage,history,systems,properties=[],files=[],rna){
  const context={world,editor,storage,history,systems,properties,files,rna},views=new Set();
  const create=(host,id)=>{const view=mountProperties(host,context,id,world.dock?.header(id));views.add(view);return {refresh:view.refresh,context:view.context,dispose(){view.dispose();views.delete(view);}};};
  const primary=create(document.querySelector('#pane'),'properties');
  return {create,context:primary.context,refresh(){
    world.outliner?.refresh();for(const view of views)view.refresh();
  },dispose(){for(const view of views)view.dispose();views.clear();}};
}
