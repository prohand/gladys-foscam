// -----------------------------------------------------------------------------
// The answers of the Foscam CGI API.
//
// Every command answers a flat XML document:
//
//   <CGI_Result>
//     <result>0</result>
//     <productName>FI9821W</productName>
//     <devName>Entr%C3%A9e</devName>
//     ...
//   </CGI_Result>
//
// One level, no attributes: a regular expression reads it, no XML library
// needed. Some firmwares URL-encode the free texts (the camera name, the
// preset names), others do not: a value that decodes is decoded, any other is
// kept as is.
// -----------------------------------------------------------------------------

const TAG = /<([A-Za-z_][A-Za-z0-9_]*)>([^<]*)<\/\1>/g;

function decode(value) {
  const unescaped = value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  if (!/%[0-9A-Fa-f]{2}/.test(unescaped)) {
    return unescaped.trim();
  }
  try {
    return decodeURIComponent(unescaped).trim();
  } catch {
    return unescaped.trim();
  }
}

/**
 * Read a `<CGI_Result>` document.
 * @param {string} text the body of the answer
 * @returns {Record<string, string> | null} every tag and its value, `null`
 *   when the text is not a CGI result at all
 */
export function parseCgiResult(text) {
  if (typeof text !== 'string' || !text.includes('<CGI_Result>')) {
    return null;
  }
  const values = {};
  for (const [, tag, value] of text.matchAll(TAG)) {
    values[tag] = decode(value);
  }
  return values;
}
