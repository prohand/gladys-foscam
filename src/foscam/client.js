// -----------------------------------------------------------------------------
// Local client of the Foscam CGI API (HD models: FI98xx, FI99xx, R2/R4, C1/C2,
// G2/G4, SD2, X1...).
//
// Every command is one HTTP GET on the camera itself, on the LAN:
//
//   http://<host>:<port>/cgi-bin/CGIProxy.fcgi?cmd=<command>&usr=<user>&pwd=<password>&...
//
// No cloud is involved. Three things worth knowing:
//
//   - the credentials travel in the query string: that is how the CGI works,
//     so a URL is NEVER logged nor put in an error message;
//   - the camera serves few requests at a time and drops the others: the
//     requests to one camera are queued, one at a time;
//   - a wrong password counts: after a few in a row, the camera locks the
//     account for a while. The caller backs off on AUTH errors (watcher.js).
// -----------------------------------------------------------------------------

import { ERROR_CODES, FoscamError, codeOfResult } from './errors.js';
import { parseCgiResult } from './xml.js';

/** Timeout of a plain command. */
export const COMMAND_TIMEOUT_MS = 5000;

/** Timeout of a snapshot: a big JPEG over Wi-Fi takes its time. */
export const SNAPSHOT_TIMEOUT_MS = 10000;

/** The PTZ commands of the CGI, by movement. */
export const PTZ_COMMANDS = {
  up: 'ptzMoveUp',
  down: 'ptzMoveDown',
  left: 'ptzMoveLeft',
  right: 'ptzMoveRight',
  stop: 'ptzStopRun',
  zoomIn: 'zoomIn',
  zoomOut: 'zoomOut',
  zoomStop: 'zoomStop',
};

/** Alarm states of `getDevState`: 0 disabled, 1 armed and quiet, 2 alarm. */
export const ALARM = { DISABLED: 'disabled', IDLE: 'idle', ALARM: 'alarm' };

function alarmOf(value) {
  switch (value) {
    case '0':
      return ALARM.DISABLED;
    case '1':
      return ALARM.IDLE;
    case '2':
      return ALARM.ALARM;
    default:
      return null;
  }
}

