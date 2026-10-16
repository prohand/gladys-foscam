// -----------------------------------------------------------------------------
// A fake Foscam CGI, served through an injected `fetch`: no network, no camera.
//
// Each camera is keyed by `host:port` and answers the commands the integration
// uses, like the real firmware does: XML `<CGI_Result>` documents, a JPEG for
// snapPicture2, result -2 on a wrong password. A camera with `down: true`
// refuses the connection, like a camera switched off.
// -----------------------------------------------------------------------------

import jpeg from 'jpeg-js';

/** A JPEG frame of the given size (noise, so that it does not compress away). */
export function makeJpeg(width, height, quality = 90) {
  const data = Buffer.alloc(width * height * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = seed & 0xff;
    data[i + 1] = (seed >> 8) & 0xff;
    data[i + 2] = (seed >> 16) & 0xff;
    data[i + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ width, height, data }, quality).data);
}

const SMALL_JPEG = makeJpeg(64, 36);

function xml(values) {
  const tags = Object.entries(values)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join('\n');
  return `<CGI_Result>\n${tags}\n</CGI_Result>\n`;
}

function textResponse(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
}

/** A camera with sensible defaults; override any field. */
export function fakeCamera(overrides = {}) {
  return {
    mac: '00:62:6E:4A:3E:6D',
    model: 'FI9821W V2',
    name: 'Cam%C3%A9ra',
    firmware: '1.11.1.10',
    username: 'admin',
    password: 'secret',
    down: false,
    // null presets: a fixed camera, which refuses the command.
    presets: ['TopMost', 'BottomMost', 'LeftMost', 'RightMost'],
    motionConfigVersion: '',
    motionConfig: {
      isEnable: '1',
      linkage: '12',
      snapInterval: '2',
      sensitivity: '1',
      triggerInterval: '10',
      schedule0: '281474976710655',
      area0: '1023',
    },
    state: {
      motionDetectAlarm: '1',
      soundAlarm: '0',
      IOAlarm: '0',
      infraLedState: '0',
    },
    infraLedMode: '0',
    jpeg: SMALL_JPEG,
    ...overrides,
  };
}

/**
 * @param {Record<string, object>} cameras by `host:port`, see fakeCamera
 */
export function createFakeFoscam(cameras = {}) {
  const calls = [];

  async function fetch(url) {
    const target = new URL(url);
    const key = `${target.hostname}:${target.port || 80}`;
    const params = Object.fromEntries(target.searchParams);
    calls.push({ key, ...params });
    const camera = cameras[key];
    if (!camera || camera.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (params.usr !== camera.username || params.pwd !== camera.password) {
      return textResponse(xml({ result: -2 }));
    }
    const ok = (values = {}) => textResponse(xml({ result: 0, ...values }));
    switch (params.cmd) {
      case 'getDevInfo':
        return ok({
          productName: camera.model,
          serialNo: '0000000000000001',
          devName: camera.name,
          mac: camera.mac.replace(/:/g, ''),
          firmwareVer: camera.firmware,
          hardwareVer: '1.4.1.8',
        });
      case 'getDevState':
        return ok(camera.state);
      case 'getPTZPresetPointList':
        if (camera.presets === null) {
          return textResponse(xml({ result: -4 }));
        }
        return ok({
          cnt: camera.presets.length,
          ...Object.fromEntries(camera.presets.map((name, i) => [`point${i}`, name])),
        });
      case 'ptzGotoPresetPoint':
        return textResponse(xml({ result: camera.presets?.includes(params.name) ? 0 : -1 }));
      case 'ptzMoveUp':
      case 'ptzMoveDown':
      case 'ptzMoveLeft':
      case 'ptzMoveRight':
      case 'ptzStopRun':
      case 'zoomIn':
      case 'zoomOut':
      case 'zoomStop':
      case 'openInfraLed':
      case 'closeInfraLed':
      case 'rebootSystem':
        if (params.cmd === 'openInfraLed') camera.state.infraLedState = '1';
        if (params.cmd === 'closeInfraLed') camera.state.infraLedState = '0';
        return ok();
      case 'getInfraLedConfig':
        return ok({ mode: camera.infraLedMode });
      case 'setInfraLedConfig':
        camera.infraLedMode = params.mode;
        return ok();
      case 'getMotionDetectConfig':
      case 'getMotionDetectConfig1':
      case 'setMotionDetectConfig':
      case 'setMotionDetectConfig1': {
        const version = params.cmd.endsWith('1') ? '1' : '';
        if (version !== camera.motionConfigVersion) {
          return textResponse(xml({ result: -4 }));
        }
        if (params.cmd.startsWith('get')) {
          return ok(camera.motionConfig);
        }
        const { cmd: _cmd, usr: _usr, pwd: _pwd, ...values } = params;
        camera.motionConfig = values;
        camera.state.motionDetectAlarm = values.isEnable === '1' ? '1' : '0';
        return ok();
      }
      case 'snapPicture2':
        return new Response(camera.jpeg, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      default:
        return textResponse(xml({ result: -1 }));
    }
  }

  return { fetch, calls, cameras };
}
