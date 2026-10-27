// Serial stand-in for the oneTBB API OpenVDB uses (oneTBB needs threads, which the module does not have): each
// parallel algorithm runs its body once over the whole range, as TBB does when it chooses not to split.
#pragma once
#include <cstddef>
#include <algorithm>
#include <functional>
#include <unordered_map>
#include <utility>

#define TBB_INTERFACE_VERSION 12160

namespace tbb {
struct split {};
struct proportional_split {
  size_t left_, right_;
  size_t left() const { return left_; }
  size_t right() const { return right_; }
};
struct simple_partitioner {};
struct auto_partitioner {};
struct static_partitioner {};
struct affinity_partitioner {};

template<typename Value> class blocked_range {
 public:
  using const_iterator = Value;
  using size_type = size_t;
  blocked_range() = default;
  blocked_range(Value begin, Value end, size_t grainsize = 1) : my_begin(begin), my_end(end), my_grainsize(grainsize) {}
  blocked_range(blocked_range &r, split) : my_begin(r.my_begin + (r.my_end - r.my_begin) / 2), my_end(r.my_end),
                                            my_grainsize(r.my_grainsize) { r.my_end = my_begin; }
  Value begin() const { return my_begin; }
  Value end() const { return my_end; }
  size_t size() const { return size_t(my_end - my_begin); }
  size_t grainsize() const { return my_grainsize; }
  bool empty() const { return !(my_begin < my_end); }
  bool is_divisible() const { return my_grainsize < size(); }
 private:
  Value my_begin{}, my_end{};
  size_t my_grainsize = 1;
};

template<typename Range, typename Body, typename... P> void parallel_for(const Range &range, const Body &body, P &&...)
{
  Range r = range;  // TBB hands bodies a copy they may modify.
  if (!r.empty()) body(r);
}
template<typename Index, typename F> requires std::is_integral_v<Index>
void parallel_for(Index first, Index last, const F &f)
{
  for (Index i = first; i < last; ++i) f(i);
}
template<typename Index, typename F> requires std::is_integral_v<Index>
void parallel_for(Index first, Index last, Index step, const F &f)
{
  for (Index i = first; i < last; i += step) f(i);
}
template<typename Range, typename Body, typename... P> void parallel_reduce(const Range &range, Body &body, P &&...)
{
  Range r = range;  // TBB hands bodies a copy they may modify.
  if (!r.empty()) body(r);
}
template<typename Range, typename Value, typename F, typename R, typename... P>
Value parallel_reduce(const Range &range, const Value &identity, const F &f, const R &, P &&...)
{
  Range r = range;
  return r.empty() ? identity : f(r, identity);
}
template<typename It> void parallel_sort(It first, It last) { std::sort(first, last); }
template<typename It, typename C> void parallel_sort(It first, It last, const C &c) { std::sort(first, last, c); }

class spin_mutex {
 public:
  class scoped_lock {
   public:
    scoped_lock() = default;
    explicit scoped_lock(spin_mutex &) {}
    void acquire(spin_mutex &) {}
    bool try_acquire(spin_mutex &) { return true; }
    void release() {}
  };
  void lock() {}
  bool try_lock() { return true; }
  void unlock() {}
};
using mutex = spin_mutex;
using queuing_mutex = spin_mutex;

class task_group_context {
 public:
  bool cancel_group_execution() { bool was = cancelled; cancelled = true; return !was; }
  bool is_group_execution_cancelled() const { return cancelled; }
 private:
  bool cancelled = false;
};
namespace task {
inline task_group_context *current_context() { return nullptr; }
}  // namespace task
class task_group {
 public:
  template<typename F> void run(F &&f) { f(); }
  template<typename F> void run_and_wait(F &&f) { f(); }
  void wait() {}
};
namespace this_task_arena {
inline int max_concurrency() { return 1; }
inline int current_thread_index() { return 0; }
}  // namespace this_task_arena
class task_arena {
 public:
  struct attach {};
  static constexpr int automatic = -1;
  task_arena(int = automatic) {}
  task_arena(attach) {}
  void initialize() {}
  void initialize(attach) {}
  bool is_active() const { return true; }
  int max_concurrency() const { return 1; }
  template<typename F> auto execute(F &&f) { return f(); }
};

enum ets_key_usage_type { ets_key_per_instance, ets_no_key };
template<typename T, typename A = void, ets_key_usage_type = ets_no_key> class enumerable_thread_specific {
 public:
  using iterator = T *;
  using const_iterator = const T *;
  using reference = T &;
  using value_type = T;
  enumerable_thread_specific() = default;
  explicit enumerable_thread_specific(const T &exemplar) : value(exemplar) {}
  template<typename F> requires std::is_invocable_r_v<T, F>
  explicit enumerable_thread_specific(F f) : value(f()) {}
  T &local() { created = true; return value; }
  T &local(bool &exists) { exists = created; created = true; return value; }
  iterator begin() { return created ? &value : &value + 1; }
  iterator end() { return &value + 1; }
  const_iterator begin() const { return created ? &value : &value + 1; }
  const_iterator end() const { return &value + 1; }
  size_t size() const { return created; }
  bool empty() const { return !created; }
  void clear() { created = false; value = T(); }
  template<typename F> T combine(F f) const { return value; }
  template<typename F> void combine_each(F f) { if (created) f(value); }
 private:
  T value{};
  bool created = false;
};

template<typename Key, typename T, typename HashCompare = void, typename A = void> class concurrent_hash_map {
  using map = std::unordered_map<Key, T>;
 public:
  using value_type = typename map::value_type;
  using iterator = typename map::iterator;
  using const_iterator = typename map::const_iterator;
  using size_type = size_t;
  class const_accessor {
   public:
    const value_type &operator*() const { return *it; }
    const value_type *operator->() const { return &*it; }
    bool empty() const { return !valid; }
    void release() { valid = false; }
   protected:
    friend class concurrent_hash_map;
    iterator it;
    bool valid = false;
  };
  class accessor : public const_accessor {
   public:
    value_type &operator*() const { return *this->it; }
    value_type *operator->() const { return &*this->it; }
  };
  bool insert(const_accessor &a, const Key &k) { auto [it, inserted] = items.try_emplace(k); a.it = it; a.valid = true; return inserted; }
  bool insert(const_accessor &a, const value_type &v) { auto [it, inserted] = items.insert(v); a.it = it; a.valid = true; return inserted; }
  bool insert(const value_type &v) { return items.insert(v).second; }
  bool find(const_accessor &a, const Key &k) { auto it = items.find(k); a.it = it; a.valid = it != items.end(); return a.valid; }
  bool erase(const Key &k) { return items.erase(k) != 0; }
  bool erase(const_accessor &a) { items.erase(a.it); a.valid = false; return true; }
  size_t count(const Key &k) const { return items.count(k); }
  size_t size() const { return items.size(); }
  bool empty() const { return items.empty(); }
  void clear() { items.clear(); }
  iterator begin() { return items.begin(); }
  iterator end() { return items.end(); }
  const_iterator begin() const { return items.begin(); }
  const_iterator end() const { return items.end(); }
 private:
  map items;
};
}  // namespace tbb
