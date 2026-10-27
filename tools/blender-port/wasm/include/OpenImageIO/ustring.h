/* What Blender's BLI_ustring.hh uses of OpenImageIO's ustring: unique strings that compare by pointer and keep their
 * hash. Blender needs only that a ustring's hash equals Strutil::strhash64 of its characters. */
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>

namespace OpenImageIO {

using string_view = std::string_view;

namespace Strutil {
/* 64-bit FNV-1a. */
constexpr uint64_t strhash64(size_t len, const char *s)
{
  uint64_t h = 14695981039346656037ull;
  for (size_t i = 0; i < len; i++) {
    h = (h ^ uint8_t(s[i])) * 1099511628211ull;
  }
  return h;
}
}  // namespace Strutil

class ustring {
  struct Entry {
    std::string str;
    uint64_t hash;
  };
  const Entry *entry_ = nullptr;

  static const Entry *intern(std::string_view s)
  {
    static std::unordered_map<std::string_view, Entry *> table;
    auto it = table.find(s);
    if (it == table.end()) {
      Entry *e = new Entry{std::string(s), Strutil::strhash64(s.size(), s.data())};
      it = table.emplace(std::string_view(e->str), e).first;
    }
    return it->second;
  }

 public:
  ustring() = default;
  explicit ustring(std::string_view s) : entry_(s.empty() ? nullptr : intern(s)) {}
  static const char *make_unique(std::string_view s) { return s.empty() ? nullptr : intern(s)->str.c_str(); }

  const char *c_str() const { return entry_ ? entry_->str.c_str() : nullptr; }
  const std::string &string() const
  {
    static const std::string empty;
    return entry_ ? entry_->str : empty;
  }
  bool empty() const { return entry_ == nullptr; }
  size_t size() const { return entry_ ? entry_->str.size() : 0; }
  uint64_t hash() const { return entry_ ? entry_->hash : Strutil::strhash64(0, ""); }
  char operator[](size_t i) const { return entry_ ? entry_->str[i] : '\0'; }
  friend bool operator==(const ustring &a, const ustring &b) { return a.entry_ == b.entry_; }
};

}  // namespace OpenImageIO
