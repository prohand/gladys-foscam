import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { MAX_IMAGE_LENGTH, downscale, imageBase64, toCameraImage } from '../src/foscam/image.js';
import { ERROR_CODES } from '../src/foscam/errors.js';
import { makeJpeg } from './helpers/fakeFoscam.js';

test('a small snapshot is sent untouched', () => {
  const small = makeJpeg(64, 36);
  const image = toCameraImage(small);
  assert.equal(image, `image/jpg;base64,${small.toString('base64')}`);
  assert.equal(imageBase64(image), small.toString('base64'));
});

test('a 1080p snapshot is made small enough for Gladys', () => {
  const big = makeJpeg(1920, 1080);
  assert.ok(big.length > MAX_IMAGE_LENGTH, 'the test frame is too big to start with');
  const image = toCameraImage(big);
  assert.ok(image.length <= MAX_IMAGE_LENGTH, `${image.length} characters`);
  const decoded = jpeg.decode(Buffer.from(imageBase64(image), 'base64'));
  assert.ok(decoded.width < 1920 && decoded.width >= 320);
  assert.equal(Math.round((decoded.width * 1080) / 1920), decoded.height, 'the ratio is kept');
});

test('downscale averages the pixels it covers', () => {
  const frame = {
    width: 2,
    height: 2,
    data: Buffer.from([0, 0, 0, 255, 200, 100, 50, 255, 0, 0, 0, 255, 200, 100, 50, 255]),
  };
  const scaled = downscale(frame, 1);
  assert.deepEqual([...scaled.data], [100, 50, 25, 255]);
});

test('a broken JPEG is a BAD_IMAGE error', () => {
  const broken = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(MAX_IMAGE_LENGTH, 1)]);
  assert.throws(() => toCameraImage(broken), { code: ERROR_CODES.BAD_IMAGE });
});
