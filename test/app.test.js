// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys on one side, fake Foscam
// cameras on the other (test/helpers), the whole of src/ in between.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FEATURES } from '../src/devices/camera.js';
import { KEY, MAC, deviceId, featureId, startApp } from './helpers/setup.js';
import { fakeCamera } from './helpers/fakeFoscam.js';

test('a camera that answers becomes a device, keyed by its MAC address', async (t) => {
  const { gladys } = await startApp(t);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, deviceId(gladys));
  assert.equal(device.name, 'Caméra', 'the name stored in the camera');
  const features = device.features.map((feature) => feature.external_id.split(':').at(-1));
  assert.deepEqual(features, [
    'image',
    'enabled',
    'motion',
    'motion-detection',
    'night-vision',
    'move',
    'preset',
  ]);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    gladys.fake.transports.map(({ transport }) => transport),
    ['local'],
  );
});

test('the device never carries a credential', async (t) => {
  const { gladys } = await startApp(t);
  const text = JSON.stringify(gladys.fake.discoveredDevices);
  assert.doesNotMatch(text, /secret/);
});

test('a camera name typed in the configuration wins', async (t) => {
  const { gladys } = await startApp(t, {
    config: { cameras: `Entrée=${KEY}`, password: 'secret', snapshot_interval: 0 },
  });
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Entrée');
});

test('a camera off at startup keeps its device, from /data', async (t) => {
  const first = await startApp(t);
  await first.app.stop();
  const camera = fakeCamera({ down: true });
  const second = await startApp(t, { cameras: { [KEY]: camera }, dataDir: first.dataDir });
  assert.equal(second.gladys.fake.discoveredDevices[0].external_id, deviceId(second.gladys));
  assert.equal(second.gladys.fake.connectionStatus.connected, false);
  assert.match(second.gladys.fake.connectionStatus.message.fr, /rien ne répond/);
  assert.deepEqual(
    second.gladys.fake.transports.map(({ transport }) => transport),
    ['unreachable'],
  );
  const stored = await readFile(join(first.dataDir, 'foscam-state.json'), 'utf8');
  assert.match(stored, new RegExp(MAC));
  assert.doesNotMatch(stored, /secret/, 'no password in /data');
});

test('a camera never reached has no device yet, and gets one when it answers', async (t) => {
  const camera = fakeCamera({ down: true });
  const { gladys, app } = await startApp(t, { cameras: { [KEY]: camera } });
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  camera.down = false;
  await app.watcher.readCamera(app.hub.list()[0]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a wrong password says so, and pauses the camera', async (t) => {
  const { gladys, app, foscam } = await startApp(t, {
    config: { cameras: KEY, password: 'nope', snapshot_interval: 0 },
  });
  assert.match(gladys.fake.connectionStatus.message.en, /wrong username or password/);
  const calls = foscam.calls.length;
  await app.watcher.readCamera(app.hub.list()[0]);
  assert.equal(foscam.calls.length, calls, 'no new attempt while paused (account lock)');
});

test('the alarm read publishes the states and fires one event per detection', async (t) => {
  const { gladys, app, cameras } = await startApp(t);
  const camera = app.hub.list()[0];
  await app.watcher.readCamera(camera);
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.MOTION)), 0);
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.MOTION_DETECTION)), 1);
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.NIGHT_VISION)), 0);
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.ENABLED)), 1);

  cameras[KEY].state.motionDetectAlarm = '2';
  await app.watcher.readCamera(camera);
  await app.watcher.readCamera(camera);
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.MOTION)), 1);
  assert.deepEqual(gladys.fake.sceneEvents, [
    { key: 'detection', data: { device: deviceId(gladys), kind: 'motion', camera_name: 'Caméra' } },
  ]);
  assert.equal(gladys.fake.cameraImages.length, 1, 'the frame of the detection is published first');

  cameras[KEY].state.motionDetectAlarm = '1';
  await app.watcher.readCamera(camera);
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.MOTION)), 0);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'the end of an alarm fires nothing');
});

test('an alarm already on at the first read is not a detection', async (t) => {
  const { gladys, app, cameras } = await startApp(t);
  cameras[KEY].state.motionDetectAlarm = '2';
  await app.watcher.readCamera(app.hub.list()[0]);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('a camera disabled in Gladys fires no detection and sends no image', async (t) => {
  const { gladys, app, cameras } = await startApp(t);
  const camera = app.hub.list()[0];
  const device = gladys.fake.discoveredDevices[0];
  const ack = await gladys.fake.setValue(
    device,
    { external_id: featureId(gladys, FEATURES.ENABLED) },
    0,
  );
  assert.equal(ack.success, true);
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.ENABLED)), 0);
  await app.watcher.readCamera(camera);
  cameras[KEY].state.motionDetectAlarm = '2';
  await app.watcher.readCamera(camera);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.equal((await gladys.fake.getImage(device)).success, false);
});

