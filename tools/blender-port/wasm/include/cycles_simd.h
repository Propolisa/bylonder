/* Cycles' SSE4.2 kernel on WebAssembly SIMD128, as its Arm build runs that kernel on Neon (sse2neon): SIMDe gives the
 * SSE intrinsics Cycles uses on wasm's, and the kernel flags util/optimization.h sets for x86-64 and Arm, which it
 * leaves unset for wasm32. Forced into every Cycles source (manifest targets). SIMDe's own aliases are function-like
 * macros, which a template's commas in an argument (shuffle<1, 2, 0, 3>(a)) break, so the intrinsics are functions
 * here, as sse2neon's are; those that take an immediate stay macros, as in x86's headers. */
#pragma once
#if defined(__wasm_simd128__) && defined(__cplusplus)
/* wasm32 has no _Float16. */
#  define SIMDE_FLOAT16_API SIMDE_FLOAT16_API_PORTABLE
#  include <simde/x86/sse4.2.h>

#  define __KERNEL_SSE__
#  define __KERNEL_SSE2__
#  define __KERNEL_SSE3__
#  define __KERNEL_SSE42__

typedef simde__m128 __m128;
typedef simde__m128i __m128i;
typedef simde__m128d __m128d;

#  define _MM_SHUFFLE SIMDE_MM_SHUFFLE
#  define _MM_TRANSPOSE4_PS SIMDE_MM_TRANSPOSE4_PS
#  define _MM_FROUND_TO_NEAREST_INT SIMDE_MM_FROUND_TO_NEAREST_INT
#  define _MM_FROUND_TRUNC SIMDE_MM_FROUND_TRUNC
#  define _MM_FROUND_NO_EXC SIMDE_MM_FROUND_NO_EXC
#  define _MM_FROUND_TO_ZERO SIMDE_MM_FROUND_TO_ZERO
#  define _MM_FROUND_NINT SIMDE_MM_FROUND_NINT

/* The function itself, not a macro of the same name. */
#  define CYCLES_SIMD(name) \
    template<typename... Args> SIMDE_FUNCTION_ATTRIBUTES auto _mm_##name(Args... args) \
    { \
      return (simde_mm_##name)(args...); \
    }
CYCLES_SIMD(add_epi32)
CYCLES_SIMD(add_ps)
CYCLES_SIMD(and_ps)
CYCLES_SIMD(and_si128)
CYCLES_SIMD(andnot_ps)
CYCLES_SIMD(andnot_si128)
CYCLES_SIMD(blendv_ps)
CYCLES_SIMD(castps_si128)
CYCLES_SIMD(castsi128_ps)
CYCLES_SIMD(ceil_ps)
CYCLES_SIMD(cmpeq_epi32)
CYCLES_SIMD(cmpeq_ps)
CYCLES_SIMD(cmpge_ps)
CYCLES_SIMD(cmpgt_ps)
CYCLES_SIMD(cmple_ps)
CYCLES_SIMD(cmplt_epi32)
CYCLES_SIMD(cmplt_ps)
CYCLES_SIMD(cvtepi32_ps)
CYCLES_SIMD(cvtps_epi32)
CYCLES_SIMD(cvtss_f32)
CYCLES_SIMD(cvtss_si32)
CYCLES_SIMD(cvttps_epi32)
CYCLES_SIMD(div_ps)
CYCLES_SIMD(floor_ps)
CYCLES_SIMD(hadd_ps)
CYCLES_SIMD(loadl_epi64)
CYCLES_SIMD(loadu_ps)
CYCLES_SIMD(loadu_si128)
CYCLES_SIMD(max_epi32)
CYCLES_SIMD(max_ps)
CYCLES_SIMD(min_epi32)
CYCLES_SIMD(min_ps)
CYCLES_SIMD(movehdup_ps)
CYCLES_SIMD(movehl_ps)
CYCLES_SIMD(moveldup_ps)
CYCLES_SIMD(movelh_ps)
CYCLES_SIMD(movemask_ps)
CYCLES_SIMD(mul_ps)
CYCLES_SIMD(mul_ss)
CYCLES_SIMD(or_ps)
CYCLES_SIMD(or_si128)
CYCLES_SIMD(rcp_ps)
CYCLES_SIMD(rcp_ss)
CYCLES_SIMD(set1_epi32)
CYCLES_SIMD(set_epi16)
CYCLES_SIMD(set_epi32)
CYCLES_SIMD(set_ps)
CYCLES_SIMD(set_ps1)
CYCLES_SIMD(set_ss)
CYCLES_SIMD(setzero_ps)
CYCLES_SIMD(sqrt_ps)
CYCLES_SIMD(sqrt_ss)
CYCLES_SIMD(storel_epi64)
CYCLES_SIMD(storeu_ps)
CYCLES_SIMD(sub_epi32)
CYCLES_SIMD(sub_ps)
CYCLES_SIMD(sub_ss)
CYCLES_SIMD(xor_ps)
CYCLES_SIMD(xor_si128)
#  undef CYCLES_SIMD
#  define _mm_set1_ps _mm_set_ps1

#  define _mm_dp_ps(...) simde_mm_dp_ps(__VA_ARGS__)
#  define _mm_extract_epi16(...) simde_mm_extract_epi16(__VA_ARGS__)
#  define _mm_round_ps(...) simde_mm_round_ps(__VA_ARGS__)
#  define _mm_round_ss(...) simde_mm_round_ss(__VA_ARGS__)
#  define _mm_shuffle_epi32(...) simde_mm_shuffle_epi32(__VA_ARGS__)
#  define _mm_shuffle_ps(...) simde_mm_shuffle_ps(__VA_ARGS__)
#  define _mm_slli_epi32(...) simde_mm_slli_epi32(__VA_ARGS__)
#  define _mm_srai_epi32(...) simde_mm_srai_epi32(__VA_ARGS__)
#  define _mm_srli_epi32(...) simde_mm_srli_epi32(__VA_ARGS__)
#endif
