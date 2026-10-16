// -----------------------------------------------------------------------------
// Watching the cameras.
//
// Two loops per camera, each one a chain of timeouts (a slow camera never gets
// two reads stacked up):
//
//   - the alarm loop reads `getDevState` every `detection_interval` seconds:
//     motion, person, sound and alarm-input alarms, motion detection armed or
//     not, infrared LEDs. It is also what tells a camera online or offline;
//   - the image loop takes a snapshot every `snapshot_interval` seconds and
//     publishes it to Gladys (0 switches it off: Gladys still gets a fresh
//     image whenever it asks for one, through onGetImage).
//
// The Foscam CGI pushes nothing: a camera alarm only exists for as long as the
// camera holds it (its "trigger interval", 5 to 15 s), so a two-second read is
// enough to see every one of them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { cameraName, logFailure } from './cameras.js';
import { cameraStates, idsOf } from './devices/camera.js';
import { ALARM } from './foscam/client.js';
import { describeErrorIn } from './foscam/errors.js';
import { CONNECTION_STATES, SCENE_TRIGGERS } from './capabilities/scenes.js';

const logger = createLogger({ name: 'watcher' });

/** Gladys takes 12 images a minute per camera: never two within 5 s. */
export const MIN_IMAGE_GAP_MS = 5000;

/** Unchanged states are re-sent this often, so they stay recently dated. */
export const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/** The alarms of getDevState, by the `kind` the detection trigger reports. */
const DETECTIONS = ['motion', 'person', 'sound', 'io'];

/**
 * @param {object} options
 * @param {object} options.gladys the SDK instance
 * @param {object} options.hub see cameras.js
 * @param {() => object} options.getConfig the current normalized config
 * @param {(camera: object) => Promise<void>} options.onIdentified a camera
 *   answered for the first time: it needs its Gladys device
 * @param {(camera: object) => Promise<void>} options.onConnectionChanged a
 *   camera went offline or came back (badge, status, widgets)
 * @param {(camera: object) => void} options.onImage a new image was taken
 * @param {() => number} [options.now] clock
 */
export function createWatcher({
  gladys,
  hub,
  getConfig,
  onIdentified,
  onConnectionChanged,
  onImage,
  now = Date.now,
}) {
  const timers = new Set();
  // Bumped by every start and stop: a read still running when the loops were
  // restarted must not schedule a second loop next to the new one.
  let generation = 0;

  function schedule(task, delayMs) {
    const owner = generation;
    const timer = setTimeout(async () => {
      timers.delete(timer);
      if (owner === generation) {
        await task(owner);
      }
    }, delayMs);
    timers.add(timer);
  }

  async function publishStates(camera) {
    if (!camera.identity) {
      return;
    }
    await gladys.publishChangedStates(cameraStates(gladys, camera, hub.isEnabled(camera)), {
      heartbeat: STATE_HEARTBEAT_MS,
    });
  }

  /**
   * Take a snapshot and publish it. Resolves false when it could not (the
   * camera is off, disabled in Gladys, or refused).
   */
  async function publishImage(camera, { force = false } = {}) {
    if (!camera.identity || !hub.isEnabled(camera)) {
      return false;
    }
    if (!force && camera.snapshot && now() - camera.snapshot.at < MIN_IMAGE_GAP_MS) {
      return true;
    }
    try {
      const image = await hub.capture(camera);
      await gladys.publishCameraImage(idsOf(gladys, camera).device, image);
      onImage(camera);
      return true;
    } catch (err) {
      logger.warn(`${cameraName(camera)}: snapshot failed — ${err.message}`);
      return false;
    }
  }

  async function fireConnection(camera, state) {
    const reason =
      state === CONNECTION_STATES.OFFLINE ? describeErrorIn('en', camera.lastError) : '';
    try {
      await gladys.publishSceneEvent(SCENE_TRIGGERS.CAMERA_CONNECTION, {
        device: idsOf(gladys, camera).device,
        state,
        camera_name: cameraName(camera),
        reason,
      });
    } catch (err) {
      logger.warn(`${cameraName(camera)}: connection event not delivered — ${err.message}`);
    }
  }

  async function fireDetections(camera, previous) {
    const kinds = DETECTIONS.filter(
      (kind) =>
        camera.alarms[kind] === ALARM.ALARM &&
        // The first read only learns the state: an alarm already on when the
        // integration starts is not a new detection.
        previous[kind] !== null &&
        previous[kind] !== ALARM.ALARM,
    );
    if (kinds.length === 0 || !hub.isEnabled(camera)) {
      return;
    }
    camera.lastDetection = { kind: kinds[0], at: now() };
    // The image first: a scene that sends the camera image on a detection
    // sends the frame of that detection, not the one of a minute ago.
    await publishImage(camera);
    for (const kind of kinds) {
      logger.info(`${cameraName(camera)}: ${kind} detected`);
      try {
        await gladys.publishSceneEvent(SCENE_TRIGGERS.DETECTION, {
          device: idsOf(gladys, camera).device,
          kind,
          camera_name: cameraName(camera),
        });
      } catch (err) {
        logger.warn(`${cameraName(camera)}: detection event not delivered — ${err.message}`);
      }
    }
  }

  /** One read of the alarms of a camera. */
  async function readCamera(camera) {
    if (!hub.canTry(camera)) {
      return;
    }
    const wasOnline = camera.online;
    let state;
    try {
      state = await camera.client.getDevState();
    } catch (err) {
      const wentOffline = hub.markFailure(camera, err);
      logFailure(camera, err, wentOffline);
      if (wentOffline) {
        await onConnectionChanged(camera);
        if (wasOnline === true) {
          await fireConnection(camera, CONNECTION_STATES.OFFLINE);
        }
      }
      return;
    }
    hub.markOnline(camera);
    if (!camera.identity) {
      try {
        await hub.probe(camera);
        await onIdentified(camera);
      } catch (err) {
        logger.warn(`${cameraName(camera)}: cannot read its identity — ${err.message}`);
      }
    }
    if (wasOnline !== true) {
      logger.info(`${cameraName(camera)}: online`);
      await onConnectionChanged(camera);
      if (wasOnline === false) {
        await fireConnection(camera, CONNECTION_STATES.ONLINE);
      }
    }
    const previous = camera.alarms;
    camera.alarms = {
      motion: state.motion,
      person: state.person,
      sound: state.sound,
      io: state.io,
    };
    if (state.motion !== null) {
      camera.armed = state.motion !== ALARM.DISABLED;
    }
    if (state.infrared !== null) {
      camera.infrared = state.infrared;
    }
    try {
      await publishStates(camera);
    } catch (err) {
      logger.warn(`${cameraName(camera)}: states not published — ${err.message}`);
    }
    await fireDetections(camera, previous);
  }

  function alarmLoop(camera) {
    schedule(async (owner) => {
      await readCamera(camera);
      if (owner === generation) {
        alarmLoop(camera);
      }
    }, getConfig().detection_interval * 1000);
  }

  function imageLoop(camera) {
    const interval = getConfig().snapshot_interval;
    if (interval === 0) {
      return;
    }
    schedule(async (owner) => {
      if (camera.online) {
        await publishImage(camera);
      }
      if (owner === generation) {
        imageLoop(camera);
      }
    }, interval * 1000);
  }

  return {
    readCamera,
    publishImage,
    publishStates,

    /** Start both loops of every camera of the configuration. */
    start() {
      this.stop();
      for (const camera of hub.list()) {
        alarmLoop(camera);
        imageLoop(camera);
      }
    },

    stop() {
      generation += 1;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    },
  };
}
