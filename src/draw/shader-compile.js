// A 3D Viewport drawing materials while their shaders compile, as EEVEE's does (eevee_material.cc,
// eevee_instance.cc): a surface whose shader is not compiled yet draws with Blender's default surface (a Principled
// BSDF), and the view tells how many shaders are left ("Compiling shaders (N remaining)"). Babylon compiles shaders
// without blocking (KHR_parallel_shader_compile) and skips a mesh whose effect is not ready; here its material compiles
// in a render pass of its own, with the view's defines, while the view's pass draws the default surface instead.
import { nodeMaterialFromTree } from '../nodes/blender/shader-nodes.js';

const DEFAULT_SURFACE = {
  nodes: [{ idname: 'ShaderNodeBsdfPrincipled', name: 'Principled BSDF' }, { idname: 'ShaderNodeOutputMaterial', name: 'Material Output' }],
  links: [['Principled BSDF', 'BSDF', 'Material Output', 'Surface']],
};

const instanced = (mesh) => !!(mesh.hasThinInstances || mesh.instances?.length);

// compiled(): a mesh a view drew with the default surface has its own shaders now, so what the view's film added up
// starts again (as EEVEE restarts its samples when a shader finishes).
export function createShaderCompile(scene, { compiled = () => {} } = {}) {
  const engine = scene.getEngine(), probe = engine.createRenderPassId('__shaderCompile');
  let fallback = null, queued = 0;
  const lastSwapped = new Map(); // render pass -> the meshes it drew with the default surface
  const defaultSurface = () => (fallback ??= nodeMaterialFromTree('__defaultSurface', scene, DEFAULT_SURFACE).material);
  // Whether the mesh's own materials are ready in render pass `pass`, each checked (and compiling) there.
  const readyIn = (pass, mesh, pending) => {
    const current = engine.currentRenderPassId;
    engine.currentRenderPassId = pass;
    try {
      let ready = true;
      for (const subMesh of mesh.subMeshes) {
        const material = subMesh.getMaterial(false);
        // Ready with its defines left dirty: Babylon hot-swaps, drawing the previous shader while the new one compiles.
        if (!material || (material.isReadyForSubMesh(mesh, subMesh, instanced(mesh)) && !subMesh.materialDefines?.isDirty)) continue;
        ready = false;
        pending?.add(material);
      }
      return ready;
    } finally { engine.currentRenderPassId = current; }
  };
  // Swapping a mesh's material for a pass drops the pass's defines of its own material, which Babylon's shadow depth
  // wrappers read (ShadowDepthWrapper takes them from the pass that created the effect): taken again at once.
  const swap = (mesh, pass, material) => {
    mesh.setMaterialForRenderPass(pass, material);
    readyIn(pass, mesh);
  };
  return {
    // Shaders left to compile for the views (a count of materials).
    get queued() { return queued; },
    // Right before a view draws materials through `camera`: meshes whose shaders are still compiling draw the default
    // surface in its pass. Returns what puts their materials back once the view has rendered.
    use(camera) {
      const pass = camera.renderPassId, swapped = [], pending = new Set();
      for (const mesh of scene.meshes) {
        if (!mesh.subMeshes?.length || !mesh.isEnabled() || !mesh.isVisible || mesh.getMaterialForRenderPass(pass)) continue;
        if (!mesh.material || mesh.metadata?.overlay || mesh.name.startsWith('__')) continue;
        // Compiled in the probe pass, which shares the view's state and Babylon's effect cache.
        if (readyIn(probe, mesh, pending)) continue;
        swap(mesh, pass, defaultSurface());
        swapped.push(mesh);
      }
      if ([...(lastSwapped.get(pass) ?? [])].some((mesh) => !swapped.includes(mesh))) compiled();
      lastSwapped.set(pass, swapped);
      queued = pending.size;
      return () => { for (const mesh of swapped) swap(mesh, pass, undefined); };
    },
    dispose() { fallback?.dispose(); lastSwapped.clear(); engine.releaseRenderPassId(probe); },
  };
}
