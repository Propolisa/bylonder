/* The modifier kernels module (modifiers.wasm): modifier-api.cc without the rest of the scene module. It holds the
 * modifiers that evaluate on a mesh alone (MESH_ONLY in src/modifiers/blender.js); the other types are left out of its
 * library and are unknown here, as modifier-api.cc makes Geometry Nodes unknown. Armature, Curve and Lattice stay:
 * BKE_modifier_init makes one of each (the virtual modifiers), and an unknown type's ModifierData has no size, so its
 * name would be written past the end of a block. */
#include "BKE_modifier.hh"

namespace blender {

ModifierTypeInfo modifierType_Boolean = {};
ModifierTypeInfo modifierType_Cloth = {};
ModifierTypeInfo modifierType_Collision = {};
ModifierTypeInfo modifierType_DataTransfer = {};
ModifierTypeInfo modifierType_DynamicPaint = {};
ModifierTypeInfo modifierType_Explode = {};
ModifierTypeInfo modifierType_Fluid = {};
ModifierTypeInfo modifierType_GreasePencilArmature = {};
ModifierTypeInfo modifierType_GreasePencilArray = {};
ModifierTypeInfo modifierType_GreasePencilBuild = {};
ModifierTypeInfo modifierType_GreasePencilColor = {};
ModifierTypeInfo modifierType_GreasePencilDash = {};
ModifierTypeInfo modifierType_GreasePencilEnvelope = {};
ModifierTypeInfo modifierType_GreasePencilHook = {};
ModifierTypeInfo modifierType_GreasePencilLattice = {};
ModifierTypeInfo modifierType_GreasePencilLength = {};
ModifierTypeInfo modifierType_GreasePencilMirror = {};
ModifierTypeInfo modifierType_GreasePencilMultiply = {};
ModifierTypeInfo modifierType_GreasePencilNoise = {};
ModifierTypeInfo modifierType_GreasePencilOffset = {};
ModifierTypeInfo modifierType_GreasePencilOpacity = {};
ModifierTypeInfo modifierType_GreasePencilOutline = {};
ModifierTypeInfo modifierType_GreasePencilShrinkwrap = {};
ModifierTypeInfo modifierType_GreasePencilSimplify = {};
ModifierTypeInfo modifierType_GreasePencilSmooth = {};
ModifierTypeInfo modifierType_GreasePencilSubdiv = {};
ModifierTypeInfo modifierType_GreasePencilTexture = {};
ModifierTypeInfo modifierType_GreasePencilThickness = {};
ModifierTypeInfo modifierType_GreasePencilTime = {};
ModifierTypeInfo modifierType_GreasePencilTint = {};
ModifierTypeInfo modifierType_GreasePencilWeightAngle = {};
ModifierTypeInfo modifierType_GreasePencilWeightProximity = {};
ModifierTypeInfo modifierType_Hook = {};
ModifierTypeInfo modifierType_LaplacianDeform = {};
ModifierTypeInfo modifierType_Mask = {};
ModifierTypeInfo modifierType_MeshToVolume = {};
ModifierTypeInfo modifierType_MeshCache = {};
ModifierTypeInfo modifierType_MeshDeform = {};
ModifierTypeInfo modifierType_MeshSequenceCache = {};
ModifierTypeInfo modifierType_Multires = {};
ModifierTypeInfo modifierType_NormalEdit = {};
ModifierTypeInfo modifierType_Ocean = {};
ModifierTypeInfo modifierType_ParticleInstance = {};
ModifierTypeInfo modifierType_ParticleSystem = {};
ModifierTypeInfo modifierType_Shrinkwrap = {};
ModifierTypeInfo modifierType_Softbody = {};
ModifierTypeInfo modifierType_Surface = {};
ModifierTypeInfo modifierType_SurfaceDeform = {};
ModifierTypeInfo modifierType_UVProject = {};
ModifierTypeInfo modifierType_UVWarp = {};
ModifierTypeInfo modifierType_VolumeDisplace = {};
ModifierTypeInfo modifierType_VolumeToMesh = {};
ModifierTypeInfo modifierType_Warp = {};
ModifierTypeInfo modifierType_WeightVGEdit = {};
ModifierTypeInfo modifierType_WeightVGMix = {};
ModifierTypeInfo modifierType_WeightVGProximity = {};

}  // namespace blender

/* Text objects and their fonts are not in this module. */
void fonts_init() {}
