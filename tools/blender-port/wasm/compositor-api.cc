/* Blender's compositor on its CPU path: the scene's compositing node group evaluated by Blender's own operations
 * (compositor::NodeGroupOperation), its Render Layers' Image the render Bylonder gives (RGBA floats, scene linear),
 * its Group Output's first color the composite. The context is the render pipeline's (render/intern/compositor.cc
 * Context), its render result Bylonder's buffers. */
#include <cstring>

#include "BLI_listbase.h"
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

#define EXPORT(name) extern "C" __attribute__((export_name(#name)))

using namespace blender;
using namespace blender::compositor;

namespace {

class BylonderContext : public Context {
  const Main &main_;
  const Scene &scene_;
  int2 size_;
  const float *render_;

 public:
  Vector<float> output;

  BylonderContext(StaticCacheManager &cache_manager, const Main &main, const Scene &scene, int2 size, const float *render)
      : Context(cache_manager), main_(main), scene_(scene), size_(size), render_(render)
  {
  }

  const Main &get_main() const override { return main_; }
  const Scene &get_scene() const override { return scene_; }
  Domain get_compositing_domain() const override { return Domain(size_); }
  bool use_gpu() const override { return false; }
  /* The Viewer's image is Blender's editors'; the composite is the Group Output's. */
  void write_viewer(Result & /*viewer_result*/) override {}
  ResultPrecision get_precision() const override { return ResultPrecision::Full; }

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
