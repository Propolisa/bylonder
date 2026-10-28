import { reactive, createApp, h, Teleport } from 'vue';
import { bindTouch } from './touch-session.js';
import { runOperator } from '../wm-operators.js';
// Touch gestures for every 3D Viewport (attach(view) per view) and the touch controls, mounted once.
export function createViewportTouch(world, editor, creator, views){
  // The mode's context menu, as right click opens it from Blender's keymaps.
  const contextMenu=()=>({MESH:'VIEW3D_MT_edit_mesh_context_menu',CURVE:'VIEW3D_MT_edit_curve_context_menu',FONT:'VIEW3D_MT_edit_font_context_menu'})[world.editMode.kind]??'VIEW3D_MT_object_context_menu';
  const state=reactive({multi:false,snap:false,fine:false,axis:null,mode:editor.mode,count:editor.selection.size,modal:!!editor.modal});
  world.onEditorState=value=>Object.assign(state,value);
  const attach=view=>{
  const nav=view.nav,picked=point=>editor.pick(point.x,point.y,view);
  let operation=null;
  return bindTouch(view.canvas,{
    tap(point,double){
      if(editor.modal){editor.finish(true);return;}
      const node=picked(point);
      if(double&&node){world.beforeSelection?.();editor.selection.replace([node]);editor.reconcile();nav.frame(editor.selected);}
      else editor.select(node,state.multi);
    },
    hold(point){views.setInput(view);world.callMenu(contextMenu(),point);},
    start(point){
      views.setInput(view);
      creator.finish();
      if(point.count>1){editor.finish(true);operation='camera';return;}
      const type=editor.modal?.type||editor.mode;
      if(type!=='select'&&editor.selection.size){
        operation='transform';editor.start(type,{point,external:true,view});
        if(state.axis)editor.axis(state.axis);
      }else operation='orbit';
    },
    move(sample){
      if(operation==='transform')editor.updateGesture(sample.dx,sample.dy,{ctrlKey:state.snap,shiftKey:state.fine});
      else if(sample.count>1){nav.pan(sample.dx,sample.dy);nav.zoom(1/Math.max(0.1,sample.scale));}
      else nav.orbit(sample.dx,sample.dy);
    },
    end(cancel){if(operation==='transform')editor.finish(!cancel);operation=null;}
  },{enabled:()=>!view.state.cameraView});
  };
  world.multiSelect=()=>state.multi;
  const host=document.createElement('div');host.id='touch-controls';document.querySelector('#viewport-section').append(host);
  const button=(text,fn,active=false,title=text)=>h('button',{onClick:fn,class:{active},title,'aria-pressed':active},text);
  const graphControls=document.createElement('span');graphControls.className='graph-touch-controls';document.querySelector('.tree-tools').append(graphControls);
  const setTool=value=>{creator.finish();editor.finish(false);editor.setMode(value);};
  const app=createApp({setup:()=>()=>[
    h(Teleport,{to:graphControls},[button('Multi',()=>state.multi=!state.multi,state.multi,'Toggle additive selection')]),
    state.count>0 && state.mode!=='select' ? h('div',{class:'touch-row touch-transform-options'},[
      ...['x','y','z'].map(axis=>button(axis.toUpperCase(),()=>{state.axis=state.axis===axis?null:axis;if(editor.modal)editor.axis(axis);},state.axis===axis)),
      button('Snap',()=>state.snap=!state.snap,state.snap),button('Fine',()=>state.fine=!state.fine,state.fine),
      ...(state.modal?[button('×',()=>editor.finish(false),false,'Cancel transform')]:[])
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
  return {attach,dispose(){world.onEditorState=null;app.unmount();host.remove();graphControls.remove();}};
}
