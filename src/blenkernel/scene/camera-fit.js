// A camera's lens as Blender's (focal length, sensor size and fit), kept with the Babylon camera; Babylon's field of
// view and the axis it fixes follow from it and the size of the image the camera frames, as Blender computes them.
import { Camera } from '@babylonjs/core';

const SENSOR_WIDTH = 36, SENSOR_HEIGHT = 24;

// blender-port: camera.cc BKE_camera_sensor_fit: Auto fits the sensor to the larger side of the image.
export const sensorFit = (fit, sizex, sizey) => (fit === 'AUTO' ? (sizex >= sizey ? 'HORIZONTAL' : 'VERTICAL') : fit);
// blender-port: camera.cc BKE_camera_sensor_size: the sensor's width, its height only when fitting vertically.
export const sensorSize = (fit, width, height) => (fit === 'VERTICAL' ? height : width);

// The lens a camera holds, or Babylon's own field of view as Blender's: a vertical one on the sensor's height, a
// horizontal one on its width with Auto fit.
export function cameraLens(camera) {
  if (camera.metadata?.wbLens) return camera.metadata.wbLens;
  const vertical = camera.fovMode === Camera.FOVMODE_VERTICAL_FIXED;
  const sensor_fit = vertical ? 'VERTICAL' : 'AUTO';
  return { sensor_fit, sensor_width: SENSOR_WIDTH, sensor_height: SENSOR_HEIGHT, lens: sensorSize(sensor_fit, SENSOR_WIDTH, SENSOR_HEIGHT) / 2 / Math.tan(camera.fov / 2) };
}

// blender-port: camera.cc BKE_camera_params_compute_viewplane: the field of view along the fitted side of a width by
// height image.
export function fitCamera(camera, { width, height }) {
  const lens = camera.metadata?.wbLens;
  if (!lens) return;
  camera.fovMode = sensorFit(lens.sensor_fit, width, height) === 'VERTICAL' ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED;
  camera.fov = 2 * Math.atan(sensorSize(lens.sensor_fit, lens.sensor_width, lens.sensor_height) / 2 / lens.lens);
}

export function setCameraLens(camera, values, size) {
  camera.metadata = { ...camera.metadata, wbLens: { ...cameraLens(camera), ...values } };
  fitCamera(camera, size);
}
