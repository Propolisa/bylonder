/* Included after a ported file's own includes: turns the macros the port keeps into declarations, so they reach
 * the AST as calls instead of expansions. */
#pragma once
#include <type_traits>
#include <utility>

#undef ELEM
#undef BLI_assert
#undef BLI_assert_msg
#undef BLI_assert_unreachable
#undef UNUSED_VARS
#undef LIKELY
#undef UNLIKELY
#undef SWAP
#undef BM_ITER_ELEM
#undef BM_ITER_MESH
#undef BM_ITER_ELEM_INDEX
#undef BM_ITER_MESH_INDEX
#undef BM_ITER_MESH_MUTABLE
#undef BM_elem_flag_test
#undef BM_elem_flag_test_bool
#undef BM_elem_flag_enable
#undef BM_elem_flag_disable
#undef BM_elem_flag_set
#undef BM_elem_flag_toggle
#undef BM_elem_flag_merge
#undef BM_elem_index_get
#undef BM_elem_index_set
#undef BMO_vert_flag_test
#undef BMO_vert_flag_test_bool
#undef BMO_vert_flag_enable
#undef BMO_vert_flag_disable
#undef BMO_vert_flag_set
#undef BMO_edge_flag_test
#undef BMO_edge_flag_test_bool
#undef BMO_edge_flag_enable
#undef BMO_edge_flag_disable
#undef BMO_edge_flag_set
#undef BMO_face_flag_test
#undef BMO_face_flag_test_bool
#undef BMO_face_flag_enable
#undef BMO_face_flag_disable
#undef BMO_face_flag_set

template<class T, class... A> bool ELEM(T, A...) { return {}; }
template<class... A> void BLI_assert(A...) {}
#define BLI_assert_msg(a, msg) BLI_assert(a)
#define BLI_assert_unreachable() BLI_assert(0)
#define UNUSED_VARS(...)
#define LIKELY(x) (x)
#define UNLIKELY(x) (x)
template<class T> void SWAP_(T &a, T &b) {}
#define SWAP(type, a, b) SWAP_(a, b)

/* `for (bl_port_iter ...)` loops stand for BM_ITER_*: the emitter turns them back into `for (const ele of ITYPE(bm,
 * data))`. */
struct bl_port_iter {
  template<class D, class T> bl_port_iter(D, T) {}
  template<class E> bool next(E &) { return false; }
};
#define BM_ITER_ELEM(ele, iter, data, itype) for (bl_port_iter bl_port_it(data, itype); bl_port_it.next(ele);)
#define BM_ITER_MESH(ele, iter, bm, itype) for (bl_port_iter bl_port_it(bm, itype); bl_port_it.next(ele);)
#define BM_ITER_ELEM_INDEX(ele, iter, data, itype, indexvar) \
  for (bl_port_iter bl_port_it(data, itype); bl_port_it.next(ele); (indexvar)++)
#define BM_ITER_MESH_INDEX(ele, iter, bm, itype, indexvar) \
  for (bl_port_iter bl_port_it(bm, itype); bl_port_it.next(ele); (indexvar)++)
#define BM_ITER_MESH_MUTABLE(ele, ele_next, iter, bm, itype) \
  for (bl_port_iter bl_port_it(bm, itype); bl_port_it.next(ele);)

