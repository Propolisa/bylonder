/* OpenSubdiv's GPU evaluator in Blender (intern/opensubdiv/internal/evaluator/gpu_compute_evaluator.cc) includes
 * <epoxy/gl.h> but calls only Blender's GPU module; the module has no OpenGL, so this stands in for it. */
#pragma once