/** A MAC address as an id: lowercase hex, no separator. */
export function normalizeMac(mac) {
  const hex = String(mac ?? '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();
  return hex.length === 12 ? hex : null;
}

function isJpeg(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

/**
 * Create the client of one camera.
 *
 * @param {object} options
 * @param {string} options.host IPv4 address or host name (checked by config.js)
 * @param {number} options.port HTTP port
 * @param {string} options.username
 * @param {string} options.password
 * @param {typeof fetch} [options.fetch] injected by the tests
 */
export function createClient({ host, port, username, password, fetch = globalThis.fetch }) {
  const base = `http://${host}:${port}/cgi-bin/CGIProxy.fcgi`;
  let queue = Promise.resolve();

  // One request at a time per camera, whatever happened to the previous one.
  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function get(command, params, timeoutMs) {
    const url = new URL(base);
    url.searchParams.set('cmd', command);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    url.searchParams.set('usr', username);
    url.searchParams.set('pwd', password);
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      // The cause (a fetch TypeError) holds no URL, only the socket error.
      throw new FoscamError(
        timedOut ? ERROR_CODES.TIMEOUT : ERROR_CODES.UNREACHABLE,
        `${command}: ${timedOut ? 'no answer in time' : (err?.cause?.code ?? err?.message)}`,
        { command },
      );
    }
    if (!response.ok) {
      throw new FoscamError(ERROR_CODES.NOT_FOSCAM, `${command}: HTTP ${response.status}`, {
        command,
      });
    }
    return response;
  }

  async function readResult(command, response) {
    const values = parseCgiResult(await response.text());
    if (values === null) {
      throw new FoscamError(ERROR_CODES.NOT_FOSCAM, `${command}: not a CGI answer`, { command });
    }
    if (values.result !== '0') {
      throw new FoscamError(codeOfResult(values.result), `${command}: result ${values.result}`, {
        command,
      });
    }
    return values;
  }

  /**
   * Run one CGI command.
   * @param {string} command e.g. `getDevInfo`
   * @param {Record<string, string|number>} [params]
   * @returns {Promise<Record<string, string>>} the tags of the answer
   */
  function request(command, params = {}) {
    return enqueue(async () => readResult(command, await get(command, params, COMMAND_TIMEOUT_MS)));
  }

  /** One JPEG frame of the main stream, as a Buffer. */
  function snapshot() {
    return enqueue(async () => {
      const response = await get('snapPicture2', {}, SNAPSHOT_TIMEOUT_MS);
      const body = Buffer.from(await response.arrayBuffer());
      if (isJpeg(body)) {
        return body;
      }
      // A refused snapshot is a CGI result (a wrong password, mostly).
      await readResult('snapPicture2', { text: async () => body.toString('utf8') });
      throw new FoscamError(ERROR_CODES.BAD_IMAGE, 'snapPicture2: not a JPEG', {
        command: 'snapPicture2',
      });
    });
  }

  return {
    host,
    port,
    request,
    snapshot,

    /** Model, firmware, name and MAC address of the camera. */
    async getDevInfo() {
      const info = await request('getDevInfo');
      const mac = normalizeMac(info.mac);
      if (!mac) {
        throw new FoscamError(ERROR_CODES.NOT_FOSCAM, 'getDevInfo: no MAC address', {
          command: 'getDevInfo',
        });
      }
      return {
        mac,
        model: info.productName || null,
        name: info.devName || null,
        serial: info.serialNo || null,
        firmware: info.firmwareVer || null,
        hardware: info.hardwareVer || null,
      };
    },

    /** The alarms and the infrared LED, as `getDevState` reports them. */
    async getDevState() {
      const state = await request('getDevState');
      return {
        motion: alarmOf(state.motionDetectAlarm),
        // Person detection, on the models that have it (newer firmwares).
        person: alarmOf(state.humanDetectAlarmState),
        sound: alarmOf(state.soundAlarm),
        io: alarmOf(state.IOAlarm),
        infrared: state.infraLedState === undefined ? null : state.infraLedState === '1',
      };
    },

    /** The names of the PTZ presets, in the camera's order. */
    async getPresets() {
      const list = await request('getPTZPresetPointList');
      const count = Number(list.cnt);
      const names = [];
      for (let i = 0; i < (Number.isInteger(count) ? count : 0); i += 1) {
        const name = list[`point${i}`];
        if (name) {
          names.push(name);
        }
      }
      return names;
    },

    gotoPreset(name) {
      return request('ptzGotoPresetPoint', { name });
    },

    /** Start a movement (`PTZ_COMMANDS` key). It runs until stopped. */
    async move(direction) {
      const command = PTZ_COMMANDS[direction];
      if (!command) {
        throw new Error(`Unknown PTZ movement: ${direction}`);
      }
      return request(command);
    },

    /** Infrared mode: `auto` (the camera decides), or forced `on` / `off`. */
    async getInfraredMode() {
      const config = await request('getInfraLedConfig');
      return config.mode === '0' ? 'auto' : 'manual';
    },

    async setInfrared(mode) {
      if (mode === 'auto') {
        await request('setInfraLedConfig', { mode: 0 });
        return;
      }
      // Forcing the LED only works in manual mode.
      await request('setInfraLedConfig', { mode: 1 });
      await request(mode === 'on' ? 'openInfraLed' : 'closeInfraLed');
    },

    /**
     * Arm or disarm the motion detection of the camera. The CGI only writes
     * the whole configuration (sensitivity, zones, schedule...): read it,
     * change `isEnable`, write it back. Newer models name it `...Config1`.
     */
    async setMotionDetection(enabled) {
      let suffix = '';
      let config;
      try {
        config = await request('getMotionDetectConfig');
      } catch (err) {
        if (!(err instanceof FoscamError) || err.code !== ERROR_CODES.REFUSED) {
          throw err;
        }
        suffix = '1';
        config = await request('getMotionDetectConfig1');
      }
      const { result: _result, ...values } = config;
      await request(`setMotionDetectConfig${suffix}`, { ...values, isEnable: enabled ? 1 : 0 });
    },

    reboot() {
      return request('rebootSystem');
    },
  };
}
