// Forked by tools/babylon-editor/vendor.mjs from Babylon.js 8.32.0 (tools/nodeRenderGraphEditor/src, Apache-2.0); do not edit.
import { NodeRenderGraphAnaglyphPostProcessBlock, NodeRenderGraphBlackAndWhitePostProcessBlock, NodeRenderGraphBlockConnectionPointTypes, NodeRenderGraphBloomPostProcessBlock, NodeRenderGraphBlurPostProcessBlock, NodeRenderGraphCascadedShadowGeneratorBlock, NodeRenderGraphChromaticAberrationPostProcessBlock, NodeRenderGraphCircleOfConfusionPostProcessBlock, NodeRenderGraphClearBlock, NodeRenderGraphColorCorrectionPostProcessBlock, NodeRenderGraphConvolutionPostProcessBlock, NodeRenderGraphCopyTextureBlock, NodeRenderGraphCullObjectsBlock, NodeRenderGraphDepthOfFieldPostProcessBlock, NodeRenderGraphElbowBlock, NodeRenderGraphExecuteBlock, NodeRenderGraphExtractHighlightsPostProcessBlock, NodeRenderGraphFXAAPostProcessBlock, NodeRenderGraphFilterPostProcessBlock, NodeRenderGraphGenerateMipmapsBlock, NodeRenderGraphGeometryRendererBlock, NodeRenderGraphGlowLayerBlock, NodeRenderGraphGrainPostProcessBlock, NodeRenderGraphHighlightLayerBlock, NodeRenderGraphImageProcessingPostProcessBlock, NodeRenderGraphInputBlock, NodeRenderGraphMotionBlurPostProcessBlock, NodeRenderGraphObjectRendererBlock, NodeRenderGraphOutputBlock, NodeRenderGraphPassCubePostProcessBlock, NodeRenderGraphPassPostProcessBlock, NodeRenderGraphResourceContainerBlock, NodeRenderGraphSSRPostProcessBlock, NodeRenderGraphScreenSpaceCurvaturePostProcessBlock, NodeRenderGraphShadowGeneratorBlock, NodeRenderGraphSharpenPostProcessBlock, NodeRenderGraphTAAObjectRendererBlock, NodeRenderGraphTeleportInBlock, NodeRenderGraphTeleportOutBlock, NodeRenderGraphTonemapPostProcessBlock, NodeRenderGraphUtilityLayerRendererBlock } from '@babylonjs/core';
import { NodeRenderGraphGUIBlock } from '@babylonjs/gui';
/**
 * Static class for BlockTools
 */
