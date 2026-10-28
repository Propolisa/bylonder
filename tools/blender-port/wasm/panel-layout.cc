/* Blender's modifier panels (each MOD_*.cc's panel_draw and its sub-panels) without Blender's interface: ui::Layout
 * records what a panel draws as a tree, which JS reads as JSON and draws with its own widgets. The panels read and
 * write the modifier through RNA, which reads and writes its DNA (operator-properties.cc). */
#include <map>
#include <set>
#include <sstream>

#include "BKE_context.hh"
#include "BKE_modifier.hh"
#include "BKE_screen.hh"
#include "BLI_listbase.h"
#include "DNA_modifier_types.h"
#include "DNA_object_types.h"
#include "DNA_screen_types.h"
#include "RNA_access.hh"
#include "UI_interface_c.hh"
#include "UI_interface_layout.hh"
#include "WM_api.hh"
#include "RE_engine.h"

#include "operator-properties.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace blender::ui {

/* What a layout or an item in it draws; a layout's own state (active, enabled) is read from it when written out. */
struct Node {
  /* An operator's enum property, for an operator's enum menu. */
  std::string kind, prop, owner, heading, property;
  /* \x01: none, so the widget shows its RNA name. */
  std::string text = "\x01";
  int index = -1, flag = 0, icon = 0;
  bool split = false, decorate = true, align = false, emboss_none = false;
  /* A property's struct type, owner ID and data, for JS to read and write it in the module (rna_get, rna_set). */
  std::optional<PointerRNA> pointer;
  const Layout *layout = nullptr;
  std::vector<std::unique_ptr<Node>> children;
};

static std::map<const Layout *, Node *> nodes;
static std::vector<std::unique_ptr<Layout>> layouts;

/* Reads a layout's protected state, as Blender's interface code does through its friend. */
struct LayoutInternal {
  static bool active(const Layout &layout) { return layout.active_; }
  static bool enabled(const Layout &layout) { return layout.enabled_; }
  static bool red_alert(const Layout &layout) { return layout.redalert_; }
  static void init(Layout &layout)
  {
    layout.active_ = true;
    layout.enabled_ = true;
  }
};

static Node &add(const Layout *parent, const char *kind)
{
  Node &node = *nodes.at(parent)->children.emplace_back(std::make_unique<Node>());
  node.kind = kind;
  node.split = nodes.at(parent)->split;
  node.decorate = nodes.at(parent)->decorate;
  return node;
}

/* The layout raw buttons go into, as the block's current layout is Blender's: the last one made (block_layout_set_current
 * in its making), or the one uiItemL_respect_property_split gives. */
static const Layout *button_layout = nullptr;

static Layout &sub_layout(const Layout *parent, const char *kind)
{
  Layout &layout = *layouts.emplace_back(std::make_unique<Layout>(ItemType(0), nullptr));
  Node &node = add(parent, kind);
  node.layout = &layout;
  nodes[&layout] = &node;
  button_layout = &layout;
  return layout;
}

static const char *owner(const PointerRNA *ptr) { return ptr && ptr->type ? RNA_struct_identifier(ptr->type) : ""; }

Item::Item(ItemType type) : type_(type) {}
Layout::Layout(ItemType type, LayoutRoot *root) : Item(type)
{
  root_ = root;
  LayoutInternal::init(*this);
}
void Layout::estimate_impl() {}
void Layout::resolve_impl() {}
/* The block raw buttons go into while a panel is recorded with one (panel_record): a button made in it is recorded
 * in the block's current layout, as Blender adds it there. */
static Block *recording_block = nullptr;
Block *Layout::block() const { return recording_block; }
void layout_record_button(Block *block, int index)
{
  if (block == recording_block && button_layout) {
    add(button_layout, "button").index = index;
  }
}
std::string panel_button_json(int index);

