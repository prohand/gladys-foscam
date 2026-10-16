// -----------------------------------------------------------------------------
// Scene actions, scene triggers and dashboard widgets, through the fake Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import { WIDGET_ACTIONS, WIDGET_KEYS, describeAgo } from '../src/capabilities/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { KEY, deviceId, startApp } from './helpers/setup.js';
import { fakeCamera, makeJpeg } from './helpers/fakeFoscam.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const declared = (list, key) => manifest[list].find((entry) => entry.key === key);
const keysOf = (entries) => (entries ?? []).map((entry) => entry.key);

test('take_snapshot publishes a fresh image on the camera device', async (t) => {
  const { gladys } = await startApp(t);
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.TAKE_SNAPSHOT, {
    device: deviceId(gladys),
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { captured: true } } });
  assert.equal(gladys.fake.cameraImages.at(-1).device_external_id, deviceId(gladys));
});

test('goto_preset finds the preset whatever its case, and says when it cannot', async (t) => {
  const { gladys, foscam } = await startApp(t);
  const run = (preset) =>
    gladys.fake.sceneAction(SCENE_ACTIONS.GOTO_PRESET, { device: deviceId(gladys), preset });
  assert.deepEqual((await run('topmost')).data.outputs, { moved: true });
  assert.equal(foscam.calls.at(-1).name, 'TopMost');
  assert.deepEqual((await run('Nowhere')).data.outputs, { moved: false });
});

test('set_motion_detection and set_night_vision change the camera', async (t) => {
  const { gladys, cameras } = await startApp(t);
  const device = deviceId(gladys);
  const armed = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_MOTION_DETECTION, {
    device,
    enabled: false,
  });
  assert.deepEqual(armed.data.outputs, { applied: true });
  assert.equal(cameras[KEY].motionConfig.isEnable, '0');
  const night = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_NIGHT_VISION, {
    device,
    mode: 'on',
  });
  assert.deepEqual(night.data.outputs, { applied: true });
  assert.equal(cameras[KEY].state.infraLedState, '1');
});

test('an action on a camera that does not answer is an output, not a failure', async (t) => {
  const { gladys, cameras } = await startApp(t);
  cameras[KEY].down = true;
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.REBOOT_CAMERA, {
    device: deviceId(gladys),
  });
  assert.deepEqual(ack, { success: true, data: { outputs: { rebooted: false } } });
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.REBOOT_CAMERA, { device: 'ext:x' });
  assert.equal(unknown.success, false, 'an unknown camera is a broken scene');
});

test('every scene action resolves exactly its declared outputs', async (t) => {
  const { gladys } = await startApp(t);
  const fields = {
    device: deviceId(gladys),
    preset: 'TopMost',
    enabled: true,
    mode: 'auto',
  };
  for (const action of manifest.scene_actions) {
    const ack = await gladys.fake.sceneAction(action.key, fields);
    assert.equal(ack.success, true, action.key);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      action.key,
    );
  }
});

test('scene events only carry the keys their trigger declares', async (t) => {
  const { gladys, app, cameras } = await startApp(t);
  const camera = app.hub.list()[0];
  await app.watcher.readCamera(camera);
  cameras[KEY].state = {
    ...cameras[KEY].state,
    motionDetectAlarm: '2',
    humanDetectAlarmState: '1',
  };
  await app.watcher.readCamera(camera);
  cameras[KEY].state.humanDetectAlarmState = '2';
  await app.watcher.readCamera(camera);
  cameras[KEY].down = true;
  for (let i = 0; i < 3; i += 1) {
    await app.watcher.readCamera(camera);
  }
  const kinds = new Set(gladys.fake.sceneEvents.map((event) => event.key));
  assert.deepEqual([...kinds].sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = declared('scene_triggers', key);
    const allowed = [...keysOf(trigger.fields), ...keysOf(trigger.variables)];
    for (const [name, value] of Object.entries(data)) {
      assert.ok(allowed.includes(name), `${key}: data.${name} is not declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${name} is flat`);
    }
  }
  const person = gladys.fake.sceneEvents.find((event) => event.data.kind === 'person');
  assert.ok(person, 'a person detection has its own kind');
  const options = (trigger, field) =>
    declared('scene_triggers', trigger)
      .fields.find((entry) => entry.key === field)
      .options.map((option) => option.value);
  for (const event of gladys.fake.sceneEvents) {
    if (event.key === SCENE_TRIGGERS.DETECTION) {
      assert.ok(options(SCENE_TRIGGERS.DETECTION, 'kind').includes(event.data.kind));
    } else {
      assert.ok(options(SCENE_TRIGGERS.CAMERA_CONNECTION, 'state').includes(event.data.state));
    }
  }
});

