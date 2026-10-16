import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, DEFAULT_PORT, normalizeConfig, parseCameras } from '../src/config.js';

test('normalizeConfig applies the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig types and bounds the numbers', () => {
  const config = normalizeConfig({
    snapshot_interval: '2',
    detection_interval: '0',
    ptz_step_ms: 99999,
    username: '  ',
  });
  // Gladys takes 12 images a minute: 2 s is raised to 5.
  assert.equal(config.snapshot_interval, 5);
  assert.equal(config.detection_interval, 1);
  assert.equal(config.ptz_step_ms, 5000);
  assert.equal(config.username, 'admin');
  assert.equal(normalizeConfig({ snapshot_interval: 0 }).snapshot_interval, 0);
  assert.equal(normalizeConfig({ snapshot_interval: '' }).snapshot_interval, 60);
});

test('the simple list reads names, ports and pasted URLs', () => {
  const { cameras, errors } = parseCameras(
    'Entrée=192.168.1.20, Jardin = 192.168.1.21:8080;\nhttp://cam.local:88/\n192.168.1.23',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    cameras.map(({ name, host, port }) => ({ name, host, port })),
    [
      { name: 'Entrée', host: '192.168.1.20', port: DEFAULT_PORT },
      { name: 'Jardin', host: '192.168.1.21', port: 8080 },
      { name: undefined, host: 'cam.local', port: 88 },
      { name: undefined, host: '192.168.1.23', port: 88 },
    ],
  );
  assert.equal(cameras[1].key, '192.168.1.21:8080');
});

test('the JSON list carries per-camera credentials and capabilities', () => {
  const { cameras, errors } = parseCameras(
    '[{"host":"192.168.1.22","name":"Garage","username":"gladys","password":"","ptz":false},' +
      '{"host":"192.168.1.30","port":"443","zoom":true}]',
  );
  assert.deepEqual(errors, []);
  assert.equal(cameras[0].username, 'gladys');
  assert.equal(cameras[0].password, '', 'an empty password of its own is kept');
  assert.equal(cameras[0].ptz, false);
  assert.equal(cameras[1].port, 443);
  assert.equal(cameras[1].zoom, true);
  assert.equal(cameras[1].password, undefined);
});

test('bad entries are reported, never half-read', () => {
  const { cameras, errors } = parseCameras(
    '192.168.1.20, 192.168.1.20:88, bad host, 10.0.0.1:99999, a/b?c, 10.0.0.2:88:1',
  );
  assert.deepEqual(
    cameras.map((camera) => camera.key),
    ['192.168.1.20:88'],
  );
  assert.deepEqual(errors.map((error) => error.reason).sort(), [
    'duplicate',
    'host',
    'host',
    'host',
    'port',
  ]);
});

test('a host cannot smuggle anything into the camera URL', () => {
  for (const host of ['192.168.1.20/x', 'a@b', 'host?cmd=rebootSystem', 'x y', '-host']) {
    assert.equal(parseCameras(`[{"host":${JSON.stringify(host)}}]`).cameras.length, 0, host);
  }
});

test('a broken JSON list says so', () => {
  assert.deepEqual(parseCameras('[{"host":').errors, [{ entry: 'JSON', reason: 'json' }]);
  assert.deepEqual(parseCameras('').cameras, []);
});