static Layout &aligned_layout(const Layout *parent, const char *kind, bool align, StringRef heading = "")
{
  Layout &layout = sub_layout(parent, kind);
  nodes[&layout]->align = align;
  nodes[&layout]->heading = heading;
  return layout;
}
Layout &Layout::column(bool align) { return aligned_layout(this, "column", align); }
Layout &Layout::column(bool align, StringRef heading) { return aligned_layout(this, "column", align, heading); }
Layout &Layout::row(bool align) { return aligned_layout(this, "row", align); }
Layout &Layout::row(bool align, StringRef heading) { return aligned_layout(this, "row", align, heading); }
Layout &Layout::box() { return sub_layout(this, "box"); }
Layout &Layout::split(float /*percentage*/, bool /*align*/) { return sub_layout(this, "split"); }

void Layout::use_property_split_set(bool value) { nodes.at(this)->split = value; }
void Layout::use_property_decorate_set(bool value) { nodes.at(this)->decorate = value; }
void Layout::emboss_set(EmbossType emboss) { nodes.at(this)->emboss_none = emboss == EmbossType::None; }
void Layout::operator_context_set(wm::OpCallContext /*opcontext*/) {}
void Layout::context_ptr_set(StringRef /*name*/, const PointerRNA * /*ptr*/) {}

void Layout::prop(PointerRNA *ptr, StringRefNull propname, eUI_Item_Flag flag, std::optional<StringRef> name, int icon)
{
  Node &node = add(this, "prop");
  node.icon = icon;
  node.prop = propname;
  node.owner = owner(ptr);
  node.pointer = *ptr;
  node.flag = int(flag);
  node.text = name ? std::string(*name) : std::string("\x01");
}
void Layout::prop(PointerRNA *ptr, PropertyRNA *prop, int index, int /*value*/, eUI_Item_Flag flag, std::optional<StringRef> name_opt,
                  int icon, std::optional<StringRef> /*placeholder*/)
{
  this->prop(ptr, RNA_property_identifier(prop), flag, name_opt, icon);
  nodes.at(this)->children.back()->index = index;
}
void Layout::prop_search(PointerRNA *ptr, StringRefNull propname, PointerRNA * /*searchptr*/, StringRefNull /*searchpropname*/,
                         std::optional<StringRefNull> name, int icon)
{
  this->prop(ptr, propname, eUI_Item_Flag(0), name ? std::optional<StringRef>(*name) : std::nullopt, icon);
  nodes.at(this)->children.back()->kind = "search";
}
void Layout::prop_search(PointerRNA *ptr, PropertyRNA *prop, PointerRNA *searchptr, PropertyRNA * /*searchprop*/,
                         PropertyRNA * /*item_searchpropname*/, std::optional<StringRefNull> name, int icon, bool /*suggestions*/)
{
  this->prop_search(ptr, RNA_property_identifier(prop), searchptr, "", name, icon);
}
void Layout::decorator(PointerRNA * /*ptr*/, PropertyRNA * /*prop*/, int /*index*/) {}
void Layout::decorator(PointerRNA * /*ptr*/, std::optional<StringRefNull> /*propname*/, int /*index*/) {}
void Layout::separator(float /*factor*/, LayoutSeparatorType /*type*/) { add(this, "separator"); }
void Layout::label(StringRef name, int icon)
{
  Node &node = add(this, "label");
  node.text = name;
  node.icon = icon;
}
void Layout::menu_fn(StringRefNull name, int /*icon*/, MenuCreateFunc /*func*/, void * /*arg*/) { add(this, "menu").text = name; }

/* Operators are recorded by name; the properties a panel sets on them go nowhere. */
PointerRNA Layout::op(StringRefNull opname, std::optional<StringRef> name, int icon, wm::OpCallContext /*context*/,
                      eUI_Item_Flag /*flag*/)
{
  Node &node = add(this, "operator");
  node.prop = opname;
  node.icon = icon;
  node.text = name ? std::string(*name) : std::string("\x01");
  return PointerRNA_NULL;
}
/* An operator's enum menu: its operator and property by name. */
PointerRNA Layout::op_menu_enum(const bContext * /*C*/, StringRefNull opname, StringRefNull propname, StringRefNull name,
                                int /*icon*/)
{
  Node &node = add(this, "operator_menu_enum");
  node.prop = opname;
  node.property = propname;
  node.text = name;
  return PointerRNA_NULL;
}
PointerRNA Layout::op_menu_enum(const bContext *C, wmOperatorType *ot, StringRefNull propname,
                                std::optional<StringRefNull> name, int icon)
{
  return this->op_menu_enum(C, ot->idname, propname, name.value_or(""), icon);
}
PointerRNA Layout::op(StringRefNull opname, std::optional<StringRef> name, int icon)
{
  return this->op(opname, name, icon, wm::OpCallContext::InvokeRegionWin, eUI_Item_Flag(0));
}
PointerRNA Layout::op(wmOperatorType *ot, std::optional<StringRef> name, int icon, wm::OpCallContext context, eUI_Item_Flag flag)
{
  return this->op(ot->idname, name, icon, context, flag);
}
PointerRNA Layout::op(wmOperatorType *ot, std::optional<StringRef> name, int icon)
{
  return this->op(ot->idname, name, icon);
}