test('the camera widget is rendered exactly as sent, in every state', async (t) => {
  const { gladys, app, cameras } = await startApp(t);
  const settings = { camera: deviceId(gladys) };
  for (const language of LANGUAGES) {
    const empty = await gladys.fake.widgetGet(WIDGET_KEYS.CAMERA, { settings, language });
    assert.deepEqual(validateWidgetContent(empty.data.content), [], `no image, ${language}`);
  }
  const camera = app.hub.list()[0];
  await app.watcher.readCamera(camera);
  cameras[KEY].state.motionDetectAlarm = '2';
  await app.watcher.readCamera(camera);
  const full = (await gladys.fake.widgetGet(WIDGET_KEYS.CAMERA, { settings })).data.content;
  assert.deepEqual(validateWidgetContent(full), []);
  const image = full.components.find((component) => component.type === 'image');
  assert.ok(image, 'the last image is shown');
  const served = await gladys.fake.widgetGetImage(image.key);
  assert.equal(served.success, true);
  assert.deepEqual(validateWidgetImage(served.data.image), []);

  cameras[KEY].down = true;
  for (let i = 0; i < 3; i += 1) {
    await app.watcher.readCamera(camera);
  }
  const offline = (await gladys.fake.widgetGet(WIDGET_KEYS.CAMERA, { settings })).data.content;
  assert.deepEqual(validateWidgetContent(offline), []);

  const none = (await gladys.fake.widgetGet(WIDGET_KEYS.CAMERA, { settings: {} })).data.content;
  assert.deepEqual(validateWidgetContent(none), []);
});

test('the camera widget buttons work', async (t) => {
  const { gladys } = await startApp(t);
  const content = (
    await gladys.fake.widgetGet(WIDGET_KEYS.CAMERA, { settings: { camera: deviceId(gladys) } })
  ).data.content;
  const refresh = content.components.find(
    (component) => component.action?.key === WIDGET_ACTIONS.REFRESH,
  );
  const ack = await gladys.fake.widgetAction(
    WIDGET_KEYS.CAMERA,
    refresh.action.key,
    refresh.action.params,
  );
  assert.equal(ack.success, true);
  assert.equal(gladys.fake.cameraImages.length, 1);
  assert.ok(gladys.fake.widgetRefreshes.includes(WIDGET_KEYS.CAMERA));
});

test('the overview widget lists every camera', async (t) => {
  const { gladys } = await startApp(t, {
    cameras: {
      [KEY]: fakeCamera({ jpeg: makeJpeg(1920, 1080) }),
      '192.168.1.21:88': fakeCamera({ down: true, mac: '00626e000001' }),
    },
    config: { cameras: `${KEY}, 192.168.1.21`, password: 'secret', snapshot_interval: 0 },
  });
  const content = (await gladys.fake.widgetGet(WIDGET_KEYS.OVERVIEW)).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items.length, 2);
  const ack = await gladys.fake.widgetAction(WIDGET_KEYS.OVERVIEW, WIDGET_ACTIONS.SNAPSHOT_ALL);
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.en, '1 of 1 images refreshed');
  assert.ok(gladys.fake.cameraImages[0].image.length <= 150 * 1024, 'the 1080p frame was reduced');
});

test('describeAgo stays short in every language', () => {
  const now = 10 * 24 * 3600 * 1000;
  for (const language of LANGUAGES) {
    for (const ago of [0, 5 * 60000, 3 * 3600000, 5 * 24 * 3600000]) {
      assert.ok(describeAgo(language, now - ago, now).length <= 20);
    }
  }
});
