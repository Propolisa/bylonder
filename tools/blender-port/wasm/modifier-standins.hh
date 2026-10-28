/* Modifier types a module leaves out (modifier-api.cc, modifiers-only.cc), registered as Blender's None type is
 * (MOD_none.cc): a bare ModifierData that is always disabled. Blender's own code that makes one of them
 * (BKE_modifier_init's virtual modifiers, conversions) gets a block of the right size; an empty ModifierTypeInfo would
 * be unknown to BKE_modifier_get_info, and modifier_allocate_and_init would read a null one and write the name past an
 * empty block. modifier_add refuses them, so for Bylonder they are still not in the module. */
#pragma once

#include "BKE_modifier.hh"
#include "BLI_string.h"
#include "DNA_modifier_types.h"
#include "RNA_prototypes.hh"
#include "UI_resources.hh"

namespace blender {

bool modifier_left_out_is_disabled(const Scene *scene, ModifierData *md, bool use_render_params);

inline ModifierTypeInfo modifier_left_out(const char *name)
{
  ModifierTypeInfo info = {};
  STRNCPY(info.idname, name);
  STRNCPY(info.name, name);
  STRNCPY(info.struct_name, "ModifierData");
  info.struct_size = sizeof(ModifierData);
  info.srna = &RNA_Modifier;
  info.type = ModifierTypeType::None;
  info.flags = eModifierTypeFlag_AcceptsMesh;
  info.icon = ICON_NONE;
  info.is_disabled = modifier_left_out_is_disabled;
  return info;
}

inline bool modifier_is_left_out(const ModifierTypeInfo *info) { return info->is_disabled == modifier_left_out_is_disabled; }

}  // namespace blender

#define LEFT_OUT_MODIFIER(Name) ModifierTypeInfo modifierType_##Name = modifier_left_out(#Name)
