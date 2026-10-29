/* Blender's uiLayout lays out every panel, header, menu and popup, and each finished block leaves the module as one
 * layout tree (JSON) that the browser draws (src/editors/interface/layout-view.js): layouts with their alignment, scale
 * and state, and buttons by kind with their RNA property or operator and its properties, text, icon and size in UI
 * units; no coordinates. A block's layouts are recorded when Blender resolves them (block_layout_resolve, linked with
 * --wrap), as it frees them then; its buttons are written once the block ends. Buttons stay valid until the next
 * draw of what holds them, and JS presses them by their address. */
#include <map>
#include <set>
#include <vector>
#include <sstream>
#include <string>

#include "BKE_context.hh"
#include "BKE_idprop.hh"
#include "BKE_modifier.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
#include "BLI_rect.h"
#include "BLI_string.h"
#include "DNA_modifier_types.h"
#include "DNA_object_types.h"
#include "DNA_screen_types.h"
#include "ED_screen.hh"
#include "MEM_guardedalloc.h"
#include "RNA_access.hh"
#include "UI_interface_c.hh"
#include "UI_interface_layout.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include "interface_intern.hh"
#include "rna-runtime.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern "C" const char *ui_icon_name(int icon);

namespace blender::ui {

/* What interface_layout.cc's ButtonItem and LayoutRoot hold (it defines the structs privately). */
struct RecordedItem : public Item {
  Button *but;
};
struct RecordedRoot {
  RecordedRoot *next, *prev;
  LayoutType type;
  wm::OpCallContext opcontext;
  int emw, emh;
  int padding;
  const uiStyle *style;
  Block *block;
  Layout *layout;
};

/* interface_layout.cc's ItemType, by value. */
static const char *const LAYOUT_KINDS[] = {"button", "row", "header", "body", "column", "column_flow", "row_flow", "grid_flow",
                                           "box", "absolute", "split", "overlap", "radial", "root"};
static const char *const ALIGNMENTS[] = {"EXPAND", "LEFT", "CENTER", "RIGHT"};
static const char *const EMBOSS[] = {"NORMAL", "NONE", "PULLDOWN", "RADIAL", "NONE_OR_STATUS", "UNDEFINED"};

/* A layout as it was when resolved, or a button. */
struct Node {
  int kind = 0;
  Button *but = nullptr;
  bool align = false, active = true, enabled = true, alert = false;
  LayoutAlign alignment = LayoutAlign::Expand;
  EmbossType emboss = EmbossType::Undefined;
  float scale[2] = {1.0f, 1.0f}, units[2] = {0.0f, 0.0f};
  std::vector<Node> children;
};

/* A resolved root layout of a block: a panel's header, preset or body, a header region's row, a menu's column. */
struct Root {
  LayoutType type;
  Node node;
};
static std::map<const Block *, Vector<Root>> recorded;

static Node record(const Item *item)
{
  Node node;
  node.kind = int(item->type());
  if (node.kind == 0) {
    node.but = static_cast<const RecordedItem *>(item)->but;
    return node;
  }
  const Layout &layout = *static_cast<const Layout *>(item);
  node.align = layout.align();
  node.active = layout.active();
  node.enabled = layout.enabled();
  node.alert = layout.red_alert();
  node.alignment = layout.alignment();
  node.emboss = layout.emboss();
  node.scale[0] = layout.scale_x() ? layout.scale_x() : 1.0f;
  node.scale[1] = layout.scale_y() ? layout.scale_y() : 1.0f;
  node.units[0] = layout.ui_units_x();
  node.units[1] = layout.ui_units_y();
  for (const Item *child : layout.items()) {
    node.children.push_back(record(child));
  }
  return node;
}

}  // namespace blender::ui

using namespace blender;
using namespace blender::ui;