template<class E, class F> int BM_elem_flag_test(E e, F hflag) { return {}; }
template<class E, class F> bool BM_elem_flag_test_bool(E e, F hflag) { return {}; }
template<class E, class F> void BM_elem_flag_enable(E e, F hflag) {}
template<class E, class F> void BM_elem_flag_disable(E e, F hflag) {}
template<class E, class F, class V> void BM_elem_flag_set(E e, F hflag, V val) {}
template<class E, class F> void BM_elem_flag_toggle(E e, F hflag) {}
template<class A, class B> void BM_elem_flag_merge(A a, B b) {}
template<class E> int BM_elem_index_get(E e) { return {}; }
template<class E, class I> void BM_elem_index_set(E e, I i) {}
template<class B, class E, class F> int BMO_vert_flag_test(B bm, E e, F oflag) { return {}; }
template<class B, class E, class F> bool BMO_vert_flag_test_bool(B bm, E e, F oflag) { return {}; }
template<class B, class E, class F> void BMO_vert_flag_enable(B bm, E e, F oflag) {}
template<class B, class E, class F> void BMO_vert_flag_disable(B bm, E e, F oflag) {}
template<class B, class E, class F, class V> void BMO_vert_flag_set(B bm, E e, F oflag, V val) {}
template<class B, class E, class F> int BMO_edge_flag_test(B bm, E e, F oflag) { return {}; }
template<class B, class E, class F> bool BMO_edge_flag_test_bool(B bm, E e, F oflag) { return {}; }
template<class B, class E, class F> void BMO_edge_flag_enable(B bm, E e, F oflag) {}
template<class B, class E, class F> void BMO_edge_flag_disable(B bm, E e, F oflag) {}
template<class B, class E, class F, class V> void BMO_edge_flag_set(B bm, E e, F oflag, V val) {}
template<class B, class E, class F> int BMO_face_flag_test(B bm, E e, F oflag) { return {}; }
template<class B, class E, class F> bool BMO_face_flag_test_bool(B bm, E e, F oflag) { return {}; }
template<class B, class E, class F> void BMO_face_flag_enable(B bm, E e, F oflag) {}
template<class B, class E, class F> void BMO_face_flag_disable(B bm, E e, F oflag) {}
template<class B, class E, class F, class V> void BMO_face_flag_set(B bm, E e, F oflag, V val) {}

/* Header macros the port keeps as calls, with their result types. */
#undef BLI_array_alloca
#undef BM_ELEM_CD_GET_FLOAT
#undef BM_ELEM_CD_GET_FLOAT_P
#undef BM_ELEM_CD_GET_VOID_P
#undef BM_ELEM_CD_GET_INT
#undef BM_ELEM_CD_SET_FLOAT
#undef BM_DISK_EDGE_NEXT
#undef BM_DISK_EDGE_PREV
#undef BLI_ASSERT_UNIT_V3
#undef MEM_SIZE_OPTIMAL
#undef BM_ELEM_API_FLAG_ENABLE
#undef BM_ELEM_API_FLAG_DISABLE
#undef BM_ELEM_API_FLAG_TEST
#undef INIT_MINMAX
#undef INIT_MINMAX2
template<class T, class N> T bl_port_alloca(T, N) { return {}; }
#define BLI_array_alloca(arr, realsize) bl_port_alloca(arr, realsize)
template<class E, class O> float BM_ELEM_CD_GET_FLOAT(E, O) { return {}; }
template<class E, class O> float *BM_ELEM_CD_GET_FLOAT_P(E, O) { return {}; }
template<class E, class O> void *BM_ELEM_CD_GET_VOID_P(E, O) { return {}; }
template<class E, class O> int BM_ELEM_CD_GET_INT(E, O) { return {}; }
template<class E, class O, class V> void BM_ELEM_CD_SET_FLOAT(E, O, V) {}
template<class E, class V> std::remove_const_t<std::remove_pointer_t<E>> *BM_DISK_EDGE_NEXT(E, V) { return {}; }
template<class E, class V> std::remove_const_t<std::remove_pointer_t<E>> *BM_DISK_EDGE_PREV(E, V) { return {}; }
template<class V> void BLI_ASSERT_UNIT_V3(V) {}
template<class S> S MEM_SIZE_OPTIMAL(S) { return {}; }
template<class E, class F> void BM_ELEM_API_FLAG_ENABLE(E, F) {}
template<class E, class F> void BM_ELEM_API_FLAG_DISABLE(E, F) {}
template<class E, class F> int BM_ELEM_API_FLAG_TEST(E, F) { return {}; }
template<class A, class B> void INIT_MINMAX(A &, B &) {}
template<class A, class B> void INIT_MINMAX2(A &, B &) {}
