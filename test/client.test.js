import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, normalizeMac } from '../src/foscam/client.js';
import { ERROR_CODES, FoscamError, describeError } from '../src/foscam/errors.js';
import { parseCgiResult } from '../src/foscam/xml.js';
import { LANGUAGES } from '../src/i18n.js';
import { createFakeFoscam, fakeCamera } from './helpers/fakeFoscam.js';

const KEY = '192.168.1.20:88';

function setup(overrides = {}, credentials = {}) {
  const foscam = createFakeFoscam({ [KEY]: fakeCamera(overrides) });
  const client = createClient({
    host: '192.168.1.20',
    port: 88,
    username: 'admin',
    password: 'secret',
    fetch: foscam.fetch,
    ...credentials,
  });
  return { foscam, client, camera: foscam.cameras[KEY] };
}

test('parseCgiResult reads the flat XML, URL-decoded or not', () => {
  assert.deepEqual(
    parseCgiResult(
      '<CGI_Result><result>0</result><devName>Entr%C3%A9e</devName><a>x &amp; y</a></CGI_Result>',
    ),
    { result: '0', devName: 'Entrée', a: 'x & y' },
  );
  assert.equal(parseCgiResult('<html>Not found</html>'), null);
  assert.deepEqual(parseCgiResult('<CGI_Result><p>100%</p></CGI_Result>'), { p: '100%' });
});

test('normalizeMac keeps 12 hex digits, lowercase', () => {
  assert.equal(normalizeMac('00:62:6E:4A:3E:6D'), '00626e4a3e6d');
  assert.equal(normalizeMac('nope'), null);
});

test('getDevInfo reads the identity of the camera', async () => {
  const { client } = setup();
  assert.deepEqual(await client.getDevInfo(), {
    mac: '00626e4a3e6d',
    model: 'FI9821W V2',
    name: 'Caméra',
    serial: '0000000000000001',
    firmware: '1.11.1.10',
    hardware: '1.4.1.8',
  });
});

test('a wrong password is an AUTH error that never quotes the password', async () => {
  const { client } = setup({}, { password: 'wrong-pass' });
  await assert.rejects(client.getDevInfo(), (err) => {
    assert.ok(err instanceof FoscamError);
    assert.equal(err.code, ERROR_CODES.AUTH);
    assert.doesNotMatch(err.message, /wrong-pass|pwd=/);
    return true;
  });
});

test('a camera switched off is UNREACHABLE, a slow one TIMEOUT', async () => {
  const { client } = setup({ down: true });
  await assert.rejects(client.getDevState(), { code: ERROR_CODES.UNREACHABLE });

  const slow = createClient({
    host: 'h',
    port: 88,
    username: 'u',
    password: 'p',
    fetch: async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    },
  });
  await assert.rejects(slow.getDevState(), { code: ERROR_CODES.TIMEOUT });
});

test('an HTTP server that is not a Foscam is NOT_FOSCAM', async () => {
  const client = createClient({
    host: 'h',
    port: 80,
    username: 'u',
    password: 'p',
    fetch: async () => new Response('<html></html>', { status: 200 }),
  });
  await assert.rejects(client.getDevInfo(), { code: ERROR_CODES.NOT_FOSCAM });
  const notFound = createClient({
    host: 'h',
    port: 80,
    username: 'u',
    password: 'p',
    fetch: async () => new Response('', { status: 404 }),
  });
  await assert.rejects(notFound.getDevInfo(), { code: ERROR_CODES.NOT_FOSCAM });
});

test('getDevState maps the alarms', async () => {
  const { client, camera } = setup();
  camera.state = {
    motionDetectAlarm: '2',
    humanDetectAlarmState: '2',
    soundAlarm: '0',
    IOAlarm: '1',
    infraLedState: '1',
  };
  assert.deepEqual(await client.getDevState(), {
    motion: 'alarm',
    person: 'alarm',
    sound: 'disabled',
    io: 'idle',
    infrared: true,
  });
});

test('the presets of a PTZ camera, and the refusal of a fixed one', async () => {
  assert.deepEqual(await setup().client.getPresets(), [
    'TopMost',
    'BottomMost',
    'LeftMost',
    'RightMost',
  ]);
  await assert.rejects(setup({ presets: null }).client.getPresets(), { code: ERROR_CODES.REFUSED });
});

test('arming the motion detection writes back the whole configuration', async () => {
  const { client, camera } = setup();
  await client.setMotionDetection(false);
  assert.equal(camera.motionConfig.isEnable, '0');
  assert.equal(camera.motionConfig.area0, '1023', 'the zones are kept');
  assert.equal(camera.motionConfig.schedule0, '281474976710655', 'the schedule is kept');
  assert.equal(camera.motionConfig.result, undefined);
});

test('newer models are armed through ...Config1', async () => {
  const { client, camera } = setup({ motionConfigVersion: '1' });
  await client.setMotionDetection(false);
  assert.equal(camera.motionConfig.isEnable, '0');
});

test('night vision: auto, or forced through the manual mode', async () => {
  const { client, camera, foscam } = setup();
  await client.setInfrared('on');
  assert.equal(camera.infraLedMode, '1');
  assert.equal(camera.state.infraLedState, '1');
  await client.setInfrared('off');
  assert.equal(camera.state.infraLedState, '0');
  await client.setInfrared('auto');
  assert.equal(camera.infraLedMode, '0');
  assert.deepEqual(
    foscam.calls.map((call) => call.cmd),
    [
      'setInfraLedConfig',
      'openInfraLed',
      'setInfraLedConfig',
      'closeInfraLed',
      'setInfraLedConfig',
    ],
  );
});

test('requests to one camera go one at a time', async () => {
  let running = 0;
  let max = 0;
  const { foscam } = setup();
  const client = createClient({
    host: '192.168.1.20',
    port: 88,
    username: 'admin',
    password: 'secret',
    fetch: async (url) => {
      running += 1;
      max = Math.max(max, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      return foscam.fetch(url);
    },
  });
  await Promise.all([client.getDevState(), client.getDevInfo(), client.snapshot()]);
  assert.equal(max, 1);
});

test('a refused snapshot reports why', async () => {
  const { client } = setup({}, { password: 'bad' });
  await assert.rejects(client.snapshot(), { code: ERROR_CODES.AUTH });
});

test('every error is explained in every language', () => {
  for (const code of Object.values(ERROR_CODES)) {
    const text = describeError(new FoscamError(code, 'x'));
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort());
    for (const language of LANGUAGES) {
      assert.ok(text[language].length > 10, `${code}.${language}`);
    }
  }
});
