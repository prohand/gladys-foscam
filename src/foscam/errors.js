// -----------------------------------------------------------------------------
// What can go wrong when talking to a camera, and how to say it to a user.
//
// The CGI answers a `result` code; the network fails in its own ways. Both end
// up as a FoscamError carrying one of the codes below, and every user-facing
// surface (Test the connection, the connection status, the widget, the scene
// events) explains it with `describeError`, in the four languages.
// -----------------------------------------------------------------------------

import { localize, pick } from '../i18n.js';

export const ERROR_CODES = {
  /** Wrong username or password (CGI -2). */
  AUTH: 'AUTH',
  /** The account has not enough rights for that command (CGI -3). */
  ACCESS: 'ACCESS',
  /** The camera refused the command: malformed, or not on this model (CGI -1, -4). */
  REFUSED: 'REFUSED',
  /** No answer in time (network) or the camera says it timed out (CGI -5). */
  TIMEOUT: 'TIMEOUT',
  /** Nothing answers at that address. */
  UNREACHABLE: 'UNREACHABLE',
  /** Something answers, but not a Foscam CGI (HTTP error, another device). */
  NOT_FOSCAM: 'NOT_FOSCAM',
  /** The snapshot is not a JPEG image. */
  BAD_IMAGE: 'BAD_IMAGE',
  /** Any other CGI failure (-6, -7, -8...). */
  UNKNOWN: 'UNKNOWN',
};

/** The CGI `result` codes, as documented by Foscam. */
const RESULT_CODES = {
  '-1': ERROR_CODES.REFUSED,
  '-2': ERROR_CODES.AUTH,
  '-3': ERROR_CODES.ACCESS,
  '-4': ERROR_CODES.REFUSED,
  '-5': ERROR_CODES.TIMEOUT,
};

export class FoscamError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} message technical detail, for the logs (never a password)
   * @param {object} [options] `{ cause, command }`
   */
  constructor(code, message, { cause, command } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'FoscamError';
    this.code = code;
    this.command = command;
  }
}

/** The error code of a CGI `result` value other than 0. */
export function codeOfResult(result) {
  return RESULT_CODES[String(result)] ?? ERROR_CODES.UNKNOWN;
}

/** The code of any error: FoscamError or not. */
export function errorCode(err) {
  return err instanceof FoscamError ? err.code : ERROR_CODES.UNKNOWN;
}

const TEXTS = {
  [ERROR_CODES.AUTH]: {
    en: 'wrong username or password (the camera may lock the account for a few minutes after several attempts)',
    fr: "nom d'utilisateur ou mot de passe incorrect (la caméra peut bloquer le compte quelques minutes après plusieurs essais)",
    de: 'falscher Benutzername oder falsches Passwort (die Kamera kann das Konto nach mehreren Versuchen einige Minuten sperren)',
    es: 'usuario o contraseña incorrectos (la cámara puede bloquear la cuenta unos minutos tras varios intentos)',
  },
  [ERROR_CODES.ACCESS]: {
    en: 'this account is not allowed to do that: give it the administrator or operator role on the camera',
    fr: "ce compte n'a pas le droit de le faire : donnez-lui le rôle administrateur ou opérateur sur la caméra",
    de: 'dieses Konto darf das nicht: gib ihm auf der Kamera die Rolle Administrator oder Bediener',
    es: 'esta cuenta no tiene permiso: dele el rol de administrador u operador en la cámara',
  },
  [ERROR_CODES.REFUSED]: {
    en: 'the camera refused the command (not available on this model or firmware)',
    fr: 'la caméra a refusé la commande (non disponible sur ce modèle ou ce firmware)',
    de: 'die Kamera hat den Befehl abgelehnt (bei diesem Modell oder dieser Firmware nicht verfügbar)',
    es: 'la cámara rechazó el comando (no disponible en este modelo o firmware)',
  },
  [ERROR_CODES.TIMEOUT]: {
    en: 'no answer in time: check that the camera is powered and on the network',
    fr: 'pas de réponse à temps : vérifiez que la caméra est alimentée et sur le réseau',
    de: 'keine rechtzeitige Antwort: prüfe, ob die Kamera Strom hat und im Netzwerk ist',
    es: 'sin respuesta a tiempo: compruebe que la cámara está encendida y en la red',
  },
  [ERROR_CODES.UNREACHABLE]: {
    en: 'nothing answers at this address: check the IP address and the HTTP port (88 by default)',
    fr: "rien ne répond à cette adresse : vérifiez l'adresse IP et le port HTTP (88 par défaut)",
    de: 'unter dieser Adresse antwortet nichts: prüfe die IP-Adresse und den HTTP-Port (standardmäßig 88)',
    es: 'nada responde en esta dirección: compruebe la dirección IP y el puerto HTTP (88 por defecto)',
  },
  [ERROR_CODES.NOT_FOSCAM]: {
    en: 'something answers at this address, but not a Foscam camera API: check the port',
    fr: "quelque chose répond à cette adresse, mais pas l'API d'une caméra Foscam : vérifiez le port",
    de: 'unter dieser Adresse antwortet etwas, aber keine Foscam-Kamera-API: prüfe den Port',
    es: 'algo responde en esta dirección, pero no la API de una cámara Foscam: compruebe el puerto',
  },
  [ERROR_CODES.BAD_IMAGE]: {
    en: 'the camera sent an image that cannot be read',
    fr: 'la caméra a envoyé une image illisible',
    de: 'die Kamera hat ein unlesbares Bild gesendet',
    es: 'la cámara envió una imagen ilegible',
  },
  [ERROR_CODES.UNKNOWN]: {
    en: 'the camera answered an unexpected error',
    fr: 'la caméra a répondu une erreur inattendue',
    de: 'die Kamera hat einen unerwarteten Fehler gemeldet',
    es: 'la cámara respondió un error inesperado',
  },
};

/** What went wrong, in one language. */
export function describeErrorIn(language, err) {
  return pick(language, TEXTS[errorCode(err)]);
}

/** What went wrong, as a `{ en, fr, de, es }` object. */
export function describeError(err) {
  return localize((language) => describeErrorIn(language, err));
}
