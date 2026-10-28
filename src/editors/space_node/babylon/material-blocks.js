// Forked by tools/babylon-editor/vendor.mjs from Babylon.js 8.32.0 (tools/nodeEditor/src, Apache-2.0); do not edit.
import { AddBlock, AmbientOcclusionBlock, AnimatedInputBlockTypes, AnisotropyBlock, ArcTan2Block, BiPlanarBlock, BonesBlock, ClampBlock, ClearCoatBlock, ClipPlanesBlock, CloudBlock, ColorConverterBlock, ColorMergerBlock, ColorSplitterBlock, ConditionalBlock, ConditionalBlockConditions, CrossBlock, CurrentScreenBlock, CurveBlock, DepthSourceBlock, DerivativeBlock, DesaturateBlock, DiscardBlock, DistanceBlock, DivideBlock, DotBlock, ElbowBlock, FogBlock, FragCoordBlock, FragDepthBlock, FragmentOutputBlock, FresnelBlock, FrontFacingBlock, GaussianBlock, GaussianSplattingBlock, GradientBlock, HeightToNormalBlock, ImageProcessingBlock, ImageSourceBlock, InputBlock, InstancesBlock, IridescenceBlock, LengthBlock, LerpBlock, LightBlock, LightInformationBlock, LoopBlock, MatrixBuilderBlock, MatrixDeterminantBlock, MatrixSplitterBlock, MatrixTransposeBlock, MaxBlock, MeshAttributeExistsBlock, MinBlock, ModBlock, MorphTargetsBlock, MultiplyBlock, NLerpBlock, NegateBlock, NodeMaterialBlockConnectionPointTypes, NodeMaterialDebugBlock, NodeMaterialModes, NodeMaterialSystemValues, NodeMaterialTeleportInBlock, NodeMaterialTeleportOutBlock, NormalBlendBlock, NormalizeBlock, OneMinusBlock, PBRMetallicRoughnessBlock, ParticleBlendMultiplyBlock, ParticleRampGradientBlock, ParticleTextureBlock, PerturbNormalBlock, PosterizeBlock, PowBlock, PrePassOutputBlock, PrePassTextureBlock, RandomNumberBlock, ReciprocalBlock, ReflectBlock, ReflectionBlock, ReflectionTextureBlock, RefractBlock, RefractionBlock, RemapBlock, ReplaceColorBlock, Rotate2dBlock, ScaleBlock, SceneDepthBlock, ScreenSizeBlock, ScreenSpaceBlock, ShadowMapBlock, SheenBlock, SimplexPerlin3DBlock, SmartFilterTextureBlock, SmoothStepBlock, SplatReaderBlock, StepBlock, StorageReadBlock, StorageWriteBlock, SubSurfaceBlock, SubtractBlock, TBNBlock, TextureBlock, TransformBlock, TriPlanarBlock, TrigonometryBlock, TrigonometryBlockOperations, TwirlBlock, VectorMergerBlock, VectorSplitterBlock, VertexOutputBlock, ViewDirectionBlock, VoronoiNoiseBlock, WaveBlock, WaveBlockKind, WorleyNoise3DBlock } from '@babylonjs/core';
export class BlockTools {
    static GetBlockFromString(data, scene, nodeMaterial) {
        switch (data) {
            case "AmbientOcclusionBlock":
                return new AmbientOcclusionBlock("Ambient Occlusion");
            case "DebugBlock":
                return new NodeMaterialDebugBlock("Debug");
            case "MatrixSplitterBlock":
                return new MatrixSplitterBlock("Matrix Splitter");
            case "StorageWriteBlock":
                return new StorageWriteBlock("StorageWrite");
            case "StorageReadBlock":
                return new StorageReadBlock("StorageRead");
            case "LoopBlock":
                return new LoopBlock("Loop");
            case "ColorConverterBlock":
                return new ColorConverterBlock("ColorConverter");
            case "TeleportInBlock":
                return new NodeMaterialTeleportInBlock("Teleport In");
            case "TeleportOutBlock":
                return new NodeMaterialTeleportOutBlock("Teleport Out");
            case "HeightToNormalBlock":
                return new HeightToNormalBlock("HeightToNormal");
            case "ElbowBlock":
                return new ElbowBlock("");
            case "TwirlBlock":
                return new TwirlBlock("Twirl");
            case "VoronoiNoiseBlock":
                return new VoronoiNoiseBlock("VoronoiNoise");
            case "ScreenSpaceBlock":
                return new ScreenSpaceBlock("ScreenSpace");
            case "CloudBlock":
                return new CloudBlock("Cloud");
            case "MatrixBuilderBlock":
                return new MatrixBuilderBlock("MatrixBuilder");
            case "DesaturateBlock":
                return new DesaturateBlock("Desaturate");
            case "RefractBlock":
                return new RefractBlock("Refract");
            case "ReflectBlock":
                return new ReflectBlock("Reflect");
            case "DerivativeBlock":
                return new DerivativeBlock("Derivative");
            case "Rotate2dBlock":
                return new Rotate2dBlock("Rotate2d");
            case "NormalBlendBlock":
                return new NormalBlendBlock("NormalBlend");
            case "WorleyNoise3DBlock":
                return new WorleyNoise3DBlock("WorleyNoise3D");
            case "SimplexPerlin3DBlock":
                return new SimplexPerlin3DBlock("SimplexPerlin3D");
            case "BonesBlock":
                return new BonesBlock("Bones");
            case "InstancesBlock":
                return new InstancesBlock("Instances");
            case "MorphTargetsBlock":
                return new MorphTargetsBlock("MorphTargets");
            case "DiscardBlock":
                return new DiscardBlock("Discard");
            case "PrePassTextureBlock":
                return new PrePassTextureBlock("PrePassTexture");
            case "ImageProcessingBlock":
                return new ImageProcessingBlock("ImageProcessing");
            case "ColorMergerBlock":
                return new ColorMergerBlock("ColorMerger");
            case "VectorMergerBlock":
                return new VectorMergerBlock("VectorMerger");
            case "ColorSplitterBlock":
                return new ColorSplitterBlock("ColorSplitter");
            case "VectorSplitterBlock":
                return new VectorSplitterBlock("VectorSplitter");
            case "TextureBlock":
                return new TextureBlock("Texture", nodeMaterial.mode === NodeMaterialModes.Particle);
            case "ReflectionTextureBlock":
                return new ReflectionTextureBlock("Reflection texture");
            case "LightBlock":
                return new LightBlock("Lights");
            case "FogBlock":
                return new FogBlock("Fog");
            case "VertexOutputBlock":
                return new VertexOutputBlock("VertexOutput");
            case "FragmentOutputBlock":
                return new FragmentOutputBlock("FragmentOutput");
            case "PrePassOutputBlock":
                return new PrePassOutputBlock("PrePassOutput");
            case "AddBlock":
                return new AddBlock("Add");
            case "ClampBlock":
                return new ClampBlock("Clamp");
            case "ScaleBlock":
                return new ScaleBlock("Scale");
            case "CrossBlock":
                return new CrossBlock("Cross");
            case "DotBlock":
                return new DotBlock("Dot");
            case "PowBlock":
                return new PowBlock("Pow");
            case "MultiplyBlock":
                return new MultiplyBlock("Multiply");
            case "TransformBlock":
                return new TransformBlock("Transform");
            case "TrigonometryBlock":
                return new TrigonometryBlock("Trigonometry");
            case "RemapBlock":
                return new RemapBlock("Remap");
            case "NormalizeBlock":
                return new NormalizeBlock("Normalize");
            case "FresnelBlock":
                return new FresnelBlock("Fresnel");
            case "LerpBlock":
                return new LerpBlock("Lerp");
            case "NLerpBlock":
                return new NLerpBlock("NLerp");
            case "DivideBlock":
                return new DivideBlock("Divide");
            case "SubtractBlock":
                return new SubtractBlock("Subtract");
            case "ModBlock":
                return new ModBlock("Mod");
            case "StepBlock":
                return new StepBlock("Step");
            case "SmoothStepBlock":
                return new SmoothStepBlock("Smooth step");
            case "OneMinusBlock":
                return new OneMinusBlock("One minus");
            case "ReciprocalBlock":
                return new ReciprocalBlock("Reciprocal");
            case "ViewDirectionBlock":
                return new ViewDirectionBlock("View direction");
            case "LightInformationBlock": {
                const lightInformationBlock = new LightInformationBlock("Light information");
                lightInformationBlock.light = scene.lights.length ? scene.lights[0] : null;
                return lightInformationBlock;
            }
            case "MaxBlock":
                return new MaxBlock("Max");
            case "MinBlock":
                return new MinBlock("Min");
            case "LengthBlock":
                return new LengthBlock("Length");
            case "DistanceBlock":
                return new DistanceBlock("Distance");
            case "NegateBlock":
                return new NegateBlock("Negate");
            case "PerturbNormalBlock":
                return new PerturbNormalBlock("Perturb normal");
            case "TBNBlock":
                return new TBNBlock("TBN");
            case "RandomNumberBlock":
                return new RandomNumberBlock("Random number");
            case "ReplaceColorBlock":
                return new ReplaceColorBlock("Replace color");
            case "PosterizeBlock":
                return new PosterizeBlock("Posterize");
            case "ArcTan2Block":
                return new ArcTan2Block("ArcTan2");
            case "GradientBlock":
                return new GradientBlock("Gradient");
            case "FrontFacingBlock":
                return new FrontFacingBlock("Front facing");
            case "MeshAttributeExistsBlock":
                return new MeshAttributeExistsBlock("Attribute exists");
            case "CosBlock": {
                const cosBlock = new TrigonometryBlock("Cos");
                cosBlock.operation = TrigonometryBlockOperations.Cos;
                return cosBlock;
            }
            case "SinBlock": {
                const sinBlock = new TrigonometryBlock("Sin");
                sinBlock.operation = TrigonometryBlockOperations.Sin;
                return sinBlock;
            }
            case "AbsBlock": {
                const absBlock = new TrigonometryBlock("Abs");
                absBlock.operation = TrigonometryBlockOperations.Abs;
                return absBlock;
            }
            case "SqrtBlock": {
                const sqrtBlock = new TrigonometryBlock("Sqrt");
                sqrtBlock.operation = TrigonometryBlockOperations.Sqrt;
                return sqrtBlock;
            }
            case "ArcCosBlock": {
                const acosBlock = new TrigonometryBlock("ArcCos");
                acosBlock.operation = TrigonometryBlockOperations.ArcCos;
                return acosBlock;
            }
            case "ArcSinBlock": {
                const asinBlock = new TrigonometryBlock("ArcSin");
                asinBlock.operation = TrigonometryBlockOperations.ArcSin;
                return asinBlock;
            }
            case "TanBlock": {
                const tanBlock = new TrigonometryBlock("Tan");
                tanBlock.operation = TrigonometryBlockOperations.Tan;
                return tanBlock;
            }
            case "ArcTanBlock": {
                const atanBlock = new TrigonometryBlock("ArcTan");
                atanBlock.operation = TrigonometryBlockOperations.ArcTan;
                return atanBlock;
            }
            case "FractBlock": {
                const fractBlock = new TrigonometryBlock("Fract");
                fractBlock.operation = TrigonometryBlockOperations.Fract;
                return fractBlock;
            }
            case "SignBlock": {
                const signBlock = new TrigonometryBlock("Sign");
                signBlock.operation = TrigonometryBlockOperations.Sign;
                return signBlock;
            }
            case "LogBlock": {
                const logBlock = new TrigonometryBlock("Log");
                logBlock.operation = TrigonometryBlockOperations.Log;
                return logBlock;
            }
            case "ExpBlock": {
                const expBlock = new TrigonometryBlock("Exp");
                expBlock.operation = TrigonometryBlockOperations.Exp;
                return expBlock;
            }
            case "Exp2Block": {
                const exp2Block = new TrigonometryBlock("Exp2");
                exp2Block.operation = TrigonometryBlockOperations.Exp2;
                return exp2Block;
            }
            case "DegreesToRadiansBlock": {
                const degreesToRadiansBlock = new TrigonometryBlock("Degrees to radians");
                degreesToRadiansBlock.operation = TrigonometryBlockOperations.Radians;
                return degreesToRadiansBlock;
            }
            case "RadiansToDegreesBlock": {
                const radiansToDegreesBlock = new TrigonometryBlock("Radians to degrees");
                radiansToDegreesBlock.operation = TrigonometryBlockOperations.Degrees;
                return radiansToDegreesBlock;
            }
            case "RoundBlock": {
                const roundBlock = new TrigonometryBlock("Round");
                roundBlock.operation = TrigonometryBlockOperations.Round;
                return roundBlock;
            }
            case "CeilingBlock": {
                const ceilingBlock = new TrigonometryBlock("Ceiling");
                ceilingBlock.operation = TrigonometryBlockOperations.Ceiling;
                return ceilingBlock;
            }
            case "FloorBlock": {
                const floorBlock = new TrigonometryBlock("Floor");
                floorBlock.operation = TrigonometryBlockOperations.Floor;
                return floorBlock;
            }
            case "SawToothWaveBlock": {
                const sawToothWaveBlock = new WaveBlock("SawTooth wave");
                sawToothWaveBlock.kind = WaveBlockKind.SawTooth;
                return sawToothWaveBlock;
            }
            case "SquareWaveBlock": {
                const squareWaveBlock = new WaveBlock("Square wave");
                squareWaveBlock.kind = WaveBlockKind.Square;
                return squareWaveBlock;
            }
            case "TriangleWaveBlock": {
                const triangleWaveBlock = new WaveBlock("Triangle wave");
                triangleWaveBlock.kind = WaveBlockKind.Triangle;
                return triangleWaveBlock;
            }
            case "SetBlock": {
                const cosBlock = new TrigonometryBlock("Set");
                cosBlock.operation = TrigonometryBlockOperations.Set;
                return cosBlock;
            }
            case "WorldMatrixBlock": {
                const worldMatrixBlock = new InputBlock("World");
                worldMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.World);
                return worldMatrixBlock;
            }
            case "WorldViewMatrixBlock": {
                const worldViewMatrixBlock = new InputBlock("World x View");
                worldViewMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.WorldView);
                return worldViewMatrixBlock;
            }
            case "WorldViewProjectionMatrixBlock": {
                const worldViewProjectionMatrixBlock = new InputBlock("World x View x Projection");
                worldViewProjectionMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.WorldViewProjection);
                return worldViewProjectionMatrixBlock;
            }
            case "ViewMatrixBlock": {
                const viewMatrixBlock = new InputBlock("View");
                viewMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.View);
                return viewMatrixBlock;
            }
            case "ViewProjectionMatrixBlock": {
                const viewProjectionMatrixBlock = new InputBlock("View x Projection");
                viewProjectionMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.ViewProjection);
                return viewProjectionMatrixBlock;
            }
            case "ProjectionMatrixBlock": {
                const projectionMatrixBlock = new InputBlock("Projection");
                projectionMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.Projection);
                return projectionMatrixBlock;
            }
            case "ProjectionInverseMatrixBlock": {
                const projectionInverseMatrixBlock = new InputBlock("ProjectionInverse");
                projectionInverseMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.ProjectionInverse);
                return projectionInverseMatrixBlock;
            }
            case "CameraPositionBlock": {
                const cameraPosition = new InputBlock("Camera position");
                cameraPosition.setAsSystemValue(NodeMaterialSystemValues.CameraPosition);
                return cameraPosition;
            }
            case "CameraParametersBlock": {
                const cameraParameters = new InputBlock("Camera parameters");
                cameraParameters.setAsSystemValue(NodeMaterialSystemValues.CameraParameters);
                const splitter = new VectorSplitterBlock("Vector splitter");
                cameraParameters.connectTo(splitter);
                return splitter;
            }
            case "FogColorBlock": {
                const fogColor = new InputBlock("Fog color");
                fogColor.setAsSystemValue(NodeMaterialSystemValues.FogColor);
                return fogColor;
            }
            case "PositionBlock": {
                const meshPosition = new InputBlock("position");
                meshPosition.setAsAttribute("position");
                return meshPosition;
            }
            case "ScreenPositionBlock": {
                const meshPosition = new InputBlock("position");
                meshPosition.setAsAttribute("position2d");
                return meshPosition;
            }
            case "UVBlock": {
                const meshUV = new InputBlock("uv");
                meshUV.setAsAttribute("uv");
                return meshUV;
            }
            case "ColorBlock": {
                const meshColor = new InputBlock("color");
                meshColor.setAsAttribute("color");
                return meshColor;
            }
            case "InstanceColorBlock": {
                const meshColor = new InputBlock("Instance Color");
                meshColor.setAsAttribute("instanceColor");
                return meshColor;
            }
            case "SplatIndexBlock": {
                const splatIndex = new InputBlock("SplatIndex");
                splatIndex.setAsAttribute("splatIndex");
                return splatIndex;
            }
            case "NormalBlock": {
                const meshNormal = new InputBlock("normal");
                meshNormal.setAsAttribute("normal");
                return meshNormal;
            }
            case "TangentBlock": {
                const meshTangent = new InputBlock("tangent");
                meshTangent.setAsAttribute("tangent");
                return meshTangent;
            }
            case "MatrixIndicesBlock": {
                const meshMatrixIndices = new InputBlock("matricesIndices");
                meshMatrixIndices.setAsAttribute("matricesIndices");
                return meshMatrixIndices;
            }
            case "MatrixWeightsBlock": {
                const meshMatrixWeights = new InputBlock("matricesWeights");
                meshMatrixWeights.setAsAttribute("matricesWeights");
                return meshMatrixWeights;
            }
            case "MatrixIndicesExtraBlock": {
                const meshMatrixIndices = new InputBlock("matricesIndicesExtra");
                meshMatrixIndices.setAsAttribute("matricesIndicesExtra");
                return meshMatrixIndices;
            }
            case "MatrixWeightsExtraBlock": {
                const meshMatrixWeights = new InputBlock("matricesWeightsExtra");
                meshMatrixWeights.setAsAttribute("matricesWeightsExtra");
                return meshMatrixWeights;
            }
            case "MouseInfoBlock": {
                const mouseInfoBlock = new InputBlock("MouseInfo", undefined, NodeMaterialBlockConnectionPointTypes.Vector4);
                mouseInfoBlock.animationType = AnimatedInputBlockTypes.MouseInfo;
                return mouseInfoBlock;
            }
            case "TimeBlock": {
                const timeBlock = new InputBlock("Time", undefined, NodeMaterialBlockConnectionPointTypes.Float);
                timeBlock.animationType = AnimatedInputBlockTypes.Time;
                return timeBlock;
            }
            case "RealTimeBlock": {
                const realTimeBlock = new InputBlock("RealTime", undefined, NodeMaterialBlockConnectionPointTypes.Float);
                realTimeBlock.animationType = AnimatedInputBlockTypes.RealTime;
                return realTimeBlock;
            }
            case "DeltaTimeBlock": {
                const deltaTimeBlock = new InputBlock("Delta time");
                deltaTimeBlock.setAsSystemValue(NodeMaterialSystemValues.DeltaTime);
                return deltaTimeBlock;
            }
            case "MaterialAlphaBlock": {
                const deltaTimeBlock = new InputBlock("Material alpha");
                deltaTimeBlock.setAsSystemValue(NodeMaterialSystemValues.MaterialAlpha);
                return deltaTimeBlock;
            }
            case "WorldPositionBlock": {
                let worldPositionBlock = nodeMaterial.getInputBlockByPredicate((b) => b.isAttribute && b.name === "position");
                if (!worldPositionBlock) {
                    worldPositionBlock = new InputBlock("position");
                    worldPositionBlock.setAsAttribute("position");
                }
                let worldMatrixBlock = nodeMaterial.getInputBlockByPredicate((b) => b.isSystemValue && b.systemValue === NodeMaterialSystemValues.World);
                if (!worldMatrixBlock) {
                    worldMatrixBlock = new InputBlock("World");
                    worldMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.World);
                }
                const transformBlock = new TransformBlock("World position");
                worldPositionBlock.connectTo(transformBlock);
                worldMatrixBlock.connectTo(transformBlock);
                return transformBlock;
            }
            case "WorldNormalBlock": {
                let worldNormalBlock = nodeMaterial.getInputBlockByPredicate((b) => b.isAttribute && b.name === "normal");
                if (!worldNormalBlock) {
                    worldNormalBlock = new InputBlock("normal");
                    worldNormalBlock.setAsAttribute("normal");
                }
                let worldMatrixBlock = nodeMaterial.getInputBlockByPredicate((b) => b.isSystemValue && b.systemValue === NodeMaterialSystemValues.World);
                if (!worldMatrixBlock) {
                    worldMatrixBlock = new InputBlock("World");
                    worldMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.World);
                }
                const transformBlock = new TransformBlock("World normal");
                worldNormalBlock.connectTo(transformBlock);
                worldMatrixBlock.connectTo(transformBlock);
                return transformBlock;
            }
            case "WorldTangentBlock": {
                let worldTangentBlock = nodeMaterial.getInputBlockByPredicate((b) => b.isAttribute && b.name === "tangent");
                if (!worldTangentBlock) {
                    worldTangentBlock = new InputBlock("tangent");
                    worldTangentBlock.setAsAttribute("tangent");
                }
                let worldMatrixBlock = nodeMaterial.getInputBlockByPredicate((b) => b.isSystemValue && b.systemValue === NodeMaterialSystemValues.World);
                if (!worldMatrixBlock) {
                    worldMatrixBlock = new InputBlock("World");
                    worldMatrixBlock.setAsSystemValue(NodeMaterialSystemValues.World);
                }
                const transformBlock = new TransformBlock("World tangent");
                worldTangentBlock.connectTo(transformBlock);
                worldMatrixBlock.connectTo(transformBlock);
                return transformBlock;
            }
            case "PBRMetallicRoughnessBlock":
                return new PBRMetallicRoughnessBlock("PBRMetallicRoughness");
            case "SheenBlock":
                return new SheenBlock("Sheen");
            case "AnisotropyBlock":
                return new AnisotropyBlock("Anisotropy");
            case "ReflectionBlock":
                return new ReflectionBlock("Reflection");
            case "ClearCoatBlock":
                return new ClearCoatBlock("ClearCoat");
            case "RefractionBlock":
                return new RefractionBlock("Refraction");
            case "SubSurfaceBlock":
                return new SubSurfaceBlock("SubSurface");
            case "IridescenceBlock":
                return new IridescenceBlock("Iridescence");
            case "CurrentScreenBlock":
                return new CurrentScreenBlock("CurrentScreen");
            case "ParticleUVBlock": {
                const uv = new InputBlock("uv");
                uv.setAsAttribute("particle_uv");
                return uv;
            }
            case "ParticleTextureBlock":
                return new ParticleTextureBlock("ParticleTexture");
            case "ParticleColorBlock": {
                const color = new InputBlock("Color");
                color.setAsAttribute("particle_color");
                return color;
            }
            case "ParticleTextureMaskBlock": {
                const u = new InputBlock("TextureMask");
                u.setAsAttribute("particle_texturemask");
                return u;
            }
            case "ParticlePositionWorldBlock": {
                const pos = new InputBlock("PositionWorld");
                pos.setAsAttribute("particle_positionw");
                return pos;
            }
            case "ScreenUVBlock": {
                const uv = new InputBlock("uv");
                uv.setAsAttribute("postprocess_uv");
                return uv;
            }
            case "ParticleRampGradientBlock":
                return new ParticleRampGradientBlock("ParticleRampGradient");
            case "ParticleBlendMultiplyBlock":
                return new ParticleBlendMultiplyBlock("ParticleBlendMultiply");
            case "FragCoordBlock":
                return new FragCoordBlock("FragCoord");
            case "ScreenSizeBlock":
                return new ScreenSizeBlock("ScreenSize");
            case "SceneDepthBlock":
                return new SceneDepthBlock("SceneDepth");
            case "EqualBlock": {
                const equalBlock = new ConditionalBlock("Equal");
                equalBlock.condition = ConditionalBlockConditions.Equal;
                return equalBlock;
            }
            case "NotEqualBlock": {
                const notEqualBlock = new ConditionalBlock("NotEqual");
                notEqualBlock.condition = ConditionalBlockConditions.NotEqual;
                return notEqualBlock;
            }
            case "LessThanBlock": {
                const lessThanBlock = new ConditionalBlock("LessThan");
                lessThanBlock.condition = ConditionalBlockConditions.LessThan;
                return lessThanBlock;
            }
            case "LessOrEqualBlock": {
                const lessOrEqualBlock = new ConditionalBlock("LessOrEqual");
                lessOrEqualBlock.condition = ConditionalBlockConditions.LessOrEqual;
                return lessOrEqualBlock;
            }
            case "GreaterThanBlock": {
                const greaterThanBlock = new ConditionalBlock("GreaterThan");
                greaterThanBlock.condition = ConditionalBlockConditions.GreaterThan;
                return greaterThanBlock;
            }
            case "GreaterOrEqualBlock": {
                const greaterOrEqualBlock = new ConditionalBlock("GreaterOrEqual");
                greaterOrEqualBlock.condition = ConditionalBlockConditions.GreaterOrEqual;
                return greaterOrEqualBlock;
            }
            case "XorBlock": {
                const xorBlock = new ConditionalBlock("Xor");
                xorBlock.condition = ConditionalBlockConditions.Xor;
                return xorBlock;
            }
            case "OrBlock": {
                const orBlock = new ConditionalBlock("Or");
                orBlock.condition = ConditionalBlockConditions.Or;
                return orBlock;
            }
            case "AndBlock": {
                const andBlock = new ConditionalBlock("And");
                andBlock.condition = ConditionalBlockConditions.And;
                return andBlock;
            }
            case "ImageSourceBlock":
                return new ImageSourceBlock("ImageSource");
            case "DepthSourceBlock":
                return new DepthSourceBlock("DepthSource");
            case "ClipPlanesBlock":
                return new ClipPlanesBlock("ClipPlanes");
            case "FragDepthBlock":
                return new FragDepthBlock("FragDepth");
            case "ShadowMapBlock":
                return new ShadowMapBlock("ShadowMap");
            case "TriPlanarBlock":
                return new TriPlanarBlock("TriPlanarTexture");
            case "BiPlanarBlock":
                return new BiPlanarBlock("BiPlanarTexture");
            case "MatrixTransposeBlock":
                return new MatrixTransposeBlock("Transpose");
            case "MatrixDeterminantBlock":
                return new MatrixDeterminantBlock("Determinant");
            case "CurveBlock":
                return new CurveBlock("Curve");
            case "GaussianSplattingBlock":
                return new GaussianSplattingBlock("GaussianSplatting");
            case "GaussianBlock":
                return new GaussianBlock("Gaussian");
            case "SplatReaderBlock":
                return new SplatReaderBlock("SplatReader");
            case "SmartFilterTextureBlock":
                return new SmartFilterTextureBlock("SmartFilterTexture");
        }
        return null;
    }
    static GetColorFromConnectionNodeType(type) {
        let color = "#964848";
        switch (type) {
            case NodeMaterialBlockConnectionPointTypes.Float:
                color = "#cb9e27";
                break;
            case NodeMaterialBlockConnectionPointTypes.Vector2:
                color = "#16bcb1";
                break;
            case NodeMaterialBlockConnectionPointTypes.Vector3:
            case NodeMaterialBlockConnectionPointTypes.Color3:
                color = "#b786cb";
                break;
            case NodeMaterialBlockConnectionPointTypes.Vector4:
            case NodeMaterialBlockConnectionPointTypes.Color4:
                color = "#be5126";
                break;
            case NodeMaterialBlockConnectionPointTypes.Matrix:
                color = "#591990";
                break;
            case NodeMaterialBlockConnectionPointTypes.Object:
                color = "#6174FA";
                break;
        }
        return color;
    }
    static GetConnectionNodeTypeFromString(type) {
        switch (type) {
            case "Float":
                return NodeMaterialBlockConnectionPointTypes.Float;
            case "Vector2":
                return NodeMaterialBlockConnectionPointTypes.Vector2;
            case "Vector3":
                return NodeMaterialBlockConnectionPointTypes.Vector3;
            case "Vector4":
                return NodeMaterialBlockConnectionPointTypes.Vector4;
            case "Matrix":
                return NodeMaterialBlockConnectionPointTypes.Matrix;
            case "Color3":
                return NodeMaterialBlockConnectionPointTypes.Color3;
            case "Color4":
                return NodeMaterialBlockConnectionPointTypes.Color4;
        }
        return NodeMaterialBlockConnectionPointTypes.AutoDetect;
    }
    static GetStringFromConnectionNodeType(type) {
        switch (type) {
            case NodeMaterialBlockConnectionPointTypes.Float:
                return "Float";
            case NodeMaterialBlockConnectionPointTypes.Vector2:
                return "Vector2";
            case NodeMaterialBlockConnectionPointTypes.Vector3:
                return "Vector3";
            case NodeMaterialBlockConnectionPointTypes.Vector4:
                return "Vector4";
            case NodeMaterialBlockConnectionPointTypes.Color3:
                return "Color3";
            case NodeMaterialBlockConnectionPointTypes.Color4:
                return "Color4";
            case NodeMaterialBlockConnectionPointTypes.Matrix:
                return "Matrix";
        }
        return "";
    }
}

