const key='workbench:render-resolution:v1';
export function renderSettings(){
  try{const value=JSON.parse(localStorage.getItem(key));if(value?.mode==='custom'&&Number.isFinite(value.ratio)&&value.ratio>=0.25&&value.ratio<=4)return value;}catch{}
  return {mode:'native'};
}
export function applyRenderSettings(engine, settings=renderSettings()){
  engine.setHardwareScalingLevel(settings.mode==='custom'?settings.ratio:1/(devicePixelRatio||1));
  engine.resize();
}
export function setupRenderSettings(onChange){
  const dialog=document.createElement('dialog');dialog.className='workbench-dialog';
  dialog.innerHTML='<h2>Render resolution</h2><label><input data-native type="checkbox">Native screen resolution</label><label>Hardware scaling ratio <input data-ratio type="number" min="0.25" max="4" step="0.05"></label><p>1 = one render pixel per CSS pixel. 0.5 = twice the resolution; 2 = half. Lower ratios look sharper and use more GPU power.</p><p data-resolution></p><div class="dialog-actions"><button data-close>Close</button></div>';
  document.body.append(dialog);
  const native=dialog.querySelector('[data-native]'),ratio=dialog.querySelector('[data-ratio]');
  const refresh=()=>{const value=renderSettings();native.checked=value.mode==='native';ratio.disabled=native.checked;ratio.value=native.checked?(1/(devicePixelRatio||1)).toFixed(3):value.ratio;dialog.querySelector('[data-resolution]').textContent=`Screen pixel ratio: ${(devicePixelRatio||1).toFixed(2)}. Saved for all projects on this device.`;};
  const change=()=>{if(!native.checked&&!ratio.checkValidity())return;const value=native.checked?{mode:'native'}:{mode:'custom',ratio:Number(ratio.value)};try{localStorage.setItem(key,JSON.stringify(value));}catch{}onChange(value);refresh();};
  native.onchange=()=>{if(!native.checked)ratio.value='1';change();};ratio.oninput=change;
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  return ()=>{refresh();dialog.showModal();};
}
