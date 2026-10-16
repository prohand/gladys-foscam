// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+).
//
//   camera    one camera, chosen in the widget settings: its last image, the
//             live motion tile, its state (connection, motion detection,
//             night vision, last detection) and buttons to refresh the image
//             and to arm or disarm the motion detection.
//   overview  every camera of the configuration at a glance, with a button
//             that takes a fresh image of each one.
//
// The content is declarative (the core renders it, no HTML): at most 8
// components, 1 focal (the image), 6 tiles, 1 status list and 4 buttons. Its
// images are served by onWidgetGetImage, by key: a new snapshot gets a new key
// (see cameras.js), since the core caches an image one hour by key.
//
// Keys are stored by the dashboards: never renamed.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { cameraName } from '../cameras.js';
import { FEATURES, idsOf } from '../devices/camera.js';
import { ALARM } from '../foscam/client.js';
import { ERROR_CODES, errorCode } from '../foscam/errors.js';
import { localize, pick } from '../i18n.js';

export const WIDGET_KEYS = { CAMERA: 'camera', OVERVIEW: 'overview' };

export const WIDGET_ACTIONS = { REFRESH: 'refresh', SNAPSHOT_ALL: 'snapshot_all' };

const T = {
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  wrongPassword: {
    en: 'Wrong password',
    fr: 'Mot de passe incorrect',
    de: 'Falsches Passwort',
    es: 'Contraseña incorrecta',
  },
  accessDenied: {
    en: 'Access denied',
    fr: 'Accès refusé',
    de: 'Zugriff verweigert',
    es: 'Acceso denegado',
  },
  disabled: {
    en: 'Disabled in Gladys',
    fr: 'Désactivée dans Gladys',
    de: 'In Gladys deaktiviert',
    es: 'Desactivada en Gladys',
  },
  connection: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  motionDetection: {
    en: 'Motion detection',
    fr: 'Détection de mouvement',
    de: 'Bewegungserkennung',
    es: 'Detección de movimiento',
  },
  armed: { en: 'Armed', fr: 'Activée', de: 'Aktiv', es: 'Activada' },
  disarmed: { en: 'Disarmed', fr: 'Désactivée', de: 'Inaktiv', es: 'Desactivada' },
  nightVision: {
    en: 'Night vision',
    fr: 'Vision nocturne',
    de: 'Nachtsicht',
    es: 'Visión nocturna',
  },
  on: { en: 'On', fr: 'Allumée', de: 'An', es: 'Encendida' },
  off: { en: 'Off', fr: 'Éteinte', de: 'Aus', es: 'Apagada' },
  auto: { en: 'auto', fr: 'auto', de: 'auto', es: 'auto' },
  lastDetection: {
    en: 'Last detection',
    fr: 'Dernière détection',
    de: 'Letzte Erkennung',
    es: 'Última detección',
  },
  never: { en: 'None yet', fr: 'Aucune', de: 'Noch keine', es: 'Ninguna aún' },
  model: { en: 'Model', fr: 'Modèle', de: 'Modell', es: 'Modelo' },
  motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  refresh: {
    en: 'Refresh image',
    fr: "Rafraîchir l'image",
    de: 'Bild aktualisieren',
    es: 'Actualizar imagen',
  },
  arm: {
    en: 'Arm detection',
    fr: 'Activer la détection',
    de: 'Erkennung an',
    es: 'Activar detección',
  },
  disarm: {
    en: 'Disarm detection',
    fr: 'Couper la détection',
    de: 'Erkennung aus',
    es: 'Desactivar detección',
  },
  snapshotAll: {
    en: 'Refresh all images',
    fr: 'Rafraîchir les images',
    de: 'Alle Bilder neu',
    es: 'Actualizar imágenes',
  },
  camerasOnline: {
    en: 'Cameras online',
    fr: 'Caméras en ligne',
    de: 'Kameras online',
    es: 'Cámaras en línea',
  },
  inAlarm: { en: 'In alarm', fr: 'En alarme', de: 'Im Alarm', es: 'En alarma' },
  chooseCamera: {
    en: 'Choose a camera in the settings of this widget.',
    fr: 'Choisissez une caméra dans les réglages de ce widget.',
    de: 'Wähle eine Kamera in den Einstellungen dieses Widgets.',
    es: 'Elija una cámara en los ajustes de este widget.',
  },
  noCamera: {
    en: 'No camera in the integration configuration yet.',
    fr: "Aucune caméra dans la configuration de l'intégration.",
    de: 'Noch keine Kamera in der Konfiguration der Integration.',
    es: 'Aún no hay cámaras en la configuración de la integración.',
  },
  noImage: {
    en: 'No image yet: tap Refresh image.',
    fr: "Pas encore d'image : touchez Rafraîchir l'image.",
    de: 'Noch kein Bild: tippe auf Bild aktualisieren.',
    es: 'Aún no hay imagen: pulse Actualizar imagen.',
  },
  kinds: {
    motion: { en: 'motion', fr: 'mouvement', de: 'Bewegung', es: 'movimiento' },
    person: { en: 'person', fr: 'personne', de: 'Person', es: 'persona' },
    sound: { en: 'sound', fr: 'son', de: 'Geräusch', es: 'sonido' },
    io: { en: 'alarm input', fr: 'entrée alarme', de: 'Alarmeingang', es: 'entrada alarma' },
  },
};

