/* Blender's compositor on its CPU path: the scene's compositing node group evaluated by Blender's own operations
 * (compositor::NodeGroupOperation), its Render Layers' Image the render Bylonder gives (RGBA floats, scene linear),
 * its Group Output's first color the composite. The context is the render pipeline's (render/intern/compositor.cc
 * Context), its render result Bylonder's buffers. On its GPU path, a node's operation alone is recorded on the
 * module's recording GPU backend (gpu-record.cc), for the views to replay. */
#include <cstring>

#include "BLI_listbase.h"
#include "BLI_set.hh"
#include "BLI_math_vector_types.hh"
#include "BLI_vector.hh"
#include "DNA_node_types.h"
#include "DNA_scene_types.h"
#include "BKE_compute_contexts.hh"
#include "BKE_node.hh"
#include "BKE_node_runtime.hh"

#include "COM_context.hh"
#include "COM_domain.hh"
#include "COM_node_group_operation.hh"
#include "COM_realize_on_domain_operation.hh"
#include "COM_result.hh"
#include "COM_static_cache_manager.hh"
#include "COM_implicit_input_operation.hh"
#include "COM_node_operation.hh"
#include "COM_single_value_node_input_operation.hh"
#include "COM_utilities.hh"

#include "gpu-record.hh"

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

using namespace blender;
using namespace blender::compositor;

namespace {

class BylonderContext : public Context {
  const Main &main_;
  const Scene &scene_;
  int2 size_;
  const float *render_;
  bool use_gpu_;

 public:
  Vector<float> output;

  BylonderContext(StaticCacheManager &cache_manager, const Main &main, const Scene &scene, int2 size, const float *render,
                  bool use_gpu = false)
      : Context(cache_manager), main_(main), scene_(scene), size_(size), render_(render), use_gpu_(use_gpu)
  {
  }

  const Main &get_main() const override { return main_; }
  const Scene &get_scene() const override { return scene_; }
  Domain get_compositing_domain() const override { return Domain(size_); }
  bool use_gpu() const override { return use_gpu_; }
  /* The Viewer's image is Blender's editors'; the composite is the Group Output's. */
  void write_viewer(Result & /*viewer_result*/) override {}
  /* The render pipeline's precision; on the GPU path, the viewport compositor's
   * (draw/engines/compositor/compositor_engine.cc Context::get_precision): Auto is half floats. */
  ResultPrecision get_precision() const override
  {
    return use_gpu_ && scene_.r.compositor_precision == SCE_COMPOSITOR_PRECISION_AUTO ? ResultPrecision::Half : ResultPrecision::Full;
  }

  /* The render's Image (Blender's Combined pass) for a view layer the scene has, as render/intern/compositor.cc
   * Context::get_pass finds it (by its index); other passes are not rendered. */
  Result get_pass(const Scene *scene, int view_layer, const char *name) override
  {
    Result pass = this->create_result(ResultType::Color, ResultPrecision::Full);
    const bool has_layer = scene && BLI_findlink(&scene->view_layers, view_layer);
    if (has_layer && (StringRef(name) == "Image" || StringRef(name) == "Combined")) {
      pass.share_data(render_, size_);
    }
    else {
      pass.allocate_invalid();
    }
    return pass;
  }

  void write_output(const Result &result)
  {
    output.resize(size_t(size_.x) * size_.y * 4);
    if (result.is_single_value()) {
      const float4 color = float4(result.get_single_value<Color>());
      for (int64_t i = 0; i < output.size(); i += 4) {
        memcpy(&output[i], &color, sizeof(color));
      }
    }
    else {
      memcpy(output.data(), result.cpu_data().data(), output.size() * sizeof(float));
    }
  }

