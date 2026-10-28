export function createTouchSession(handlers,{threshold=7,holdDelay=450}={}){
  const points=new Map();let start=null,previous=null,timer=null,dragging=false,held=false,multiple=false,lastTap=null;
  const sample=()=>{const values=[...points.values()];return {x:values.reduce((s,p)=>s+p.x,0)/values.length,y:values.reduce((s,p)=>s+p.y,0)/values.length,distance:values.length>1?Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y):0,count:values.length};};
  const clear=()=>{clearTimeout(timer);timer=null;};
  const end=cancel=>{clear();if(dragging)handlers.end?.(cancel);points.clear();start=previous=null;dragging=held=multiple=false;};
  return {
    down(id,point){
      points.set(id,point);clear();
      if(points.size>1){multiple=true;held=false;if(dragging)handlers.end?.(false);dragging=false;}
      start=previous=sample();
      if(points.size===1){held=false;timer=setTimeout(()=>{if(!dragging&&points.size===1){held=true;handlers.hold?.(start);}},holdDelay);}
    },
    move(id,point){
      if(!points.has(id))return;points.set(id,point);
      const next=sample();
      if(!dragging){
        if(Math.hypot(next.x-start.x,next.y-start.y)<threshold&&Math.abs(next.distance-start.distance)<threshold)return;
        clear();if(held)return;dragging=true;handlers.start?.(start);
      }
      handlers.move?.({dx:next.x-previous.x,dy:next.y-previous.y,scale:previous.distance>0?next.distance/previous.distance:1,...next});previous=next;
    },
    up(id,point,cancel=false){
      if(!points.has(id))return;
      const wasDragging=dragging,wasHeld=held;
      if(cancel){end(true);return;}
      clear();points.delete(id);
      if(wasDragging)handlers.end?.(false);
      dragging=false;
      if(points.size){start=previous=sample();held=true;return;}
      if(!wasDragging&&!wasHeld&&!multiple){const now=performance.now();const double=lastTap&&now-lastTap.time<320&&Math.hypot(point.x-lastTap.x,point.y-lastTap.y)<24;handlers.tap?.(point,!!double);lastTap=double?null:{...point,time:now};}
      start=previous=null;held=multiple=false;
    },
    cancel(){end(true);},
    get active(){return points.size>0;}
  };
}
export function bindTouch(element, handlers, options={}){
  const session=createTouchSession(handlers,options),point=e=>({x:e.clientX,y:e.clientY,target:e.target});
  const accept=e=>e.pointerType==='touch'&&options.enabled?.()!==false;
  const down=e=>{if(!accept(e))return;e.preventDefault();e.stopImmediatePropagation();element.setPointerCapture(e.pointerId);session.down(e.pointerId,point(e));};
  const move=e=>{if(!accept(e)||!session.active)return;e.preventDefault();e.stopImmediatePropagation();session.move(e.pointerId,point(e));};
  const up=e=>{if(e.pointerType!=='touch'||!session.active)return;e.preventDefault();e.stopImmediatePropagation();session.up(e.pointerId,point(e),e.type==='pointercancel');};
  const cancel=()=>session.cancel();
  element.addEventListener('pointerdown',down,true);element.addEventListener('pointermove',move,true);element.addEventListener('pointerup',up,true);element.addEventListener('pointercancel',up,true);element.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);
  return ()=>{session.cancel();element.removeEventListener('pointerdown',down,true);element.removeEventListener('pointermove',move,true);element.removeEventListener('pointerup',up,true);element.removeEventListener('pointercancel',up,true);element.removeEventListener('lostpointercapture',cancel);window.removeEventListener('blur',cancel);};
}