export class BlockTools {
    static GetBlockFromString(data, frameGraph, scene) {
        switch (data) {
            case "TeleportInBlock":
                return new NodeRenderGraphTeleportInBlock("Teleport In", frameGraph, scene);
            case "TeleportOutBlock":
                return new NodeRenderGraphTeleportOutBlock("Teleport Out", frameGraph, scene);
            case "OutputBlock":
                return new NodeRenderGraphOutputBlock("Output", frameGraph, scene);
            case "ElbowBlock":
                return new NodeRenderGraphElbowBlock("", frameGraph, scene);
            case "ResourceContainerBlock":
                return new NodeRenderGraphResourceContainerBlock("Resources", frameGraph, scene);
            case "ExecuteBlock":
                return new NodeRenderGraphExecuteBlock("Execute", frameGraph, scene);
            case "UtilityLayerRendererBlock":
                return new NodeRenderGraphUtilityLayerRendererBlock("Utility Layer", frameGraph, scene);
            case "TextureBlock": {
                return new NodeRenderGraphInputBlock("Texture", frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.Texture);
            }
            case "TextureBackBufferBlock": {
                return new NodeRenderGraphInputBlock("Backbuffer color", frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.TextureBackBuffer);
            }
            case "TextureBackBufferDepthStencilBlock": {
                return new NodeRenderGraphInputBlock("Backbuffer depth/stencil", frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.TextureBackBufferDepthStencilAttachment);
            }
            case "TextureDepthStencilBlock": {
                return new NodeRenderGraphInputBlock("Depth/stencil texture", frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.TextureDepthStencilAttachment);
            }
            case "CameraBlock": {
                return new NodeRenderGraphInputBlock("Camera", frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.Camera);
            }
            case "ObjectListBlock": {
                return new NodeRenderGraphInputBlock("Object list", frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.ObjectList);
            }
            case "ShadowLightBlock": {
                return new NodeRenderGraphInputBlock("Shadow light", frameGraph, scene, NodeRenderGraphBlockConnectionPointTypes.ShadowLight);
            }
            case "ClearBlock": {
                return new NodeRenderGraphClearBlock("Clear", frameGraph, scene);
            }
            case "CopyTextureBlock": {
                return new NodeRenderGraphCopyTextureBlock("Copy texture", frameGraph, scene);
            }
            case "GenerateMipmapsBlock": {
                return new NodeRenderGraphGenerateMipmapsBlock("Generate mipmaps", frameGraph, scene);
            }
            case "BlackAndWhiteBlock": {
                return new NodeRenderGraphBlackAndWhitePostProcessBlock("Black and White", frameGraph, scene);
            }
            case "BloomBlock": {
                return new NodeRenderGraphBloomPostProcessBlock("Bloom", frameGraph, scene);
            }
            case "BlurBlock": {
                return new NodeRenderGraphBlurPostProcessBlock("Blur", frameGraph, scene);
            }
            case "PassBlock": {
                return new NodeRenderGraphPassPostProcessBlock("Pass", frameGraph, scene);
            }
            case "PassCubeBlock": {
                return new NodeRenderGraphPassCubePostProcessBlock("Pass cube", frameGraph, scene);
            }
            case "GUIBlock": {
                return new NodeRenderGraphGUIBlock("GUI", frameGraph, scene);
            }
            case "ObjectRendererBlock": {
                return new NodeRenderGraphObjectRendererBlock("Object renderer", frameGraph, scene);
            }
            case "GeometryRendererBlock": {
                return new NodeRenderGraphGeometryRendererBlock("Geometry renderer", frameGraph, scene);
            }
            case "TAAObjectRendererBlock": {
                return new NodeRenderGraphTAAObjectRendererBlock("TAA Object renderer", frameGraph, scene);
            }
            case "CullBlock": {
                return new NodeRenderGraphCullObjectsBlock("Cull", frameGraph, scene);
            }
            case "CircleOfConfusionBlock": {
                return new NodeRenderGraphCircleOfConfusionPostProcessBlock("Circle of Confusion", frameGraph, scene);
            }
            case "DepthOfFieldBlock": {
                return new NodeRenderGraphDepthOfFieldPostProcessBlock("Depth of Field", frameGraph, scene);
            }
            case "ExtractHighlightsBlock": {
                return new NodeRenderGraphExtractHighlightsPostProcessBlock("Extract Highlights", frameGraph, scene);
            }
            case "ShadowGeneratorBlock": {
                return new NodeRenderGraphShadowGeneratorBlock("Shadow Generator", frameGraph, scene);
            }
            case "CascadedShadowGeneratorBlock": {
                return new NodeRenderGraphCascadedShadowGeneratorBlock("Cascaded Shadow Generator", frameGraph, scene);
            }
            case "GlowLayerBlock": {
                return new NodeRenderGraphGlowLayerBlock("Glow Layer", frameGraph, scene);
            }
            case "HighlightLayerBlock": {
                return new NodeRenderGraphHighlightLayerBlock("Highlight Layer", frameGraph, scene);
            }
            case "SSRBlock": {
                return new NodeRenderGraphSSRPostProcessBlock("SSR", frameGraph, scene);
            }
            case "AnaglyphBlock": {
                return new NodeRenderGraphAnaglyphPostProcessBlock("Anaglyph", frameGraph, scene);
            }
            case "ChromaticAberrationBlock": {
                return new NodeRenderGraphChromaticAberrationPostProcessBlock("Chromatic Aberration", frameGraph, scene);
            }
            case "ImageProcessingBlock": {
                return new NodeRenderGraphImageProcessingPostProcessBlock("Image Processing", frameGraph, scene);
            }
            case "FXAABlock": {
                return new NodeRenderGraphFXAAPostProcessBlock("FXAA", frameGraph, scene);
            }
            case "GrainBlock": {
                return new NodeRenderGraphGrainPostProcessBlock("Grain", frameGraph, scene);
            }
            case "MotionBlurBlock": {
                return new NodeRenderGraphMotionBlurPostProcessBlock("Motion Blur", frameGraph, scene);
            }
            case "ConvolutionBlock": {
                return new NodeRenderGraphConvolutionPostProcessBlock("Convolution", frameGraph, scene);
            }
            case "SharpenBlock": {
                return new NodeRenderGraphSharpenPostProcessBlock("Sharpen", frameGraph, scene);
            }
            case "ScreenSpaceCurvatureBlock": {
                return new NodeRenderGraphScreenSpaceCurvaturePostProcessBlock("Screen Space Curvature", frameGraph, scene);
            }
            case "ColorCorrectionBlock": {
                return new NodeRenderGraphColorCorrectionPostProcessBlock("Color Correction", frameGraph, scene, "https://assets.babylonjs.com/textures/co.png");
            }
            case "FilterBlock": {
                return new NodeRenderGraphFilterPostProcessBlock("Filter", frameGraph, scene);
            }
            case "TonemapBlock": {
                return new NodeRenderGraphTonemapPostProcessBlock("Tonemap", frameGraph, scene);
            }
        }
        return null;
    }
    static GetColorFromConnectionNodeType(type) {
        let color = "#964848";
        switch (type) {
            case NodeRenderGraphBlockConnectionPointTypes.ObjectList:
                color = "#84995c";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.Camera:
                color = "#e24975";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.Texture:
                color = "#f28e0a";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureBackBuffer:
                color = "#51dcc5";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureBackBufferDepthStencilAttachment:
                color = "#51e5c4";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureDepthStencilAttachment:
                color = "#51e593";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureViewDepth:
            case NodeRenderGraphBlockConnectionPointTypes.TextureNormalizedViewDepth:
                color = "#51e566";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureViewNormal:
                color = "#7ee551";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureAlbedo:
                color = "#b9e551";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureReflectivity:
                color = "#e5af51";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureWorldPosition:
                color = "#e58551";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureVelocity:
                color = "#e55151";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureScreenDepth:
                color = "#e55185";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureLocalPosition:
                color = "#e551a8";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureWorldNormal:
                color = "#e551d5";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.TextureLinearVelocity:
                color = "#c451e5";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.ResourceContainer:
                color = "#adad92";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.ShadowGenerator:
                color = "#495e77";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.ShadowLight:
                color = "#e08e4b";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.BasedOnInput:
                color = "#f28e0a"; // Used by the teleport blocks
                break;
            case NodeRenderGraphBlockConnectionPointTypes.AutoDetect: // Used by the elbow block
                color = "#880000";
                break;
            case NodeRenderGraphBlockConnectionPointTypes.Object:
                color = "#6174FA";
                break;
            default:
                throw new Error("Unknown connection point type: " + type);
        }
        return color;
    }
    static GetConnectionNodeTypeFromString(type) {
        switch (type) {
            case "Texture":
                return NodeRenderGraphBlockConnectionPointTypes.Texture;
            case "TextureBackBuffer":
                return NodeRenderGraphBlockConnectionPointTypes.TextureBackBuffer;
            case "TextureBackBufferDepthStencilAttachment":
                return NodeRenderGraphBlockConnectionPointTypes.TextureBackBufferDepthStencilAttachment;
            case "TextureDepthStencilAttachment":
                return NodeRenderGraphBlockConnectionPointTypes.TextureDepthStencilAttachment;
            case "Camera":
                return NodeRenderGraphBlockConnectionPointTypes.Camera;
            case "ObjectList":
                return NodeRenderGraphBlockConnectionPointTypes.ObjectList;
            case "TextureViewDepth":
                return NodeRenderGraphBlockConnectionPointTypes.TextureViewDepth;
            case "TextureNormalizedViewDepth":
                return NodeRenderGraphBlockConnectionPointTypes.TextureNormalizedViewDepth;
            case "TextureNormal":
                return NodeRenderGraphBlockConnectionPointTypes.TextureViewNormal;
            case "TextureAlbedo":
                return NodeRenderGraphBlockConnectionPointTypes.TextureAlbedo;
            case "TextureReflectivity":
                return NodeRenderGraphBlockConnectionPointTypes.TextureReflectivity;
            case "TexturePosition":
                return NodeRenderGraphBlockConnectionPointTypes.TextureWorldPosition;
            case "TextureVelocity":
                return NodeRenderGraphBlockConnectionPointTypes.TextureVelocity;
            case "TextureScreenDepth":
                return NodeRenderGraphBlockConnectionPointTypes.TextureScreenDepth;
            case "TextureLocalPosition":
                return NodeRenderGraphBlockConnectionPointTypes.TextureLocalPosition;
            case "TextureWorldNormal":
                return NodeRenderGraphBlockConnectionPointTypes.TextureWorldNormal;
            case "TextureLinearVelocity":
                return NodeRenderGraphBlockConnectionPointTypes.TextureLinearVelocity;
            case "ResourceContainer":
                return NodeRenderGraphBlockConnectionPointTypes.ResourceContainer;
            case "ShadowGenerator":
                return NodeRenderGraphBlockConnectionPointTypes.ShadowGenerator;
            case "ShadowLight":
                return NodeRenderGraphBlockConnectionPointTypes.ShadowLight;
        }
        return NodeRenderGraphBlockConnectionPointTypes.AutoDetect;
    }
    static GetStringFromConnectionNodeType(type) {
        switch (type) {
            case NodeRenderGraphBlockConnectionPointTypes.Texture:
                return "Texture";
            case NodeRenderGraphBlockConnectionPointTypes.TextureBackBuffer:
                return "TextureBackBuffer";
            case NodeRenderGraphBlockConnectionPointTypes.TextureBackBufferDepthStencilAttachment:
                return "TextureBackBufferDepthStencilAttachment";
            case NodeRenderGraphBlockConnectionPointTypes.TextureDepthStencilAttachment:
                return "TextureDepthStencilAttachment";
            case NodeRenderGraphBlockConnectionPointTypes.Camera:
                return "Camera";
            case NodeRenderGraphBlockConnectionPointTypes.ObjectList:
                return "ObjectList";
            case NodeRenderGraphBlockConnectionPointTypes.TextureViewDepth:
                return "TextureViewDepth";
            case NodeRenderGraphBlockConnectionPointTypes.TextureNormalizedViewDepth:
                return "TextureNormalizedViewDepth";
            case NodeRenderGraphBlockConnectionPointTypes.TextureViewNormal:
                return "TextureNormal";
            case NodeRenderGraphBlockConnectionPointTypes.TextureAlbedo:
                return "TextureAlbedo";
            case NodeRenderGraphBlockConnectionPointTypes.TextureReflectivity:
                return "TextureReflectivity";
            case NodeRenderGraphBlockConnectionPointTypes.TextureWorldPosition:
                return "TexturePosition";
            case NodeRenderGraphBlockConnectionPointTypes.TextureVelocity:
                return "TextureVelocity";
            case NodeRenderGraphBlockConnectionPointTypes.TextureScreenDepth:
                return "TextureScreenDepth";
            case NodeRenderGraphBlockConnectionPointTypes.TextureLocalPosition:
                return "TextureLocalPosition";
            case NodeRenderGraphBlockConnectionPointTypes.TextureWorldNormal:
                return "TextureWorldNormal";
            case NodeRenderGraphBlockConnectionPointTypes.TextureLinearVelocity:
                return "TextureLinearVelocity";
            case NodeRenderGraphBlockConnectionPointTypes.ResourceContainer:
                return "ResourceContainer";
            case NodeRenderGraphBlockConnectionPointTypes.ShadowGenerator:
                return "ShadowGenerator";
            case NodeRenderGraphBlockConnectionPointTypes.ShadowLight:
                return "ShadowLight";
        }
        return "";
    }
}