/** How long ago, in a few characters (status values hold 40 at most). */
export function describeAgo(language, at, now) {
  const minutes = Math.floor(Math.max(0, now - at) / 60000);
  if (minutes < 1) {
    return pick(language, {
      en: 'just now',
      fr: "à l'instant",
      de: 'gerade eben',
      es: 'ahora mismo',
    });
  }
  if (minutes < 60) {
    return pick(language, {
      en: `${minutes} min ago`,
      fr: `il y a ${minutes} min`,
      de: `vor ${minutes} Min.`,
      es: `hace ${minutes} min`,
    });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return pick(language, {
      en: `${hours} h ago`,
      fr: `il y a ${hours} h`,
      de: `vor ${hours} Std.`,
      es: `hace ${hours} h`,
    });
  }
  const days = Math.floor(hours / 24);
  return pick(language, {
    en: `${days} days ago`,
    fr: `il y a ${days} jours`,
    de: `vor ${days} Tagen`,
    es: `hace ${days} días`,
  });
}

/** The connection of a camera, as a status value and a color. */
export function connectionItem(hub, camera) {
  if (!hub.isEnabled(camera)) {
    return { value: T.disabled, color: WIDGET_COLORS.NEUTRAL };
  }
  if (camera.online === true) {
    return { value: T.online, color: WIDGET_COLORS.SUCCESS };
  }
  if (camera.online === null) {
    return { value: T.waiting, color: WIDGET_COLORS.NEUTRAL };
  }
  switch (errorCode(camera.lastError)) {
    case ERROR_CODES.AUTH:
      return { value: T.wrongPassword, color: WIDGET_COLORS.DANGER };
    case ERROR_CODES.ACCESS:
      return { value: T.accessDenied, color: WIDGET_COLORS.WARNING };
    default:
      return { value: T.offline, color: WIDGET_COLORS.DANGER };
  }
}

function inAlarm(camera) {
  return Object.values(camera.alarms).some((alarm) => alarm === ALARM.ALARM);
}

