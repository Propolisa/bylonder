import { h } from 'vue';
import { address } from '../animation/model.js';
import { viewTransforms, looks } from './render-babylon.js';
import { getRenderPath, renderDefaults } from './render.js';

const headerToggle = (checked, title, onChange) => () => [h('input', { type: 'checkbox', class: 'bl-panel-check', checked, title, 'aria-label': title, onChange: e => onChange(e.target.checked) })];
const animatable = new Set(['viewSettings.exposure', 'render.motionBlurShutter', 'eevee.screenTraceThickness', 'eevee.fastGiDistance']);

// Properties > Render, following Blender's EEVEE panel order. Only settings with a Babylon counterpart are shown.
export function renderPanels({ world, row, panel }) {
  const settings = world.renderSettings, s = settings.state;
  const field = (path, label, extra = {}) => row({ id: 'render.' + path, label, default: getRenderPath(renderDefaults, path), get: () => getRenderPath(settings.state, path), set: (v, finish) => settings.set(path, v, finish !== false), refs: () => animatable.has(path) ? [address('scene', path)] : [], ...extra });
  return [
    h('div', { class: 'bl-property' }, [h('label', 'Render Engine'), h('span', { class: 'bl-node-link bl-plain' }, 'Babylon'), h('span')]),
    panel('render.sampling', 'Sampling', () => [
      panel('render.sampling.viewport', 'Viewport', () => [field('eevee.taaSamples', 'Samples', { integer: true, min: 1, max: 8, step: 1, description: 'Babylon MSAA samples' })], { subpanel: true }),
      panel('render.sampling.render', 'Render', () => [field('eevee.taaRenderSamples', 'Samples', { integer: true, min: 1, max: 256, step: 1, description: 'Renders averaged per frame in Render Image and Render Animation: sub-pixel jitter for anti-aliasing, and sub-frame times across the shutter when Motion Blur is on' })], { subpanel: true }),
    ]),
    panel('render.raytracing', 'Raytracing', () => [
      field('eevee.rayTracingMethod', 'Method', { options: { 'Light Probe': 'PROBE', 'Screen-Trace': 'SCREEN' }, disabled: () => !settings.state.eevee.useRaytracing }),
      ...(s.eevee.rayTracingMethod === 'SCREEN' ? [panel('render.raytracing.screen', 'Screen Tracing', () => [
        field('eevee.screenTraceQuality', 'Precision', { min: 0, max: 1, step: 0.01, disabled: () => !settings.state.eevee.useRaytracing }),
        field('eevee.screenTraceThickness', 'Thickness', { min: 0, max: 100, step: 0.01, disabled: () => !settings.state.eevee.useRaytracing }),
      ], { subpanel: true })] : []),
      panel('render.raytracing.fastgi', 'Fast GI Approximation', () => [
        field('eevee.fastGiMethod', 'Method', { options: { 'Ambient Occlusion': 'AMBIENT_OCCLUSION' }, disabled: () => !settings.state.eevee.useRaytracing }),
        field('eevee.fastGiDistance', 'Distance', { unit: 'length', min: 0, max: 1000, step: 0.1, disabled: () => !settings.state.eevee.useRaytracing }),
      ], { subpanel: true }),
    ], { defaultClosed: !s.eevee.useRaytracing, actions: headerToggle(s.eevee.useRaytracing, 'Use Raytracing', v => settings.set('eevee.useRaytracing', v)) }),
    panel('render.motionBlur', 'Motion Blur', () => [
      field('render.motionBlurShutter', 'Shutter', { min: 0, max: 2, step: 0.01, disabled: () => !settings.state.render.useMotionBlur }),
      h('p', { class: 'bl-message' }, 'Viewport: a motion blur post effect. Render: Samples spread across the shutter (up to 1 frame).'),
    ], { defaultClosed: !s.render.useMotionBlur, actions: headerToggle(s.render.useMotionBlur, 'Use Motion Blur', v => settings.set('render.useMotionBlur', v)) }),
    panel('render.colorManagement', 'Color Management', () => [
      field('displaySettings.displayDevice', 'Display Device', { options: { sRGB: 'sRGB' } }),
      field('viewSettings.viewTransform', 'View Transform', { options: Object.fromEntries(Object.entries(viewTransforms).map(([k, v]) => [v.label, k])) }),
      field('viewSettings.look', 'Look', { options: Object.fromEntries(Object.entries(looks).map(([k, [label]]) => [label, k])) }),
      field('viewSettings.exposure', 'Exposure', { min: -32, max: 32, step: 0.01 }),
    ], { defaultClosed: true }),
    h('p', { class: 'bl-message' }, 'Render settings apply in Rendered shading and camera view. Bloom and other post effects are in the Compositor, as in Blender.'),
    world.compositor?.enabled ? h('p', { class: 'bl-message bl-error' }, 'Compositing Use Nodes is on: Babylon renders through the frame graph, which bypasses Sampling, Raytracing and Motion Blur. Color Management still applies.') : null,
  ];
}
