/* The depsgraph's relations between IDs, for the IR's references (docs/licence-free-live.md, Relation gaps): what a walk
 * of ID pointers misses (time, the active camera, Geometry Nodes' Object and Collection Info, Self Object). A graph of
 * the scene's view layer is built as Blender builds it, read, and freed. */
#include <set>
#include <string>
#include <tuple>

#include "BKE_main.hh"
#include "DEG_depsgraph.hh"
#include "DEG_depsgraph_build.hh"
#include "DNA_ID.h"
#include "intern/depsgraph.hh"
#include "intern/depsgraph_relation.hh"
#include "intern/node/deg_node.hh"
#include "intern/node/deg_node_component.hh"
#include "intern/node/deg_node_id.hh"
#include "intern/node/deg_node_operation.hh"

using namespace blender;

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

namespace {

/* The IR's key of the ID a depsgraph node belongs to (`OB:Cube`, a linked one's `@library`), or `time`. */
std::string key_of(const deg::Node *node)
{
  const deg::IDNode *id_node = nullptr;
  if (node->type == deg::NodeType::OPERATION) {
    id_node = static_cast<const deg::OperationNode *>(node)->owner->owner;
  }
  else if (node->type == deg::NodeType::ID_REF) {
    id_node = static_cast<const deg::IDNode *>(node);
  }
  else if (node->type == deg::NodeType::TIMESOURCE) {
    return "time";
  }
  else {
    id_node = static_cast<const deg::ComponentNode *>(node)->owner;
  }
  const ID *id = id_node->id_orig;
  std::string key = std::string(id->name, 2) + ":" + (id->name + 2);
  if (id->lib) {
    key += std::string("@") + (id->lib->id.name + 2);
  }
  return key;
}

std::string quoted(const std::string &text)
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

}  // namespace

/* `[{ from, to, name }]`: each relation between two IDs (or from time to an ID) of the view layer's depsgraph, named
 * as Blender's relation builder names it, once per pair and name. Valid until the next call. */
EXPORT(deg_relations) const char *deg_relations(Main *bmain, Scene *scene, ViewLayer *view_layer)
{
  static std::string json;
  Depsgraph *graph = DEG_graph_new(bmain, scene, view_layer, DAG_EVAL_VIEWPORT);
  DEG_graph_build_from_view_layer(graph);
  std::set<std::tuple<std::string, std::string, std::string>> relations;
  const deg::Depsgraph &deg_graph = *reinterpret_cast<const deg::Depsgraph *>(graph);
  auto collect = [&](const deg::Node &to) {
    for (const deg::Relation *relation : to.inlinks) {
      const std::string from = key_of(relation->from), into = key_of(relation->to);
      if (from != into) {
        relations.emplace(from, into, relation->name ? relation->name : "");
      }
    }
  };
  for (const deg::IDNode *id_node : deg_graph.id_nodes) {
    collect(*id_node);
    for (const deg::ComponentNode *component : id_node->components.values()) {
      collect(*component);
      for (const deg::OperationNode *operation : component->operations) {
        collect(*operation);
      }
    }
  }
  DEG_graph_free(graph);
  json = "[";
  for (const auto &[from, to, name] : relations) {
    json += (json.size() > 1 ? "," : "") + std::string("{\"from\":") + quoted(from) + ",\"to\":" + quoted(to) + ",\"name\":" + quoted(name) + "}";
  }
  json += "]";
  return json.c_str();
}
