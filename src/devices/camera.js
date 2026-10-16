// -----------------------------------------------------------------------------
// A Foscam camera as a Gladys device.
//
// Features (their keys are part of the external ids: never renamed):
//
//   image             the camera image (dedicated channel, publishCameraImage)
//   enabled           Gladys-side privacy gate: 0 = Gladys stops showing the
//                     camera, and the integration stops pushing its images and
//                     firing its detections. The camera itself keeps recording.
//   motion            motion (or person) detected right now, read from the
//                     camera alarms
//   motion-detection  the motion detection of the camera, armed or not
//   night-vision      infrared LEDs on or off
//   move              PTZ models only: pan, tilt (and zoom when declared)
//   preset            PTZ models with presets: go to a saved position
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, cameraName } from '../cameras.js';
import { MAX_PTZ_STEP_MS } from '../config.js';
import { ALARM } from '../foscam/client.js';

const logger = createLogger({ name: 'camera' });

export const FEATURES = {
  IMAGE: 'image',
  ENABLED: 'enabled',
  MOTION: 'motion',
  MOTION_DETECTION: 'motion-detection',
  NIGHT_VISION: 'night-vision',
  MOVE: 'move',
  PRESET: 'preset',
};

/**
 * The values of the Gladys `move` feature (SDK CAMERA_MOVE): 0 is stop,
 * always accepted and never listed as an option.
 */
export const MOVES = {
  1: { direction: 'left', label: 'Pan left' },
  2: { direction: 'right', label: 'Pan right' },
  3: { direction: 'up', label: 'Tilt up' },
  4: { direction: 'down', label: 'Tilt down' },
  5: { direction: 'zoomIn', label: 'Zoom in', zoom: true },
  6: { direction: 'zoomOut', label: 'Zoom out', zoom: true },
};

export function idsOf(gladys, camera) {
  return gladys.externalIds(DEVICE_TYPE, camera.identity.mac);
}

/** The key of a feature (`move`...) from its external id, or null. */
export function featureKeyOf(gladys, camera, featureExternalId) {
  const prefix = `${idsOf(gladys, camera).device}:`;
  return featureExternalId?.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}

function binaryFeature(name, externalId, category, type, readOnly) {
  return {
    name,
    external_id: externalId,
    category,
    type,
    read_only: readOnly,
    has_feedback: true,
    keep_history: true,
    min: 0,
    max: 1,
  };
}

/** The discovery payload of one identified camera. */
export function buildDevice(gladys, camera) {
  const ids = idsOf(gladys, camera);
  const { identity } = camera;
  const features = [
    {
      name: 'Image',
      external_id: ids.feature(FEATURES.IMAGE),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
      read_only: true,
      has_feedback: false,
      // Images never go through the states history.
      keep_history: false,
      min: 0,
      max: 0,
    },
    binaryFeature(
      'Enabled in Gladys',
      ids.feature(FEATURES.ENABLED),
      DEVICE_FEATURE_CATEGORIES.CAMERA,
      DEVICE_FEATURE_TYPES.CAMERA.ENABLED,
      false,
    ),
    binaryFeature(
      'Motion',
      ids.feature(FEATURES.MOTION),
      DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
      DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      true,
    ),
    binaryFeature(
      'Motion detection',
      ids.feature(FEATURES.MOTION_DETECTION),
      DEVICE_FEATURE_CATEGORIES.SWITCH,
      DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      false,
    ),
    binaryFeature(
      'Night vision',
      ids.feature(FEATURES.NIGHT_VISION),
      DEVICE_FEATURE_CATEGORIES.SWITCH,
      DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      false,
    ),
  ];
  if (identity.ptz) {
    const moves = Object.entries(MOVES).filter(([, move]) => !move.zoom || identity.zoom);
    features.push({
      name: 'Move',
      external_id: ids.feature(FEATURES.MOVE),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.MOVE,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 0,
      max: 6,
      supported_options: moves.map(([value, move], index) => ({
        value: Number(value),
        label: move.label,
        sort_order: index,
      })),
    });
  }
  if (identity.ptz && identity.presets.length > 0) {
    features.push({
      name: 'Preset',
      external_id: ids.feature(FEATURES.PRESET),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.PRESET,
      read_only: false,
      has_feedback: false,
      keep_history: false,
      min: 1,
      max: identity.presets.length,
      // The value sent is the position in the camera's list, from 1.
      supported_options: identity.presets.map((name, index) => ({
        value: index + 1,
        label: name,
        sort_order: index,
      })),
    });
  }
  return {
    name: cameraName(camera),
    external_id: ids.device,
    model: identity.model ?? undefined,
    // Re-published devices get their params upserted: a new IP address or
    // firmware shows up without re-creating the camera. Never a credential.
    params: [
      { name: 'host', value: camera.entry.host },
      { name: 'port', value: String(camera.entry.port) },
      { name: 'mac', value: identity.mac },
      { name: 'model', value: identity.model ?? '' },
      { name: 'firmware', value: identity.firmware ?? '' },
    ],
    features,
  };
}

