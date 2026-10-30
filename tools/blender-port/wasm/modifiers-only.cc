/* The modifier kernels module (modifiers.wasm): modifier-api.cc without the rest of the scene module. It holds the
 * modifiers that evaluate on a mesh alone (MESH_ONLY in src/modifiers/blender.js); the other types are left out of its
 * library as stand-ins modifier_add refuses (modifier-standins.hh). Armature, Curve and Lattice stay real:
 * BKE_modifier_init copies one of each whole into its virtual modifiers, which a stand-in's bare ModifierData is not. */
#include "modifier-standins.hh"

#include "BKE_global.hh"
#include "BKE_idtype.hh"
#include "BLO_readfile.hh"
#include "BLT_translation.hh"
#include "DNA_armature_types.h"
#include "DNA_node_types.h"
#include "DNA_scene_types.h"
#include "DNA_userdef_types.h"
#include "RNA_types.hh"

namespace blender {

/* As blender.cc and editor-context.cc define them: Blender's globals start zeroed. */
Global G;
UserDef U;
extern const PointerRNA PointerRNA_NULL = {};

/* As readfile.cc defines them for data not read from a file, which is all this module's data (the scene module reads files). */
ID_Readfile_Data::Tags BLO_readfile_id_runtime_tags(const ID & /*id*/) { return {}; }
void BLO_readfile_id_runtime_data_free(ID & /*id*/) {}

IDTypeInfo id_type_without_data(short code, uint64_t filter, int index, size_t size, const char *name,
                                const char *name_plural, const char *context, uint32_t flags);
/* Scenes and node trees, without scene.cc and node.cc: the module's one scene is outside Main. */
IDTypeInfo IDType_ID_SCE = id_type_without_data(ID_SCE, FILTER_ID_SCE, INDEX_ID_SCE, sizeof(Scene), "Scene", "scenes",
                                                BLT_I18NCONTEXT_ID_SCENE, 0);
IDTypeInfo IDType_ID_NT = id_type_without_data(ID_NT, FILTER_ID_NT, INDEX_ID_NT, sizeof(bNodeTree), "NodeTree", "node_groups",
                                               BLT_I18NCONTEXT_ID_NODETREE, IDTYPE_FLAGS_APPEND_IS_REUSABLE);
/* Armatures, without armature.cc's ID callbacks. Not in modifier-api.cc: a stand-in's initializer there would write
 * over the scene module's real armature type (armature.cc), whose definition wins the link. */
IDTypeInfo IDType_ID_AR = id_type_without_data(ID_AR, FILTER_ID_AR, INDEX_ID_AR, sizeof(bArmature), "Armature", "armatures",
                                               BLT_I18NCONTEXT_ID_ARMATURE, IDTYPE_FLAGS_APPEND_IS_REUSABLE);

/* Not in modifier-api.cc: a stand-in's initializer there would write over the scene module's real Geometry Nodes and
 * Line Art types, whose definitions win the link. */
LEFT_OUT_MODIFIER(Nodes);
LEFT_OUT_MODIFIER(GreasePencilLineart);
LEFT_OUT_MODIFIER(Boolean);
LEFT_OUT_MODIFIER(Cloth);
LEFT_OUT_MODIFIER(Collision);
LEFT_OUT_MODIFIER(DataTransfer);
LEFT_OUT_MODIFIER(DynamicPaint);
LEFT_OUT_MODIFIER(Explode);
LEFT_OUT_MODIFIER(Fluid);
LEFT_OUT_MODIFIER(GreasePencilArmature);
LEFT_OUT_MODIFIER(GreasePencilArray);
LEFT_OUT_MODIFIER(GreasePencilBuild);
LEFT_OUT_MODIFIER(GreasePencilColor);
LEFT_OUT_MODIFIER(GreasePencilDash);
LEFT_OUT_MODIFIER(GreasePencilEnvelope);
LEFT_OUT_MODIFIER(GreasePencilHook);
LEFT_OUT_MODIFIER(GreasePencilLattice);
LEFT_OUT_MODIFIER(GreasePencilLength);
LEFT_OUT_MODIFIER(GreasePencilMirror);
LEFT_OUT_MODIFIER(GreasePencilMultiply);
LEFT_OUT_MODIFIER(GreasePencilNoise);
LEFT_OUT_MODIFIER(GreasePencilOffset);
LEFT_OUT_MODIFIER(GreasePencilOpacity);
LEFT_OUT_MODIFIER(GreasePencilOutline);
LEFT_OUT_MODIFIER(GreasePencilShrinkwrap);
LEFT_OUT_MODIFIER(GreasePencilSimplify);
LEFT_OUT_MODIFIER(GreasePencilSmooth);
LEFT_OUT_MODIFIER(GreasePencilSubdiv);
LEFT_OUT_MODIFIER(GreasePencilTexture);
LEFT_OUT_MODIFIER(GreasePencilThickness);
LEFT_OUT_MODIFIER(GreasePencilTime);
LEFT_OUT_MODIFIER(GreasePencilTint);
LEFT_OUT_MODIFIER(GreasePencilWeightAngle);
LEFT_OUT_MODIFIER(GreasePencilWeightProximity);
LEFT_OUT_MODIFIER(Hook);
LEFT_OUT_MODIFIER(LaplacianDeform);
LEFT_OUT_MODIFIER(Mask);
LEFT_OUT_MODIFIER(MeshToVolume);
LEFT_OUT_MODIFIER(MeshCache);
LEFT_OUT_MODIFIER(MeshDeform);
LEFT_OUT_MODIFIER(MeshSequenceCache);
LEFT_OUT_MODIFIER(Multires);
LEFT_OUT_MODIFIER(NormalEdit);
LEFT_OUT_MODIFIER(Ocean);
LEFT_OUT_MODIFIER(ParticleInstance);
LEFT_OUT_MODIFIER(ParticleSystem);
LEFT_OUT_MODIFIER(Shrinkwrap);
LEFT_OUT_MODIFIER(Softbody);
LEFT_OUT_MODIFIER(Surface);
LEFT_OUT_MODIFIER(SurfaceDeform);
LEFT_OUT_MODIFIER(UVProject);
LEFT_OUT_MODIFIER(UVWarp);
LEFT_OUT_MODIFIER(VolumeDisplace);
LEFT_OUT_MODIFIER(VolumeToMesh);
LEFT_OUT_MODIFIER(Warp);
LEFT_OUT_MODIFIER(WeightVGEdit);
LEFT_OUT_MODIFIER(WeightVGMix);
LEFT_OUT_MODIFIER(WeightVGProximity);

}  // namespace blender

/* Text objects and their fonts are not in this module. */
void fonts_init() {}