/* Sub-panels inside a panel's layout, always open: JS keeps their open state. */
PanelLayout Layout::panel_prop(const bContext * /*C*/, PointerRNA * /*open_prop_owner*/, StringRefNull open_prop_name)
{
  Layout &panel = sub_layout(this, "panel");
  nodes[&panel]->prop = open_prop_name;
  return {&sub_layout(&panel, "header"), &sub_layout(&panel, "body")};
}
Layout *Layout::panel_prop(const bContext *C, PointerRNA *open_prop_owner, StringRefNull open_prop_name, StringRef label)
{
  PanelLayout panel = this->panel_prop(C, open_prop_owner, open_prop_name);
  panel.header->label(label, 0);
  return panel.body;
}
PanelLayout Layout::panel_prop_with_bool_header(const bContext *C, PointerRNA *open_prop_owner, StringRefNull open_prop_name,
                                                PointerRNA *bool_prop_owner, StringRefNull bool_prop_name,
                                                std::optional<StringRef> label)
{
  PanelLayout panel = this->panel_prop(C, open_prop_owner, open_prop_name);
  panel.header->prop(bool_prop_owner, bool_prop_name, eUI_Item_Flag(0), label, 0);
  return panel;
}

/* A label in a property split's label column, the items after it in its value column (where the block's buttons go
 * next); without the split, a label. Decorators are not drawn. */
Layout *uiItemL_respect_property_split(Layout *layout, StringRef text, int icon)
{
  if (!nodes.at(layout)->split) {
    layout->label(text, icon);
    return nullptr;
  }
  Layout &value = sub_layout(layout, "split_label");
  nodes[&value]->text = text;
  button_layout = &value;
  return nullptr;
}

/* Blender's template widgets (a data-block selector, a curve editor), recorded by name and property for JS to draw. */
static void template_node(Layout *layout, const char *name, PointerRNA *ptr, StringRefNull propname)
{
  Node &node = add(layout, "template");
  node.text = name;
  node.prop = propname;
  node.owner = owner(ptr);
  node.pointer = *ptr;
}
void template_id(Layout *layout, const bContext * /*C*/, PointerRNA *ptr, StringRefNull propname, const char * /*newop*/,
                 const char * /*openop*/, const char * /*unlinkop*/, int /*filter*/, bool /*live_icon*/, std::optional<StringRef> /*text*/)
{
  template_node(layout, "template_id", ptr, propname);
}
void template_curve_profile(Layout *layout, PointerRNA *ptr, StringRefNull propname)
{
  template_node(layout, "template_curve_profile", ptr, propname);
}
void template_curve_mapping(Layout *layout, PointerRNA *ptr, StringRefNull propname, int /*type*/, bool /*levels*/, bool /*brush*/,
                            bool /*neg_slope*/, bool /*tone*/, bool /*presets*/)
{
  template_node(layout, "template_curve_mapping", ptr, propname);
}
void template_color_ramp(Layout *layout, PointerRNA *ptr, StringRefNull propname, bool /*expand*/)
{
  template_node(layout, "template_color_ramp", ptr, propname);
}
void template_any_id(Layout *layout, PointerRNA *ptr, StringRefNull propname, StringRefNull /*proptypename*/,
                     std::optional<StringRef> /*text*/)
{
  template_node(layout, "template_any_ID", ptr, propname);
}
void template_path_builder(Layout *layout, PointerRNA *ptr, StringRefNull propname, PointerRNA * /*root_ptr*/,
                           std::optional<StringRefNull> /*text*/)
{
  template_node(layout, "template_path_builder", ptr, propname);
}

