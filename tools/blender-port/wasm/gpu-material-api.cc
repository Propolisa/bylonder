/* A node's GPU code as Blender builds it: the node's own GPU function (bNodeType::gpu_fn, node_gpu_material) runs on
 * Blender's GPU node graph (gpu_node_graph.cc, compiled from Blender), its inputs linked as Blender's compositor links
 * a pixel operation's (ShaderOperation::link_node_inputs), and the graph is read back as JSON for the Babylon blocks
 * that run the node (src/nodes/blender/compositor-nodes.js). The graph's GLSL function signatures come from Blender's
 * GLSL libraries Bylonder ships (gpu-library.js), read by JS (gpu_function_signature). This is the first part of
 * Bylonder's recording GPU backend for Blender's compositor (docs/node-editors.md). */
#include <algorithm>
#include <cstring>
#include <string>

#include "BKE_node.hh"
#include "BKE_node_runtime.hh"
#include "BKE_node_tree_update.hh"
#include "BKE_lib_id.hh"
#include "BLI_listbase.h"
#include "BLI_map.hh"
#include "BLI_math_vector.h"
#include "BLI_string.h"
#include "BLI_vector.hh"
#include "DNA_image_types.h"
#include "DNA_node_types.h"
#include "MEM_guardedalloc.h"

#include "COM_shader_node.hh"
#include "GPU_material.hh"
#include "gpu_material_library.hh"
#include "gpu_node_graph.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))
#define IMPORT(name) extern "C" __attribute__((import_module("env"), import_name(#name)))

/* A GLSL function's parameters (GPUType and GPUFunctionQual each, at most `max`), as Blender's shader tool reads a
 * node function's signature (shader_tool/processor.cc parse_library_functions); -1 when no library has it. */
IMPORT(gpu_function_signature) int gpu_function_signature(const char *name, int *types, int *quals, int max);

namespace blender {

/* port-override: Blender's GPU material (gpu_material.cc) compiles shaders; here it holds the node graph and the color
 * band rows its nodes add. */
struct GPUMaterial {
  GPUNodeGraph graph = {};
  Vector<Vector<float>> bands;
};

/* port-override: the function library is read from the shipped GLSL (gpu_shader_dependency.cc parses Blender's at
 * startup). */
GPUFunction *gpu_material_library_get_function(const char *name)
{
  static Map<std::string, GPUFunction *> functions;
  return functions.lookup_or_add_cb(name, [&]() -> GPUFunction * {
    int types[MAX_PARAMETER], quals[MAX_PARAMETER];
    const int count = gpu_function_signature(name, types, quals, MAX_PARAMETER);
    if (count < 0) {
      return nullptr;
    }
    GPUFunction *function = MEM_new<GPUFunction>(__func__);
    STRNCPY(function->name, name);
    function->totparam = count;
    for (int i = 0; i < count; i++) {
      function->paramtype[i] = GPUType(types[i]);
      function->paramqual[i] = GPUFunctionQual(quals[i]);
    }
    return function;
  });
}

GPUNodeGraph *gpu_material_node_graph(GPUMaterial *material) { return &material->graph; }

/* port-override: a color band's row is kept with its pixels, which the JSON gives (gpu_material.cc uploads them to the
 * material's ramp texture). The returned "texture" is the row's index. */
gpu::Texture **gpu_material_ramp_texture_row_set(GPUMaterial *mat, int size, const float *pixels, float *r_row)
{
  *r_row = float(mat->bands.size());
  mat->bands.append(Vector<float>(Span<float>(pixels, size * 4)));
  return reinterpret_cast<gpu::Texture **>(intptr_t(mat->bands.size()));
}

/* port-override: the Sky Texture's precomputed sky is Bylonder's (shader-node-api.cc sky_texture). */
gpu::Texture **gpu_material_sky_texture_layer_set(GPUMaterial * /*mat*/, int, int, const float *, float *row)
{
  *row = 0.0f;
  return nullptr;
}

/* port-override: material flags steer Blender's engines' passes, which Bylonder's are not. */
void GPU_material_flag_set(GPUMaterial * /*mat*/, eGPUMaterialFlag /*flag*/) {}

}  // namespace blender

