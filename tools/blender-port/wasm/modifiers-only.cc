/* The modifier kernels module (modifiers.wasm): modifier-api.cc without the rest of the scene module. It holds the
 * modifiers that evaluate on a mesh alone (MESH_ONLY in src/modifiers/blender.js); the other types are left out of its
 * library and are unknown here, as modifier-api.cc makes Geometry Nodes unknown. */
#include "BKE_global.hh"
#include "BKE_idtype.hh"
#include "BKE_modifier.hh"
#include "BLT_translation.hh"
#include "DNA_node_types.h"
#include "DNA_scene_types.h"
#include "DNA_userdef_types.h"
#include "RNA_types.hh"

namespace blender {

/* As blender.cc and editor-context.cc define them: Blender's globals start zeroed. */
Global G;
UserDef U;
extern const PointerRNA PointerRNA_NULL = {};

IDTypeInfo id_type_without_data(short code, uint64_t filter, int index, size_t size, const char *name,
                                const char *name_plural, const char *context, uint32_t flags);
/* Scenes and node trees, without scene.cc and node.cc: the module's one scene is outside Main. */
IDTypeInfo IDType_ID_SCE = id_type_without_data(ID_SCE, FILTER_ID_SCE, INDEX_ID_SCE, sizeof(Scene), "Scene", "scenes",
                                                BLT_I18NCONTEXT_ID_SCENE, 0);
IDTypeInfo IDType_ID_NT = id_type_without_data(ID_NT, FILTER_ID_NT, INDEX_ID_NT, sizeof(bNodeTree), "NodeTree", "node_groups",
                                               BLT_I18NCONTEXT_ID_NODETREE, IDTYPE_FLAGS_APPEND_IS_REUSABLE);

ModifierTypeInfo modifierType_Armature = {};
ModifierTypeInfo modifierType_Boolean = {};
ModifierTypeInfo modifierType_Cloth = {};
ModifierTypeInfo modifierType_Collision = {};
ModifierTypeInfo modifierType_Curve = {};
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
ModifierTypeInfo modifierType_Lattice = {};
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
