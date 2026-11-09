/* Geometry Nodes kernels for Bylonder's evaluator (src/io_scene_babylon/runtime/geometry-nodes/, docs/licence-free-live.md,
 * Geometry Nodes kernel seams): a fragment of an IR graph (one geometry node with the field nodes feeding it, a function
 * node over arrays, a field input on a domain) built as a node tree outside Main and run by Blender's own Geometry Nodes
 * evaluation, on IR geometry marshalled in and out. Requests and results are JSON; bulk arrays stay in module memory,
 * named by their address. The IDs a fragment reads (materials, objects with their geometry, collections) are defined
 * first by their IR keys (gn_id_define). */
#include <cstdio>
#include <map>
#include <memory>
#include <sstream>
#include <string>

#include "BKE_collection.hh"
#include "BKE_geometry_fields.hh"
#include "BKE_geometry_set.hh"
#include "BKE_instances.hh"
#include "BKE_lib_id.hh"
#include "BKE_material.hh"
#include "BKE_mesh.hh"
#include "BKE_node.hh"
#include "BKE_node_runtime.hh"
#include "BKE_node_socket_value.hh"
#include "BKE_node_tree_update.hh"
#include "BKE_object.hh"
#include "BKE_object_types.hh"
#include "BKE_pointcloud.hh"
#include "BKE_colorband.hh"
#include "BKE_colortools.hh"
#include "BKE_compute_contexts.hh"
#include "BKE_geometry_nodes_reference_set.hh"
#include "BLI_math_matrix.hh"
#include "BLI_math_quaternion.hh"
#include "BLI_math_rotation.hh"
#include "BLI_serialize.hh"
#include "BLI_listbase.h"
#include "BLI_multi_value_map.hh"
#include "BLI_string.h"
#include "DNA_collection_types.h"
#include "DNA_color_types.h"
#include "DNA_material_types.h"
#include "DNA_mesh_types.h"
#include "DNA_node_types.h"
#include "DNA_object_types.h"
#include "DNA_pointcloud_types.h"
#include "DNA_texture_types.h"
#include "FN_lazy_function_execute.hh"
#include "MEM_guardedalloc.h"
#include "NOD_geometry_nodes_lazy_function.hh"
#include "RNA_access.hh"
#include "RNA_prototypes.hh"

#include "extraction.hh"

using namespace blender;
using io::serialize::ArrayValue;
using io::serialize::DictionaryValue;
using io::serialize::Value;
using io::serialize::eValueType;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

void types_ensure();

