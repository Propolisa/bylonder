import { encodeProject, decodeProject } from './share-codec.js';
export function setupSharing({capture,importProject}){
  const dialog=document.createElement('dialog');dialog.className='workbench-dialog';
  dialog.innerHTML='<h2>Share current project</h2><label><input data-overrides type="checkbox" checked>Include current scene edits and control values</label><p>The link contains a snapshot of the files and assets, not version history. Anyone with the link can open a separate copy.</p><textarea data-url readonly aria-label="Project share link"></textarea><p role="status"></p><div class="dialog-actions"><button data-close>Close</button><button data-copy disabled>Copy link</button><button data-share disabled>Share…</button></div>';
  document.body.append(dialog);
  const url=dialog.querySelector('[data-url]'),status=dialog.querySelector('[role=status]'),copy=dialog.querySelector('[data-copy]'),share=dialog.querySelector('[data-share]'),include=dialog.querySelector('[data-overrides]');
  let generation=0;
  const prepare=async()=>{const version=++generation;copy.disabled=share.disabled=true;url.value='';status.textContent='Capturing current scene…';try{const snapshot=await capture(include.checked);const hash=encodeProject(snapshot.project,{includeOverrides:include.checked,overrides:snapshot.overrides});if(version!==generation)return;url.value=location.origin+location.pathname+hash;copy.disabled=false;share.disabled=!navigator.share;status.textContent=`${(url.value.length/1024).toFixed(1)} KB link. Some apps limit long URLs; use Export ZIP if a link is truncated.`;}catch(error){if(version===generation)status.textContent=error.message;}};
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(url.value);status.textContent='Link copied.';}catch{url.focus();url.select();status.textContent='Select and copy the link above.';}};
  share.onclick=async()=>{try{await navigator.share({title:'Babylon project',url:url.value});}catch(error){if(error.name!=='AbortError')status.textContent='Sharing unavailable here. Copy the link instead.';}};
  include.onchange=prepare;dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  const incoming=async()=>{
    if(!location.hash.startsWith('#project='))return;
    let payload;try{payload=decodeProject(location.hash);}catch(error){alert(error.message);return;}
    const preview=document.createElement('dialog');preview.className='workbench-dialog';
    const heading=document.createElement('h2');heading.textContent=payload.name;
    const description=document.createElement('p');description.textContent=`Shared project · ${Object.keys(payload.files).length} files. Open as a new local project? Run its JavaScript only if you trust the sender.`;
    const actions=document.createElement('div');actions.className='dialog-actions';
    const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>preview.close();
    const open=document.createElement('button');open.textContent='Open local copy';open.onclick=async()=>{open.disabled=true;try{await importProject(payload);history.replaceState(null,'',location.pathname+location.search);preview.close();}catch(error){description.textContent=error.message;open.disabled=false;}};
    actions.append(cancel,open);preview.append(heading,description,actions);document.body.append(preview);preview.onclose=()=>preview.remove();preview.showModal();
  };
  window.addEventListener('hashchange',incoming);
  return {open(){include.checked=true;dialog.showModal();prepare();},incoming};
}
