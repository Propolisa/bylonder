/* Included first in each source of Cycles' side module (blender_build.py, CYCLES_PIC). Blender's inline variables whose
 * address is a type's identity, declared with default visibility, so cycles.wasm reaches them through its GOT, bound to
 * the module's one copy (src/port/side-modules.js), instead of a copy of its own that the module's code does not know
 * (a CPPType that is no type of Blender's: attributes read as the wrong type, faces given the wrong material). */
#pragma once

#ifdef __cplusplus
#  include <cstdint>

#  define BYLONDER_SHARED __attribute__((visibility("default")))

namespace blender {
template<typename T, int64_t Size> class TypedBuffer;
class CPPType;
namespace detail {
/* BLI_cpp_type.hh: CPPType::get<T>, CPPType::is<T>. */
template<typename T> extern BYLONDER_SHARED TypedBuffer<CPPType, 1> cpp_type_impl;
}  // namespace detail
namespace blenlib_detail {
/* BLI_any.hh: Any::is<T>. */
template<typename ExtraInfo> struct AnyTypeInfo;
template<typename ExtraInfo, typename T> extern BYLONDER_SHARED const AnyTypeInfo<ExtraInfo> info_for_inline;
}  // namespace blenlib_detail
}  // namespace blender

#  undef BYLONDER_SHARED
#endif
