import assert from 'node:assert/strict';
import { NullEngine, Scene, Texture } from '@babylonjs/core';
import '../src/overrides/babylon/srgb-texture-parse.js';
import { OVERRIDE_FILES } from '../src/io_scene_babylon/runtime-files.js';

// A page's sRGB image (Framed Print's print, Texture Paint's vase) loads into an sRGB buffer from the package's root.
const scene = new Scene(new NullEngine());
scene.useDelayedTextureLoading = true;
const srgb = Texture.Parse({ name: 'images/0.png', url: 'images/0.png', _useSRGBBuffer: true, invertY: true, samplingMode: 3 }, scene, 'https://example.test/page/');
assert.equal(srgb._useSRGBBuffer, true);
assert.equal(srgb.url, 'https://example.test/page/images/0.png');
const data = Texture.Parse({ name: 'images/1.png', url: 'images/1.png', invertY: true, samplingMode: 3 }, scene, 'https://example.test/page/');
assert.equal(data._useSRGBBuffer, false, 'a Non-Color image stays linear');
assert.ok(OVERRIDE_FILES.includes('babylon/srgb-texture-parse.js'), 'every package ships it');
console.log('sRGB texture parse: exported sRGB images load into sRGB buffers');
