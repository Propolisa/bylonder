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
#include "BKE_node.hh"
#include "BKE_node_runtime.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
#include "BLI_rect.h"
#include "BLI_string.h"
#include "DNA_modifier_types.h"
#include "DNA_node_types.h"
#include "DNA_object_types.h"
#include "DNA_screen_types.h"
#include "ED_screen.hh"
#include "MEM_guardedalloc.h"
#include "RNA_enum_types.hh"
#include "RNA_access.hh"
#include "RNA_prototypes.hh"
#include "UI_abstract_view.hh"
#include "UI_grid_view.hh"
#include "UI_interface_c.hh"
#include "UI_interface_layout.hh"
#include "WM_api.hh"
#include "WM_types.hh"

#include "interface_intern.hh"
#include "regions/interface_regions_intern.hh"
#include "rna-runtime.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

extern "C" const char *ui_icon_name(int icon);

namespace blender {
void buttons_context_compute(const bContext *C, SpaceProperties *sbuts);
}

namespace blender::ui {

/* A popup menu's laid out block, as the running invoke's popup (anim-api.cc). */
void popup_layout_open(const std::string &title, const std::string &layout);
}  // namespace blender::ui
namespace blender {
extern void (*operator_call_handover)(wmOperatorType *ot, PointerRNA *properties);
std::string operator_values_json(PointerRNA *ptr);
}  // namespace blender
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
  out << ",\"index\":" << index;
  /* A number's type, subtype, unit and precision as the property is defined for this data (a node group input's are
   * its socket's), which the page shows the value by. */
  const PropertyType type = RNA_property_type(prop);
  if (ELEM(type, PROP_INT, PROP_FLOAT)) {
    const char *subtype = "", *unit = "";
    RNA_enum_identifier(rna_enum_property_subtype_items, RNA_property_subtype(prop), &subtype);
    RNA_enum_identifier(rna_enum_property_unit_items, RNA_SUBTYPE_UNIT(RNA_property_subtype(prop)), &unit);
    out << ",\"type\":\"" << (type == PROP_INT ? 'I' : 'F') << "\",\"subtype\":";
    quote(out, subtype);
    out << ",\"unit\":";
    quote(out, unit);
    if (type == PROP_FLOAT) {
      float min, max, step, precision;
      RNA_property_float_ui_range(const_cast<PointerRNA *>(&ptr), prop, &min, &max, &step, &precision);
      out << ",\"precision\":" << int(precision);
    }
  }
  out << '}';
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
  /* A grid view's preview item's name, which its tile shows (or its tooltip, where the tile hides it). */
  if (but->type == ButtonType::ViewItem) {
    if (const auto *item = dynamic_cast<const PreviewGridItem *>(static_cast<ButtonViewItem *>(but)->view_item)) {
      key(out, "label");
      quote(out, item->label);
    }
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
                                  {"active_default", bool(but->flag & BUT_ACTIVE_DEFAULT)},
                                  {"renaming", but->type == ButtonType::Text && !but->rnaprop && bool(static_cast<const ButtonText *>(but)->rename_func)}})
  {
    if (set) {
      out << ",\"" << name << "\":true";
    }
  }
  if (const int align = but->drawflag & BUT_ALIGN) {
    out << ",\"aligned\":\"" << (align & BUT_ALIGN_TOP ? "T" : "") << (align & BUT_ALIGN_DOWN ? "B" : "")
        << (align & BUT_ALIGN_LEFT ? "L" : "") << (align & BUT_ALIGN_RIGHT ? "R" : "") << '"';
  }
  /* A node socket's link menu (uiTemplateNodeLink) shows the socket in its color (widget_draw_node_link_socket). */
  if (but->flag & BUT_NODE_LINK) {
    char color[32];
    SNPRINTF(color, ",\"node_link\":\"#%02x%02x%02x%02x\"", but->col[0], but->col[1], but->col[2], but->col[3]);
    out << color;
  }
  if (but->rnaprop) {
    rna_json(out, "rna", but->rnapoin, but->rnaprop, RNA_property_array_check(but->rnaprop) ? but->rnaindex : -1);
    if (ELEM(but->type, ButtonType::Row, ButtonType::ListRow, ButtonType::Tab)) {
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

/* A block's roots, as one tree per root, or its buttons as a column where it has no layout (a search popup's, which
 * template_common_search_menu places itself); forgets them. */
static void block_roots_json(std::ostringstream &out, const Block *block)
{
  auto found = recorded.find(block);
  if (found == recorded.end()) {
    out << "{\"kind\":\"column\",\"children\":[";
    for (const int64_t i : block->buttons_ptrs.index_range()) {
      out << (i ? "," : "");
      button_json(out, block->buttons_ptrs[i].get());
    }
    out << "]}";
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

/* Menus and popups, each in a temporary region of the window's screen as Blender's popups are (popup_block_create's
 * region_temp_add, whose UI handler frees its blocks with it), never in the editor region whose context made them,
 * which frees its own blocks when it is drawn again. A menu is kept by its root, the menu it was opened from: opening
 * a menu frees only its own last regions and their sub-menus, so a menu still open elsewhere (the topbar's, while a
 * header draws its own) keeps its buttons. The operator popup (popup_menu_begin, a properties dialog) is one at a time. */
struct Popup {
  bool is_menu;
  std::string root;
  ARegion *region;
  /* An enum menu's items return their value through it to the button that opened it. */
  std::unique_ptr<PopupBlockHandle> handle;
};
static Vector<std::unique_ptr<Popup>> &popups()
{
  static Vector<std::unique_ptr<Popup>> list;
  return list;
}
static bScreen *window_screen(const bContext *C) { return WM_window_get_active_screen(CTX_wm_window(C)); }

static void popups_free(bContext *C, FunctionRef<bool(const Popup &)> which)
{
  popups().remove_if([&](const std::unique_ptr<Popup> &popup) {
    if (!which(*popup)) {
      return false;
    }
    for (const Block &block : popup->region->runtime->uiblocks) {
      recorded.erase(&block);
    }
    region_temp_remove(C, window_screen(C), popup->region);
    return true;
  });
}
static void menu_free(bContext *C, const StringRef root)
{
  popups_free(C, [&](const Popup &popup) { return popup.is_menu && popup.root == root; });
}
static void operator_popup_free(bContext *C)
{
  popups_free(C, [](const Popup &popup) { return !popup.is_menu; });
}

static Popup &popup_new(const bContext *C, const bool is_menu, const StringRef root)
{
  ARegion *region = region_temp_add(window_screen(C));
  region_handlers_add(&region->runtime->handlers);
  popups().append(std::make_unique<Popup>(Popup{is_menu, root, region, nullptr}));
  return *popups().last();
}
static Block *popup_block_new(const bContext *C, const char *name, EmbossType emboss, const bool is_menu, const StringRef root)
{
  return block_begin(C, CTX_data_scene(C), CTX_wm_window(C), popup_new(C, is_menu, root).region, name, emboss);
}
static Block *menu_block_new(const bContext *C, const char *name, EmbossType emboss, const StringRef root)
{
  return popup_block_new(C, name, emboss, true, root);
}
static Popup *popup_of(const Block *block)
{
  for (std::unique_ptr<Popup> &popup : popups()) {
    if (BLI_findindex(&popup->region->runtime->uiblocks, block) != -1) {
      return popup.get();
    }
  }
  return nullptr;
}
static std::string menu_root(const Block *block)
{
  const Popup *popup = popup_of(block);
  return popup && popup->is_menu ? popup->root : block->name;
}

/* Panels. */

/* The context region, about to be laid out again. Its last blocks stay until the new ones replace them (block_region_set),
 * as when Blender redraws a region, so what the new blocks take over from them carries (a view's renaming,
 * AbstractView::update_from_old); layout_end frees those not replaced. It is shown (port-override: Bylonder's window
 * manager lays out the regions it draws, so it marks them visible, as ED_region_visibility_change_update would). */
static ARegion *region_drawn(bContext *C)
{
  ARegion *region = CTX_wm_region(C);
  recorded.clear();
  region->runtime->visible = true;
  return region;
}
/* The region laid out: its blocks the layout did not make again go, as after Blender's region draw. */
static void layout_end(bContext *C, ARegion *region) { blocklist_free_inactive(C, region); }

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
/* A region without a size yet (one a view just made, before the page sized it) is not laid out, as Blender draws no
 * such region: its layout would divide by its size. */
static bool region_sized(const bContext *C)
{
  const ARegion *region = CTX_wm_region(C);
  return region && region->winx > 0 && region->winy > 0;
}

EXPORT(ui_region_panels) const char *ui_region_panels(bContext *C)
{
  static std::string json;
  if (!region_sized(C)) {
    return "{\"category\":\"\",\"categories\":[],\"panels\":[]}";
  }
  ARegion *region = region_drawn(C);
  if (region->runtime->type->layout) {
    region->runtime->type->layout(C, region);
  }
  else {
    /* A region type without a layout callback lays its panels out in its draw, as this
     * (buttons_navigation_bar_region_draw, graph_buttons_region_draw). */
    if (region->regiontype == RGN_TYPE_NAV_BAR && CTX_wm_space_properties(C)) {
      buttons_context_compute(C, CTX_wm_space_properties(C));
      for (PanelType &pt : region->runtime->type->paneltypes) {
        pt.flag |= PANEL_TYPE_LAYOUT_VERT_BAR;
      }
    }
    ED_region_panels_layout(C, region);
  }
  layout_end(C, region);
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

/* A laid out region's blocks as a JSON array. */
static const char *region_blocks_json(bContext *C, ARegion *region, const char *kind)
{
  static std::string json;
  layout_end(C, region);
  std::ostringstream out;
  out << '[';
  bool first = true;
  for (Block &block : region->runtime->uiblocks) {
    out << (first ? "" : ",");
    out << block_json(&block, kind);
    first = false;
  }
  out << ']';
  json = out.str();
  return json.c_str();
}

/* The context region's header as Blender lays it out (ED_region_header_layout: each header type's draw), as a JSON
 * array of rows. */
EXPORT(ui_region_header) const char *ui_region_header(bContext *C)
{
  ARegion *region = region_drawn(C);
  ED_region_header_layout(C, region);
  return region_blocks_json(C, region, "header");
}

/* The context region laid out by its type (ED_region_do_layout: the asset shelf's grid of assets), as a JSON array of
 * its blocks. */
EXPORT(ui_region_layout) const char *ui_region_layout(bContext *C)
{
  if (!region_sized(C)) {
    return "[]";
  }
  ARegion *region = region_drawn(C);
  ED_region_do_layout(C, region);
  return region_blocks_json(C, region, "region");
}


/* Node bodies. */

/* A node's buttons as its editor lays them out (node_draw.cc node_update_basis_buttons: its type's draw_buttons, in
 * the node's width), or an empty string for a node that draws none. The page edits what they show through RNA, so
 * the block goes once written. */
EXPORT(ui_node_buttons) const char *ui_node_buttons(bContext *C, bNodeTree *ntree, bNode *node)
{
  static std::string json;
  if (!node->typeinfo->draw_buttons || !(node->flag & NODE_OPTIONS)) {
    return "";
  }
  PointerRNA nodeptr = RNA_pointer_create_discrete(&ntree->id, RNA_Node, node);
  Block *block = block_begin(C, CTX_data_scene(C), CTX_wm_window(C), nullptr, "node_buttons", EmbossType::Emboss);
  Layout &layout = block_layout(block, LayoutDirection::Vertical, LayoutType::Panel, 0, 0, node->width - U.widget_unit, 0, 0, style_get_dpi());
  if (node->is_muted()) {
    layout.active_set(false);
  }
  layout.context_ptr_set("node", &nodeptr);
  node->typeinfo->draw_buttons(layout, C, &nodeptr);
  block_align_end(block);
  block_layout_resolve(block);
  block_end(C, block);
  json = block_json(block, "node");
  recorded.erase(block);
  block_free(C, block);
  return json.c_str();
}

/* Menus and popovers. */

/* The block ended in the context it was made in, where its operator buttons poll. */
static std::string menu_json(const bContext *C, Block *block)
{
  block_end(C, block);
  return block_json(block, "menu");
}

/* A layout a menu draws into (as popup_menu_begin's), in a block of its own. */
static Layout &menu_layout(const bContext *C, Block *block)
{
  return block_layout(block, LayoutDirection::Vertical, LayoutType::Menu, 0, 0, 200, 0, UI_MENU_PADDING, style_get_dpi());
}

/* How the next menus are laid out: for a search, as menu search lays out each menu it lists
 * (interface_template_search_menu.cc: the context's is_menu_search, which menus that draw differently in a search
 * read), and as a popup (wm.call_menu), whose operators execute (ui_popup_menu_create_block). */
enum { MENU_SEARCH = 1 << 0, MENU_POPUP = 1 << 1 };
static int menu_mode = 0;
EXPORT(ui_menu_mode_set) void ui_menu_mode_set(int mode) { menu_mode = mode; }
static void menu_draw_context(bContext *C, FunctionRef<void()> draw)
{
  static const bContextStore search_store = [] {
    bContextStore store;
    store.entries.append({"is_menu_search", true});
    return store;
  }();
  const bContextStore *previous = CTX_store_get(C);
  if (menu_mode & MENU_SEARCH) {
    CTX_store_set(C, &search_store);
  }
  draw();
  CTX_store_set(C, previous);
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
  menu_free(C, name);
  Block *block = menu_block_new(C, name, EmbossType::Pulldown, name);
  Layout &layout = menu_layout(C, block);
  if (menu_mode & MENU_POPUP) {
    layout.operator_context_set(wm::OpCallContext::ExecRegionWin);
  }
  menu_draw_context(C, [&] { menutype_draw(C, mt, &layout); });
  block_layout_resolve(block);
  json = menu_json(C, block);
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
/* Whether a button JS names is still one of a live block's: the context region's, or any region of the window's screen,
 * its areas' or its menus' and popups'. A layout drawn again frees the buttons a page may still show, so a click on one
 * is dropped rather than read from freed memory. */
static bool button_live(const bContext *C, const Button *but)
{
  const auto in_region = [&](const ARegion &region) {
    for (const Block &block : region.runtime->uiblocks) {
      for (const std::unique_ptr<Button> &held : block.buttons_ptrs) {
        if (held.get() == but) {
          return true;
        }
      }
    }
    return false;
  };
  if (const ARegion *region = CTX_wm_region(C); region && in_region(*region)) {
    return true;
  }
  const bScreen *screen = window_screen(C);
  for (const ScrArea &area : screen->areabase) {
    for (const ARegion &region : area.regionbase) {
      if (in_region(region)) {
        return true;
      }
    }
  }
  for (const ARegion &region : screen->regionbase) {
    if (in_region(region)) {
      return true;
    }
  }
  return false;
}

EXPORT(ui_button_menu) const char *ui_button_menu(bContext *C, Button *but)
{
  if (!button_live(C, but)) {
    return "";
  }
  static std::string json;
  const std::string root = menu_root(but->block);
  if (PanelType *pt = button_paneltype_get(but)) {
    Block *block = menu_block_new(C, pt->idname, EmbossType::Emboss, root);
    Layout &layout = block_layout(block, LayoutDirection::Vertical, LayoutType::Panel, 0, 0, UI_POPOVER_WIDTH_UNITS * UI_UNIT_X, 0,
                                  0, style_get_dpi());
    Panel panel = {};
    panel.type = pt;
    panel.layout = &layout;
    if (but->context) {
      layout.context_copy(but->context);
    }
    menu_draw_context(C, [&] { pt->draw(C, &panel); });
    block_layout_resolve(block);
    json = menu_json(C, block);
  }
  else if (but->menu_create_func) {
    Block *block = menu_block_new(C, but->str.c_str(), EmbossType::Pulldown, root);
    if (but->type == ButtonType::Menu && but->rnaprop && RNA_property_type(but->rnaprop) == PROP_ENUM) {
      Popup &popup = *popup_of(block);
      popup.handle = std::make_unique<PopupBlockHandle>();
      popup.handle->region = popup.region;
      popup.handle->popup_create_vars.but = but;
      block->handle = popup.handle.get();
    }
    /* The button's context goes with what it opens (ui_popup_menu_create_block): a collection's sub-menu of Move to
     * Collection reads its collection from it. */
    Layout &layout = menu_layout(C, block);
    if (but->context) {
      layout.context_copy(but->context);
    }
    menu_draw_context(C, [&] { but->menu_create_func(C, &layout, but->poin); });
    block_layout_resolve(block);
    json = menu_json(C, block);
  }
  else if (but->block_create_func) {
    Block *block = but->block_create_func(C, popup_new(C, true, root).region, but->poin ? static_cast<void *>(but->poin) : but->func_argN);
    if (block_layout_needs_resolving(block)) {
      block_layout_resolve(block);
    }
    json = menu_json(C, block);
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
  if (!button_live(C, but)) {
    return 0;
  }
  if (is_toggle(but)) {
    const bool on = value < 0 ? button_value_get(but) == 0.0 : value != 0;
    button_value_set(but, on ? 1.0 : 0.0);
  }
  else if (ELEM(but->type, ButtonType::Row, ButtonType::ListRow, ButtonType::Tab)) {
    button_value_set(but, but->hardmax);
  }
  else if (but->type == ButtonType::ButMenu) {
    button_value_set(but, double(but->retval));
  }
  else if (but->type == ButtonType::ViewItem) {
    /* As a click activates a view's item (interface_handlers.cc force_activate_view_item_but). */
    CTX_store_set(C, but->context);
    static_cast<ButtonViewItem *>(but)->view_item->activate(*C);
    CTX_store_set(C, nullptr);
  }
  button_applied(C, but);
  button_update(but);
  /* A menu item's value goes to the menu button that opened it (handle_button_return_submenu). */
  if (but->type == ButtonType::ButMenu && but->block->handle) {
    Button *opener = but->block->handle->popup_create_vars.but;
    if (opener && button_live(C, opener) && opener->type == ButtonType::Menu) {
      button_value_set(opener, double(but->block->handle->retvalue));
      button_applied(C, opener);
      button_update(opener);
    }
  }
  return (but->flag & UI_SELECT) ? 1 : 0;
}
/* A double click on a view's item: its renaming begins, where it can be renamed (do_but_VIEW_ITEM). Its layout then
 * has the rename field in its place. */
EXPORT(ui_button_rename) bool ui_button_rename(bContext *C, Button *but)
{
  if (!button_live(C, but) || but->type != ButtonType::ViewItem) {
    return false;
  }
  AbstractViewItem &item = *static_cast<ButtonViewItem *>(but)->view_item;
  if (!view_item_can_rename(item)) {
    return false;
  }
  view_item_begin_rename(item);
  return true;
}
/* A view's item dragged: what its drag controller starts (view_item_drag_start, as do_but_VIEW_ITEM starts it once
 * the press moves past the drag threshold), which is an operator call (an asset shelf's drag operator, the pose
 * library's Blend Pose Asset) handed to the page's window manager to invoke from the drag: JSON { operator,
 * properties }, or an empty string. */
EXPORT(ui_view_item_drag) const char *ui_view_item_drag(bContext *C, Button *but)
{
  static std::string json;
  json.clear();
  if (!button_live(C, but) || but->type != ButtonType::ViewItem) {
    return "";
  }
  operator_call_handover = [](wmOperatorType *ot, PointerRNA *properties) {
    char idname[OP_MAX_TYPENAME];
    WM_operator_py_idname(idname, ot->idname);
    json = std::string("{\"operator\":\"") + idname + "\",\"properties\":" + operator_values_json(properties) + "}";
  };
  CTX_store_set(C, but->context);
  view_item_drag_start(*C, *static_cast<ButtonViewItem *>(but)->view_item);
  CTX_store_set(C, nullptr);
  operator_call_handover = nullptr;
  return json.c_str();
}

/* A view's item's context menu (ui_popup_context_menu_for_button: its build_context_menu, in the item's context), as a
 * menu tree. */
EXPORT(ui_view_item_context_menu) const char *ui_view_item_context_menu(bContext *C, Button *but)
{
  static std::string json;
  if (!button_live(C, but) || but->type != ButtonType::ViewItem) {
    return "";
  }
  Block *block = menu_block_new(C, __func__, EmbossType::Pulldown, menu_root(but->block));
  Layout &layout = menu_layout(C, block);
  if (but->context) {
    layout.context_copy(but->context);
  }
  CTX_store_set(C, but->context);
  static_cast<ButtonViewItem *>(but)->view_item->build_context_menu(*C, layout.column(false));
  CTX_store_set(C, nullptr);
  block_layout_resolve(block);
  json = menu_json(C, block);
  return json.c_str();
}
/* An operator button pressed, as ui_apply_but_funcs_after runs it: its operator in the button's context with the button
 * active (template_ID's New assigns what it makes to the template's property), then the button's functions. Returns the
 * operator's wmOperatorStatus. */
EXPORT(ui_button_operator) int ui_button_operator(bContext *C, Button *but)
{
  if (!button_live(C, but)) {
    return int(OPERATOR_CANCELLED);
  }
  const bContextStore *previous = CTX_store_get(C);
  if (but->context) {
    CTX_store_set(C, but->context);
  }
  but->flag |= BUT_ACTIVE_OVERRIDE;
  const wmOperatorStatus status = WM_operator_name_call_ptr(C, but->optype, but->opcontext, but->opptr, nullptr);
  CTX_store_set(C, previous);
  /* The operator may have opened a popup in the button's place, which frees the menu that held it. */
  if (button_live(C, but)) {
    but->flag &= ~BUT_ACTIVE_OVERRIDE;
    button_applied(C, but);
  }
  return int(status);
}
/* The context store a button's layout gave it (context_pointer_set: a panel's point cache, a modifier) made the
 * context's, for its operator run by the page's registry; returns the store it replaced, which
 * ui_context_store_restore gives back. */
EXPORT(ui_button_context_push) const bContextStore *ui_button_context_push(bContext *C, Button *but)
{
  const bContextStore *previous = CTX_store_get(C);
  if (button_live(C, but) && but->context) {
    CTX_store_set(C, but->context);
  }
  return previous;
}
EXPORT(ui_context_store_restore) void ui_context_store_restore(bContext *C, const bContextStore *store) { CTX_store_set(C, store); }
/* After JS set a property button's value through RNA: its functions, as after a press. */
EXPORT(ui_button_applied) void ui_button_applied(bContext *C, Button *but)
{
  if (button_live(C, but)) {
    button_applied(C, but);
  }
}
/* A number or text button without RNA (a value of Blender's code, but->poin): set as the button sets it. */
EXPORT(ui_button_value_set) void ui_button_value_set(bContext *C, Button *but, double value)
{
  if (!button_live(C, but)) {
    return;
  }
  button_value_set(but, value);
  button_applied(C, but);
}
EXPORT(ui_button_text_set) void ui_button_text_set(bContext *C, Button *but, const char *text)
{
  if (!button_live(C, but)) {
    return;
  }
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

/* Searches. */

/* A search button's items, as its update function adds them (search_item_add, linked with --wrap), for the page's
 * search popup in place of Blender's search box region (interface_region_search.cc). */
struct SearchItem {
  std::string name;
  void *poin;
  int icon;
  int flag;
};
static Vector<SearchItem> *listed = nullptr;
static Vector<SearchItem> search_items(bContext *C, ButtonSearch *but, const char *text)
{
  /* What the update function is given: an empty SearchItems (zeroed), whose items the wrap takes. */
  alignas(8) static char empty[256] = {};
  Vector<SearchItem> items;
  listed = &items;
  but->items_update_fn(C, but->arg, text, reinterpret_cast<SearchItems *>(empty), !but->changed);
  listed = nullptr;
  return items;
}

}  // namespace blender::ui

#define SEARCH_ITEM_ADD _ZN7blender2ui15search_item_addEPNS0_11SearchItemsENS_9StringRefEPviih
extern "C" bool WRAP(__real_, SEARCH_ITEM_ADD)(ui::SearchItems *items, StringRef name, void *poin, int iconid, int but_flag,
                                                uint8_t name_prefix_offset);
/* port-override: while the page lists a search's items, they are taken instead of written into a search box. */
extern "C" bool WRAP(__wrap_, SEARCH_ITEM_ADD)(ui::SearchItems *items, StringRef name, void *poin, int iconid, int but_flag,
                                                uint8_t name_prefix_offset)
{
  if (!ui::listed) {
    return WRAP(__real_, SEARCH_ITEM_ADD)(items, name, poin, iconid, but_flag, name_prefix_offset);
  }
  ui::listed->append({name.drop_prefix(name_prefix_offset), poin, iconid, but_flag});
  return true;
}

namespace blender::ui {

static ButtonSearch *searchable(const bContext *C, Button *but)
{
  return button_live(C, but) && but->type == ButtonType::SearchMenu && static_cast<ButtonSearch *>(but)->items_update_fn ?
             static_cast<ButtonSearch *>(but) :
             nullptr;
}

/* A search button's items for `text`, as its search box lists them: [{ name, icon, disabled, active }], or an empty
 * string for a button without a search function. */
EXPORT(ui_button_search) const char *ui_button_search(bContext *C, Button *but, const char *text)
{
  static std::string json;
  ButtonSearch *search = searchable(C, but);
  if (!search) {
    return "";
  }
  std::ostringstream out;
  out << '[';
  bool first = true;
  for (const SearchItem &item : search_items(C, search, text)) {
    out << (first ? "{\"name\":" : ",{\"name\":");
    first = false;
    quote(out, item.name);
    if (item.icon) {
      key(out, "icon");
      quote(out, ui_icon_name(item.icon));
    }
    if (item.flag & BUT_DISABLED) {
      out << ",\"disabled\":true";
    }
    if (item.poin && item.poin == search->item_active) {
      out << ",\"active\":true";
    }
    out << '}';
  }
  out << ']';
  json = out.str();
  return json.c_str();
}

/* The search's item `index` for `text` chosen, as its search box applies it (searchbox_apply): the button's functions
 * run with the item (template_ID's assigns the ID). */
EXPORT(ui_button_search_apply) void ui_button_search_apply(bContext *C, Button *but, const char *text, int index)
{
  ButtonSearch *search = searchable(C, but);
  if (!search) {
    return;
  }
  const Vector<SearchItem> items = search_items(C, search, text);
  if (index < 0 || index >= items.size() || (items[index].flag & BUT_DISABLED)) {
    return;
  }
  but->func_arg2 = items[index].poin;
  button_applied(C, but);
}

/* Popups. */


/* port-override: a popup menu Blender's code builds (popup_menu_begin to popup_menu_end) is drawn by Bylonder's window
 * manager: its block is laid out by Blender and handed over as the invoke's popup. */
struct PopupMenu {
  Block *block;
  Layout *layout;
  std::string title;
};
PopupMenu *popup_menu_begin_ex(bContext *C, const char *title, const char *block_name, int /*icon*/)
{
  operator_popup_free(C);
  Block *block = popup_block_new(C, block_name, EmbossType::Pulldown, false, "");
  return MEM_new<PopupMenu>(__func__, block, &menu_layout(C, block), title);
}
PopupMenu *popup_menu_begin(bContext *C, const char *title, int icon) { return popup_menu_begin_ex(C, title, __func__, icon); }
Layout *popup_menu_layout(PopupMenu *pup) { return pup->layout; }
void popup_menu_end(bContext *C, PopupMenu *pup)
{
  block_layout_resolve(pup->block);
  popup_layout_open(pup->title, menu_json(C, pup->block));
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
  operator_popup_free(C);
  Block *block = popup_block_new(C, op->type->idname, EmbossType::Emboss, false, "");
  Layout &layout = block_layout(block, LayoutDirection::Vertical, LayoutType::Panel, 0, 0, 15 * UI_UNIT_X, 0, 0, style_get_dpi());
  layout.use_property_split_set(true);
  layout.use_property_decorate_set(false);
  uiTemplateOperatorPropertyButs(C, &layout, op, BUT_LABEL_ALIGN_NONE, 0);
  block_layout_resolve(block);
  return menu_json(C, block);
}

}  // namespace blender::ui