function cameraContent(gladys, hub, camera, language, now) {
  const ids = idsOf(gladys, camera);
  const components = [];
  if (camera.snapshot) {
    components.push({
      type: 'image',
      key: camera.snapshot.key,
      alt: cameraName(camera),
      fit: 'contain',
    });
  } else {
    components.push({ type: 'text', variant: 'caption', text: T.noImage });
  }
  components.push({
    type: 'value',
    label: T.motion,
    icon: 'activity',
    device_feature: ids.feature(FEATURES.MOTION),
  });

  const items = [{ label: T.connection, icon: 'wifi', ...connectionItem(hub, camera) }];
  if (camera.armed !== null) {
    items.push({
      label: T.motionDetection,
      icon: 'shield',
      value: camera.armed ? T.armed : T.disarmed,
      color: camera.armed ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  if (camera.infrared !== null) {
    const state = camera.infrared ? T.on : T.off;
    items.push({
      label: T.nightVision,
      icon: 'moon',
      value:
        camera.infraredMode === 'auto'
          ? localize((lang) => `${pick(lang, state)} (${pick(lang, T.auto)})`)
          : state,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  items.push({
    label: T.lastDetection,
    icon: 'bell',
    value: camera.lastDetection
      ? `${pick(language, T.kinds[camera.lastDetection.kind])} · ${describeAgo(language, camera.lastDetection.at, now)}`
      : T.never,
    color: camera.lastDetection ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
  });
  if (camera.identity.model) {
    items.push({
      label: T.model,
      icon: 'camera',
      value: [camera.identity.model, camera.identity.firmware].filter(Boolean).join(' · '),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: T.refresh,
    icon: 'refresh-cw',
    style: 'primary',
    action: { key: WIDGET_ACTIONS.REFRESH, params: { device: ids.device } },
  });
  if (camera.armed !== null) {
    components.push({
      type: 'button',
      label: camera.armed ? T.disarm : T.arm,
      icon: camera.armed ? 'shield-off' : 'shield',
      style: 'secondary',
      device_feature: ids.feature(FEATURES.MOTION_DETECTION),
      value: camera.armed ? 0 : 1,
    });
  }
  return components;
}

function overviewContent(hub) {
  const cameras = hub.list();
  if (cameras.length === 0) {
    return [{ type: 'text', variant: 'caption', text: T.noCamera }];
  }
  const online = cameras.filter((camera) => camera.online === true).length;
  return [
    { type: 'value', label: T.camerasOnline, icon: 'video', value: `${online}/${cameras.length}` },
    {
      type: 'value',
      label: T.inAlarm,
      icon: 'bell',
      value: cameras.filter(inAlarm).length,
      color: cameras.some(inAlarm) ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'status',
      // The status list holds 10 rows: a larger fleet shows its first ten.
      items: cameras.slice(0, 10).map((camera) => ({
        label: cameraName(camera),
        icon: inAlarm(camera) ? 'bell' : 'video',
        ...(inAlarm(camera)
          ? { value: T.inAlarm, color: WIDGET_COLORS.WARNING }
          : connectionItem(hub, camera)),
      })),
    },
    {
      type: 'button',
      label: T.snapshotAll,
      icon: 'camera',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.SNAPSHOT_ALL },
    },
  ];
}

/**
 * The widget handlers, keyed by manifest key: `get` for onWidgetGet,
 * `action` for onWidgetAction.
 *
 * @param {object} options
 * @param {object} options.gladys the SDK instance
 * @param {object} options.hub see cameras.js
 * @param {(camera: object, options?: object) => Promise<boolean>} options.snapshot
 *   take and publish a fresh image
 * @param {() => number} [options.now] clock
 */
export function createWidgets({ gladys, hub, snapshot, now = Date.now }) {
  return {
    [WIDGET_KEYS.CAMERA]: {
      async get({ settings = {}, language = 'en' }) {
        if (!settings.camera) {
          return { components: [{ type: 'text', variant: 'caption', text: T.chooseCamera }] };
        }
        const camera = hub.byExternalId(gladys, settings.camera);
        if (!camera) {
          return { components: [{ type: 'text', variant: 'caption', text: T.noCamera }] };
        }
        // The image changes with every snapshot, which nudges the widget:
        // the TTL is a safety net.
        return {
          ttl_seconds: 120,
          components: cameraContent(gladys, hub, camera, language, now()),
        };
      },

      async action({ actionKey, params }) {
        if (actionKey !== WIDGET_ACTIONS.REFRESH) {
          throw new Error(`Unknown widget action: ${actionKey}`);
        }
        const camera = hub.byExternalId(gladys, params?.device);
        if (!camera || !(await snapshot(camera, { force: true }))) {
          // Throwing acks the action as failed: the message reaches the user.
          throw new Error('The camera did not send an image');
        }
        return undefined;
      },
    },

    [WIDGET_KEYS.OVERVIEW]: {
      async get() {
        return { ttl_seconds: 60, components: overviewContent(hub) };
      },

      async action({ actionKey }) {
        if (actionKey !== WIDGET_ACTIONS.SNAPSHOT_ALL) {
          throw new Error(`Unknown widget action: ${actionKey}`);
        }
        const cameras = hub.identified().filter((camera) => camera.online);
        const results = await Promise.all(
          cameras.map((camera) => snapshot(camera, { force: true })),
        );
        const done = results.filter(Boolean).length;
        return localize((language) =>
          pick(language, {
            en: `${done} of ${cameras.length} images refreshed`,
            fr: `${done} image(s) sur ${cameras.length} rafraîchie(s)`,
            de: `${done} von ${cameras.length} Bildern aktualisiert`,
            es: `${done} de ${cameras.length} imágenes actualizadas`,
          }),
        );
      },
    },
  };
}

/** Ask the core to re-pull every widget now (rate-limited 1 per 10 s per widget). */
export function refreshWidgets(gladys) {
  for (const key of Object.values(WIDGET_KEYS)) {
    gladys.requestWidgetRefresh(key);
  }
}
