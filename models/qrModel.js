/**
 * models/qrModel.js
 * ------------------
 * The "M" in MVC. This module contains no Express-specific code at all —
 * it only knows how to (1) turn a user's raw input + chosen type into a
 * properly formatted string for encoding, and (2) hand that string to the
 * `qrcode` library to produce an actual QR code image.
 *
 * Keeping this logic separate from the controller means it can be unit
 * tested in isolation and reused anywhere (CLI script, API, tests, etc.).
 */

const QRCode = require('qrcode');

/**
 * Shared rendering options for every QR code we generate.
 * - errorCorrectionLevel 'H' (High) gives the QR the most redundancy,
 *   so it still scans even if part of the printed code is smudged/damaged.
 * - margin adds a quiet white border, which scanners need to lock on.
 * - color keeps it pure black-on-white, the most universally scannable
 *   combination for any phone camera or hardware scanner.
 */
const BASE_OPTIONS = {
  errorCorrectionLevel: 'H',
  margin: 2,
  color: {
    dark: '#000000',
    light: '#FFFFFF',
  },
};

/**
 * Allowed QR "content types". Anything outside this list is rejected
 * by the validation middleware before it ever reaches this model.
 */
const SUPPORTED_TYPES = ['text', 'url', 'email', 'phone'];

/**
 * Allowed expiration units. 'never' means the code is permanent —
 * `expires_at` is stored as NULL in the database, and the scan route
 * never treats it as expired.
 */
const SUPPORTED_EXPIRY_UNITS = ['never', 'minutes', 'hours', 'days', 'months', 'years'];

/**
 * Converts a user-chosen amount + unit (e.g. "30" + "days") into an
 * absolute JS Date marking when the code should stop working.
 *
 * Calendar-aware: "months" and "years" use Date's own setMonth/
 * setFullYear arithmetic rather than a fixed "30 days = 1 month"
 * approximation, so a 1-year expiry lands on the same calendar date
 * next year (correctly handling leap years, months of different
 * lengths, etc.) instead of drifting.
 *
 * @param {string|number} expiryValue - how many units (e.g. 30)
 * @param {string} expiryUnit - one of SUPPORTED_EXPIRY_UNITS
 * @returns {Date|null} the expiry Date, or null for "never expires"
 */
function calculateExpiryDate(expiryValue, expiryUnit) {
  if (!expiryUnit || expiryUnit === 'never') return null;

  const amount = parseInt(expiryValue, 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const date = new Date();

  switch (expiryUnit) {
    case 'minutes':
      date.setMinutes(date.getMinutes() + amount);
      break;
    case 'hours':
      date.setHours(date.getHours() + amount);
      break;
    case 'days':
      date.setDate(date.getDate() + amount);
      break;
    case 'months':
      date.setMonth(date.getMonth() + amount);
      break;
    case 'years':
      date.setFullYear(date.getFullYear() + amount);
      break;
    default:
      return null;
  }

  return date;
}

/**
 * Takes the raw text typed by the user plus the type they selected and
 * returns the *actual* string that gets encoded into the QR code.
 *
 * Why this matters: a QR code itself doesn't know about "emails" or
 * "phone numbers" — it just encodes a string. But phones recognize
 * standard URI prefixes (mailto:, tel:) and offer to open the right
 * app (Mail, Phone dialer) automatically when they scan it. So we
 * build those prefixes here.
 *
 * @param {string} type - one of SUPPORTED_TYPES
 * @param {string} text - raw user input
 * @returns {string} the formatted string ready to be encoded
 */
function formatQRData(type, text) {
  const trimmed = (text || '').trim();

  switch (type) {
    case 'url':
      // If the user typed "example.com" without a protocol, add one.
      // Without this, some scanners treat the value as plain text
      // instead of a clickable link.
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    case 'email':
      // mailto: tells the scanning app to open the default mail client
      // with the "To" field pre-filled.
      return trimmed.toLowerCase().startsWith('mailto:') ? trimmed : `mailto:${trimmed}`;

    case 'phone':
      // tel: tells the scanning app to open the dialer pre-filled.
      return trimmed.toLowerCase().startsWith('tel:') ? trimmed : `tel:${trimmed}`;

    case 'text':
    default:
      // Plain text / anything else is encoded verbatim.
      return trimmed;
  }
}

/**
 * Generates a QR code as a base64 Data URL (e.g. "data:image/png;base64,...").
 * This is perfect for immediately rendering the QR code in an <img> tag
 * on the page right after the form is submitted — no file is written to
 * disk and no extra HTTP round trip is needed.
 *
 * @param {string} data - the already-formatted string to encode
 * @param {{ width?: number }} options
 * @returns {Promise<string>} a base64 PNG data URL
 */
async function generateQRCodeDataURL(data, options = {}) {
  return QRCode.toDataURL(data, {
    ...BASE_OPTIONS,
    type: 'image/png',
    width: options.width || 300,
  });
}

/**
 * Generates a QR code as a raw PNG Buffer. Used by the download route,
 * since sending a real binary buffer (rather than a data URL string)
 * lets the browser save it as a genuine standalone .png file.
 *
 * @param {string} data - the already-formatted string to encode
 * @param {{ width?: number }} options
 * @returns {Promise<Buffer>} PNG image bytes
 */
async function generateQRCodeBuffer(data, options = {}) {
  return QRCode.toBuffer(data, {
    ...BASE_OPTIONS,
    type: 'png',
    width: options.width || 300,
  });
}

module.exports = {
  SUPPORTED_TYPES,
  SUPPORTED_EXPIRY_UNITS,
  calculateExpiryDate,
  formatQRData,
  generateQRCodeDataURL,
  generateQRCodeBuffer,
};
