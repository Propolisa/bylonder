# Writes RNA_prototypes.hh as Blender's build makes it (makesrna.cc, rna_generate_external_property_prototypes), from
# the RNA structs and properties Blender itself reports, so the port can parse sources that include it.
# usage: blender -b --factory-startup --python tools/blender-reference/rna-prototypes.py -- OUT_FILE
import bpy, sys

structs = [t.bl_rna for t in (getattr(bpy.types, n) for n in dir(bpy.types)) if hasattr(t, "bl_rna") and t.bl_rna.identifier == t.__name__]
lines = ["/* RNA_prototypes.hh of Blender " + bpy.app.version_string + ", from tools/blender-reference/rna-prototypes.py. */", "",
         "#pragma once", "", "namespace blender {", "", "struct PropertyRNA;", "struct StructRNA;", ""]
lines += [f"extern struct StructRNA *RNA_{s.identifier};" for s in structs]
for s in structs:
    inherited = set(s.base.properties.keys()) if s.base else set()
    lines += [f"extern PropertyRNA &rna_{s.identifier}_{p};" for p in s.properties.keys() if p not in inherited]
lines += ["", "}  // namespace blender", ""]
open(sys.argv[sys.argv.index("--") + 1], "w").write("\n".join(lines))