namespace {

/* ---- IDs by IR key ---- */

struct IDs {
  std::map<std::string, ID *> by_key;
  std::map<const ID *, std::string> key_of;
  Object self = {};
};
IDs &ids()
{
  static IDs table;
  if (!table.self.runtime) {
    table.self.runtime = MEM_new<bke::ObjectRuntime>(__func__);
    table.self.runtime->object_to_world = float4x4::identity();
    table.self.runtime->world_to_object = float4x4::identity();
  }
  return table;
}

ID *id_find(const std::string &key)
{
  auto found = ids().by_key.find(key);
  return found == ids().by_key.end() ? nullptr : found->second;
}

std::string id_key(const ID *id)
{
  auto found = ids().key_of.find(id);
  return found == ids().key_of.end() ? std::string(id->name + 2) : found->second;
}

/* ---- JSON helpers ---- */

double number(const Value *value)
{
  switch (value->type()) {
    case eValueType::Int: return double(value->as_int_value()->value());
    case eValueType::Double: return value->as_double_value()->value();
    case eValueType::Boolean: return value->as_boolean_value()->value() ? 1.0 : 0.0;
    default: return 0.0;
  }
}

template<typename T> T *address(const DictionaryValue &dict, StringRef key)
{
  return reinterpret_cast<T *>(uintptr_t(dict.lookup_int(key).value_or(0)));
}

std::string quoted(StringRef text)
{
  std::string out = "\"";
  for (const char c : text) {
    if (c == '"' || c == '\\') {
      out += '\\';
    }
    out += c;
  }
  return out + "\"";
}

/* ---- Attributes ---- */

const std::map<std::string, bke::AttrType> &attribute_types()
{
  static const std::map<std::string, bke::AttrType> types = {
      {"BOOLEAN", bke::AttrType::Bool}, {"INT8", bke::AttrType::Int8}, {"INT", bke::AttrType::Int32},
      {"INT16_2D", bke::AttrType::Int16_2D}, {"INT32_2D", bke::AttrType::Int32_2D}, {"FLOAT", bke::AttrType::Float},
      {"FLOAT2", bke::AttrType::Float2}, {"FLOAT_VECTOR", bke::AttrType::Float3}, {"FLOAT4X4", bke::AttrType::Float4x4},
      {"BYTE_COLOR", bke::AttrType::ColorByte}, {"FLOAT_COLOR", bke::AttrType::ColorFloat}, {"QUATERNION", bke::AttrType::Quaternion},
      {"FLOAT4", bke::AttrType::Float4}};
  return types;
}
const std::map<std::string, bke::AttrDomain> &attribute_domains()
{
  static const std::map<std::string, bke::AttrDomain> domains = {
      {"POINT", bke::AttrDomain::Point}, {"EDGE", bke::AttrDomain::Edge}, {"FACE", bke::AttrDomain::Face},
      {"CORNER", bke::AttrDomain::Corner}, {"CURVE", bke::AttrDomain::Curve}, {"INSTANCE", bke::AttrDomain::Instance},
      {"LAYER", bke::AttrDomain::Layer}};
  return domains;
}
template<typename Map, typename V> std::string name_of(const Map &map, const V value)
{
  for (const auto &[name, v] : map) {
    if (v == value) {
      return name;
    }
  }
  return "";
}

/* IR attributes `[{ name, domain, type, data: address }]` onto a component's attributes. */
void attributes_set(bke::MutableAttributeAccessor attributes, const ArrayValue *list)
{
  if (!list) {
    return;
  }
  for (const std::shared_ptr<Value> &item : list->elements()) {
    const DictionaryValue &attribute = *item->as_dictionary_value();
    const std::string name(*attribute.lookup_str("name"));
    const auto type = attribute_types().find(std::string(*attribute.lookup_str("type")));
    const auto domain = attribute_domains().find(std::string(*attribute.lookup_str("domain")));
    if (type == attribute_types().end() || domain == attribute_domains().end()) {
      continue;
    }
    const CPPType &cpp_type = bke::attribute_type_to_cpp_type(type->second);
    const int size = attributes.domain_size(domain->second);
    const GSpan data(cpp_type, address<const void>(attribute, "data"), size);
    attributes.remove(name);
    attributes.add(name, domain->second, type->second, bke::AttributeInitVArray(GVArray::from_span(data)));
  }
}

/* Materials by IR key, as a mesh's or a point cloud's material slots. */
template<typename T> void materials_set(T &data, const ArrayValue *list)
{
  if (!list || list->elements().is_empty()) {
    return;
  }
  data.totcol = short(list->elements().size());
  data.mat = MEM_new_array_zeroed<Material *>(data.totcol, __func__);
  for (const int i : list->elements().index_range()) {
    const DictionaryValue *slot = list->elements()[i]->as_dictionary_value();
    data.mat[i] = slot ? reinterpret_cast<Material *>(id_find(std::string(slot->lookup_str("id").value_or("")))) : nullptr;
  }
}

/* ---- IR geometry in ---- */

bke::GeometrySet geometry_in(const DictionaryValue &geometry);

bke::InstanceReference reference_in(const DictionaryValue &reference)
{
  if (const std::optional<StringRefNull> key = reference.lookup_str("id")) {
    if (ID *id = id_find(std::string(*key))) {
      if (GS(id->name) == ID_OB) {
        return bke::InstanceReference(*reinterpret_cast<Object *>(id));
      }
      if (GS(id->name) == ID_GR) {
        return bke::InstanceReference(*reinterpret_cast<Collection *>(id));
      }
    }
  }
  if (const DictionaryValue *nested = reference.lookup_dict("geometry")) {
    return bke::InstanceReference(geometry_in(*nested));
  }
  return bke::InstanceReference();
}

/* `{ mesh?: { verts, positions, edges, edge_verts, faces, face_offsets, corner_verts, corner_edges, attributes, materials },
 * points?: { count, positions, attributes, materials }, instances?: { count, transforms, reference_indices, references,
 * attributes } }`, arrays by address. */
bke::GeometrySet geometry_in(const DictionaryValue &geometry)
{
  bke::GeometrySet set;
  if (const DictionaryValue *m = geometry.lookup_dict("mesh")) {
    const int faces = int(m->lookup_int("faces").value_or(0));
    Mesh *mesh = mesh_from_arrays(int(m->lookup_int("verts").value_or(0)), address<const float3>(*m, "positions"),
                                  int(m->lookup_int("edges").value_or(0)), address<const int2>(*m, "edge_verts"), faces,
                                  address<const int>(*m, "face_offsets"), address<const int>(*m, "corner_verts"),
                                  address<const int>(*m, "corner_edges"), nullptr);
    attributes_set(mesh->attributes_for_write(), m->lookup_array("attributes"));
    materials_set(*mesh, m->lookup_array("materials"));
    set.replace_mesh(mesh);
  }
  if (const DictionaryValue *p = geometry.lookup_dict("points")) {
    const int count = int(p->lookup_int("count").value_or(0));
    PointCloud *points = BKE_pointcloud_new_nomain(count);
    points->positions_for_write().copy_from(Span(address<const float3>(*p, "positions"), count));
    attributes_set(points->attributes_for_write(), p->lookup_array("attributes"));
    materials_set(*points, p->lookup_array("materials"));
    set.replace_pointcloud(points);
  }
  if (const DictionaryValue *in = geometry.lookup_dict("instances")) {
    const int count = int(in->lookup_int("count").value_or(0));
    auto instances = std::make_unique<bke::Instances>(count);
    if (const ArrayValue *references = in->lookup_array("references")) {
      for (const std::shared_ptr<Value> &reference : references->elements()) {
        instances->add_new_reference(reference_in(*reference->as_dictionary_value()));
      }
    }
    instances->transforms_for_write().copy_from(Span(address<const float4x4>(*in, "transforms"), count));
    instances->reference_handles_for_write().copy_from(Span(address<const int>(*in, "reference_indices"), count));
    attributes_set(instances->attributes_for_write(), in->lookup_array("attributes"));
    set.replace_instances(instances.release());
  }
  return set;
}

/* ---- IR geometry out ---- */

/* What a result keeps alive for JS to read: the geometries and the arrays made for them. */
struct Result {
  Vector<bke::GeometrySet> geometries;
  Vector<GArray<>> arrays;
  std::string json;
};
Result &result()
{
  static Result r;
  return r;
}

std::string pointer(const void *data) { return std::to_string(uintptr_t(data)); }

/* A component's attributes, but the topology a mesh has its own arrays for. */
std::string attributes_out(const bke::AttributeAccessor attributes)
{
  std::string out = "[";
  attributes.foreach_attribute([&](const bke::AttributeIter &iter) {
    if (ELEM(iter.name, "position", ".edge_verts", ".corner_vert", ".corner_edge") || iter.data_type == bke::AttrType::String) {
      return;
    }
    const std::string type = name_of(attribute_types(), iter.data_type);
    if (type.empty()) {
      return;
    }
    const GVArray values = *iter.get();
    result().arrays.append(GArray<>(values.type(), values.size()));
    GArray<> &array = result().arrays.last();
    values.materialize(array.data());
    out += (out.size() > 1 ? "," : "") + std::string("{\"name\":") + quoted(iter.name) + ",\"domain\":\"" +
           name_of(attribute_domains(), iter.domain) + "\",\"type\":\"" + type + "\",\"data\":" + pointer(array.data()) + "}";
  });
  return out + "]";
}

template<typename T> std::string materials_out(const T &data)
{
  std::string out = "[";
  for (int i = 0; i < data.totcol; i++) {
    out += (i ? "," : "") + (data.mat[i] ? "{\"id\":" + quoted(id_key(&data.mat[i]->id)) + "}" : std::string("null"));
  }
  return out + "]";
}

std::string geometry_out(const bke::GeometrySet &set)
{
  std::string out = "{";
  auto add = [&](const std::string &part) { out += (out.size() > 1 ? "," : "") + part; };
  if (const Mesh *mesh = set.get_mesh()) {
    add("\"mesh\":{\"verts\":" + std::to_string(mesh->verts_num) + ",\"positions\":" + pointer(mesh->vert_positions().data()) +
        ",\"edges\":" + std::to_string(mesh->edges_num) + ",\"edge_verts\":" + pointer(mesh->edges().data()) +
        ",\"faces\":" + std::to_string(mesh->faces_num) + ",\"face_offsets\":" + pointer(mesh->face_offsets().data()) +
        ",\"corners\":" + std::to_string(mesh->corners_num) + ",\"corner_verts\":" + pointer(mesh->corner_verts().data()) +
        ",\"corner_edges\":" + pointer(mesh->corner_edges().data()) + ",\"attributes\":" + attributes_out(mesh->attributes()) +
        ",\"materials\":" + materials_out(*mesh) + "}");
  }
  if (const PointCloud *points = set.get_pointcloud()) {
    add("\"points\":{\"count\":" + std::to_string(points->totpoint) + ",\"positions\":" + pointer(points->positions().data()) +
        ",\"attributes\":" + attributes_out(points->attributes()) + ",\"materials\":" + materials_out(*points) + "}");
  }
  if (const bke::Instances *instances = set.get_instances()) {
    std::string references = "[";
    for (const bke::InstanceReference &reference : instances->references()) {
      references += references.size() > 1 ? "," : "";
      switch (reference.type()) {
        case bke::InstanceReference::Type::Object: references += "{\"id\":" + quoted(id_key(&reference.object().id)) + "}"; break;
        case bke::InstanceReference::Type::Collection: references += "{\"id\":" + quoted(id_key(&reference.collection().id)) + "}"; break;
        case bke::InstanceReference::Type::GeometrySet: references += "{\"geometry\":" + geometry_out(reference.geometry_set()) + "}"; break;
        default: references += "null";
      }
    }
    add("\"instances\":{\"count\":" + std::to_string(instances->instances_num()) + ",\"transforms\":" +
        pointer(instances->transforms().data()) + ",\"reference_indices\":" + pointer(instances->reference_handles().data()) +
        ",\"references\":" + references + "],\"attributes\":" + attributes_out(instances->attributes()) + "}");
  }
  return out + "}";
}

/* ---- RNA values from JSON ---- */

void rna_set(PointerRNA &ptr, StringRef name, const Value &value);

/* A collection's items, as many as the JSON has: a color ramp's stops and a curve's points are made to match first. */
void rna_collection_set(PointerRNA &ptr, PropertyRNA *prop, const ArrayValue &items)
{
  const int count = int(items.elements().size());
  if (RNA_struct_is_a(ptr.type, RNA_ColorRamp)) {
    static_cast<ColorBand *>(ptr.data)->tot = std::clamp(count, 1, MAXCOLORBAND);
  }
  else if (RNA_struct_is_a(ptr.type, RNA_CurveMap)) {
    CurveMap &map = *static_cast<CurveMap *>(ptr.data);
    MEM_delete(map.curve);
    map.curve = MEM_new_array<CurveMapPoint>(size_t(count), __func__);
    map.totpoint = count;
  }
  for (const int i : items.elements().index_range()) {
    PointerRNA item;
    if (!RNA_property_collection_lookup_int(&ptr, prop, i, &item) || !items.elements()[i]->as_dictionary_value()) {
      continue;
    }
    for (const auto &[key, v] : items.elements()[i]->as_dictionary_value()->elements()) {
      rna_set(item, key, *v);
    }
  }
}

/* A property by identifier from its IR value: numbers and arrays, enum identifiers, strings, an ID by `{ id }`, a nested
 * struct by its properties, a collection by its items. */
void rna_set(PointerRNA &ptr, StringRef name, const Value &value)
{
  PropertyRNA *prop = RNA_struct_find_property(&ptr, std::string(name).c_str());
  if (!prop) {
    return;
  }
  const PropertyType type = RNA_property_type(prop);
  if (type == PROP_POINTER) {
    const DictionaryValue *dict = value.as_dictionary_value();
    if (!dict) {
      return;
    }
    if (const std::optional<StringRefNull> key = dict->lookup_str("id")) {
      if (RNA_property_editable(&ptr, prop)) {
        RNA_property_pointer_set(&ptr, prop, RNA_id_pointer_create(id_find(std::string(*key))), nullptr);
      }
      return;
    }
    PointerRNA nested = RNA_property_pointer_get(&ptr, prop);
    if (nested.data) {
      for (const auto &[key, v] : dict->elements()) {
        rna_set(nested, key, *v);
      }
    }
    return;
  }
  if (type == PROP_COLLECTION) {
    if (const ArrayValue *items = value.as_array_value()) {
      rna_collection_set(ptr, prop, *items);
    }
    return;
  }
  if (!RNA_property_editable(&ptr, prop)) {
    return;
  }
  const int length = RNA_property_array_length(&ptr, prop);
  const ArrayValue *array = value.as_array_value();
  switch (type) {
    case PROP_BOOLEAN:
      if (length && array) {
        Array<bool> values(length, false);
        for (const int i : IndexRange(std::min<int>(length, array->elements().size()))) values[i] = number(array->elements()[i].get()) != 0;
        RNA_property_boolean_set_array(&ptr, prop, values.data());
      }
      else RNA_property_boolean_set(&ptr, prop, number(&value) != 0);
      break;
    case PROP_INT:
      if (length && array) {
        Array<int> values(length, 0);
        for (const int i : IndexRange(std::min<int>(length, array->elements().size()))) values[i] = int(number(array->elements()[i].get()));
        RNA_property_int_set_array(&ptr, prop, values.data());
      }
      else RNA_property_int_set(&ptr, prop, int(number(&value)));
      break;
    case PROP_FLOAT:
      if (length && array) {
        Array<float> values(length, 0.0f);
        for (const int i : IndexRange(std::min<int>(length, array->elements().size()))) values[i] = float(number(array->elements()[i].get()));
        RNA_property_float_set_array(&ptr, prop, values.data());
      }
      else RNA_property_float_set(&ptr, prop, float(number(&value)));
      break;
    case PROP_STRING:
      if (const io::serialize::StringValue *text = value.as_string_value()) RNA_property_string_set(&ptr, prop, text->value().c_str());
      break;
    case PROP_ENUM: {
      int result = 0, flag;
      auto value_of = [&](const Value &item) {
        const io::serialize::StringValue *text = item.as_string_value();
        return text && RNA_property_enum_value(nullptr, &ptr, prop, text->value().c_str(), &flag) ? flag : 0;
      };
      if (array) for (const std::shared_ptr<Value> &item : array->elements()) result |= value_of(*item);
      else result = value_of(value);
      RNA_property_enum_set(&ptr, prop, result);
      break;
    }
    default: break;
  }
}

/* ---- A fragment as a node tree ---- */

/* Builds `{ nodes: [{ name, type, settings, inputs }], links, inputs: [socket type], outputs: [socket type] }` as a
 * Geometry Nodes tree: its Group Input's sockets are the fragment's inputs in order (links from node "Group Input",
 * output "<i>"), its Group Output's its outputs (links to "Group Output", input "<i>"). */
bNodeTree *fragment_tree(const DictionaryValue &fragment)
{
  bNodeTree *tree = bke::node_tree_add_tree(nullptr, "Fragment", "GeometryNodeTree");
  static const std::map<std::string, std::string> SOCKETS = {
      {"VALUE", "NodeSocketFloat"}, {"INT", "NodeSocketInt"}, {"BOOLEAN", "NodeSocketBool"}, {"VECTOR", "NodeSocketVector"},
      {"RGBA", "NodeSocketColor"}, {"ROTATION", "NodeSocketRotation"}, {"MATRIX", "NodeSocketMatrix"}, {"STRING", "NodeSocketString"},
      {"GEOMETRY", "NodeSocketGeometry"}, {"OBJECT", "NodeSocketObject"}, {"COLLECTION", "NodeSocketCollection"},
      {"MATERIAL", "NodeSocketMaterial"}, {"IMAGE", "NodeSocketImage"}, {"MENU", "NodeSocketMenu"}};
  for (const char *side : {"inputs", "outputs"}) {
    if (const ArrayValue *list = fragment.lookup_array(side)) {
      for (const int i : list->elements().index_range()) {
        const io::serialize::StringValue *type = list->elements()[i]->as_string_value();
        const auto socket = SOCKETS.find(type ? type->value() : "VALUE");
        tree->tree_interface.add_socket(std::to_string(i), "", socket == SOCKETS.end() ? "NodeSocketFloat" : socket->second,
                                        side[0] == 'i' ? NODE_INTERFACE_SOCKET_INPUT : NODE_INTERFACE_SOCKET_OUTPUT, nullptr);
      }
    }
  }
  std::map<std::string, bNode *> nodes;
  nodes["Group Input"] = bke::node_add_node(nullptr, *tree, UString("NodeGroupInput"));
  nodes["Group Output"] = bke::node_add_node(nullptr, *tree, UString("NodeGroupOutput"));
  const ArrayValue *list = fragment.lookup_array("nodes");
  for (const std::shared_ptr<Value> &item : list ? list->elements() : Span<std::shared_ptr<Value>>()) {
    const DictionaryValue &n = *item->as_dictionary_value();
    const std::string type(n.lookup_str("type").value_or("node:"));
    bNode *node = bke::node_add_node(nullptr, *tree, UString(StringRef(type).drop_prefix(5)));
    if (!node) {
      continue;
    }
    nodes[std::string(n.lookup_str("name").value_or(""))] = node;
    PointerRNA ptr = RNA_pointer_create_discrete(&tree->id, RNA_Node, node);
    if (const DictionaryValue *settings = n.lookup_dict("settings")) {
      for (const auto &[key, v] : settings->elements()) rna_set(ptr, key, *v);
    }
    BKE_ntree_update_tag_node_property(tree, node);
  }
  /* Sockets follow settings (a Math node's operation, a Compare node's type): values and links once they exist. */
  BKE_ntree_update_without_main(*tree);
  for (const std::shared_ptr<Value> &item : list ? list->elements() : Span<std::shared_ptr<Value>>()) {
    const DictionaryValue &n = *item->as_dictionary_value();
    const auto node = nodes.find(std::string(n.lookup_str("name").value_or("")));
    const DictionaryValue *inputs = n.lookup_dict("inputs");
    if (node == nodes.end() || !inputs) {
      continue;
    }
    for (const auto &[identifier, v] : inputs->elements()) {
      if (bNodeSocket *socket = bke::node_find_socket(*node->second, SOCK_IN, UString(identifier))) {
        PointerRNA ptr = RNA_pointer_create_discrete(&tree->id, RNA_NodeSocket, socket);
        rna_set(ptr, "default_value", *v);
      }
    }
  }
  auto socket = [&](bNode *node, eNodeSocketInOut side, const std::string &identifier) -> bNodeSocket * {
    if (node->is_group_input() || node->is_group_output()) {
      ListBase &sockets = side == SOCK_IN ? node->inputs : node->outputs;
      return static_cast<bNodeSocket *>(BLI_findlink(&sockets, std::stoi(identifier)));
    }
    return bke::node_find_socket(*node, side, UString(identifier));
  };
  MultiValueMap<bNodeSocket *, bNodeLink *> multi_inputs;
  if (const ArrayValue *links = fragment.lookup_array("links")) {
    for (const std::shared_ptr<Value> &item : links->elements()) {
      const Span<std::shared_ptr<Value>> link = item->as_array_value()->elements();
      auto text = [&](int i) { return link[i]->as_string_value()->value(); };
      const auto from = nodes.find(text(0)), to = nodes.find(text(2));
      if (from == nodes.end() || to == nodes.end()) {
        continue;
      }
      bNodeSocket *out = socket(from->second, SOCK_OUT, text(1)), *in = socket(to->second, SOCK_IN, text(3));
      if (out && in) {
        multi_inputs.add(in, &bke::node_add_link(*tree, *from->second, *out, *to->second, *in));
      }
    }
  }
  // port-override: node_add_link numbers a multi-input's links as they come; the request's order is set over it.
  /* A multi-input socket (Join Geometry) takes its links in the request's order: Blender takes the highest sort id
   * first, and gives each new link the next one. */
  for (const auto &[socket, socket_links] : multi_inputs.items()) {
    for (const int i : socket_links.index_range()) {
      socket_links[i]->multi_input_sort_id = int(socket_links.size()) - 1 - i;
    }
  }
  BKE_ntree_update_without_main(*tree);
  return tree;
}

/* A fragment input's value: a geometry, an ID by key, a vector, a rotation as Euler XYZ (3) or a quaternion (4). */
bke::SocketValueVariant input_value(const std::string &type, const Value &value)
{
  const ArrayValue *array = value.as_array_value();
  auto component = [&](int i) { return array && i < int(array->elements().size()) ? float(number(array->elements()[i].get())) : 0.0f; };
  if (type == "GEOMETRY") {
    const DictionaryValue *dict = value.as_dictionary_value();
    return bke::SocketValueVariant::From(dict ? geometry_in(*dict) : bke::GeometrySet());
  }
  if (type == "VALUE") return bke::SocketValueVariant::From(float(number(&value)));
  if (type == "INT") return bke::SocketValueVariant::From(int(number(&value)));
  if (type == "BOOLEAN") return bke::SocketValueVariant::From(number(&value) != 0);
  if (type == "VECTOR") return bke::SocketValueVariant::From(float3(component(0), component(1), component(2)));
  if (type == "RGBA") return bke::SocketValueVariant::From(ColorGeometry4f(component(0), component(1), component(2), array && array->elements().size() > 3 ? component(3) : 1.0f));
  if (type == "ROTATION") {
    return bke::SocketValueVariant::From(array && array->elements().size() == 4 ? math::Quaternion(component(0), component(1), component(2), component(3))
                                                                               : math::to_quaternion(math::EulerXYZ(component(0), component(1), component(2))));
  }
  if (type == "MATRIX") {
    float4x4 matrix = float4x4::identity();
    for (const int i : IndexRange(16)) matrix.base_ptr()[i] = component(i);
    return bke::SocketValueVariant::From(matrix);
  }
  if (type == "STRING") return bke::SocketValueVariant::From(std::string(value.as_string_value() ? value.as_string_value()->value() : ""));
  const DictionaryValue *dict = value.as_dictionary_value();
  ID *id = dict ? id_find(std::string(dict->lookup_str("id").value_or(""))) : nullptr;
  if (type == "OBJECT") return bke::SocketValueVariant::From(reinterpret_cast<Object *>(id));
  if (type == "COLLECTION") return bke::SocketValueVariant::From(reinterpret_cast<Collection *>(id));
  if (type == "MATERIAL") return bke::SocketValueVariant::From(reinterpret_cast<Material *>(id));
  return {};
}

/* A float as JSON, with the digits that give it back exactly. */
std::string real(const float value)
{
  char text[32];
  snprintf(text, sizeof(text), "%.9g", double(value));
  return text;
}

std::string output_value(const std::string &type, bke::SocketValueVariant &value)
{
  if (type == "GEOMETRY") {
    result().geometries.append(value.extract<bke::GeometrySet>());
    return geometry_out(result().geometries.last());
  }
  value.convert_to_single();
  auto numbers = [](const float *v, int n) {
    std::string out = "[";
    for (int i = 0; i < n; i++) out += (i ? "," : "") + real(v[i]);
    return out + "]";
  };
  if (type == "VALUE") return real(value.get<float>());
  if (type == "INT") return std::to_string(value.get<int>());
  if (type == "BOOLEAN") return value.get<bool>() ? "true" : "false";
  if (type == "VECTOR") return numbers(value.get<float3>(), 3);
  if (type == "RGBA") return numbers(value.get<ColorGeometry4f>(), 4);
  if (type == "ROTATION") {
    const math::Quaternion q = value.get<math::Quaternion>();
    const float wxyz[4] = {q.w, q.x, q.y, q.z};
    return numbers(wxyz, 4);
  }
  if (type == "MATRIX") return numbers(value.get<float4x4>().base_ptr(), 16);
  if (type == "STRING") return quoted(value.get<std::string>());
  return "null";
}

/* Runs the tree as execute_geometry_nodes_on_geometry does (geometry_nodes_execute.cc), with every input given (not
 * only the first geometry) and every output read. */
std::string execute(const bNodeTree &tree, const DictionaryValue &request)
{
  using namespace nodes;
  tree.ensure_interface_cache();
  const std::shared_ptr<const GeometryNodesLazyFunctionGraphInfo> graph_info = ensure_geometry_nodes_lazy_function_graph(tree);
  if (!graph_info) {
    return "{\"error\":\"the fragment does not evaluate\"}";
  }
  const GeometryNodesLazyFunctionGraphInfo &info = *graph_info;
  const GeometryNodesGroupFunction &function = info.function;
  const fn::lazy_function::LazyFunction &lazy_function = *function.function;
  const int inputs_num = lazy_function.inputs().size(), outputs_num = lazy_function.outputs().size();
  Array<GMutablePointer> param_inputs(inputs_num), param_outputs(outputs_num);
  Array<std::optional<fn::lazy_function::ValueUsage>> input_usages(inputs_num);
  Array<fn::lazy_function::ValueUsage> output_usages(outputs_num, fn::lazy_function::ValueUsage::Unused);
  Array<bool> set_outputs(outputs_num, false);
  output_usages.as_mutable_span().slice(function.outputs.main).fill(fn::lazy_function::ValueUsage::Used);

  ResourceScope scope;
  GeoNodesModifierData modifier_data;
  modifier_data.self_object = &ids().self;
  GeoNodesCallData call_data;
  call_data.modifier_data = &modifier_data;
  call_data.root_ntree = &tree;
  call_data.call_depth_limit = 100;
  GeoNodesUserData user_data;
  user_data.call_data = &call_data;
  bke::ModifierComputeContext compute_context{nullptr, 0};
  user_data.compute_context = &compute_context;

  const ArrayValue *types = request.lookup_dict("graph")->lookup_array("inputs");
  const ArrayValue *values = request.lookup_array("values");
  for (const int i : tree.interface_inputs().index_range()) {
    const std::string type = types->elements()[i]->as_string_value()->value();
    param_inputs[function.inputs.main[i]] = &scope.construct<bke::SocketValueVariant>(input_value(type, *values->elements()[i]));
  }
  Array<bool> outputs_used(tree.interface_outputs().size(), true);
  for (const int i : outputs_used.index_range()) {
    param_inputs[function.inputs.output_usages[i]] = &outputs_used[i];
  }
  Array<bke::GeometryNodesReferenceSet> propagate(function.inputs.references_to_propagate.geometry_outputs.size());
  for (const int i : propagate.index_range()) {
    param_inputs[function.inputs.references_to_propagate.range[i]] = &propagate[i];
  }
  for (const int i : IndexRange(outputs_num)) {
    const CPPType &type = *lazy_function.outputs()[i].type;
    param_outputs[i] = {type, scope.allocator().allocate(type)};
  }
  GeoNodesLocalUserData local_user_data(user_data);
  fn::lazy_function::Context context(lazy_function.init_storage(scope.allocator()), &user_data, &local_user_data);
  fn::lazy_function::BasicParams params{lazy_function, param_inputs, param_outputs, input_usages, output_usages, set_outputs};
  lazy_function.execute(params, context);
  lazy_function.destruct_storage(context.storage);

  const ArrayValue *output_types = request.lookup_dict("graph")->lookup_array("outputs");
  auto output = [&](int i) -> bke::SocketValueVariant & { return *param_outputs[function.outputs.main[i]].get<bke::SocketValueVariant>(); };
  auto type_of = [&](int i) { return output_types->elements()[i]->as_string_value()->value(); };
  /* A field output (Distribute Points on Faces' Rotation) is captured on the geometry output's components, on the
   * domain it is detected on, as Blender keeps it as an anonymous attribute. */
  std::optional<int> geometry_output;
  for (const int i : function.outputs.main.index_range()) {
    if (type_of(i) == "GEOMETRY") {
      geometry_output = i;
      break;
    }
  }
  std::map<int, std::string> captured;
  if (geometry_output) {
    bke::GeometrySet geometry = output(*geometry_output).extract<bke::GeometrySet>();
    for (const int i : function.outputs.main.index_range()) {
      if (!output(i).is_field()) {
        continue;
      }
      const fn::GField field = output(i).extract<fn::GField>();
      const std::string name = ".bylonder_" + std::to_string(i);
      for (const bke::GeometryComponent::Type type : geometry.gather_component_types(true, true)) {
        bke::GeometryComponent &component = geometry.get_component_for_write(type);
        if (const std::optional<bke::AttrDomain> domain = bke::try_detect_field_domain(component, field)) {
          bke::try_capture_field_on_geometry(component, name, *domain, field);
        }
      }
      captured[i] = name;
    }
    output(*geometry_output).set(std::move(geometry));
  }
  std::string out = "[";
  for (const int i : function.outputs.main.index_range()) {
    out += i ? "," : "";
    out += captured.count(i) ? "{\"attribute\":" + quoted(captured[i]) + "}" : output_value(type_of(i), output(i));
  }
  for (const int i : IndexRange(outputs_num)) {
    if (set_outputs[i]) {
      param_outputs[i].destruct();
    }
  }
  return out + "]";
}

std::unique_ptr<Value> parse(const char *json)
{
  std::istringstream stream(json);
  return io::serialize::JsonFormatter().deserialize(stream);
}

}  // namespace

