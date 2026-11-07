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

export function createShaderCompile(scene) {
  const engine = scene.getEngine(), probe = engine.createRenderPassId('__shaderCompile');
  let fallback = null, queued = 0;
  const defaultSurface = () => (fallback ??= nodeMaterialFromTree('__defaultSurface', scene, DEFAULT_SURFACE).material);
  // Whether the mesh's own materials are compiled for the view about to render: compiled (and compiling) in the probe
  // pass, which shares the view's state and Babylon's effect cache.
  const compiled = (mesh, pending) => {
    const pass = engine.currentRenderPassId;
    engine.currentRenderPassId = probe;
    try {
      let ready = true;
      for (const subMesh of mesh.subMeshes) {
        const material = subMesh.getMaterial(false);
        if (!material || material.isReadyForSubMesh(mesh, subMesh, instanced(mesh))) continue;
        ready = false;
        pending.add(material);
      }
      return ready;
    } finally { engine.currentRenderPassId = pass; }
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
        if (compiled(mesh, pending)) continue;
        mesh.setMaterialForRenderPass(pass, defaultSurface());
        swapped.push(mesh);
      }
      queued = pending.size;
      return () => { for (const mesh of swapped) mesh.setMaterialForRenderPass(pass, undefined); };
    },
    dispose() { fallback?.dispose(); engine.releaseRenderPassId(probe); },
  };
}
