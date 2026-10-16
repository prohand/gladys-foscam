// Start the integration against the SDK's fake Gladys and fake cameras.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { createFakeFoscam, fakeCamera } from './fakeFoscam.js';

export const KEY = '192.168.1.20:88';
export const MAC = '00626e4a3e6d';

/**
 * @param {import('node:test').TestContext} t
 * @param {object} [options]
 * @param {Record<string, object>} [options.cameras] fake cameras by host:port
 * @param {object} [options.config] the Gladys configuration
 * @param {string} [options.dataDir] reuse a /data of a previous run
 * @param {() => number} [options.now]
 */
export async function startApp(t, options = {}) {
  const cameras = options.cameras ?? { [KEY]: fakeCamera() };
  const foscam = createFakeFoscam(cameras);
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'foscam-')));
  if (!options.dataDir) {
    t.after(() => rm(dataDir, { recursive: true, force: true }));
  }
  const gladys = createFakeGladys({
    config: options.config ?? {
      cameras: Object.keys(cameras).join(', '),
      username: 'admin',
      password: 'secret',
      // No loop runs on its own in the tests: they call the watcher directly.
      snapshot_interval: 0,
      detection_interval: 60,
    },
  });
  const app = createApp(gladys, { fetch: foscam.fetch, dataDir, now: options.now });
  t.after(() => app.stop());
  await gladys.connect();
  return { gladys, app, foscam, dataDir, cameras: foscam.cameras };
}

export const deviceId = (gladys, mac = MAC) => gladys.externalIds('camera', mac).device;
export const featureId = (gladys, key, mac = MAC) => gladys.externalIds('camera', mac).feature(key);