/* The panel being drawn and the modifier it draws. */
static PointerRNA panel_ptr;
PointerRNA *panel_custom_data_get(const Panel * /*panel*/) { return &panel_ptr; }
void panel_context_pointer_set(Panel * /*panel*/, const char * /*name*/, PointerRNA * /*ptr*/) {}
void block_lock_set(Block * /*block*/, bool /*val*/, const char * /*lockstr*/) {}

static void quote(std::ostringstream &out, const std::string &text)
{
  out << '"';
  for (const char c : text) {
    if (c == '"' || c == '\\') {
      out << '\\' << c;
    }
    else if (c >= 0 && c < 0x20) {
      out << "\\u00" << "0123456789abcdef"[c >> 4] << "0123456789abcdef"[c & 15];
    }
    else {
      out << c;
    }
  }
  out << '"';
}

/* A node as JSON: its kind, what it shows, and for a layout its state and children. */
static void write(std::ostringstream &out, const Node &node)
{
  out << "{\"kind\":";
  quote(out, node.kind);
  for (const auto &[key, value] :
       {std::pair{"prop", &node.prop}, {"owner", &node.owner}, {"heading", &node.heading}, {"property", &node.property}})
  {
    if (!value->empty()) {
      out << ",\"" << key << "\":";
      quote(out, *value);
    }
  }
  if (node.text != "\x01") {
    out << ",\"text\":";
    quote(out, node.text);
  }
  if (node.icon) {
    out << ",\"icon\":" << node.icon;
  }
  if (node.align) {
    out << ",\"align\":true";
  }
  if (node.emboss_none) {
    out << ",\"emboss\":\"NONE\"";
  }
  if (node.layout && node.layout->alignment() != LayoutAlign::Expand) {
    out << ",\"alignment\":\"" << (const char *[]){"EXPAND", "LEFT", "CENTER", "RIGHT"}[int(node.layout->alignment())] << '"';
  }
  if (node.pointer) {
    out << ",\"pointer\":[" << uintptr_t(node.pointer->type) << ',' << uintptr_t(node.pointer->owner_id) << ','
        << uintptr_t(node.pointer->data) << ']';
  }
  if (node.kind == "button") {
    out << ",\"button\":" << panel_button_json(node.index);
  }
  out << ",\"index\":" << node.index << ",\"flag\":" << node.flag << ",\"split\":" << node.split << ",\"decorate\":" << node.decorate;
  if (node.layout) {
    out << ",\"active\":" << LayoutInternal::active(*node.layout) << ",\"enabled\":" << LayoutInternal::enabled(*node.layout)
        << ",\"alert\":" << LayoutInternal::red_alert(*node.layout);
  }
  out << ",\"children\":[";
  for (size_t i = 0; i < node.children.size(); i++) {
    out << (i ? "," : "");
    write(out, *node.children[i]);
  }
  out << "]}";
}

/* A registered panel type drawn into a node: a sub-panel's header (its checkbox), then its body and its sub-panels. */
static void draw_panel(const bContext *C, PanelType *type, Node &parent, bool root)
{
  Node &node = *parent.children.emplace_back(std::make_unique<Node>());
  node.kind = "panel";
  node.text = type->label;
  node.prop = type->idname;
  Panel panel = {};
  panel.type = type;
  for (const auto &[kind, draw] : {std::pair{"header", root ? nullptr : type->draw_header}, {"body", type->draw}}) {
    if (!draw) {
      continue;
    }
    Layout &layout = *layouts.emplace_back(std::make_unique<Layout>(ItemType(0), nullptr));
    Node &part = *node.children.emplace_back(std::make_unique<Node>());
    part.kind = kind;
    part.layout = &layout;
    nodes[&layout] = &part;
    panel.layout = &layout;
    button_layout = &layout;
    draw(C, &panel);
  }
  for (LinkData &link : type->children) {
    draw_panel(C, static_cast<PanelType *>(link.data), node, false);
  }
}