#define RESOLVE _ZN7blender2ui20block_layout_resolveEPNS0_5BlockE
#define WRAP_(prefix, name) prefix##name
#define WRAP(prefix, name) WRAP_(prefix, name)
extern "C" int2 WRAP(__real_, RESOLVE)(Block *block);
/* port-override: records the block's layouts before Blender resolves and frees them. */
extern "C" int2 WRAP(__wrap_, RESOLVE)(Block *block)
{
  for (Link *link = static_cast<Link *>(block->layouts.first); link; link = link->next) {
    const RecordedRoot &root = *reinterpret_cast<RecordedRoot *>(link);
    recorded[block].append({root.type, record(root.layout)});
  }
  return WRAP(__real_, RESOLVE)(block);
}

namespace blender::ui {

/* JSON. */

static void quote(std::ostringstream &out, StringRef text)
{
  out << '"';
  for (const char c : text) {
    if (c == '"' || c == '\\') {
      out << '\\' << c;
    }
    else if (uchar(c) < 0x20) {
      out << "\\u00" << "0123456789abcdef"[c >> 4] << "0123456789abcdef"[c & 15];
    }
    else {
      out << c;
    }
  }
  out << '"';
}
static void key(std::ostringstream &out, const char *name) { out << ",\"" << name << "\":"; }
static void pointer_json(std::ostringstream &out, const PointerRNA &ptr)
{
  out << '[' << uintptr_t(ptr.type) << ',' << uintptr_t(ptr.owner_id) << ',' << uintptr_t(ptr.data) << ']';
}
static void rna_json(std::ostringstream &out, const char *name, const PointerRNA &ptr, PropertyRNA *prop, int index)
{
  key(out, name);
  out << "{\"pointer\":";
  pointer_json(out, ptr);
  out << ",\"owner\":";
  quote(out, ptr.type ? RNA_struct_identifier(ptr.type) : "");
  out << ",\"prop\":";
  quote(out, RNA_property_identifier(prop));
  out << ",\"index\":" << index << '}';
}

static const char *button_type_name(ButtonType type)
{
  switch (type) {
#define TYPE(name, text) \
  case ButtonType::name: \
    return text;
    TYPE(But, "BUT") TYPE(Row, "ROW") TYPE(Text, "TEXT") TYPE(TextBox, "TEXTBOX") TYPE(Menu, "MENU")
    TYPE(ButMenu, "BUTMENU") TYPE(Num, "NUM") TYPE(NumSlider, "NUMSLIDER") TYPE(Toggle, "TOGGLE")
    TYPE(ToggleN, "TOGGLE_N") TYPE(IconToggle, "ICON_TOGGLE") TYPE(IconToggleN, "ICON_TOGGLE_N")
    TYPE(ButToggle, "BUT_TOGGLE") TYPE(Checkbox, "CHECKBOX") TYPE(CheckboxN, "CHECKBOX_N") TYPE(Color, "COLOR")
    TYPE(Tab, "TAB") TYPE(Popover, "POPOVER") TYPE(Scroll, "SCROLL") TYPE(Block, "BLOCK") TYPE(Label, "LABEL")
    TYPE(KeyEvent, "KEYEVENT") TYPE(HsvCube, "HSVCUBE") TYPE(Pulldown, "PULLDOWN") TYPE(Roundbox, "ROUNDBOX")
    TYPE(ColorBand, "COLORBAND") TYPE(Unitvec, "UNITVEC") TYPE(Curve, "CURVE") TYPE(CurveProfile, "CURVEPROFILE")
    TYPE(ListBox, "LISTBOX") TYPE(ListRow, "LISTROW") TYPE(HsvCircle, "HSVCIRCLE") TYPE(TrackPreview, "TRACKPREVIEW")
    TYPE(SearchMenu, "SEARCH_MENU") TYPE(Extra, "EXTRA") TYPE(PreviewTile, "PREVIEW_TILE") TYPE(HotkeyEvent, "HOTKEY_EVENT")
    TYPE(Image, "IMAGE") TYPE(Histogram, "HISTOGRAM") TYPE(Waveform, "WAVEFORM") TYPE(Vectorscope, "VECTORSCOPE")
    TYPE(Progress, "PROGRESS") TYPE(NodeSocket, "NODESOCKET") TYPE(Sepr, "SEPR") TYPE(SeprLine, "SEPR_LINE")
    TYPE(SeprSpacer, "SEPR_SPACER") TYPE(Grip, "GRIP") TYPE(Decorator, "DECORATOR") TYPE(ViewItem, "VIEW_ITEM")
#undef TYPE
  }
  return "BUT";
}

static bool is_toggle(const Button *but)
{
  return ELEM(but->type, ButtonType::Toggle, ButtonType::ToggleN, ButtonType::IconToggle, ButtonType::IconToggleN,
              ButtonType::ButToggle, ButtonType::Checkbox, ButtonType::CheckboxN);
}

/* A button: its kind, address, text (its label, and what it shows when that differs: a number's value with its unit,
 * an enum's item), icon, size, state, and what it edits or runs. */
static void button_json(std::ostringstream &out, Button *but)
{
  if (!but->block->endblock) {
    button_update(but);
  }
  out << "{\"kind\":\"button\",\"type\":\"" << button_type_name(but->type) << "\",\"id\":" << uintptr_t(but);
  if (!but->str.empty()) {
    key(out, "text");
    quote(out, but->str);
  }
  if (but->drawstr != but->str) {
    key(out, "display");
    quote(out, but->drawstr);
  }
  if (const int icon = button_icon(but)) {
    key(out, "icon");
    quote(out, ui_icon_name(icon));
  }
  if (!but->tip.is_empty()) {
    key(out, "tip");
    quote(out, but->tip);
  }
  char size[64];
  SNPRINTF(size, ",\"w\":%.3g,\"h\":%.3g", BLI_rctf_size_x(&but->rect) / UI_UNIT_X, BLI_rctf_size_y(&but->rect) / UI_UNIT_Y);
  out << size;
  if (but->emboss != EmbossType::Emboss) {
    out << ",\"emboss\":\"" << EMBOSS[int(but->emboss)] << '"';
  }
  for (const auto &[name, set] : {std::pair{"disabled", bool(but->flag & BUT_DISABLED)}, {"inactive", bool(but->flag & BUT_INACTIVE)},
                                  {"selected", bool(but->flag & UI_SELECT)}, {"alert", bool(but->flag & BUT_REDALERT)},
                                  {"animated", bool(but->flag & BUT_ANIMATED)}, {"keyed", bool(but->flag & BUT_ANIMATED_KEY)},
                                  {"driven", bool(but->flag & BUT_DRIVEN)}, {"submenu", bool(but->flag & BUT_ICON_SUBMENU)},
                                  {"text_left", bool(but->drawflag & BUT_TEXT_LEFT)}, {"text_right", bool(but->drawflag & BUT_TEXT_RIGHT)},
                                  {"icon_left", bool(but->drawflag & BUT_ICON_LEFT)}, {"invert", bool(but->drawflag & BUT_CHECKBOX_INVERT)},
                                  {"active_default", bool(but->flag & BUT_ACTIVE_DEFAULT)}})
  {
    if (set) {
      out << ",\"" << name << "\":true";
    }
  }
  if (const int align = but->drawflag & BUT_ALIGN) {
    out << ",\"aligned\":\"" << (align & BUT_ALIGN_TOP ? "T" : "") << (align & BUT_ALIGN_DOWN ? "B" : "")
        << (align & BUT_ALIGN_LEFT ? "L" : "") << (align & BUT_ALIGN_RIGHT ? "R" : "") << '"';
  }
  if (but->rnaprop) {
    rna_json(out, "rna", but->rnapoin, but->rnaprop, but->rnaindex);
    if (ELEM(but->type, ButtonType::Row, ButtonType::ListRow)) {
      out << ",\"value\":" << but->hardmax;
    }
  }
  else if (ELEM(but->type, ButtonType::Text, ButtonType::SearchMenu) && but->poin) {
    key(out, "value");
    quote(out, but->poin);
  }
  else if (but->poin && !but->menu_create_func && !but->block_create_func) {
    out << ",\"value\":" << button_value_get(but);
  }
  if (ELEM(but->type, ButtonType::Num, ButtonType::NumSlider)) {
    char range[160];
    SNPRINTF(range, ",\"min\":%.9g,\"max\":%.9g,\"soft_min\":%.9g,\"soft_max\":%.9g", but->hardmin, but->hardmax, but->softmin, but->softmax);
    out << range;
  }
  if (but->type == ButtonType::SearchMenu) {
    const ButtonSearch *search = static_cast<const ButtonSearch *>(but);
    if (search->rnasearchprop) {
      rna_json(out, "search", search->rnasearchpoin, search->rnasearchprop, -1);
    }
  }
  if (but->type == ButtonType::Decorator) {
    const ButtonDecorator *decorator = static_cast<const ButtonDecorator *>(but);
    if (decorator->decorated_rnaprop) {
      rna_json(out, "decorates", decorator->decorated_rnapoin, decorator->decorated_rnaprop, decorator->decorated_rnaindex);
    }
  }
  if (but->optype) {
    char idname[OP_MAX_TYPENAME];
    WM_operator_py_idname(idname, but->optype->idname);
    key(out, "operator");
    quote(out, idname);
    if (but->opptr) {
      key(out, "properties");
      out << operator_values_json(but->opptr);
    }
    out << ",\"context\":" << int(but->opcontext);
  }
  if (MenuType *mt = button_menutype_get(but)) {
    key(out, "menu");
    quote(out, mt->idname);
  }
  else if (PanelType *pt = button_paneltype_get(but)) {
    key(out, "popover");
    quote(out, pt->idname);
  }
  if (but->menu_create_func || but->block_create_func) {
    out << ",\"opens\":true";
  }
  out << '}';
}

/* A layout and what it holds; its size in UI units is its buttons' extent. */
static rctf node_json(std::ostringstream &out, const Node &node)
{
  if (node.kind == 0) {
    button_json(out, node.but);
    return node.but->rect;
  }
  std::ostringstream children;
  rctf rect;
  BLI_rctf_init_minmax(&rect);
  for (const size_t i : IndexRange(node.children.size())) {
    children << (i ? "," : "");
    const rctf child = node_json(children, node.children[i]);
    if (BLI_rctf_is_valid(&child)) {
      BLI_rctf_union(&rect, &child);
    }
  }
  out << "{\"kind\":\"" << LAYOUT_KINDS[node.kind] << '"';
  if (node.align) {
    out << ",\"align\":true";
  }
  for (const auto &[name, value] : {std::pair{"active", node.active}, {"enabled", node.enabled}}) {
    if (!value) {
      out << ",\"" << name << "\":false";
    }
  }
  if (node.alert) {
    out << ",\"alert\":true";
  }
  if (node.alignment != LayoutAlign::Expand) {
    out << ",\"alignment\":\"" << ALIGNMENTS[int(node.alignment)] << '"';
  }
  if (!ELEM(node.emboss, EmbossType::Undefined, EmbossType::Emboss)) {
    out << ",\"emboss\":\"" << EMBOSS[int(node.emboss)] << '"';
  }
  char numbers[128] = "";
  if (node.scale[0] != 1.0f || node.scale[1] != 1.0f) {
    SNPRINTF(numbers, ",\"scale_x\":%.3g,\"scale_y\":%.3g", node.scale[0], node.scale[1]);
    out << numbers;
  }
  if (node.units[0] || node.units[1]) {
    SNPRINTF(numbers, ",\"units_x\":%.3g,\"units_y\":%.3g", node.units[0], node.units[1]);
    out << numbers;
  }
  if (BLI_rctf_is_valid(&rect)) {
    SNPRINTF(numbers, ",\"w\":%.3g,\"h\":%.3g", BLI_rctf_size_x(&rect) / UI_UNIT_X, BLI_rctf_size_y(&rect) / UI_UNIT_Y);
    out << numbers;
  }
  out << ",\"children\":[" << children.str() << "]}";
  return rect;
}

static const char *root_kind(LayoutType type)
{
  switch (type) {
    case LayoutType::Header:
      return "row";
    case LayoutType::Menu:
      return "menu";
    default:
      return "column";
  }
}

/* A block's roots, as one tree per root; forgets them. */
static void block_roots_json(std::ostringstream &out, const Block *block)
{
  auto found = recorded.find(block);
  if (found == recorded.end()) {
    return;
  }
  for (const int64_t i : found->second.index_range()) {
    const Root &root = found->second[i];
    out << (i ? "," : "");
    std::ostringstream node;
    node_json(node, root.node);
    /* A root is a column (a header's a row): its kind is the root type's. */
    std::string json = node.str();
    const std::string kind = std::string("\"kind\":\"") + root_kind(root.type) + '"';
    json.replace(json.find("\"kind\":\"root\""), strlen("\"kind\":\"root\""), kind);
    out << json;
  }
  recorded.erase(found);
}

/* A block a region draws with its layout (region-draw.cc): its roots' trees as a JSON array, and their extent, or an
 * empty string for a block without a layout. */
std::string block_layout_json(const Block *block, rctf *r_rect)
{
  BLI_rctf_init_minmax(r_rect);
  auto found = recorded.find(block);
  if (found == recorded.end()) {
    return "";
  }
  std::ostringstream out;
  out << '[';
  for (const int64_t i : found->second.index_range()) {
    out << (i ? "," : "");
    const rctf rect = node_json(out, found->second[i].node);
    if (BLI_rctf_is_valid(&rect)) {
      BLI_rctf_union(r_rect, &rect);
    }
  }
  recorded.erase(found);
  return out.str() + ']';
}

static std::string block_json(const Block *block, const char *kind)
{
  std::ostringstream out;
  out << "{\"kind\":\"" << kind << "\",\"name\":";
  quote(out, block->name);
  out << ",\"children\":[";
  block_roots_json(out, block);
  out << "]}";
  return out.str();
}

/* Blocks made outside a region (menus, popups, recorded panels), kept until the next of their kind. */
static Vector<Block *> &owned(int kind)
{
  static Vector<Block *> lists[3];
  return lists[kind];
}
enum { OWNED_MENU = 0, OWNED_PANELS = 1, OWNED_POPUP = 2 };
static void owned_free(const bContext *C, int kind)
{
  for (Block *block : owned(kind)) {
    recorded.erase(block);
    block_free(C, block);
  }
  owned(kind).clear();
}

static Block *block_new(const bContext *C, const char *name, EmbossType emboss, int kind)
{
  Block *block = block_begin(C, C ? CTX_data_scene(C) : nullptr, C ? CTX_wm_window(C) : nullptr, nullptr, name, emboss);
  owned(kind).append(block);
  return block;
}

/* Panels. */

/* The context region, about to be laid out again: its last blocks go. It is shown (port-override: Bylonder's window
 * manager lays out the regions it draws, so it marks them visible, as ED_region_visibility_change_update would). */
static ARegion *region_drawn(bContext *C)
{
  ARegion *region = CTX_wm_region(C);
  blocklist_free(C, region);
  recorded.clear();
  region->runtime->visible = true;
  return region;
}

/* A panel and its sub-panels as a region drew them: its header, preset and body roots in the order drawn, then its
 * open sub-panels. */
static void panel_json(std::ostringstream &out, Panel *panel)
{
  PanelType *pt = panel->type;
  out << "{\"kind\":\"panel\",\"id\":";
  quote(out, pt->idname);
  key(out, "text");
  quote(out, panel->drawname ? panel->drawname : pt->label);
  out << ",\"closed\":" << (panel_is_closed(panel) ? "true" : "false");
  if (pt->flag & PANEL_TYPE_NO_HEADER) {
    out << ",\"hide_header\":true";
  }
  if (pt->category[0]) {
    key(out, "category");
    quote(out, pt->category);
  }
  /* The block's roots: a preset and a header when the type draws them, then the body when open. */
  out << ",\"parts\":[";
  const bool header = pt->draw_header && !(pt->flag & PANEL_TYPE_NO_HEADER);
  const bool preset = pt->draw_header_preset && !(pt->flag & PANEL_TYPE_NO_HEADER);
  if (panel->runtime->block) {
    Vector<std::string> parts;
    if (preset) {
      parts.append("preset");
    }
    if (header) {
      parts.append("header");
    }
    parts.append("body");
    auto found = recorded.find(panel->runtime->block);
    if (found != recorded.end()) {
      for (const int64_t i : found->second.index_range()) {
        out << (i ? "," : "") << "{\"part\":\"" << (i < parts.size() ? parts[i] : "body") << "\",\"layout\":";
        node_json(out, found->second[i].node);
        out << '}';
      }
      recorded.erase(found);
    }
  }
  /* Layout panels (layout.panel), in the order their headers come: what opens each. */
  out << "],\"layout_panels\":[";
  for (const int64_t i : panel->runtime->layout_panels.headers.index_range()) {
    const LayoutPanelHeader &header = panel->runtime->layout_panels.headers[i];
    PointerRNA owner = header.open_owner_ptr;
    out << (i ? "," : "") << "{\"pointer\":";
    pointer_json(out, owner);
    out << ",\"prop\":";
    quote(out, header.open_prop_name);
    out << ",\"open\":" << (RNA_boolean_get(&owner, header.open_prop_name.c_str()) ? "true" : "false") << '}';
  }
  out << "],\"children\":[";
  bool first = true;
  for (Panel &child : panel->children) {
    if (child.type && panel_is_active(&child) && child.runtime->block) {
      out << (first ? "" : ",");
      panel_json(out, &child);
      first = false;
    }
  }
  out << "]}";
}

/* The context region's panels as Blender's region lays them out (its type's layout: buttons_main_region_layout for
 * the Properties editor, ED_region_panels_layout for a sidebar), in their order, with the region's categories (a
 * sidebar's tabs) and the one shown: { category, categories, panels }. Blocks stay until the region's next layout. */
EXPORT(ui_region_panels) const char *ui_region_panels(bContext *C)
{
  static std::string json;
  ARegion *region = region_drawn(C);
  region->runtime->type->layout(C, region);
  Vector<Panel *> panels;
  for (Panel &panel : region->panels) {
    if (panel.type && panel_is_active(&panel) && panel.runtime->block) {
      panels.append(&panel);
    }
  }
  std::stable_sort(panels.begin(), panels.end(), [](Panel *a, Panel *b) { return a->sortorder < b->sortorder; });
  std::ostringstream out;
  out << "{\"category\":";
  quote(out, region->runtime->category ? region->runtime->category : "");
  out << ",\"categories\":[";
  bool first = true;
  for (const PanelCategoryDyn &category : region->runtime->panels_category) {
    out << (first ? "" : ",");
    quote(out, category.idname);
    first = false;
  }
  out << "],\"panels\":[";
  for (const int64_t i : panels.index_range()) {
    out << (i ? "," : "");
    panel_json(out, panels[i]);
  }
  out << "]}";
  json = out.str();
  return json.c_str();
}

/* Shows a category (a sidebar's tab) of the context region, as clicking its tab does. */
EXPORT(ui_category_set) void ui_category_set(bContext *C, const char *idname)
{
  panel_category_active_set(CTX_wm_region(C), idname);
}

/* Opens or closes a panel of the context region (as clicking its header does), by its type's idname. */
EXPORT(ui_panel_closed_set) void ui_panel_closed_set(bContext *C, const char *idname, bool closed)
{
  std::function<Panel *(ListBaseT<Panel> &)> find = [&](ListBaseT<Panel> &panels) -> Panel * {
    for (Panel &panel : panels) {
      if (panel.type && STREQ(panel.type->idname, idname)) {
        return &panel;
      }
      if (Panel *child = find(panel.children)) {
        return child;
      }
    }
    return nullptr;
  };
  if (Panel *panel = find(CTX_wm_region(C)->panels)) {
    SET_FLAG_FROM_TEST(panel->flag, closed, PNL_CLOSED);
  }
}

/* The context region's header as Blender lays it out (ED_region_header_layout: each header type's draw), as a JSON
 * array of rows. */
EXPORT(ui_region_header) const char *ui_region_header(bContext *C)
{
  static std::string json;
  ARegion *region = region_drawn(C);
  ED_region_header_layout(C, region);
  std::ostringstream out;
  out << '[';
  bool first = true;
  for (Block &block : region->runtime->uiblocks) {
    out << (first ? "" : ",");
    out << block_json(&block, "header");
    first = false;
  }
  out << ']';
  json = out.str();
  return json.c_str();
}

/* Menus and popovers. */

static std::string menu_json(Block *block)
{
  block_end(nullptr, block);
  return block_json(block, "menu");
}

/* A layout a menu draws into (as popup_menu_begin's), in a block of its own. */
static Layout &menu_layout(const bContext *C, Block *block)
{
  return block_layout(block, LayoutDirection::Vertical, LayoutType::Menu, 0, 0, 200, 0, UI_MENU_PADDING, style_get_dpi());
}

/* A menu type drawn as its menu shows it (menutype_draw: its poll, draw and the draw functions added to it), or an
 * empty string for a menu type Blender does not have. The menus before it go. */
EXPORT(ui_menu) const char *ui_menu(bContext *C, const char *name)
{
  static std::string json;
  MenuType *mt = WM_menutype_find(name, false);
  if (!mt) {
    return "";
  }
  owned_free(C, OWNED_MENU);
  Block *block = block_new(C, name, EmbossType::Pulldown, OWNED_MENU);
  menutype_draw(C, mt, &menu_layout(C, block));
  block_layout_resolve(block);
  json = menu_json(block);
  return json.c_str();
}
EXPORT(menu_type_label) const char *menu_type_label(const char *name)
{
  MenuType *mt = WM_menutype_find(name, false);
  return mt ? mt->label : "";
}

/* What a button opens (a menu, a popover, an enum's items, a block), drawn by the button's own function as Blender's
 * popup does (popup_block_create's create functions), as a menu tree. Menus opened before from the same menu stay,
 * as sub-menus stay open. */
EXPORT(ui_button_menu) const char *ui_button_menu(bContext *C, Button *but)
{
  static std::string json;
  if (PanelType *pt = button_paneltype_get(but)) {
    Block *block = block_new(C, pt->idname, EmbossType::Emboss, OWNED_MENU);
    Layout &layout = block_layout(block, LayoutDirection::Vertical, LayoutType::Panel, 0, 0, UI_POPOVER_WIDTH_UNITS * UI_UNIT_X, 0,
                                  0, style_get_dpi());
    Panel panel = {};
    panel.type = pt;
    panel.layout = &layout;
    pt->draw(C, &panel);
    block_layout_resolve(block);
    json = menu_json(block);
  }
  else if (but->menu_create_func) {
    Block *block = block_new(C, but->str.c_str(), EmbossType::Pulldown, OWNED_MENU);
    but->menu_create_func(C, &menu_layout(C, block), but->poin);
    block_layout_resolve(block);
    json = menu_json(block);
  }
  else if (but->block_create_func) {
    Block *block = but->block_create_func(C, CTX_wm_region(C), but->poin ? static_cast<void *>(but->poin) : but->func_argN);
    owned(OWNED_MENU).append(block);
    if (block_layout_needs_resolving(block)) {
      block_layout_resolve(block);
    }
    json = menu_json(block);
  }
  else {
    json = "";
  }
  return json.c_str();
}

/* Presses a button as Blender applies one (interface_handlers.cc's apply_but and its functions after): a toggle flips
 * (or takes `value`, 0 or 1), a row button sets its value, then its functions, its block's and its RNA property's
 * update run. Operator buttons are run by JS by their operator. Returns the toggle's state after. */
static void button_applied(bContext *C, Button *but)
{
  if (but->func) {
    but->func(C, but->func_arg1, but->func_arg2);
  }
  if (but->apply_func) {
    but->apply_func(*C);
  }
  if (but->funcN) {
    but->funcN(C, but->func_argN, but->func_arg2);
  }
  if (but->block->func) {
    but->block->func(C, but->block->func_arg1, but->block->func_arg2);
  }
  if (but->block->handle_func) {
    but->block->handle_func(C, but->block->handle_func_arg, but->retval);
  }
  if (but->rnaprop) {
    RNA_property_update(C, &but->rnapoin, but->rnaprop);
  }
}
EXPORT(ui_button_press) int ui_button_press(bContext *C, Button *but, int value)
{
  if (is_toggle(but)) {
    const bool on = value < 0 ? button_value_get(but) == 0.0 : value != 0;
    button_value_set(but, on ? 1.0 : 0.0);
  }
  else if (ELEM(but->type, ButtonType::Row, ButtonType::ListRow)) {
    button_value_set(but, but->hardmax);
  }
  button_applied(C, but);
  button_update(but);
  return (but->flag & UI_SELECT) ? 1 : 0;
}
/* After JS set a property button's value through RNA: its functions, as after a press. */
EXPORT(ui_button_applied) void ui_button_applied(bContext *C, Button *but) { button_applied(C, but); }
/* A number or text button without RNA (a value of Blender's code, but->poin): set as the button sets it. */
EXPORT(ui_button_value_set) void ui_button_value_set(bContext *C, Button *but, double value)
{
  button_value_set(but, value);
  button_applied(C, but);
}
EXPORT(ui_button_text_set) void ui_button_text_set(bContext *C, Button *but, const char *text)
{
  const std::string old = but->poin ? but->poin : "";
  if (but->rnaprop || but->poin) {
    button_string_set(C, but, text);
  }
  if (but->type == ButtonType::Text) {
    ButtonText *text_but = static_cast<ButtonText *>(but);
    if (text_but->rename_func) {
      text_but->rename_func(*C, old);
    }
  }
  button_applied(C, but);
}

/* Popups. */

void popup_layout_open(const std::string &title, const std::string &layout);

/* port-override: a popup menu Blender's code builds (popup_menu_begin to popup_menu_end) is drawn by Bylonder's window
 * manager: its block is laid out by Blender and handed over as the invoke's popup. */
struct PopupMenu {
  Block *block;
  Layout *layout;
  std::string title;
};
PopupMenu *popup_menu_begin_ex(bContext *C, const char *title, const char *block_name, int /*icon*/)
{
  owned_free(C, OWNED_POPUP);
  Block *block = block_new(C, block_name, EmbossType::Pulldown, OWNED_POPUP);
  return MEM_new<PopupMenu>(__func__, block, &menu_layout(C, block), title);
}
PopupMenu *popup_menu_begin(bContext *C, const char *title, int icon) { return popup_menu_begin_ex(C, title, __func__, icon); }
Layout *popup_menu_layout(PopupMenu *pup) { return pup->layout; }
void popup_menu_end(bContext * /*C*/, PopupMenu *pup)
{
  block_layout_resolve(pup->block);
  popup_layout_open(pup->title, menu_json(pup->block));
  MEM_delete(pup);
}
bool popup_menu_end_or_cancel(bContext *C, PopupMenu *pup)
{
  if (pup->layout->items().is_empty()) {
    MEM_delete(pup);
    return false;
  }
  popup_menu_end(C, pup);
  return true;
}

/* An operator's properties as its dialog draws them (template_operator_property_buts, as its type's ui or its
 * visible properties), on the operator's own properties, which JS edits in place: a menu tree. */
std::string operator_props_layout(bContext *C, wmOperator *op)
{
  owned_free(C, OWNED_POPUP);
  Block *block = block_new(C, op->type->idname, EmbossType::Emboss, OWNED_POPUP);
  Layout &layout = block_layout(block, LayoutDirection::Vertical, LayoutType::Panel, 0, 0, 15 * UI_UNIT_X, 0, 0, style_get_dpi());
  layout.use_property_split_set(true);
  layout.use_property_decorate_set(false);
  uiTemplateOperatorPropertyButs(C, &layout, op, BUT_LABEL_ALIGN_NONE, 0);
  block_layout_resolve(block);
  return menu_json(block);
}

}  // namespace blender::ui
