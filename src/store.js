// -----------------------------------------------------------------------------
// What the integration remembers across restarts, in /data (the only writable
// path of the container).
//
// - The identity of every camera met (MAC address, model, presets...), by
//   address. The MAC address is the Gladys id of a camera: a camera that does
//   not answer when the integration starts must keep its id, its device and
//   its history, so its identity is kept from the last time it answered.
// - The cameras the user disabled in Gladys (the `enabled` feature): a
//   Gladys-side gate the camera itself knows nothing about.
//
// Never a password: those stay in the Gladys configuration.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DEFAULT_DATA_DIR = '/data';
const FILE = 'foscam-state.json';

const EMPTY = () => ({ identities: {}, disabled: [] });

/**
 * @param {string} [dataDir] where the file lives (a temporary directory in tests)
 */
export function createStore(dataDir = process.env.FOSCAM_DATA_DIR || DEFAULT_DATA_DIR) {
  const path = join(dataDir, FILE);
  let state = EMPTY();
  let writing = Promise.resolve();

  async function save() {
    const content = `${JSON.stringify(state, null, 2)}\n`;
    // Written one after the other, through a temporary file: a crash leaves
    // the previous version, never half a file.
    writing = writing.then(async () => {
      try {
        await mkdir(dataDir, { recursive: true });
        await writeFile(`${path}.tmp`, content, { mode: 0o600 });
        await rename(`${path}.tmp`, path);
      } catch (err) {
        logger.warn(`Cannot save ${path}: ${err.message}`);
      }
    });
    return writing;
  }

  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        state = {
          identities:
            parsed?.identities && typeof parsed.identities === 'object' ? parsed.identities : {},
          disabled: Array.isArray(parsed?.disabled) ? parsed.disabled : [],
        };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Cannot read ${path}, starting afresh: ${err.message}`);
        }
        state = EMPTY();
      }
    },

    /** The identity last seen at that address, or null. */
    identity(key) {
      return state.identities[key] ?? null;
    },

    async saveIdentity(key, identity) {
      let changed = JSON.stringify(state.identities[key] ?? null) !== JSON.stringify(identity);
      // One address per MAC: a camera given a new IP address leaves its old one.
      for (const [other, known] of Object.entries(state.identities)) {
        if (other !== key && known.mac === identity.mac) {
          delete state.identities[other];
          changed = true;
        }
      }
      state.identities[key] = identity;
      if (changed) {
        await save();
      }
    },

    isEnabled(mac) {
      return !state.disabled.includes(mac);
    },

    async setEnabled(mac, enabled) {
      const disabled = state.disabled.filter((other) => other !== mac);
      if (!enabled) {
        disabled.push(mac);
      }
      state.disabled = disabled;
      await save();
    },

    /** Wait for the pending writes (tests, shutdown). */
    flush() {
      return writing;
    },
  };
}
