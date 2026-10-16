// -----------------------------------------------------------------------------
// The integration, wired to the SDK.
//
// Every handler Gladys can call is registered here, before connect(): device
// discovery and commands, camera images, the Configuration screen action,
// scene actions and dashboard widgets. The camera logic itself lives in the
// modules this file assembles:
//
//   cameras.js               the cameras of the configuration and their state
//   foscam/                  the CGI client, its errors, the image resizing
//   devices/camera.js        a camera as a Gladys device, its commands
//   watcher.js               alarm and image loops, scene triggers
//   capabilities/            scene actions and dashboard widgets
//   connection.js            connection status and "Test the connection"
//
// `createApp` takes the SDK instance (a fake one in the tests) and the
// injectable dependencies: `fetch` (the cameras), `dataDir` (/data), `now`.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { cameraName, createCameraHub, logFailure } from './cameras.js';
import { SCENE_ACTIONS, createSceneActions } from './capabilities/scenes.js';
import { WIDGET_KEYS, createWidgets, refreshWidgets } from './capabilities/widgets.js';
import { normalizeConfig } from './config.js';
import { connectionStatus, testConnection } from './connection.js';
import { buildDevice, createCommands, featureKeyOf, idsOf } from './devices/camera.js';
import { imageBase64 } from './foscam/image.js';
import { createStore } from './store.js';
import { createWatcher } from './watcher.js';

const logger = createLogger({ name: 'app' });

/** Keys of the manifest `actions` (Configuration screen buttons). */
export const ACTIONS = { TEST_CONNECTION: 'test_connection' };

const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Logs der Integration nach.',
  es: 'La inicialización falló, consulte los registros de la integración.',
};

/**
 * @param {object} gladys a GladysIntegration (or the SDK's fake one)
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.dataDir]
 * @param {() => number} [options.now]
 */
export function createApp(gladys, { fetch = globalThis.fetch, dataDir, now = Date.now } = {}) {
  const store = createStore(dataDir);
  const hub = createCameraHub({ store, fetch, now });
  let config = normalizeConfig();
  let loaded = false;
  let reloading = Promise.resolve();
  const getConfig = () => config;

  async function quietly(what, task) {
    try {
      await task();
    } catch (err) {
      logger.warn(`${what} failed: ${err.message}`);
    }
  }

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(
      hub.identified().map((camera) => buildDevice(gladys, camera)),
    );
  }

  // The badge of every camera: the CGI is local only, so a camera is either
  // reached on the LAN or unreachable.
  async function publishTransports() {
    const entries = hub.identified().map((camera) => ({
      external_id: idsOf(gladys, camera).device,
      transport: camera.online === false ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL,
    }));
    if (entries.length > 0) {
      await gladys.publishTransports(entries);
    }
  }

  async function publishStatus() {
    const { connected, message } = connectionStatus(hub);
    await gladys.setConnectionStatus(connected, message);
  }

  const watcher = createWatcher({
    gladys,
    hub,
    getConfig,
    now,
    onIdentified: async (camera) => {
      logger.info(`${cameraName(camera)}: first contact, publishing its device`);
      await quietly('Device publication', publishDevices);
    },
    onConnectionChanged: async () => {
      await quietly('Transport badges', publishTransports);
      await quietly('Connection status', publishStatus);
      refreshWidgets(gladys);
    },
    onImage: () => refreshWidgets(gladys),
  });

  async function onChanged(camera) {
    await quietly('State publication', () => watcher.publishStates(camera));
    refreshWidgets(gladys);
  }

  const commands = createCommands({ hub, getConfig, onChanged });
  const snapshot = (camera, options) => watcher.publishImage(camera, options);
  const sceneActions = createSceneActions({ gladys, hub, snapshot, onChanged });
  const widgets = createWidgets({ gladys, hub, snapshot, now });

  async function probeAll() {
    await Promise.all(
      hub.list().map(async (camera) => {
        try {
          await hub.probe(camera);
          hub.markOnline(camera);
        } catch (err) {
          logFailure(camera, err, hub.markFailure(camera, err));
        }
      }),
    );
  }

  // Read the configuration again and restart the loops. Serialized: a
  // configuration saved during a reconnection waits for it.
  function reload() {
    // A failed reload must not block the next one.
    reloading = reloading
      .catch(() => {})
      .then(async () => {
        watcher.stop();
        await commands.stopAll();
        if (!loaded) {
          await store.load();
          loaded = true;
        }
        const ignored = hub.configure(config);
        for (const { entry, reason } of ignored) {
          logger.warn(`Camera "${entry}" ignored (${reason})`);
        }
        await probeAll();
        await publishDevices();
        await quietly('Transport badges', publishTransports);
        watcher.start();
        refreshWidgets(gladys);
        await publishStatus();
      });
    return reloading;
  }

  function cameraOf(device) {
    const camera = hub.byExternalId(gladys, device.external_id);
    if (!camera) {
      // Throwing acks the request as failed.
      throw new Error(`Unknown camera: ${device.external_id}`);
    }
    return camera;
  }

  // --- Discovery -------------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> asking every camera again');
    await probeAll();
    await publishDevices();
    await quietly('Transport badges', publishTransports);
  });

  // A camera just created in Gladys: give it an image right away instead of
  // an empty frame until the next snapshot.
  gladys.onDeviceCreated(async (device) => {
    const camera = hub.byExternalId(gladys, device.external_id);
    if (camera?.online) {
      await watcher.publishImage(camera, { force: true });
    }
  });

  // --- Commands --------------------------------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    const camera = cameraOf(device);
    const key = featureKeyOf(gladys, camera, feature.external_id);
    logger.info(`${cameraName(camera)}: ${key} <- ${value}`);
    await commands.setValue(gladys, camera, key, value);
  });

  // --- Camera image: Gladys wants a FRESH one (live view, chat) -------------
  gladys.onGetImage(async (device) => {
    const camera = cameraOf(device);
    if (!hub.isEnabled(camera)) {
      throw new Error(`${cameraName(camera)} is disabled in Gladys`);
    }
    const image = await hub.capture(camera);
    refreshWidgets(gladys);
    return image;
  });

  // --- Configuration screen --------------------------------------------------
  gladys.onAction('test_connection', async () => {
    const report = await testConnection(hub);
    await quietly('Transport badges', publishTransports);
    await quietly('Connection status', publishStatus);
    refreshWidgets(gladys);
    return report;
  });

  // --- Scene actions ---------------------------------------------------------
  for (const key of Object.values(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => sceneActions[key](fields));
  }

  // --- Dashboard widgets -----------------------------------------------------
  for (const key of Object.values(WIDGET_KEYS)) {
    gladys.onWidgetGet(key, (request) => widgets[key].get(request));
    gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
      widgets[key].action({ actionKey, params, settings }),
    );
  }
  gladys.onWidgetGetImage(async (imageKey) => {
    const found = hub.snapshotByKey(imageKey);
    if (!found) {
      throw new Error(`No image ${imageKey}`);
    }
    return imageBase64(found.image);
  });

  // --- Configuration and connection lifecycle -------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    config = normalizeConfig(newConfig);
    try {
      await reload();
    } catch (err) {
      logger.error('Reconfiguration failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    }
  });

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      await reload();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    }
  });

  gladys.on('disconnected', () => {
    watcher.stop();
  });

  return {
    hub,
    watcher,
    reload,
    getConfig,

    /** Stop the loops and the moving cameras (shutdown). */
    async stop() {
      watcher.stop();
      await commands.stopAll();
      await store.flush();
    },
  };
}
