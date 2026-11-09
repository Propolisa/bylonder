// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's PBR material on WebGPU: compiled from Babylon's GLSL (ForceGLSL) instead of its WGSL, so Bylonder's GLSL plugins on it (curves, point clouds, Dithered) draw there too; Bylonder's Standard materials ask for it per material (forceGLSL); goes when those plugins carry WGSL.
import { PBRBaseMaterial } from '@babylonjs/core';

export function pbrFromGLSL() { PBRBaseMaterial.ForceGLSL = true; }
