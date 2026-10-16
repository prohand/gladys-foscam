// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+).
//
// Triggers (manifest `scene_triggers`), fired by watcher.js:
//
//   detection          a camera raised an alarm: motion, person, sound, or its
//                      alarm input. One event per alarm (the edge), never one
//                      per read. The `motion` feature already drives the
//                      standard "device state" trigger; this one tells WHAT
//                      was detected, which a binary state cannot.
//   camera_connection  a camera stopped answering, or came back.
//
// Actions (manifest `scene_actions`), registered by app.js:
//
//   take_snapshot, goto_preset, set_motion_detection, set_night_vision,
//   reboot_camera
//
// An action that the camera could not carry out resolves its output to
// `false` instead of throwing: a scene action is never a condition, the scene
// author gates on the output. An unknown camera (deleted, renamed address)
// throws: that is a broken scene, and Gladys logs it.
//
// Keys are stored by the scenes that use them: never renamed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { cameraName } from '../cameras.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_TRIGGERS = {
  DETECTION: 'detection',
  CAMERA_CONNECTION: 'camera_connection',
};

/** What a camera can detect: the `kind` filter of the `detection` trigger. */
export const DETECTION_KINDS = {
  MOTION: 'motion',
  PERSON: 'person',
  SOUND: 'sound',
  IO: 'io',
};

/** The `state` filter of the `camera_connection` trigger. */
export const CONNECTION_STATES = { ONLINE: 'online', OFFLINE: 'offline' };

export const SCENE_ACTIONS = {
  TAKE_SNAPSHOT: 'take_snapshot',
  GOTO_PRESET: 'goto_preset',
  SET_MOTION_DETECTION: 'set_motion_detection',
  SET_NIGHT_VISION: 'set_night_vision',
  REBOOT_CAMERA: 'reboot_camera',
};

/** The `mode` options of `set_night_vision`. */
export const NIGHT_VISION_MODES = ['auto', 'on', 'off'];

/**
 * The handlers of the scene actions, keyed by manifest key. Each one receives
 * the RESOLVED fields (`device` is the camera device external id) and resolves
 * the declared outputs.
 *
 * @param {object} options
 * @param {object} options.gladys the SDK instance
 * @param {object} options.hub see cameras.js
 * @param {(camera: object) => Promise<boolean>} options.snapshot take and
 *   publish a fresh image, resolves false when it could not
 * @param {(camera: object) => Promise<void>} options.onChanged publish the
 *   states of a camera after a change
 */
export function createSceneActions({ gladys, hub, snapshot, onChanged }) {
  function cameraOf(fields) {
    const camera = hub.byExternalId(gladys, fields.device);
    if (!camera) {
      throw new Error(`Unknown camera: ${fields.device}`);
    }
    return camera;
  }

  // Run a camera operation: true when done, false when the camera refused it.
  async function attempt(camera, what, operation) {
    try {
      await operation();
      return true;
    } catch (err) {
      logger.warn(`${cameraName(camera)}: ${what} failed — ${err.message}`);
      return false;
    }
  }

  return {
    async [SCENE_ACTIONS.TAKE_SNAPSHOT](fields) {
      const camera = cameraOf(fields);
      // Published on the camera device: the core's "send camera image" scene
      // action, placed after this one, sends that very frame.
      return { captured: await snapshot(camera) };
    },

    async [SCENE_ACTIONS.GOTO_PRESET](fields) {
      const camera = cameraOf(fields);
      const wanted = String(fields.preset ?? '').trim();
      // Typed in the scene, so read it kindly: "home" finds "Home".
      const name =
        camera.identity.presets.find((preset) => preset === wanted) ??
        camera.identity.presets.find((preset) => preset.toLowerCase() === wanted.toLowerCase()) ??
        wanted;
      const moved = await attempt(camera, `preset ${name}`, () => camera.client.gotoPreset(name));
      return { moved };
    },

    async [SCENE_ACTIONS.SET_MOTION_DETECTION](fields) {
      const camera = cameraOf(fields);
      const enabled = fields.enabled === true || fields.enabled === 'true' || fields.enabled === 1;
      const applied = await attempt(camera, 'motion detection', () =>
        camera.client.setMotionDetection(enabled),
      );
      if (applied) {
        camera.armed = enabled;
        await onChanged(camera);
      }
      return { applied };
    },

    async [SCENE_ACTIONS.SET_NIGHT_VISION](fields) {
      const camera = cameraOf(fields);
      const mode = NIGHT_VISION_MODES.includes(fields.mode) ? fields.mode : 'auto';
      const applied = await attempt(camera, `night vision ${mode}`, () =>
        camera.client.setInfrared(mode),
      );
      if (applied) {
        camera.infraredMode = mode === 'auto' ? 'auto' : 'manual';
        if (mode !== 'auto') {
          camera.infrared = mode === 'on';
        }
        await onChanged(camera);
      }
      return { applied };
    },

    async [SCENE_ACTIONS.REBOOT_CAMERA](fields) {
      const camera = cameraOf(fields);
      return { rebooted: await attempt(camera, 'reboot', () => camera.client.reboot()) };
    },
  };
}