using namespace blender;

/* A node's input value on its GPU node stack (blender-port: compositor/intern/shader_operation.cc
 * initialize_input_stack_value), and whether Blender links it as a constant rather than a uniform. */
static bool input_stack_value(const bNodeSocket &input, GPUNodeStack &stack)
{
  zero_v4(stack.vec);
  switch (input.type) {
    case SOCK_FLOAT:
      stack.vec[0] = input.default_value_typed<bNodeSocketValueFloat>()->value;
      return false;
    case SOCK_INT:
      stack.vec[0] = float(input.default_value_typed<bNodeSocketValueInt>()->value);
      return false;
    case SOCK_BOOLEAN:
      stack.vec[0] = float(input.default_value_typed<bNodeSocketValueBoolean>()->value);
      return true;
    case SOCK_MENU:
      stack.vec[0] = float(input.default_value_typed<bNodeSocketValueMenu>()->value);
      return true;
    case SOCK_VECTOR:
      copy_v4_v4(stack.vec, input.default_value_typed<bNodeSocketValueVector>()->value);
      return false;
    case SOCK_RGBA:
      copy_v4_v4(stack.vec, input.default_value_typed<bNodeSocketValueRGBA>()->value);
      return false;
    default:
      return false;
  }
}

/* The set function Blender's compositor links a value of the stack's type through (shader_operation.cc
 * get_set_function_name, by GPU type). */
static const char *set_function(const bNodeSocket &socket, const GPUType type)
{
  if (socket.type == SOCK_RGBA) {
    return "set_color";
  }
  switch (type) {
    case GPU_VEC2:
      return "set_float2";
    case GPU_VEC3:
      return "set_float3";
    case GPU_VEC4:
      return "set_float4";
    default:
      return "set_float";
  }
}

static std::string json_floats(const float *values, int count)
{
  std::string text = "[";
  for (int i = 0; i < count; i++) {
    text += (i ? "," : "") + std::to_string(values[i]);
  }
  return text + "]";
}

static std::string quoted(const char *s) { return std::string("\"") + s + "\""; }

/* The graph as JSON: its nodes in order, each a GLSL function call with its inputs (another node's output by id, a
 * constant or uniform value, an image input of the operation, a color band row, a function name) and its outputs' ids
 * and types; the node's output sockets' ids; the color bands' pixels. */
static std::string graph_json(GPUMaterial &material, const bNode &node, compositor::ShaderNode &shader_node)
{
  Map<const GPUOutput *, int> ids;
  for (const GPUNode &gpu_node : material.graph.nodes) {
    for (const GPUOutput &output : gpu_node.outputs) {
      ids.add(&output, ids.size());
    }
  }
  std::string text = "{\"nodes\":[";
  bool first = true;
  for (const GPUNode &gpu_node : material.graph.nodes) {
    text += (first ? "" : ",") + std::string("{\"name\":") + quoted(gpu_node.name) + ",\"inputs\":[";
    first = false;
    bool first_input = true;
    for (const GPUInput &input : gpu_node.inputs) {
      std::string value;
      switch (input.source) {
        case GPU_SOURCE_OUTPUT:
          value = "\"source\":\"output\",\"from\":" + std::to_string(ids.lookup(input.link->output));
          break;
        case GPU_SOURCE_CONSTANT:
        case GPU_SOURCE_UNIFORM:
          value = std::string("\"source\":\"") + (input.source == GPU_SOURCE_CONSTANT ? "constant" : "uniform") +
                  "\",\"value\":" + json_floats(input.vec, std::min(int(input.type), 16));
          break;
        case GPU_SOURCE_ATTR:
          value = "\"source\":\"image\",\"name\":" + quoted(input.attr->name);
          break;
        case GPU_SOURCE_TEX:
          value = input.texture->colorband ? "\"source\":\"band\",\"band\":" + std::to_string(intptr_t(input.texture->colorband) - 1) :
                  input.texture->ima         ? "\"source\":\"texture\",\"image\":" + quoted(input.texture->ima->id.name + 2) :
                                               std::string("\"source\":\"texture\"");
          break;
        case GPU_SOURCE_FUNCTION_CALL:
          value = "\"source\":\"function\",\"name\":" + quoted(input.function_call);
          break;
        default:
          value = "\"source\":\"unknown\"";
          break;
      }
      text += (first_input ? "{" : ",{") + std::string("\"type\":") + std::to_string(input.type) + "," + value + "}";
      first_input = false;
    }
    text += "],\"outputs\":[";
    bool first_output = true;
    for (const GPUOutput &output : gpu_node.outputs) {
      text += (first_output ? "{" : ",{") + std::string("\"type\":") + std::to_string(output.type) + ",\"id\":" +
              std::to_string(ids.lookup(&output)) + "}";
      first_output = false;
    }
    text += "]}";
  }
  text += "],\"outputs\":{";
  first = true;
  for (const bNodeSocket *socket : node.output_sockets()) {
    const GPUNodeLink *link = shader_node.get_output(socket->identifier).link;
    if (link && link->link_type == GPU_NODE_LINK_OUTPUT) {
      text += (first ? "" : ",") + quoted(socket->identifier) + ":" + std::to_string(ids.lookup(link->output));
      first = false;
    }
  }
  text += "},\"bands\":[";
  first = true;
  for (const Vector<float> &band : material.bands) {
    text += (first ? "" : ",") + json_floats(band.data(), band.size());
    first = false;
  }
  return text + "]}";
}

