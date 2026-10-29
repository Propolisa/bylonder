import { reactive, createApp, h } from 'vue';
import { bindTouch } from './touch-session.js';
import { runOperator, invokeOperator } from '../wm-operators.js';
// Blender's transform for each touch tool, run modally by the window manager: the touch's moves reach it as the pointer's.
const TRANSFORMS={move:'transform.translate',rotate:'transform.rotate',scale:'transform.resize'};
// Touch gestures for every 3D Viewport (attach(view) per view) and the touch controls, mounted once.
export function createViewportTouch(world, editor, creator, views){
  // The mode's context menu, as right click opens it from Blender's keymaps.
  const contextMenu=()=>({MESH:'VIEW3D_MT_edit_mesh_context_menu',CURVE:'VIEW3D_MT_edit_curve_context_menu',FONT:'VIEW3D_MT_edit_font_context_menu'})[world.editMode.kind]??'VIEW3D_MT_object_context_menu';
  const state=reactive({multi:false,snap:false,fine:false,axis:null,mode:editor.mode,count:editor.selection.size,modal:false});
  // A key pressed for the running transform (its modal keymap's), where the pointer is.
  const press=type=>world.wm.dispatch({type,value:'PRESS',...editor.pointer,native:{}});
  world.onEditorState=value=>Object.assign(state,value);
  const attach=view=>{
  const nav=view.nav,picked=point=>editor.pick(point.x,point.y,view);
  let operation=null;
  return bindTouch(view.canvas,{
    tap(point,double){
      if(state.modal){press('ret');return;}
      const node=picked(point);
      if(double&&node){world.beforeSelection?.();editor.selection.replace([node]);editor.reconcile();nav.frame(editor.selected);}
      else editor.select(node,state.multi);
    },
    hold(point){views.setInput(view);world.callMenu(contextMenu(),point);},
    start(point){
      views.setInput(view);
      creator.finish();
      if(point.count>1){if(state.modal)press('ret');operation='camera';return;}
      const idname=TRANSFORMS[editor.mode];
      if(idname&&editor.selection.size){
        operation='transform';
        invokeOperator(idname,{},{type:'mousemove',value:'NOTHING',x:point.x,y:point.y,view,native:{}});
        state.modal=!!world.wm.modal;
        for(const [on,key] of [[state.axis,state.axis],[state.snap,'left_ctrl'],[state.fine,'left_shift']])if(on)press(key);
      }else operation='orbit';
    },
    move(sample){
      if(operation==='transform')return;
      if(sample.count>1){nav.pan(sample.dx,sample.dy);nav.zoom(1/Math.max(0.1,sample.scale));}
      else nav.orbit(sample.dx,sample.dy);
    },
    end(cancel){if(operation==='transform'&&state.modal)press(cancel?'esc':'ret');state.modal=false;operation=null;}
  },{enabled:()=>!view.state.cameraView});
  };
  world.multiSelect=()=>state.multi;
  const host=document.createElement('div');host.id='touch-controls';document.querySelector('#viewport-section').append(host);
  const button=(text,fn,active=false,title=text)=>h('button',{onClick:fn,class:{active},title,'aria-pressed':active},text);
  const setTool=value=>{creator.finish();editor.setMode(value);};
  const app=createApp({setup:()=>()=>[
    state.count>0 && state.mode!=='select' ? h('div',{class:'touch-row touch-transform-options'},[
      ...['x','y','z'].map(axis=>button(axis.toUpperCase(),()=>{state.axis=state.axis===axis?null:axis;if(state.modal)press(axis);},state.axis===axis)),
      button('Snap',()=>state.snap=!state.snap,state.snap),button('Fine',()=>state.fine=!state.fine,state.fine),
      ...(state.modal?[button('×',()=>{press('esc');state.modal=false;},false,'Cancel transform')]:[])
    ]):null,
    h('div',{class:'touch-row touch-primary'},[
      h('select',{'aria-label':'Interaction tool',value:state.mode,onChange:event=>setTool(event.target.value)},[
        ...[['select','Select / orbit'],['move','Move'],['rotate','Rotate'],['scale','Scale']].map(([value,label])=>h('option',{value,disabled:value!=='select'&&!state.count},label))
      ]),
      button('Multi',()=>state.multi=!state.multi,state.multi,'Toggle additive selection'),
      button('Actions',()=>world.callMenu(contextMenu(),{x:60,y:70})),
      button('↶',()=>runOperator('ed.undo'),false,'Undo'),button('↷',()=>runOperator('ed.redo'),false,'Redo')
    ])
  ]});app.mount(host);
  return {attach,dispose(){world.onEditorState=null;app.unmount();host.remove();}};
}
