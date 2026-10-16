// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user fills it in the Gladys Configuration screen, from the `config_schema`
// of `gladys-assistant-integration.json`. This module holds the defaults (they
// MUST match the manifest `default` values, see test/manifest.test.js), turns
// the raw object into typed values, and reads the camera list.
//
// The camera list is one text field, so that any number of cameras fits in the
// form. Two syntaxes:
//
//   - the simple one, entries separated by commas, semicolons or new lines:
//       192.168.1.20, Garden=192.168.1.21:8080
//     `name=` is optional (the name stored in the camera is used otherwise),
//     the port defaults to 88, the Foscam HTTP port;
//   - a JSON array, for the cameras that need their own credentials or a
//     forced PTZ / zoom capability:
//       [{ "host": "192.168.1.22", "port": 88, "name": "Garage",
//          "username": "gladys", "password": "...", "ptz": false }]
//
// The username and password of the configuration serve every camera that does
// not carry its own.
// -----------------------------------------------------------------------------

/** The Foscam HTTP port, out of the box (HD models). */
export const DEFAULT_PORT = 88;

/** Gladys accepts 12 images a minute per camera: one every 5 s at most. */
export const MIN_SNAPSHOT_INTERVAL = 5;

/** Safety bound of a PTZ move (SDK rule: a lost stop must never last). */
export const MAX_PTZ_STEP_MS = 5000;

export const DEFAULT_CONFIG = {
  cameras: '',
  username: 'admin',
  password: '',
  // Seconds between two snapshots pushed to Gladys (0 = never pushed, only
  // taken when Gladys asks for one).
  snapshot_interval: 60,
  // Seconds between two reads of the camera alarms (motion, person, sound).
  detection_interval: 2,
  // How long a PTZ move lasts before the integration stops it, in ms.
  ptz_step_ms: 800,
};

function toNumber(value, fallback, min, max) {
  const number = Number(value);
  if (value === null || value === '' || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const snapshot = toNumber(raw.snapshot_interval, DEFAULT_CONFIG.snapshot_interval, 0, 3600);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    cameras: typeof raw.cameras === 'string' ? raw.cameras : DEFAULT_CONFIG.cameras,
    username:
      typeof raw.username === 'string' && raw.username.trim() !== ''
        ? raw.username.trim()
        : DEFAULT_CONFIG.username,
    password: typeof raw.password === 'string' ? raw.password : DEFAULT_CONFIG.password,
    // 0 switches the push off; anything else is held to the Gladys rate.
    snapshot_interval: snapshot === 0 ? 0 : Math.max(MIN_SNAPSHOT_INTERVAL, Math.round(snapshot)),
    detection_interval: toNumber(raw.detection_interval, DEFAULT_CONFIG.detection_interval, 1, 60),
    ptz_step_ms: toNumber(raw.ptz_step_ms, DEFAULT_CONFIG.ptz_step_ms, 100, MAX_PTZ_STEP_MS),
  };
}

// A host name or an IPv4 address: it ends up in a URL, so nothing else gets in.
const HOST_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/;

/** The key of a camera: where it answers. */
export function cameraKey(host, port) {
  return `${host.toLowerCase()}:${port}`;
}

function parsePort(value, errors, where) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push({ entry: where, reason: 'port' });
    return null;
  }
  return port;
}

function checkHost(host, errors, where) {
  if (typeof host !== 'string' || !HOST_PATTERN.test(host.trim())) {
    errors.push({ entry: where, reason: 'host' });
    return null;
  }
  return host.trim();
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function optionalBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function fromJson(text, errors) {
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    errors.push({ entry: 'JSON', reason: 'json' });
    return [];
  }
  if (!Array.isArray(list)) {
    errors.push({ entry: 'JSON', reason: 'json' });
    return [];
  }
  return list.flatMap((item, index) => {
    const where = `#${index + 1}`;
    if (item === null || typeof item !== 'object') {
      errors.push({ entry: where, reason: 'host' });
      return [];
    }
    const host = checkHost(item.host, errors, where);
    const port = parsePort(item.port, errors, where);
    if (host === null || port === null) {
      return [];
    }
    return [
      {
        host,
        port,
        name: optionalString(item.name),
        // A password of its own may legitimately be empty, so only a string
        // counts, whatever it holds.
        username: optionalString(item.username),
        password: typeof item.password === 'string' ? item.password : undefined,
        ptz: optionalBoolean(item.ptz),
        zoom: optionalBoolean(item.zoom),
      },
    ];
  });
}

function fromText(text, errors) {
  return text
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .flatMap((entry) => {
      const equal = entry.indexOf('=');
      const name = equal === -1 ? undefined : optionalString(entry.slice(0, equal));
      const address = (equal === -1 ? entry : entry.slice(equal + 1)).trim();
      // Pasted from a browser: http://192.168.1.20:88/ is fine too. Only then
      // is a path dropped; anywhere else a slash is a typo, refused below.
      const url = /^https?:\/\//i.test(address);
      const bare = url ? address.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') : address;
      const [hostPart, portPart, ...rest] = bare.split(':');
      if (rest.length > 0) {
        errors.push({ entry, reason: 'host' });
        return [];
      }
      const host = checkHost(hostPart, errors, entry);
      const port = parsePort(portPart, errors, entry);
      if (host === null || port === null) {
        return [];
      }
      return [{ host, port, name }];
    });
}

/**
 * Read the camera list of the configuration.
 *
 * @param {string} text the `cameras` field
 * @returns {{ cameras: Array<object>, errors: Array<{ entry: string, reason: string }> }}
 *   `cameras` in the order typed, one per address; `errors` names every entry
 *   left out and why (`host`, `port`, `json`, `duplicate`)
 */
export function parseCameras(text) {
  const errors = [];
  const trimmed = typeof text === 'string' ? text.trim() : '';
  const entries = trimmed.startsWith('[') ? fromJson(trimmed, errors) : fromText(trimmed, errors);
  const seen = new Set();
  const cameras = [];
  for (const entry of entries) {
    const key = cameraKey(entry.host, entry.port);
    if (seen.has(key)) {
      errors.push({ entry: key, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    cameras.push({ ...entry, key });
  }
  return { cameras, errors };
}