  /* blender-port: render/intern/compositor.cc Context::evaluate, for the Group Output alone. */
  void evaluate(const bNodeTree &node_group)
  {
    const bke::DataBlockComputeContext compute_context(nullptr, scene_.id);
    NodeGroupOperation operation(*this, node_group, NodeGroupOutputTypes::GroupOutputNode, node_group.active_viewer_key,
                                 bke::NODE_INSTANCE_KEY_BASE, compute_context);
    node_group.ensure_interface_cache();
    for (const bNodeTreeInterfaceSocket *socket : node_group.interface_outputs()) {
      Result &result = operation.get_result(socket->identifier);
      const bool needed = socket == node_group.interface_outputs().first() && result.type() == ResultType::Color;
      result.set_reference_count(needed ? 1 : 0);
    }
    Vector<std::unique_ptr<Result>> inputs;
    for (const bNodeTreeInterfaceSocket *socket : node_group.interface_inputs()) {
      Result *input = new Result(this->create_result(ResultType::Color, ResultPrecision::Full));
      input->allocate_invalid();
      operation.map_input_to_result(socket->identifier, input);
      inputs.append(std::unique_ptr<Result>(input));
    }
    operation.evaluate();
    for (const bNodeTreeInterfaceSocket *socket : node_group.interface_outputs()) {
      Result &result = operation.get_result(socket->identifier);
      if (!result.should_compute()) {
        continue;
      }
      const InputDescriptor descriptor = {ResultType::Color, InputRealizationMode::OperationDomain};
      SimpleOperation *realization = RealizeOnDomainOperation::construct_if_needed(*this, result, descriptor, this->get_compositing_domain());
      if (realization) {
        realization->map_input_to_result(&result);
        realization->evaluate();
        this->write_output(realization->get_result());
        realization->get_result().release();
        delete realization;
        continue;
      }
      this->write_output(result);
      result.release();
    }
  }
};

}  // namespace

/* The scene's composite of a render (`width` by `height` RGBA floats, scene linear, bottom row first) as the same, or
 * null when the scene has no compositing node group or it outputs nothing; valid until the next call. */
EXPORT(compositor_evaluate)
const float *compositor_evaluate(const Main *main, const Scene *scene, const float *render, int width, int height)
{
  static StaticCacheManager cache_manager;
  static Vector<float> output;
  if (!scene->compositing_node_group) {
    return nullptr;
  }
  BylonderContext context(cache_manager, *main, *scene, int2(width, height), render);
  context.evaluate(*scene->compositing_node_group);
  cache_manager.reset();
  output = std::move(context.output);
  return output.is_empty() ? nullptr : output.data();
}

static std::string single_value_json(const Result &result)
{
  const float4 value = result.type() == ResultType::Float ? float4(result.get_single_value<float>()) :
                       result.type() == ResultType::Float3 ? float4(result.get_single_value<float3>(), 0.0f) :
                       result.type() == ResultType::Float4 ? result.get_single_value<float4>() :
                       result.type() == ResultType::Color  ? float4(result.get_single_value<Color>()) :
                                                             float4(0.0f);
  return "[" + std::to_string(value.x) + "," + std::to_string(value.y) + "," + std::to_string(value.z) + "," + std::to_string(value.w) + "]";
}

/* A node's operation (bNodeType::get_compositor_operation) evaluated alone on the GPU path, as recorded (gpu-record.cc
 * Recording::json) with {"inputs": {identifier: texture}, "outputs": {identifier: {"texture"} or {"value"}}}: the inputs
 * named in `linked` (identifiers, one per line) are images of `width` by `height` pixels, the others their values. The
 * recorded uploads' bytes are compositor_recorded_data's. Null for a node without an operation of its own (a pixel
 * node's GPU code is node_gpu_graph's). Valid until the next call. */
