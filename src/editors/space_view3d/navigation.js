import { Camera, Vector3 } from "@babylonjs/core";
// Editor-camera navigation for one 3D Viewport: orbit, pan and wheel zoom (view3d.rotate, view3d.move and
// view3d.zoom, bound by the window manager's 3D View keymap) and the numpad views.
// enabled(): false while the view looks through the scene camera. onSync(): the view's label needs updating.
export function createNavigation({ camera, engine, canvas, capture, enabled = () => true, onSync = () => {} }) {
  camera.attachControl(canvas, true);
  camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.inputs.removeByType("ArcRotateCameraPointersInput");
  let drag = null;
  const updateBounds = () => {
    if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
      const h = camera.radius * Math.tan(camera.fov / 2),
        a = engine.getAspectRatio(camera);
      camera.orthoTop = h;
      camera.orthoBottom = -h;
      camera.orthoLeft = -h * a;
      camera.orthoRight = h * a;
    }
  };
  let viewName = "User";
  const sync = () => {
    updateBounds();
    onSync();
  };
  // Drags with the mouse until the button that started it is released; Shift pans.
  const begin = (event, panning) => {
    if (!enabled() || capture.active) return;
    drag = { pan: panning };
    capture.begin({ x: event.x, y: event.y }, move, up, canvas);
  };
  const pan = (dx,dy) => {
    const scale=(2*camera.radius*Math.tan(camera.fov/2))/canvas.clientHeight;
    camera.target.addInPlace(camera.getDirection(Vector3.Right()).scale(-dx*scale)).addInPlace(camera.getDirection(Vector3.Up()).scale(dy*scale));
  };
  const orbit = (dx,dy) => {if(viewName!=="User"){viewName="User";sync();}camera.alpha-=dx*0.006;camera.beta=Math.max(0.001,Math.min(Math.PI-0.001,camera.beta-dy*0.006));};
  const zoom = factor => {camera.radius=Math.max(0.4,Math.min(200,camera.radius*factor));sync();};
  const move = (dx,dy) => {if(drag)(drag.pan?pan:orbit)(dx,dy);};
  const up = () => {
    if (drag) {
      drag = null;
      capture.release();
    }
  };
  const mouseUp = (e) => {
    if (e.button === 1) up();
  };
  window.addEventListener("pointerup", mouseUp);
  return {
    sync,
    pan, orbit, zoom,
    rotate: (event) => begin(event, false),
    move: (event) => begin(event, true),
    // view3d.zoom by one wheel step: `delta` 1 zooms in.
    wheelZoom(delta) { if (enabled()) zoom(Math.exp(-delta * 0.1)); },
    updateBounds,
    get viewName() { return viewName; },
    opposite() { camera.alpha += Math.PI; camera.beta = Math.PI - camera.beta; viewName = "User"; sync(); },
    toggle() {
      camera.mode = camera.mode === 0 ? 1 : 0;
      sync();
    },
    view(name, opposite = false) {
      camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
      if (name === "front") {
        camera.alpha = opposite ? Math.PI / 2 : -Math.PI / 2;
        camera.beta = Math.PI / 2;
      }
      if (name === "right") {
        camera.alpha = opposite ? Math.PI : 0;
        camera.beta = Math.PI / 2;
      }
      if (name === "top") {
        camera.alpha = -Math.PI / 2;
        camera.beta = opposite ? Math.PI - 0.001 : 0.001;
      }
      viewName = { front: ["Front", "Back"], right: ["Right", "Left"], top: ["Top", "Bottom"] }[name][opposite ? 1 : 0];
      sync();
    },
    frame(mesh) {
      if (!mesh) return;
      camera.target.copyFrom(mesh.getAbsolutePosition());
      camera.radius = Math.max(
        2,
        (mesh.getBoundingInfo?.().boundingSphere.radiusWorld || 1.5) * 3.8,
      );
      sync();
    },
    dispose() {
      up();
      camera.detachControl();
      window.removeEventListener("pointerup", mouseUp);
    },
  };
}