/* A node's GPU code as JSON (graph_json), its inputs named in `linked` (identifiers, one per line) linked from images
 * and the others taking their values, until the next call. The node's tree gets a reroute linked into each such input,
 * as its GPU function may ask whether an input is linked (Color Balance's white point). */
EXPORT(node_gpu_graph) const char *node_gpu_graph(bNodeTree *tree, bNode *node, const char *linked)
{
  static std::string text;
  if (!node->typeinfo->gpu_fn) {
    return "{\"nodes\":[],\"outputs\":{},\"bands\":[]}";
  }
  Vector<std::string> identifiers;
  for (const char *line = linked; *line;) {
    const char *end = strchr(line, '\n');
    identifiers.append(std::string(line, end ? end - line : strlen(line)));
    line = end ? end + 1 : line + strlen(line);
  }
  for (const std::string &identifier : identifiers) {
    bNodeSocket *input = bke::node_find_socket(*node, SOCK_IN, UString(identifier.c_str()));
    if (input && !input->is_directly_linked()) {
      bNode *reroute = bke::node_add_node(nullptr, *tree, UString("NodeReroute"));
      bke::node_add_link(*tree, *reroute, *static_cast<bNodeSocket *>(reroute->outputs.first), *node, *input);
    }
  }
  BKE_ntree_update_without_main(*tree);
  tree->ensure_topology_cache();

  GPUMaterial material;
  compositor::ShaderNode shader_node(*node);
  for (const bNodeSocket *input : node->input_sockets()) {
    GPUNodeStack &stack = shader_node.get_input(input->identifier);
    if (stack.type == GPU_NONE) {
      continue;
    }
    if (!input->is_available()) {
      zero_v4(stack.vec);
      GPU_link(&material, "set_float", GPU_constant(stack.vec), &stack.link);
    }
    else if (identifiers.contains(input->identifier)) {
      GPU_link(&material, set_function(*input, stack.type), GPU_attribute(&material, CD_AUTO_FROM_NAME, input->identifier), &stack.link);
    }
    else {
      const bool constant = input_stack_value(*input, stack);
      GPU_link(&material, set_function(*input, stack.type), constant ? GPU_constant(stack.vec) : GPU_uniform(stack.vec), &stack.link);
    }
  }
  shader_node.compile(&material);
  text = graph_json(material, *node, shader_node);
  gpu_node_graph_free(&material.graph);
  return text.c_str();
}

/* Whether a node type has GPU code (a GPU function node_gpu_graph runs). */
EXPORT(node_type_has_gpu) bool node_type_has_gpu(const char *idname)
{
  const bke::bNodeType *type = bke::node_type_find(UString(idname));
  return type && type->gpu_fn;
}