/**
 * The states of a camera worth publishing, in the publishStates format.
 * Unknown values (a model without infrared) are left out.
 */
export function cameraStates(gladys, camera, enabled) {
  const ids = idsOf(gladys, camera);
  const states = [{ device_feature_external_id: ids.feature(FEATURES.ENABLED), state: +enabled }];
  const { motion, person } = camera.alarms;
  if (motion !== null || person !== null) {
    const detected = motion === ALARM.ALARM || person === ALARM.ALARM;
    states.push({ device_feature_external_id: ids.feature(FEATURES.MOTION), state: +detected });
  }
  if (camera.armed !== null) {
    states.push({
      device_feature_external_id: ids.feature(FEATURES.MOTION_DETECTION),
      state: +camera.armed,
    });
  }
  if (camera.infrared !== null) {
    states.push({
      device_feature_external_id: ids.feature(FEATURES.NIGHT_VISION),
      state: +camera.infrared,
    });
  }
  return states;
}

/**
 * The commands of a camera (onSetValue), with the PTZ watchdog.
 *
 * Foscam has no relative PTZ step: a move runs until `ptzStopRun`. Every move
 * is therefore stopped by the integration after `ptz_step_ms` (5 s at most):
 * a lost stop must never leave a camera grinding against its end stop.
 *
 * @param {object} options
 * @param {object} options.hub see cameras.js
 * @param {() => object} options.getConfig the current normalized config
 * @param {(changed: object) => Promise<void>} options.onChanged publish the
 *   states of a camera after a command
 */
export function createCommands({ hub, getConfig, onChanged }) {
  const watchdogs = new Map();

  function clearWatchdog(camera) {
    clearTimeout(watchdogs.get(camera.key));
    watchdogs.delete(camera.key);
  }

  async function stop(camera, zoom) {
    clearWatchdog(camera);
    await camera.client.move('stop');
    if (zoom) {
      await camera.client.move('zoomStop');
    }
  }

  async function move(camera, value) {
    if (value === 0) {
      await stop(camera, camera.identity.zoom);
      return;
    }
    const step = MOVES[value];
    if (!step || (step.zoom && !camera.identity.zoom)) {
      throw new Error(`${cameraName(camera)}: movement ${value} is not supported`);
    }
    clearWatchdog(camera);
    await camera.client.move(step.direction);
    const duration = Math.min(getConfig().ptz_step_ms, MAX_PTZ_STEP_MS);
    watchdogs.set(
      camera.key,
      setTimeout(() => {
        watchdogs.delete(camera.key);
        camera.client
          .move(step.zoom ? 'zoomStop' : 'stop')
          .catch((err) => logger.error(`${cameraName(camera)}: PTZ stop failed`, err));
      }, duration),
    );
  }

  return {
    /** Run the command of a feature. Throws when it cannot be done. */
    async setValue(gladys, camera, featureKey, value) {
      const number = Number(value);
      switch (featureKey) {
        case FEATURES.ENABLED:
          await hub.setEnabled(camera, number === 1);
          break;
        case FEATURES.MOTION_DETECTION:
          await camera.client.setMotionDetection(number === 1);
          camera.armed = number === 1;
          break;
        case FEATURES.NIGHT_VISION:
          await camera.client.setInfrared(number === 1 ? 'on' : 'off');
          camera.infrared = number === 1;
          camera.infraredMode = 'manual';
          break;
        case FEATURES.MOVE:
          await move(camera, number);
          return;
        case FEATURES.PRESET: {
          const name = camera.identity.presets[number - 1];
          if (!name) {
            throw new Error(`${cameraName(camera)}: no preset ${value}`);
          }
          await camera.client.gotoPreset(name);
          return;
        }
        default:
          throw new Error(`${cameraName(camera)}: feature ${featureKey} cannot be set`);
      }
      await onChanged(camera);
    },

    /** Stop the cameras still moving (shutdown, reconfiguration). */
    async stopAll() {
      const moving = hub.list().filter((camera) => watchdogs.has(camera.key));
      await Promise.allSettled(moving.map((camera) => stop(camera, camera.identity?.zoom)));
    },
  };
}
