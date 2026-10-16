// -----------------------------------------------------------------------------
// The connection status of the integration, and the "Test the connection"
// report of the Configuration screen.
//
// The status is the summary (shown next to the integration); the report is
// the detail, camera by camera, with what to do about each failure.
// -----------------------------------------------------------------------------

import { cameraName, describeAddress } from './cameras.js';
import { describeErrorIn } from './foscam/errors.js';
import { localize, pick } from './i18n.js';

const ENTRY_ERRORS = {
  host: {
    en: 'not a valid IP address or host name',
    fr: "adresse IP ou nom d'hôte invalide",
    de: 'keine gültige IP-Adresse und kein gültiger Hostname',
    es: 'dirección IP o nombre de host no válido',
  },
  port: {
    en: 'the port must be a number between 1 and 65535',
    fr: 'le port doit être un nombre entre 1 et 65535',
    de: 'der Port muss eine Zahl zwischen 1 und 65535 sein',
    es: 'el puerto debe ser un número entre 1 y 65535',
  },
  json: {
    en: 'the list starts with [ but is not a valid JSON array',
    fr: "la liste commence par [ mais n'est pas un tableau JSON valide",
    de: 'die Liste beginnt mit [, ist aber kein gültiges JSON-Array',
    es: 'la lista empieza por [ pero no es un array JSON válido',
  },
  duplicate: {
    en: 'this camera is already in the list',
    fr: 'cette caméra est déjà dans la liste',
    de: 'diese Kamera steht bereits in der Liste',
    es: 'esta cámara ya está en la lista',
  },
};

function entryErrorLine(language, { entry, reason }) {
  return pick(language, {
    en: `"${entry}" ignored: ${pick('en', ENTRY_ERRORS[reason])}.`,
    fr: `« ${entry} » ignorée : ${pick('fr', ENTRY_ERRORS[reason])}.`,
    de: `„${entry}“ ignoriert: ${pick('de', ENTRY_ERRORS[reason])}.`,
    es: `"${entry}" ignorada: ${pick('es', ENTRY_ERRORS[reason])}.`,
  });
}

const NO_CAMERA = {
  en: 'No camera configured yet: type the IP address of your cameras in the Cameras field.',
  fr: "Aucune caméra configurée : saisissez l'adresse IP de vos caméras dans le champ Caméras.",
  de: 'Noch keine Kamera eingerichtet: trage die IP-Adresse deiner Kameras im Feld Kameras ein.',
  es: 'Aún no hay cámaras configuradas: escriba la dirección IP de sus cámaras en el campo Cámaras.',
};

/**
 * The status shown in the Configuration screen: connected when every camera
 * answers, with the names of the others otherwise.
 * @returns {{ connected: boolean, message?: object }}
 */
export function connectionStatus(hub) {
  const cameras = hub.list();
  if (cameras.length === 0) {
    return { connected: false, message: NO_CAMERA };
  }
  const failing = cameras.filter((camera) => camera.online === false);
  const ignored = hub.parseErrors;
  if (failing.length === 0 && ignored.length === 0) {
    return { connected: true };
  }
  return {
    connected: false,
    message: localize((language) =>
      [
        ...failing.map(
          (camera) => `${cameraName(camera)}: ${describeErrorIn(language, camera.lastError)}.`,
        ),
        ...ignored.map((error) => entryErrorLine(language, error)),
      ].join(' '),
    ),
  };
}

function capabilities(language, identity) {
  if (!identity.ptz) {
    return pick(language, { en: 'fixed', fr: 'fixe', de: 'fest', es: 'fija' });
  }
  const count = identity.presets.length;
  return pick(language, {
    en: `PTZ, ${count} preset(s)`,
    fr: `motorisée, ${count} position(s) enregistrée(s)`,
    de: `PTZ, ${count} Preset(s)`,
    es: `PTZ, ${count} posición(es) guardada(s)`,
  });
}

/**
 * "Test the connection": ask every camera who it is, right now, and say what
 * answered and what did not.
 *
 * @param {object} hub see cameras.js
 * @returns {Promise<object>} the `{ en, fr, de, es }` message under the button
 */
export async function testConnection(hub) {
  const cameras = hub.list();
  const results = await Promise.all(
    cameras.map(async (camera) => {
      try {
        const identity = await hub.probe(camera);
        hub.markOnline(camera);
        return { camera, identity };
      } catch (err) {
        hub.markFailure(camera, err);
        return { camera, err };
      }
    }),
  );
  return localize((language) => {
    if (cameras.length === 0 && hub.parseErrors.length === 0) {
      return pick(language, NO_CAMERA);
    }
    const lines = results.map(({ camera, identity, err }) => {
      const where = `${cameraName(camera)} (${describeAddress(camera)})`;
      if (err) {
        return `✗ ${where}: ${describeErrorIn(language, err)}.`;
      }
      const firmware = identity.firmware ? ` ${identity.firmware}` : '';
      return `✓ ${where}: ${identity.model ?? 'Foscam'}${firmware}, ${capabilities(language, identity)}.`;
    });
    for (const error of hub.parseErrors) {
      lines.push(`✗ ${entryErrorLine(language, error)}`);
    }
    return lines.join('\n');
  });
}
