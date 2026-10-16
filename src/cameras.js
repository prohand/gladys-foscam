// -----------------------------------------------------------------------------
// The cameras of the configuration, and what the integration knows of each.
//
// One entry per address typed in the configuration. A camera becomes a Gladys
// device once it has answered at least once: its MAC address is its id (an
// address changes with DHCP, a MAC address does not), and its identity is
// remembered in /data so that a camera off at startup keeps its device.
//
// Runtime state (online or not, last alarms, last snapshot) lives here too, so
// every surface — devices, watcher, scenes, widgets — reads the same thing.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { cameraKey, parseCameras } from './config.js';
import { createClient } from './foscam/client.js';
import { ERROR_CODES, FoscamError, errorCode } from './foscam/errors.js';
import { toCameraImage } from './foscam/image.js';

const logger = createLogger({ name: 'cameras' });

/** The Gladys device type of a camera (part of its external id: never changed). */
export const DEVICE_TYPE = 'camera';

/** The name of a camera: the one typed, else the one stored in the camera. */
export function cameraName(camera) {
  return (
    camera.entry.name ??
    camera.identity?.name ??
    `Foscam ${camera.identity?.model ?? camera.entry.host}`
  );
}

function credentialsOf(entry, config) {
  return {
    username: entry.username ?? config.username,
    password: entry.password ?? config.password,
  };
}

/**
 * @param {object} options
 * @param {object} options.store see store.js
 * @param {typeof fetch} [options.fetch] injected by the tests
 * @param {() => number} [options.now] clock
 */
export function createCameraHub({ store, fetch = globalThis.fetch, now = Date.now }) {
  /** @type {Map<string, object>} by address key */
  let cameras = new Map();
  let parseErrors = [];

  function newCamera(entry, config) {
    const { username, password } = credentialsOf(entry, config);
    return {
      key: entry.key,
      entry,
      credentials: `${username}\u0000${password}`,
      client: createClient({ host: entry.host, port: entry.port, username, password, fetch }),
      identity: store.identity(entry.key),
      online: null,
      lastError: null,
      failures: 0,
      backoffUntil: 0,
      alarms: { motion: null, person: null, sound: null, io: null },
      armed: null,
      infrared: null,
      infraredMode: null,
      lastDetection: null,
      snapshot: null,
    };
  }

  return {
    /**
     * Read the camera list of a (new) configuration. A camera whose address
     * and credentials did not change keeps its runtime state.
     * @returns {Array<object>} the entries left out, see parseCameras
     */
    configure(config) {
      const parsed = parseCameras(config.cameras);
      parseErrors = parsed.errors;
      const next = new Map();
      for (const entry of parsed.cameras) {
        const previous = cameras.get(entry.key);
        const { username, password } = credentialsOf(entry, config);
        if (previous && previous.credentials === `${username}\u0000${password}`) {
          previous.entry = entry;
          next.set(entry.key, previous);
        } else {
          next.set(entry.key, newCamera(entry, config));
        }
      }
      cameras = next;
      return parseErrors;
    },

    get parseErrors() {
      return parseErrors;
    },

    /** Every camera of the configuration, in the order typed. */
    list() {
      return [...cameras.values()];
    },

    /** The cameras that have a Gladys device (they answered once). */
    identified() {
      return this.list().filter((camera) => camera.identity !== null);
    },

    /** The camera of a Gladys device, from its external id. */
    byExternalId(gladys, externalId) {
      return (
        this.identified().find(
          (camera) =>
            gladys.externalIds(DEVICE_TYPE, camera.identity.mac).device === externalId ||
            externalId?.startsWith(
              `${gladys.externalIds(DEVICE_TYPE, camera.identity.mac).device}:`,
            ),
        ) ?? null
      );
    },

    /** A camera answered: count it as online. Resolves true when it just came back. */
    markOnline(camera) {
      const cameBack = camera.online !== true;
      camera.online = true;
      camera.failures = 0;
      camera.lastError = null;
      camera.backoffUntil = 0;
      return cameBack;
    },

    /**
     * A request failed. A wrong password makes the camera offline at once and
     * pauses it for five minutes: insisting gets the account locked. Anything
     * else needs three failures in a row (a busy camera drops a request now
     * and then). Resolves true when the camera just went offline.
     */
    markFailure(camera, err) {
      camera.failures += 1;
      camera.lastError = err;
      const auth = errorCode(err) === ERROR_CODES.AUTH;
      if (auth) {
        camera.backoffUntil = now() + 5 * 60 * 1000;
      }
      if (camera.online !== false && (auth || camera.failures >= 3 || camera.online === null)) {
        camera.online = false;
        return true;
      }
      return false;
    },

    /** False while a camera is paused after a wrong password. */
    canTry(camera) {
      return now() >= camera.backoffUntil;
    },

    /**
     * Ask a camera who it is and what it can do, and remember it.
     * Resolves the identity, or throws (the camera keeps the one it had).
     */
    async probe(camera) {
      const info = await camera.client.getDevInfo();
      let presets = [];
      let ptz = camera.entry.ptz;
      if (ptz !== false) {
        try {
          presets = await camera.client.getPresets();
          // A fixed camera answers an empty list or refuses the command; a
          // motorized one always has its four built-in end stops at least.
          ptz = ptz ?? presets.length > 0;
        } catch (err) {
          if (
            !(err instanceof FoscamError) ||
            ![ERROR_CODES.REFUSED, ERROR_CODES.ACCESS].includes(err.code)
          ) {
            throw err;
          }
          ptz = ptz ?? false;
        }
      }
      const identity = {
        ...info,
        ptz: Boolean(ptz),
        zoom: Boolean(ptz) && camera.entry.zoom === true,
        presets: ptz ? presets : [],
      };
      camera.identity = identity;
      await store.saveIdentity(camera.key, identity);
      // Only for the widget: `auto` or forced. Not every model answers it.
      camera.infraredMode = await camera.client.getInfraredMode().catch(() => null);
      return identity;
    },

    /**
     * Take a snapshot, made small enough for Gladys, and keep it for the
     * widget. Resolves the `image/jpg;base64,...` string.
     */
    async capture(camera) {
      const image = toCameraImage(await camera.client.snapshot());
      const at = now();
      camera.snapshot = {
        image,
        at,
        // The core caches a widget image one hour by key: a new image, a new key.
        key: `snap-${camera.identity?.mac ?? 'unknown'}-${at.toString(36)}`,
      };
      return image;
    },

    /** The camera holding a widget image key, and its image. */
    snapshotByKey(key) {
      return this.list().find((camera) => camera.snapshot?.key === key)?.snapshot ?? null;
    },

    isEnabled(camera) {
      return camera.identity ? store.isEnabled(camera.identity.mac) : true;
    },

    setEnabled(camera, enabled) {
      return store.setEnabled(camera.identity.mac, enabled);
    },
  };
}

/** Where a camera answers, for the logs and the reports (never a credential). */
export function describeAddress(camera) {
  return cameraKey(camera.entry.host, camera.entry.port);
}

/** Log a failure once per change of error, not at every poll. */
export function logFailure(camera, err, wentOffline) {
  const message = `${cameraName(camera)} (${describeAddress(camera)}): ${err.message}`;
  if (wentOffline) {
    logger.warn(`Camera offline — ${message}`);
  } else {
    logger.debug(message);
  }
}