/* Defines an ID a fragment reads, by its IR key: `{ key, type: 'MATERIAL' }`, `{ key, type: 'OBJECT', matrix: [16]
 * by columns, geometry, materials }` or `{ key, type: 'COLLECTION', objects: [key], children: [key], instance_offset }`.
 * Objects and collections are named as in Blender (the key without its code), which Collection Info sorts by. */
EXPORT(gn_id_define) void gn_id_define(const char *json)
{
  types_ensure();
  const std::unique_ptr<Value> value = parse(json);
  const DictionaryValue &d = *value->as_dictionary_value();
  const std::string key(*d.lookup_str("key")), type(*d.lookup_str("type"));
  const std::string name = key.substr(key.find(':') + 1);
  ID *id = nullptr;
  if (type == "MATERIAL") {
    id = static_cast<ID *>(BKE_id_new_nomain(ID_MA, name.c_str()));
  }
  else if (type == "OBJECT") {
    Object *ob = static_cast<Object *>(BKE_id_new_nomain(ID_OB, name.c_str()));
    ob->type = OB_MESH;
    ob->runtime = MEM_new<bke::ObjectRuntime>(__func__);
    float4x4 matrix = float4x4::identity();
    if (const ArrayValue *m = d.lookup_array("matrix")) {
      for (const int i : IndexRange(std::min<int>(16, m->elements().size()))) matrix.base_ptr()[i] = float(number(m->elements()[i].get()));
    }
    ob->runtime->object_to_world = matrix;
    ob->runtime->world_to_object = math::invert(matrix);
    bke::GeometrySet geometry = d.lookup_dict("geometry") ? geometry_in(*d.lookup_dict("geometry")) : bke::GeometrySet();
    if (Mesh *mesh = geometry.get_mesh_for_write()) {
      materials_set(*mesh, d.lookup_array("materials"));
    }
    ob->runtime->geometry_set_eval = new bke::GeometrySet(std::move(geometry));
    id = &ob->id;
  }
  else if (type == "COLLECTION") {
    Collection *collection = static_cast<Collection *>(BKE_id_new_nomain(ID_GR, name.c_str()));
    if (const ArrayValue *offset = d.lookup_array("instance_offset")) {
      for (const int i : IndexRange(std::min<int>(3, offset->elements().size()))) collection->instance_offset[i] = float(number(offset->elements()[i].get()));
    }
    for (const char *list : {"objects", "children"}) {
      const ArrayValue *keys = d.lookup_array(list);
      for (const std::shared_ptr<Value> &k : keys ? keys->elements() : Span<std::shared_ptr<Value>>()) {
        ID *member = id_find(k->as_string_value()->value());
        if (member && GS(member->name) == ID_OB && list[0] == 'o') {
          CollectionObject *cob = MEM_new<CollectionObject>(__func__);
          cob->ob = reinterpret_cast<Object *>(member);
          BLI_addtail(&collection->gobject, cob);
        }
        else if (member && GS(member->name) == ID_GR) {
          CollectionChild *child = MEM_new<CollectionChild>(__func__);
          child->collection = reinterpret_cast<Collection *>(member);
          BLI_addtail(&collection->children, child);
        }
      }
    }
    id = &collection->id;
  }
  if (id) {
    ids().by_key[key] = id;
    ids().key_of[id] = key;
  }
}

/* Forgets the defined IDs (a new scene). They stay allocated: results may still reference them. */
EXPORT(gn_ids_clear) void gn_ids_clear()
{
  ids().by_key.clear();
  ids().key_of.clear();
}

/* Evaluates `{ graph: fragment, values: [one per fragment input] }`, giving `[one per fragment output]` as JSON:
 * single values inline, geometries with their arrays by address, valid until the next gn_eval or gn_result_free. A
 * geometry kernel's field outputs come back as attributes the fragment stores (`.bylonder_*`). */
EXPORT(gn_eval) const char *gn_eval(const char *json)
{
  types_ensure();
  result() = {};
  const std::unique_ptr<Value> request = parse(json);
  const DictionaryValue &dict = *request->as_dictionary_value();
  bNodeTree *tree = fragment_tree(*dict.lookup_dict("graph"));
  result().json = execute(*tree, dict);
  BKE_id_free(nullptr, &tree->id);
  return result().json.c_str();
}

EXPORT(gn_result_free) void gn_result_free() { result() = {}; }
