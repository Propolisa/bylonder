import { Mesh } from '@babylonjs/core';
import { Pane } from 'tweakpane';
import { snapshot, apply } from '../undo/storage.js';
import { fontFamilies } from '../../blenkernel/text/fonts.js';
import { textDefaults, textSchema, prepareText, applyText } from '../../blenkernel/text/text.js';
export function createTextEditor(world, editor, history, commands) {
  const dialog = document.createElement('dialog');
  dialog.className = 'text-editor';
  dialog.innerHTML = `<header>Text <button data-close aria-label="Cancel text editing">×</button></header><label>Content<textarea data-text rows="3" maxlength="2000"></textarea></label><label>Google font<input data-family list="google-font-families" autocomplete="off"><datalist id="google-font-families"></datalist></label><div data-preview aria-label="Font preview"></div><div data-controls></div><p data-status role="status"></p><footer><button data-cancel>Cancel</button><button data-apply>Apply</button></footer>`;
  document.body.append(dialog);
  const field = name => dialog.querySelector(`[data-${name}]`);
  let session, pane, generation=0, timer, ready=false;
  let familiesPromise;
  const populate = () => familiesPromise ||= fontFamilies().then(families => {
    dialog.querySelector('datalist').replaceChildren(...families.map(family=>{const option=document.createElement('option');option.value=family;return option;}));
  }).catch(()=>{field('family').title='Catalogue unavailable. Enter any Google Fonts family name directly.';});
  const finish = (commit=true) => {
    if (!session || (commit&&!ready)) return;
    ++generation;
    clearTimeout(timer);
    if (commit) history.commit(); else apply(world.objects,session.before);
    session=null;
    pane?.dispose();
    dialog.close();
    editor.reconcile();
    world.focusViewport?.();
  };
  const update = () => {
    clearTimeout(timer);
    const version=++generation;
    ready=false;
    field('apply').disabled=true;
    field('status').textContent='Updating…';
    timer=setTimeout(async()=>{
      try {
        const prepared=await prepareText({...session.values},world.scene);
        if(version!==generation||!session)return;
        if(!session.node){
          session.node=new Mesh(commands.unique('Text'),world.scene);
          session.node.metadata={editable:true,wbId:crypto.randomUUID()};
          world.objects.push(session.node);
        }
        applyText(session.node,prepared);
        editor.selection.replace([session.node]);
        editor.reconcile();
        field('preview').textContent=prepared.values.text;
        field('preview').style.fontFamily=`"${prepared.previewFamily}"`;
        field('status').textContent='';
        ready=true;
        field('apply').disabled=false;
      } catch(error){if(version===generation)field('status').textContent=error.message;}
    },250);
  };
  field('text').oninput=()=>{session.values.text=field('text').value;update();};
  field('family').oninput=()=>{session.values.family=field('family').value.trim();update();};
  field('apply').onclick=()=>finish();
  field('cancel').onclick=field('close').onclick=()=>finish(false);
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();finish();}});
  return {
    get pending(){return session;},
    get open(){return dialog.open;},
    show(node){
      if(session)finish(false);
      editor.finish(false);
      session={node,before:snapshot(world.objects),values:{...textDefaults,...node?.metadata?.wbCreation?.text}};
      field('text').value=session.values.text;
      field('family').value=session.values.family;
      field('preview').textContent='';
      field('controls').replaceChildren();
      pane=new Pane({container:field('controls')});
      for(const [key,schema] of Object.entries(textSchema)){
        if(['text','family'].includes(key))continue;
        const {default:_,...settings}=schema;
        pane.addBinding(session.values,key,settings).on('change',update);
      }
      dialog.showModal();
      field('text').focus();
      populate();
      update();
    },
    finish,
    dispose(){finish(false);dialog.remove();},
  };
}
