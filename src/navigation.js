import { Camera, Vector3 } from "@babylonjs/core";
export function createNavigation({ camera, engine }, canvas, capture) {
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
  const sync = () => {
    updateBounds();
    document.querySelector("#view-name").textContent =
      camera.mode === 0 ? "User perspective" : "User orthographic";
    document.querySelector("#projection").innerHTML =
      (camera.mode === 0 ? "Perspective" : "Orthographic") + " <kbd>5</kbd>";
  };
  const down = (e) => {
    if(document.body.classList.contains("scene-mode"))return;
    if (e.pointerType === "touch") return;
    if (e.button === 1 && !capture.active) {
      e.preventDefault();

      drag = true;
      capture.begin({ x: e.clientX, y: e.clientY }, move, up);
    }
  };
  const pan = (dx,dy) => {
    const scale=(2*camera.radius*Math.tan(camera.fov/2))/canvas.clientHeight;
    camera.target.addInPlace(camera.getDirection(Vector3.Right()).scale(-dx*scale)).addInPlace(camera.getDirection(Vector3.Up()).scale(dy*scale));
  };
  const orbit = (dx,dy) => {camera.alpha-=dx*0.006;camera.beta=Math.max(0.001,Math.min(Math.PI-0.001,camera.beta-dy*0.006));};
  const zoom = factor => {camera.radius=Math.max(0.4,Math.min(200,camera.radius*factor));sync();};
  const move = (dx,dy,event) => {if(drag)(event.shiftKey?pan:orbit)(dx,dy);};
  const up = () => {
    if (drag) {
      drag = null;
      capture.release();
    }
  };
  const wheel = (e) => {
    if(document.body.classList.contains("scene-mode"))return;
    e.preventDefault();
    if (capture.active) return;
    camera.radius = Math.max(
      0.4,
      Math.min(200, camera.radius * Math.exp(e.deltaY * 0.001)),
    );
    sync();
  };
  canvas.addEventListener("pointerdown", down, true);

  const mouseUp = (e) => {
    if (e.button === 1) up();
  };
  window.addEventListener("mouseup", mouseUp);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  return {
    sync,
    pan, orbit, zoom,
    updateBounds,
    opposite() { camera.alpha += Math.PI; camera.beta = Math.PI - camera.beta; sync(); },
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
      sync();
      document.querySelector("#view-name").textContent =
        (opposite ? "Opposite " : name + " ") + "orthographic";
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
      canvas.removeEventListener("pointerdown", down, true);

      window.removeEventListener("mouseup", mouseUp);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    },
  };
}