test('offline after three failed reads, online again at the first answer', async (t) => {
  const { gladys, app, cameras } = await startApp(t);
  const camera = app.hub.list()[0];
  cameras[KEY].down = true;
  await app.watcher.readCamera(camera);
  await app.watcher.readCamera(camera);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'a busy camera drops a request now and then');
  await app.watcher.readCamera(camera);
  assert.deepEqual(gladys.fake.sceneEvents.at(-1).data.state, 'offline');
  assert.match(gladys.fake.sceneEvents.at(-1).data.reason, /nothing answers/);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');

  cameras[KEY].down = false;
  await app.watcher.readCamera(camera);
  assert.equal(gladys.fake.sceneEvents.at(-1).data.state, 'online');
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  assert.equal(gladys.fake.sceneEvents.length, 2);
});

test('arming and night vision from Gladys reach the camera', async (t) => {
  const { gladys, cameras } = await startApp(t);
  const device = gladys.fake.discoveredDevices[0];
  const set = (key, value) =>
    gladys.fake.setValue(device, { external_id: featureId(gladys, key) }, value);
  assert.equal((await set(FEATURES.MOTION_DETECTION, 0)).success, true);
  assert.equal(cameras[KEY].motionConfig.isEnable, '0');
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.MOTION_DETECTION)), 0);
  assert.equal((await set(FEATURES.NIGHT_VISION, 1)).success, true);
  assert.equal(cameras[KEY].state.infraLedState, '1');
  assert.equal(gladys.fake.lastState(featureId(gladys, FEATURES.NIGHT_VISION)), 1);
});

test('a PTZ move is always stopped by the watchdog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gladys, foscam } = await startApp(t);
  const device = gladys.fake.discoveredDevices[0];
  const move = { external_id: featureId(gladys, FEATURES.MOVE) };
  assert.equal((await gladys.fake.setValue(device, move, 1)).success, true);
  assert.equal(foscam.calls.at(-1).cmd, 'ptzMoveLeft');
  t.mock.timers.tick(800);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(foscam.calls.at(-1).cmd, 'ptzStopRun');
  // Zoom was not declared for this camera.
  assert.equal((await gladys.fake.setValue(device, move, 5)).success, false);
});

test('a preset is reached by its position in the list', async (t) => {
  const { gladys, foscam } = await startApp(t);
  const device = gladys.fake.discoveredDevices[0];
  const preset = device.features.find((feature) => feature.external_id.endsWith(':preset'));
  assert.deepEqual(
    preset.supported_options.map((option) => [option.value, option.label]),
    [
      [1, 'TopMost'],
      [2, 'BottomMost'],
      [3, 'LeftMost'],
      [4, 'RightMost'],
    ],
  );
  assert.equal((await gladys.fake.setValue(device, preset, 3)).success, true);
  assert.deepEqual(
    { cmd: foscam.calls.at(-1).cmd, name: foscam.calls.at(-1).name },
    { cmd: 'ptzGotoPresetPoint', name: 'LeftMost' },
  );
  assert.equal((await gladys.fake.setValue(device, preset, 9)).success, false);
});

test('a fixed camera has no PTZ feature', async (t) => {
  const { gladys } = await startApp(t, { cameras: { [KEY]: fakeCamera({ presets: null }) } });
  const keys = gladys.fake.discoveredDevices[0].features.map((f) =>
    f.external_id.split(':').at(-1),
  );
  assert.ok(!keys.includes('move') && !keys.includes('preset'));
});

test('Gladys gets a fresh image on demand', async (t) => {
  const { gladys } = await startApp(t);
  const ack = await gladys.fake.getImage(gladys.fake.discoveredDevices[0]);
  assert.equal(ack.success, true);
  assert.match(ack.data.image, /^image\/jpg;base64,\/9j\//);
});

test('a camera created in Gladys gets its first image at once', async (t) => {
  const { gladys } = await startApp(t);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  assert.equal(gladys.fake.cameraImages.length, 1);
  assert.equal(gladys.fake.cameraImages[0].device_external_id, deviceId(gladys));
});

test('Test the connection reports every camera and every ignored entry', async (t) => {
  const { gladys } = await startApp(t, {
    cameras: {
      [KEY]: fakeCamera(),
      '192.168.1.21:88': fakeCamera({ down: true, mac: '00626e000001' }),
    },
    config: {
      cameras: `${KEY}, Jardin=192.168.1.21, bad host`,
      password: 'secret',
      snapshot_interval: 0,
    },
  });
  const ack = await gladys.fake.action('test_connection');
  assert.equal(ack.success, true);
  const { message } = ack.data;
  assert.match(
    message.en,
    /✓ Caméra \(192\.168\.1\.20:88\): FI9821W V2 1\.11\.1\.10, PTZ, 4 preset\(s\)/,
  );
  assert.match(message.en, /✗ Jardin \(192\.168\.1\.21:88\): nothing answers/);
  assert.match(message.fr, /« bad host » ignorée/);
  assert.ok(message.de && message.es);
});

test('a new configuration is applied without a restart', async (t) => {
  const { gladys } = await startApp(t, { config: { cameras: '', password: 'secret' } });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await gladys.fake.configUpdated({ cameras: KEY, password: 'secret', snapshot_interval: 0 });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
