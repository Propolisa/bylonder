/* The tables of an RNA file's runtime functions (rna-funcs.hh) from its generated list, included by the file's wrapper
 * after the file with RNA_FUNCS_FILE (the list, rna_<file>_funcs.inc) and RNA_TABLES (the tables' name) defined. */
#include "rna-funcs.hh"

namespace blender {

static const RnaFunc rna_funcs[] = {
#define RNA_BASE(srna, base)
#define RNA_ARRAY(srna, identifier, type, length)
#define RNA_FUNC(srna, identifier, type, member, func) \
  {&srna, identifier, type, RNA_FUNC_##member, reinterpret_cast<void (*)()>(func)},
#include RNA_FUNCS_FILE
#undef RNA_BASE
#undef RNA_ARRAY
#undef RNA_FUNC
    {nullptr, nullptr, 0, RNA_FUNC_update, nullptr},
};

static const RnaBase rna_bases[] = {
#define RNA_BASE(srna, base) {&srna, &base},
#define RNA_ARRAY(srna, identifier, type, length)
#define RNA_FUNC(srna, identifier, type, member, func)
#include RNA_FUNCS_FILE
#undef RNA_BASE
#undef RNA_ARRAY
#undef RNA_FUNC
    {nullptr, nullptr},
};

static const RnaArray rna_arrays[] = {
#define RNA_BASE(srna, base)
#define RNA_ARRAY(srna, identifier, type, length) {&srna, identifier, type, length},
#define RNA_FUNC(srna, identifier, type, member, func)
#include RNA_FUNCS_FILE
#undef RNA_BASE
#undef RNA_ARRAY
#undef RNA_FUNC
    {nullptr, nullptr, 0, 0},
};

const RnaTables RNA_TABLES = {rna_funcs, rna_bases, rna_arrays};

}  // namespace blender
