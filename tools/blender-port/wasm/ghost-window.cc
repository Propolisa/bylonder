/* GHOST for the browser: the page is a system without windows of its own, so Blender's window is GHOST's headless
 * window (GHOST_WindowNULL, as GHOST_SystemHeadless makes it), and the browser's keys are GHOST's keys as each GHOST
 * system converts its own (here from a DOM KeyboardEvent's `code`, the physical key, and its `key` for letters, as
 * X11 and Wayland take a letter from the keyboard layout). */
#include "intern/GHOST_ContextNone.cc"
#include "intern/GHOST_Window.cc"
#include "intern/GHOST_WindowNULL.hh"

#include <cstring>
#include <string_view>

GHOST_IWindow *ghost_window_new(uint32_t width, uint32_t height)
{
  return new GHOST_WindowNULL("Blender", 0, 0, width, height, GHOST_kWindowStateNormal, nullptr, GHOST_kDrawingContextTypeNone,
                              GHOST_CONTEXT_PARAMS_NONE);
}

struct BrowserKey {
  const char *code;
  GHOST_TKey key;
};
static const BrowserKey browser_keys[] = {
    {"Backspace", GHOST_kKeyBackSpace},  {"Tab", GHOST_kKeyTab},
    {"Enter", GHOST_kKeyEnter},          {"Escape", GHOST_kKeyEsc},
    {"Space", GHOST_kKeySpace},          {"Quote", GHOST_kKeyQuote},
    {"Comma", GHOST_kKeyComma},          {"Minus", GHOST_kKeyMinus},
    {"Period", GHOST_kKeyPeriod},        {"Slash", GHOST_kKeySlash},
    {"Semicolon", GHOST_kKeySemicolon},  {"Equal", GHOST_kKeyEqual},
    {"BracketLeft", GHOST_kKeyLeftBracket}, {"BracketRight", GHOST_kKeyRightBracket},
    {"Backslash", GHOST_kKeyBackslash},  {"Backquote", GHOST_kKeyAccentGrave},
    {"ShiftLeft", GHOST_kKeyLeftShift},  {"ShiftRight", GHOST_kKeyRightShift},
    {"ControlLeft", GHOST_kKeyLeftControl}, {"ControlRight", GHOST_kKeyRightControl},
    {"AltLeft", GHOST_kKeyLeftAlt},      {"AltRight", GHOST_kKeyRightAlt},
    {"MetaLeft", GHOST_kKeyLeftOS},      {"MetaRight", GHOST_kKeyRightOS},
    {"IntlBackslash", GHOST_kKeyGrLess}, {"ContextMenu", GHOST_kKeyApp},
    {"CapsLock", GHOST_kKeyCapsLock},    {"NumLock", GHOST_kKeyNumLock},
    {"ScrollLock", GHOST_kKeyScrollLock}, {"ArrowLeft", GHOST_kKeyLeftArrow},
    {"ArrowRight", GHOST_kKeyRightArrow}, {"ArrowUp", GHOST_kKeyUpArrow},
    {"ArrowDown", GHOST_kKeyDownArrow},  {"PrintScreen", GHOST_kKeyPrintScreen},
    {"Pause", GHOST_kKeyPause},          {"Insert", GHOST_kKeyInsert},
    {"Delete", GHOST_kKeyDelete},        {"Home", GHOST_kKeyHome},
    {"End", GHOST_kKeyEnd},              {"PageUp", GHOST_kKeyUpPage},
    {"PageDown", GHOST_kKeyDownPage},    {"NumpadDecimal", GHOST_kKeyNumpadPeriod},
    {"NumpadEnter", GHOST_kKeyNumpadEnter}, {"NumpadAdd", GHOST_kKeyNumpadPlus},
    {"NumpadSubtract", GHOST_kKeyNumpadMinus}, {"NumpadMultiply", GHOST_kKeyNumpadAsterisk},
    {"NumpadDivide", GHOST_kKeyNumpadSlash},
};

/* The GHOST key of a DOM key: a letter by the layout's letter, digits, numpad digits and function keys by their
 * number, the rest from the table. */
GHOST_TKey ghost_key_from_browser(const char *code, const char *key)
{
  const std::string_view c = code;
  if (key && strlen(key) == 1 && ((key[0] >= 'a' && key[0] <= 'z') || (key[0] >= 'A' && key[0] <= 'Z'))) {
    return GHOST_TKey(GHOST_kKeyA + ((key[0] | 0x20) - 'a'));
  }
  if (c.size() == 4 && c.substr(0, 3) == "Key") {
    return GHOST_TKey(GHOST_kKeyA + (c[3] - 'A'));
  }
  if (c.size() == 6 && c.substr(0, 5) == "Digit") {
    return GHOST_TKey(GHOST_kKey0 + (c[5] - '0'));
  }
  if (c.size() == 7 && c.substr(0, 6) == "Numpad" && c[6] >= '0' && c[6] <= '9') {
    return GHOST_TKey(GHOST_kKeyNumpad0 + (c[6] - '0'));
  }
  if (c.size() >= 2 && c[0] == 'F' && c.size() <= 3 && c[1] >= '1' && c[1] <= '9') {
    const int number = std::stoi(std::string(c.substr(1)));
    if (number >= 1 && number <= 24) {
      return GHOST_TKey(GHOST_kKeyF1 + number - 1);
    }
  }
  for (const BrowserKey &entry : browser_keys) {
    if (c == entry.code) {
      return entry.key;
    }
  }
  return GHOST_kKeyUnknown;
}
