/**
 * WiFi QR payload + validation. Pure functions: no DOM, no storage, no network, no logging.
 *
 * Payload format (the de-facto standard read by iOS and Android cameras and by ZXing):
 *   WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<password>;H:<true|false>;;
 *
 * Escaping: a backslash is placed before \  ;  ,  "  and  :  inside the SSID and password.
 * Values are never trimmed or otherwise altered.
 */

export const SECURITY = {
  WPA: { label: 'WPA / WPA2 / WPA3', needsPassword: true },
  WEP: { label: 'WEP', needsPassword: true },
  nopass: { label: 'None (open network)', needsPassword: false },
};

/** Escape \ ; , " : with a leading backslash (single pass, so nothing is escaped twice). */
export function escapeWifiValue(value) {
  return String(value).replace(/[\\;,":]/g, '\\$&');
}

/**
 * Builds the QR text. `security` is 'WPA' | 'WEP' | 'nopass'. Open networks always get an empty password.
 */
export function buildWifiPayload({ ssid, password = '', security = 'WPA', hidden = false }) {
  const type = SECURITY[security] ? security : 'WPA';
  const open = type === 'nopass';
  return `WIFI:T:${type};S:${escapeWifiValue(ssid)};P:${open ? '' : escapeWifiValue(password)};H:${hidden ? 'true' : 'false'};;`;
}

/** UTF-8 length in bytes (SSIDs are limited to 32 bytes, not 32 characters). */
export function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

const HEX = /^[0-9a-fA-F]+$/;
const NON_ASCII = /[^\x00-\x7f]/;

/**
 * Validates the form values.
 *  - `errors`   block the QR code (missing required values, impossible SSID length).
 *  - `warnings` never block; they flag values that are unusual for the chosen security type.
 * Returns { valid, errors: { ssid?, password? }, warnings: { ssid?: string[], password?: string[] } }.
 */
export function validateNetwork({ ssid = '', password = '', security = 'WPA' }) {
  const errors = {};
  const warnings = { ssid: [], password: [] };

  if (ssid.length === 0) errors.ssid = 'Enter the network name (SSID).';
  else {
    const bytes = utf8Length(ssid);
    if (bytes > 32) errors.ssid = `A network name can be at most 32 bytes. This one is ${bytes} bytes.`;
    if (/^\s|\s$/.test(ssid)) warnings.ssid.push('The name starts or ends with a space. It will be included exactly as typed.');
    if (NON_ASCII.test(ssid)) warnings.ssid.push('The name has non-English characters. Most phones read them correctly, but some older scanners may not.');
  }

  const info = SECURITY[security] ?? SECURITY.WPA;
  if (info.needsPassword) {
    if (password.length === 0) errors.password = 'Enter the network password.';
    else {
      if (security === 'WPA') {
        const ok = (password.length >= 8 && password.length <= 63) || (password.length === 64 && HEX.test(password));
        if (!ok) warnings.password.push('WPA passwords are normally 8 to 63 characters. Check that this matches your router.');
      } else if (security === 'WEP') {
        const n = password.length;
        const ok = n === 5 || n === 13 || ((n === 10 || n === 26) && HEX.test(password));
        if (!ok) warnings.password.push('WEP keys are normally 5 or 13 characters, or 10 or 26 hexadecimal digits.');
      }
      if (/^\s|\s$/.test(password)) warnings.password.push('The password starts or ends with a space. It will be included exactly as typed.');
      if (NON_ASCII.test(password)) warnings.password.push('The password has non-English characters. Most phones read them correctly, but some older scanners may not.');
    }
  }

  return { valid: Object.keys(errors).length === 0, errors, warnings };
}

export function securitySummary({ security = 'WPA', hidden = false }) {
  const label = (SECURITY[security] ?? SECURITY.WPA).label;
  return hidden ? `${label} · hidden network` : label;
}