EXPORT(compositor_record_node)
const char *compositor_record_node(const Main *main, const Scene *scene, bNodeTree *tree, bNode *node, const char *linked, int width, int height)
{
  static std::string text;
  if (!node->typeinfo->get_compositor_operation || node->typeinfo->gpu_fn) {
    return nullptr;
  }
  Set<std::string> linked_inputs;
  for (const char *line = linked; *line;) {
    const char *end = strchr(line, '\n');
    linked_inputs.add(std::string(line, end ? end - line : strlen(line)));
    line = end ? end + 1 : line + strlen(line);
  }
  tree->ensure_topology_cache();
  const gpu::Recording recording;
  StaticCacheManager cache_manager;
  BylonderContext context(cache_manager, *main, *scene, int2(width, height), nullptr, true);
  std::unique_ptr<NodeOperation> operation(node->typeinfo->get_compositor_operation(context, *node));
  Vector<std::unique_ptr<Operation>> input_operations;
  Vector<std::unique_ptr<Result>> images;
  std::string inputs;
  /* blender-port: compositor/intern/node_group_operation.cc map_node_operation_inputs_to_their_results, with images
   * in place of the linked nodes' results. */
  for (const bNodeSocket *input : node->input_sockets()) {
    if (!is_socket_available(input)) {
      continue;
    }
    if (linked_inputs.contains(input->identifier)) {
      Result *image = new Result(context.create_result(get_node_socket_result_type(input)));
      image->allocate_texture(Domain(int2(width, height)));
      /* Held past the operation, so the texture pool gives none of its textures to the operation's own results. */
      image->set_reference_count(2);
      operation->map_input_to_result(input->identifier, image);
      inputs += (inputs.empty() ? "\"" : ",\"") + std::string(input->identifier) + "\":" + std::to_string(gpu::Recording::id(image->gpu_texture()));
      images.append(std::unique_ptr<Result>(image));
      continue;
    }
    const InputDescriptor descriptor = input_descriptor_from_input_socket(input);
    if (descriptor.implicit_input.has_value()) {
      auto *input_operation = new ImplicitInputOperation(context, descriptor.implicit_input.value());
      input_operations.append(std::unique_ptr<Operation>(input_operation));
      input_operation->evaluate();
      operation->map_input_to_result(input->identifier, &input_operation->get_result());
      continue;
    }
    auto *input_operation = new SingleValueNodeInputOperation(context, *input);
    input_operations.append(std::unique_ptr<Operation>(input_operation));
    input_operation->evaluate();
    operation->map_input_to_result(input->identifier, &input_operation->get_result());
  }
  for (const bNodeSocket *output : node->output_sockets()) {
    if (is_socket_available(output)) {
      operation->get_result(output->identifier).set_reference_count(1);
    }
  }
  operation->evaluate();
  std::string outputs;
  for (const bNodeSocket *output : node->output_sockets()) {
    if (!is_socket_available(output)) {
      continue;
    }
    Result *result = &operation->get_result(output->identifier);
    /* The image realized on the render's domain, where the next node would realize it (a Translate's or a
     * Transform's output is the image with a transformed domain). */
    std::unique_ptr<SimpleOperation> realization;
    if (result->is_allocated() && !result->is_single_value()) {
      const InputDescriptor descriptor = {result->type(), InputRealizationMode::OperationDomain};
      realization.reset(RealizeOnDomainOperation::construct_if_needed(context, *result, descriptor, context.get_compositing_domain()));
    }
    if (realization) {
      realization->map_input_to_result(result);
      realization->evaluate();
      result = &realization->get_result();
    }
    outputs += (outputs.empty() ? "\"" : ",\"") + std::string(output->identifier) + "\":" +
               (!result->is_allocated()      ? std::string("null") :
                result->is_single_value() ? "{\"value\":" + single_value_json(*result) + "}" :
                                            "{\"texture\":" + std::to_string(gpu::Recording::id(result->gpu_texture())) + "}");
    result->release();
  }
  const std::string recorded = gpu::Recording::json();
  text = recorded.substr(0, recorded.size() - 1) + ",\"inputs\":{" + inputs + "},\"outputs\":{" + outputs + "}}";
  return text.c_str();
}

/* The bytes of the uploads compositor_record_node recorded, and their count. */
EXPORT(compositor_recorded_data) const uint8_t *compositor_recorded_data(int *size)
{
  *size = int(gpu::Recording::data().size());
  return gpu::Recording::data().data();
}

/* Whether a node type runs as an operation of its own (compositor_record_node records it), not as GPU code. */
EXPORT(node_type_has_operation) bool node_type_has_operation(const char *idname)
{
  const bke::bNodeType *type = bke::node_type_find(UString(idname));
  return type && type->get_compositor_operation && !type->gpu_fn;
}