/* port-override: a region's instanced panels (the F-Modifiers' that ANIM_fmodifier_panels adds) are not kept: the
 * sidebar records them after the panel that adds them (anim_sidebar_panels), so adding one only frees its data. */
bool panel_list_matches_data(ARegion * /*region*/, ListBase * /*data*/, ListPanelIDFromDataFunc /*panel_idname_func*/)
{
  return false;
}
void panels_free_instanced(const bContext * /*C*/, ARegion * /*region*/) {}
Panel *panel_add_instanced(const bContext * /*C*/, ARegion * /*region*/, ListBaseT<Panel> * /*panels*/,
                           const char * /*panel_idname*/, PointerRNA *custom_data)
{
  MEM_delete(custom_data);
  return nullptr;
}

/* A registered panel type with its header and sub-panels, as JSON, drawing `ptr` (its custom data, an instanced
 * panel's) and recording the raw buttons it makes in `block`. */
std::string panel_record(const bContext *C, PanelType *type, const PointerRNA &ptr, Block *block)
{
  Node root;
  root.kind = "panels";
  panel_ptr = ptr;
  recording_block = block;
  draw_panel(C, type, root, false);
  recording_block = nullptr;
  button_layout = nullptr;
  std::ostringstream out;
  out << std::boolalpha;
  write(out, root);
  nodes.clear();
  layouts.clear();
  return out.str();
}

/* A layout recorded on its own (a region's block layout, block_layout in region-draw.cc), as `kind`: its root, until
 * layout_record_clear. */
static std::vector<std::unique_ptr<Node>> roots;
Layout &layout_record_begin(const char *kind)
{
  Layout &layout = *layouts.emplace_back(std::make_unique<Layout>(ItemType(0), nullptr));
  Node &node = *roots.emplace_back(std::make_unique<Node>());
  node.kind = kind;
  node.layout = &layout;
  nodes[&layout] = &node;
  return layout;
}
void layout_record_align_set(const Layout &layout, bool align) { nodes.at(&layout)->align = align; }
std::string layout_record_json(const Layout &layout)
{
  std::ostringstream out;
  out << std::boolalpha;
  write(out, *nodes.at(&layout));
  return out.str();
}
void layout_record_clear()
{
  roots.clear();
  nodes.clear();
  layouts.clear();
}

}  // namespace blender::ui

/* The modifier panels' types, as the Properties editor's region registers them, each type's when first drawn. */
static ARegionType &modifier_region(ModifierType type)
{
  static ARegionType region = {};
  static std::set<int> registered;
  const ModifierTypeInfo *info = BKE_modifier_get_info(type);
  if (info && info->panel_register && registered.insert(type).second) {
    info->panel_register(&region);
  }
  return region;
}

/* port-override: Bylonder renders with its own engine, which has none of Blender's engine flags, so panels that ask
 * (Subdivision Surface's adaptive subdivision for Cycles) show what they show for any other engine. */
RenderEngineType *blender::RE_engines_find(const char * /*idname*/)
{
  static RenderEngineType engine = {};
  return &engine;
}

/* port-override: UI lists and gizmos are drawn by Bylonder, so their types are not kept. */
bool blender::WM_uilisttype_add(uiListType * /*ult*/) { return true; }

/* What a modifier's panel and its sub-panels draw, as JSON, valid until the next call. */
EXPORT(modifier_panel_draw) const char *modifier_panel_draw(Object *ob, ModifierData *md)
{
  static bContext *C = CTX_create();
  static std::string json;
  char idname[BKE_ST_MAXNAME];
  BKE_modifier_type_panel_id(ModifierType(md->type), idname);
  PanelType *type = static_cast<PanelType *>(
      BLI_findstring(&modifier_region(ModifierType(md->type)).paneltypes, idname, offsetof(PanelType, idname)));
  ui::Node root;
  root.kind = "panels";
  ui::panel_ptr = RNA_pointer_create_discrete(&ob->id, *BKE_modifier_get_info(ModifierType(md->type))->srna, md);
  if (type) {
    ui::draw_panel(C, type, root, true);
  }
  std::ostringstream out;
  out << std::boolalpha;
  ui::write(out, root);
  json = out.str();
  ui::nodes.clear();
  ui::layouts.clear();
  return json.c_str();
}