export const categories = {
 "SFE": [
  "ScreenUVBlock",
  "SmartFilterTextureBlock",
  "SmartFilterFragmentOutputBlock"
 ],
 "Animation": [
  "BonesBlock",
  "MorphTargetsBlock"
 ],
 "Color_Management": [
  "ReplaceColorBlock",
  "PosterizeBlock",
  "GradientBlock",
  "DesaturateBlock",
  "ColorConverterBlock"
 ],
 "Conversion_Blocks": [
  "ColorMergerBlock",
  "ColorSplitterBlock",
  "VectorMergerBlock",
  "VectorSplitterBlock"
 ],
 "Inputs": [
  "Float",
  "Vector2",
  "Vector3",
  "Vector4",
  "Color3",
  "Color4",
  "TextureBlock",
  "ReflectionTextureBlock",
  "MouseInfoBlock",
  "TimeBlock",
  "RealTimeBlock",
  "DeltaTimeBlock",
  "MaterialAlphaBlock",
  "FragCoordBlock",
  "ScreenSizeBlock",
  "ImageSourceBlock",
  "DepthSourceBlock",
  "TriPlanarBlock",
  "BiPlanarBlock"
 ],
 "Interpolation": [
  "LerpBlock",
  "StepBlock",
  "SmoothStepBlock",
  "NLerpBlock"
 ],
 "Logical": [
  "EqualBlock",
  "NotEqualBlock",
  "LessThanBlock",
  "LessOrEqualBlock",
  "GreaterThanBlock",
  "GreaterOrEqualBlock",
  "XorBlock",
  "OrBlock",
  "AndBlock"
 ],
 "Math__Standard": [
  "AddBlock",
  "DivideBlock",
  "MaxBlock",
  "MinBlock",
  "ModBlock",
  "MultiplyBlock",
  "NegateBlock",
  "OneMinusBlock",
  "ReciprocalBlock",
  "ScaleBlock",
  "SignBlock",
  "SqrtBlock",
  "SubtractBlock"
 ],
 "Math__Scientific": [
  "AbsBlock",
  "ArcCosBlock",
  "ArcSinBlock",
  "ArcTanBlock",
  "ArcTan2Block",
  "CosBlock",
  "CurveBlock",
  "DegreesToRadiansBlock",
  "ExpBlock",
  "Exp2Block",
  "FractBlock",
  "LogBlock",
  "PowBlock",
  "RadiansToDegreesBlock",
  "SawToothWaveBlock",
  "SinBlock",
  "SquareWaveBlock",
  "TanBlock",
  "TriangleWaveBlock",
  "SetBlock"
 ],
 "Math__Vector": [
  "CrossBlock",
  "DerivativeBlock",
  "DistanceBlock",
  "DotBlock",
  "FresnelBlock",
  "LengthBlock",
  "ReflectBlock",
  "RefractBlock",
  "Rotate2dBlock",
  "TransformBlock",
  "ScreenSpaceBlock",
  "TwirlBlock"
 ],
 "Matrices": [
  "Matrix",
  "WorldMatrixBlock",
  "WorldViewMatrixBlock",
  "WorldViewProjectionMatrixBlock",
  "ViewMatrixBlock",
  "ViewProjectionMatrixBlock",
  "ProjectionMatrixBlock",
  "ProjectionInverseMatrixBlock",
  "MatrixBuilderBlock",
  "MatrixDeterminantBlock",
  "MatrixTransposeBlock",
  "MatrixSplitterBlock"
 ],
 "Misc": [
  "ElbowBlock",
  "ShadowMapBlock",
  "TeleportInBlock",
  "TeleportOutBlock",
  "DebugBlock",
  "AmbientOcclusionBlock"
 ],
 "Mesh": [
  "InstancesBlock",
  "PositionBlock",
  "UVBlock",
  "ColorBlock",
  "InstanceColorBlock",
  "NormalBlock",
  "HeightToNormalBlock",
  "TBNBlock",
  "PerturbNormalBlock",
  "NormalBlendBlock",
  "TangentBlock",
  "MatrixIndicesBlock",
  "MatrixWeightsBlock",
  "MatrixIndicesExtraBlock",
  "MatrixWeightsExtraBlock",
  "WorldPositionBlock",
  "WorldNormalBlock",
  "WorldTangentBlock",
  "FrontFacingBlock",
  "MeshAttributeExistsBlock"
 ],
 "Loop": [
  "LoopBlock",
  "StorageReadBlock",
  "StorageWriteBlock"
 ],
 "Noises": [
  "RandomNumberBlock",
  "SimplexPerlin3DBlock",
  "WorleyNoise3DBlock",
  "CloudBlock",
  "VoronoiNoiseBlock"
 ],
 "Output_Nodes": [
  "VertexOutputBlock",
  "FragmentOutputBlock",
  "PrePassOutputBlock",
  "DiscardBlock",
  "ClipPlanesBlock",
  "FragDepthBlock"
 ],
 "Particle": [
  "ParticleBlendMultiplyBlock",
  "ParticleColorBlock",
  "ParticlePositionWorldBlock",
  "ParticleRampGradientBlock",
  "ParticleTextureBlock",
  "ParticleTextureMaskBlock",
  "ParticleUVBlock"
 ],
 "GaussianSplatting": [
  "GaussianSplattingBlock",
  "SplatIndexBlock",
  "SplatReaderBlock",
  "GaussianBlock"
 ],
 "PBR": [
  "PBRMetallicRoughnessBlock",
  "AnisotropyBlock",
  "ClearCoatBlock",
  "IridescenceBlock",
  "ReflectionBlock",
  "RefractionBlock",
  "SheenBlock",
  "SubSurfaceBlock"
 ],
 "PostProcess": [
  "ScreenPositionBlock",
  "CurrentScreenBlock",
  "PrePassTextureBlock"
 ],
 "Procedural__Texture": [
  "ScreenPositionBlock"
 ],
 "Range": [
  "ClampBlock",
  "RemapBlock",
  "NormalizeBlock"
 ],
 "Round": [
  "RoundBlock",
  "CeilingBlock",
  "FloorBlock"
 ],
 "Scene": [
  "FogBlock",
  "CameraPositionBlock",
  "CameraParametersBlock",
  "FogColorBlock",
  "ImageProcessingBlock",
  "LightBlock",
  "LightInformationBlock",
  "ViewDirectionBlock",
  "SceneDepthBlock"
 ]
};
export const tooltips = {
 "BonesBlock": "Provides a world matrix for each vertex, based on skeletal (bone/joint) animation",
 "MorphTargetsBlock": "Provides the final positions, normals, tangents, and uvs based on morph targets in a mesh",
 "AddBlock": "Adds the left and right inputs of the same type together",
 "DistanceBlock": "Provides a distance vector based on the left and right input vectors",
 "DivideBlock": "Divides the left input by the right input of the same type",
 "LengthBlock": "Outputs the length of an input vector",
 "MaxBlock": "Outputs the largest value between the left and right inputs of the same type",
 "MinBlock": "Outputs the smallest value between the left and right inputs of the same type",
 "MultiplyBlock": "Multiplies the left and right inputs of the same type together",
 "NegateBlock": "Multiplies the input by -1",
 "OneMinusBlock": "Subtracts each channel of the input value from 1 (1 - input)",
 "RandomNumberBlock": "Provides a random number based on an input seed",
 "ReciprocalBlock": "Quotient of 1 divided by the input",
 "ScaleBlock": "Multiplies the input channels by a float factor",
 "SubtractBlock": "Subtracts the right input from the left input of the same type",
 "GradientBlock": "Returns the color in the gradient represented by the target value of the input",
 "PosterizeBlock": "Reduces the number of values in each channel to the number in the corresponding channel of steps",
 "ReplaceColorBlock": "Outputs the replacement color if the distance between value and reference is less than distance, else outputs the value color",
 "ColorMergerBlock": "Combines float input channels into a color",
 "ColorSplitterBlock": "Separates color input channels into individual floats",
 "VectorMergerBlock": "Combines up to four input floats into a vector",
 "VectorSplitterBlock": "Separates vectors input channels into individual floats",
 "Color3": "A color made up of red, green, and blue channel values",
 "Color4": "A color made up of red, green, blue, and alpha channel values",
 "MaterialAlphaBlock": "A float representing the alpha value of the material",
 "DeltaTimeBlock": "A float representing the time that has passed since the last frame was rendered",
 "Float": "A floating point number representing a value with a fractional component",
 "TextureBlock": "A node for reading a linked or embedded texture file",
 "PrePassTextureBlock": "A node for reading textures from the prepass",
 "MouseInfoBlock": "return a Vector4 that contains x, y, leftButton, rightButton",
 "TimeBlock": "A float value that represents the time that has passed since the scene was loaded (it is incremented by 0.6 each second)",
 "RealTimeBlock": "A float value that represents the number of seconds that have elapsed since the engine was initialized",
 "Vector2": "a vector composed of X and Y channels",
 "Vector3": "a vector composed of X, Y, and Z channels",
 "Vector4": "a vector composed of X, Y, Z, and W channels",
 "LerpBlock": "Outputs a value that is a mix of the left and right inputs based on the target value",
 "NLerpBlock": "Outputs a value that is a mix of the left and right inputs based on the target's normalized value",
 "SmoothStepBlock": "Outputs a value based on a the input value's position on a curve between the two edge values",
 "StepBlock": "Outputs 1 for any input value above the edge input, outputs 0 for any input value below the edge input",
 "Matrix": "A 4x4 table of related values",
 "ProjectionMatrixBlock": "A matrix to remap points in 3D space to 2D plane relative to the screen",
 "ProjectionInverseMatrixBlock": "A matrix to remap points in 2D screen space to 3D space",
 "ViewMatrixBlock": "A matrix to remap points in 3D space to 2D plane relative to the view of the scene camera",
 "ViewProjectionMatrixBlock": "A matrix to remap points in 3D space to 2D view space before remapping to 2D screen space",
 "WorldMatrixBlock": "A matrix to remap points in 3D local space to 3D world space",
 "WorldViewProjectionMatrixBlock": "A matrix to remap points in 3D local space to 3D world space, then to 2D camera space, and ending in 2D screen space",
 "ColorBlock": "Outputs the RGBA color of each vertex in the mesh",
 "InstanceColorBlock": "Outputs the RGBA color of each instance",
 "InstancesBlock": "Provides the world matrix for each instance to apply this material to all instances",
 "MatrixIndicesBlock": "A Vector4 representing the vertex to bone skinning assignments",
 "MatrixWeightsBlock": "A Vector4 representing the vertex to bone skinning weights",
 "MatrixIndicesExtraBlock": "A Vector4 representing the vertex to bone skinning assignments when the number of influences per bone is greater than 4",
 "MatrixWeightsExtraBlock": "A Vector4 representing the vertex to bone skinning weights when the number of influences per bone is greater than 4",
 "NormalBlock": "A Vector3 representing the normal of each vertex of the attached mesh",
 "PositionBlock": "A Vector3 representing the position of each vertex of the attached mesh",
 "TangentBlock": "A Vector3 representing the tangent of each vertex of the attached mesh",
 "UVBlock": "A Vector2 representing the UV coordinates of each vertex of the attached mesh",
 "WorldNormal": "A Vector4 representing the normal of each vertex of the attached mesh transformed into world space",
 "WorldTangent": "A Vector4 representing the tangent of each vertex of the attached mesh transformed into world space",
 "PerturbNormalBlock": "Creates high-frequency detail normal vectors based on a normal map, the world position, and world normal",
 "TBNBlock": "Creates a TBN matrix from normal, tangent, and bitangent vectors",
 "NormalBlend": "Outputs the result of blending two normal maps together using a per-channel screen",
 "WorldPosition": "A Vector4 representing the position of each vertex of the attached mesh transformed into world space",
 "DiscardBlock": "A final node that will not output a pixel below the cutoff value",
 "FragmentOutputBlock": "A mandatory final node for outputing the color of each pixel",
 "PrePassOutputBlock": "An optional final node for outputing geometry data on prepass textures",
 "VertexOutputBlock": "A mandatory final node for outputing the position of each vertex",
 "SmartFilterFragmentOutputBlock": "A mandatory final node for outputing the color of each pixel in Smart Filters mode",
 "ClampBlock": "Outputs values above the maximum or below minimum as maximum or minimum values respectively",
 "NormalizeBlock": "Remaps the length of a vector or color to 1",
 "RemapBlock": "Remaps input value between sourceMin and sourceMax to a new range between targetMin and targetMax",
 "CeilingBlock": "Outputs fractional values as the next higher whole number",
 "FloorBlock": "Outputs fractional values as the next lower whole number",
 "RoundBlock": "Outputs fractional values rounded to the nearest whole number",
 "ModBlock": "Outputs the value of one parameter modulo another",
 "CameraPositionBlock": "Outputs a Vector3 position of the active scene camera",
 "CameraParametersBlock": "Outputs a Vector4 containing (-1 for webGL and 1 for webGPU, camera.minZ, camera.maxZ, 1 / camera.maxZ)",
 "FogBlock": "Applies fog to the scene with an increasing opacity based on distance from the camera",
 "FogColorBlock": "The system value for fog color pulled from the scene",
 "ImageProcessingBlock": "Provides access to all of the Babylon image processing properties",
 "LightBlock": "Outputs diffuse and specular contributions from one or more scene lights",
 "LightInformationBlock": "Provides the direction, color and intensity of a selected light based on its world position",
 "ReflectionTextureBlock": "Creates a reflection from the input texture",
 "ViewDirectionBlock": "Outputs the direction vector of where the camera is aimed",
 "AbsBlock": "Outputs the absolute value of the input value",
 "ArcCosBlock": "Outputs the inverse of the cosine value based on the input value",
 "ArcSinBlock": "Outputs the inverse of the sine value based on the input value",
 "ArcTan2Block": "Outputs the inverse of the tangent value based on the input value",
 "ArcTanBlock": "Outputs the inverse of the tangent value based on the input value",
 "SetBlock": "Outputs the alias based on the input value",
 "CosBlock": "Outputs the cosine value based on the input value",
 "DegreesToRadiansBlock": "Converts the input degrees value to radians",
 "Exp2Block": "Outputs the input value multiplied by itself 1 time. (Exponent of 2)",
 "ExpBlock": "Outputs the input value multiplied by itself 9 time. (Exponent of 10)",
 "FractBlock": "Outputs only the fractional value of a floating point number",
 "LogBlock": "The logarithmic value based on the input value",
 "PowBlock": "Outputs the input value multiplied by itself the number of times equal to the power input (Exponent of power)",
 "RadiansToDegreesBlock": "Converts the input radians value to degrees",
 "SawToothWaveBlock": "Outputs a sawtooth pattern value between -1 and 1 based on the input value",
 "SignBlock": "returns 1 if the input is positive, 0 if input is equal to 0, or -1 if the input is negative",
 "SinBlock": "Outputs the sine value based on the input value",
 "SqrtBlock": "Outputs the square root of the input value",
 "SquareWaveBlock": "Outputs a stepped pattern value between -1 and 1 based on the input value",
 "TanBlock": "Outputs the tangent value based on the input value",
 "TriangleWaveBlock": "Outputs a sawtooth pattern value between 0 and 1 based on the input value",
 "CrossBlock": "Outputs a vector that is perpendicular to two input vectors",
 "DotBlock": "Outputs the cos of the angle between two vectors",
 "FresnelBlock": "Outputs the grazing angle of the surface of the mesh, relative to a camera influenced by the bias and power inputs",
 "TransformBlock": "Transforms a input vector based on the input matrix",
 "DerivativeBlock": "FRAGMENT SHADER ONLY. Provides the rate of change for an input on a given axis (x,y).",
 "DesaturateBlock": "Convert a color input into a grayscale representation.",
 "WorldViewMatrixBlock": "A matrix to remap points in 3D local space to 3D world space, and ending in 2D camera space.",
 "FrontFacingBlock": "Returns 1 if a mesh triangle faces the normal direction and 0 if it does not.",
 "SimplexPerlin3DBlock": "Creates a type of gradient noise with few directional artifacts.",
 "WorleyNoise3DBlock": "Creates a random pattern resembling cells.",
 "ReflectBlock": "Outputs the direction of the input vector reflected across the surface normal.",
 "RefractBlock": "Outputs a direction simulating a deflection of the input vector.",
 "Rotate2dBlock": "Rotates UV coordinates around the W axis.",
 "PBRMetallicRoughnessBlock": "PBR metallic/roughness material",
 "SheenBlock": "PBR Sheen block",
 "AnisotropyBlock": "PBR Anisotropy block",
 "ReflectionBlock": "PBR Reflection block",
 "ClearCoatBlock": "PBR ClearCoat block",
 "RefractionBlock": "PBR Refraction block",
 "SubSurfaceBlock": "PBR SubSurface block",
 "IridescenceBlock": "PBR Iridescence block",
 "ScreenPositionBlock": "A Vector2 representing the position of each vertex of the screen quad (derived from UV set from the quad used to render)",
 "CurrentScreenBlock": "The screen buffer used as input for the post process",
 "ParticleUVBlock": "The particle uv texture coordinate",
 "ParticleTextureBlock": "The particle texture",
 "ParticleColorBlock": "The particle color",
 "ParticleTextureMaskBlock": "The particle texture mask",
 "ParticleRampGradientBlock": "The particle ramp gradient block",
 "ParticleBlendMultiplyBlock": "The particle blend multiply block",
 "ParticlePositionWorldBlock": "The world position of the particle",
 "ScreenUVBlock": "The screen quad's UV texture coordinates",
 "GaussianSplattingBlock": "The gaussian splatting block",
 "GaussianBlock": "The gaussian color computation block",
 "SplatReaderBlock": "The gaussian splat reader block",
 "SplatIndexBlock": "The splat index",
 "FragCoordBlock": "The gl_FragCoord predefined variable that contains the window relative coordinate (x, y, z, 1/w)",
 "ScreenSizeBlock": "The size (in pixels) of the screen window",
 "SceneDepthBlock": "The scene depth buffer",
 "MatrixBuilderBlock": "Converts 4 Vector4 into a matrix",
 "EqualBlock": "Return a value if two operands are equals",
 "NotEqualBlock": "Return a value if two operands are not equals",
 "LessThanBlock": "Return a value if an operand is smaller than a second operand",
 "LessOrEqualBlock": "Return a value if an operand is smaller or equal to a second operand",
 "GreaterThanBlock": "Return a value if an operand is greater than a second operand",
 "GreaterOrEqualBlock": "Return a value if an operand is greater or equal to a second operand",
 "XorBlock": "Return a value if (a xor b) > 0",
 "OrBlock": "Return a value if (a or b) > 0",
 "AndBlock": "Return a value if (a and b) > 0",
 "ImageSourceBlock": "Centralize texture access for TextureBlocks",
 "DepthSourceBlock": "Centralize depth texture access for TextureBlocks",
 "CloudBlock": "Generate Fractal Brownian Motion Clouds",
 "VoronoiNoiseBlock": "Generate Voronoi Noise",
 "ScreenSpaceBlock": "Convert a Vector3 or a Vector4 into screen space",
 "TwirlBlock": "Apply a twirl rotation",
 "ElbowBlock": "Passthrough block mostly used to organize your graph",
 "TeleportInBlock": "Passthrough block mostly used to organize your graph (but without visible lines). It works like a teleportation point for the graph.",
 "TeleportOutBlock": "Endpoint for a TeleportInBlock.",
 "ClipPlanesBlock": "A node that add clip planes support",
 "HeightToNormalBlock": "Convert a height map into a normal map",
 "FragDepthBlock": "A final node that sets the fragment depth",
 "ShadowMapBlock": "Compute a depth value suitable for shadow map generation",
 "TriPlanarBlock": "A node for reading a texture with triplanar mapping",
 "BiPlanarBlock": "A node for reading a texture with biplanar mapping",
 "MatrixDeterminantBlock": "Compute the determinant of a matrix",
 "MatrixTransposeBlock": "Compute the transpose of a matrix",
 "MeshAttributeExistsBlock": "Falls back to secondary input if specified attribute doesn't exists on the rendered mesh",
 "CurveBlock": "Apply a curve function",
 "ColorConverterBlock": "Converts between RGB and HSL color spaces",
 "LoopBlock": "Block used to repeat code",
 "StorageReadBlock": "Block used to read from a loop storage variable",
 "StorageWriteBlock": "Block used to write to a loop storage variable",
 "MatrixSplitterBlock": "Block used to split a matrix into Vector4",
 "DebugBlock": "Block used to render intermediate debug values",
 "SmartFilterTextureBlock": "Block used to add a Smart Filter Effect (SFE) shader interface",
 "AmbientOcclusionBlock": "Block used to compute screen space ambient occlusion"
};