export const categories = {
 "Inputs": [
  "TextureBlock",
  "TextureBackBufferBlock",
  "TextureBackBufferDepthStencilBlock",
  "TextureDepthStencilBlock",
  "ObjectListBlock",
  "CameraBlock",
  "ShadowLightBlock"
 ],
 "Layers": [
  "GlowLayerBlock",
  "HighlightLayerBlock"
 ],
 "Misc": [
  "ElbowBlock",
  "TeleportInBlock",
  "TeleportOutBlock",
  "GUIBlock",
  "ResourceContainerBlock",
  "CullBlock",
  "ExecuteBlock"
 ],
 "Post_Processes": [
  "AnaglyphBlock",
  "BlackAndWhiteBlock",
  "BloomBlock",
  "BlurBlock",
  "ChromaticAberrationBlock",
  "CircleOfConfusionBlock",
  "ColorCorrectionBlock",
  "ConvolutionBlock",
  "DepthOfFieldBlock",
  "ExtractHighlightsBlock",
  "FilterBlock",
  "FXAABlock",
  "GrainBlock",
  "ImageProcessingBlock",
  "MotionBlurBlock",
  "PassBlock",
  "PassCubeBlock",
  "ScreenSpaceCurvatureBlock",
  "SharpenBlock",
  "SSRBlock",
  "TonemapBlock"
 ],
 "Output_Nodes": [
  "OutputBlock"
 ],
 "Rendering": [
  "ObjectRendererBlock",
  "GeometryRendererBlock",
  "TAAObjectRendererBlock",
  "ShadowGeneratorBlock",
  "CascadedShadowGeneratorBlock",
  "UtilityLayerRendererBlock"
 ],
 "Textures": [
  "ClearBlock",
  "CopyTextureBlock",
  "GenerateMipmapsBlock"
 ]
};
export const tooltips = {
 "TextureBlock": "Input block set to a texture value",
 "TextureBackBufferBlock": "Input block corresponding to the back buffer color texture",
 "TextureBackBufferDepthStencilBlock": "Input block corresponding to the back buffer depth/stencil texture",
 "TextureDepthStencilBlock": "Input block corresponding to a depth/stencil texture",
 "ElbowBlock": "Passthrough block mostly used to organize your graph",
 "TeleportInBlock": "Passthrough block mostly used to organize your graph (but without visible lines). It works like a teleportation point for the graph.",
 "TeleportOutBlock": "Endpoint for a TeleportInBlock.",
 "OutputBlock": "Output block used to gather the final render graph",
 "ClearBlock": "Clears a texture",
 "CopyTextureBlock": "Copies a texture to another texture",
 "GenerateMipmapsBlock": "Generates mipmaps for a texture",
 "BlackAndWhiteBlock": "Applies a black and white post process",
 "BloomBlock": "Applies a bloom post process",
 "BlurBlock": "Applies a blur post process",
 "CircleOfConfusionBlock": "Applies a circle of confusion post process",
 "DepthOfFieldBlock": "Applies a depth of field post process",
 "ExtractHighlightsBlock": "Applies an extract highlights post process",
 "PassBlock": "Applies a pass post process",
 "PassCubeBlock": "Applies a pass cube post process",
 "GUIBlock": "Used to render a GUI",
 "ObjectRendererBlock": "Renders objects to a render target",
 "TAAObjectRendererBlock": "Renders objects with Temporal Anti-Aliasing to a render target",
 "GeometryRendererBlock": "Generates geometry buffers for a list of objects",
 "ObjectListBlock": "List of objects (meshes, particle systems, sprites)",
 "CullBlock": "Culls a list of objects",
 "CameraBlock": "Camera",
 "ResourceContainerBlock": "Container of resources (textures, buffers, shadow generators)",
 "ShadowLightBlock": "Shadow light (used by the shadow generator block)",
 "ShadowGeneratorBlock": "Generates shadows through a shadow generator",
 "CascadedShadowGeneratorBlock": "Generates shadows through a cascaded shadow generator",
 "ExecuteBlock": "Block used to execute a custom function",
 "GlowLayerBlock": "Adds a glow effect to a texture",
 "HighlightLayerBlock": "Adds a highlight effect to a texture",
 "UtilityLayerRendererBlock": "Renders an utility layer",
 "SSRBlock": "Applies a Screen Space Reflection post process",
 "AnaglyphBlock": "Applies an anaglyph post process",
 "ChromaticAberrationBlock": "Applies a chromatic aberration post process",
 "ImageProcessingBlock": "Applies an image processing post process",
 "FXAABlock": "Applies a FXAA post process",
 "GrainBlock": "Applies a grain post process",
 "MotionBlurBlock": "Applies a motion blur post process",
 "ConvolutionBlock": "Applies a convolution post process",
 "ScreenSpaceCurvatureBlock": "Applies a screen space curvature post process",
 "SharpenBlock": "Applies a sharpen post process",
 "ColorCorrectionBlock": "Applies a color correction post process",
 "FilterBlock": "Applies a kernel filter post process",
 "TonemapBlock": "Applies a tonemapping post process"
};
