/**
 * models/qrStore.js
 * --------------------
 * Database access for QR code records. Every other file (controllers,
 * dashboard) talks to the database only through the functions in this
 * module — nobody else writes raw SQL. That keeps query logic in one
 * place and means swapping databases later only touches this file.
 *
 * All queries use parameterized placeholders ($1, $2, ...) rather
 * than string-concatenating user input into SQL, which is what
 * prevents SQL injection — `pg` sends the values separately from the
 * query text, so they're never interpreted as SQL syntax.
 */

const crypto = require('crypto');
const pool = require('../config/db');

/**
 * Creates a new QR code record.
 *
 * @param {{ type: string, targetUrl: string, expiresAt: Date|null }} fields
 * @returns {Promise<object>} the inserted row
 */
async function createRecord({ type, targetUrl, expiresAt }) {
  const insertQuery = `
    INSERT INTO qr_codes (qr_code, type, target_url, expires_at)
    VALUES ($1, $2, $3, $4)
    RETURNING id, qr_code, type, target_url, created_at, expires_at, status;
  `;

  // Retry a few times on the (extremely unlikely) chance two requests
  // generate the same random ID at once and collide on the UNIQUE
  // constraint, rather than failing the user's request outright.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const qrCode = crypto.randomBytes(4).toString('hex');
    try {
      const result = await pool.query(insertQuery, [qrCode, type, targetUrl, expiresAt]);
      return result.rows[0];
    } catch (err) {
      const isUniqueViolation = err && err.code === '23505';
      if (!isUniqueViolation) throw err;
      // otherwise loop and try a fresh random ID
    }
  }

  throw new Error('Could not generate a unique QR code ID after several attempts.');
}

/**
 * Looks up a single record by its short public ID (the part of the
 * URL after /q/). Returns null rather than throwing if not found —
 * "not found" is an expected, normal outcome here, not an error.
 */
async function getRecordByCode(qrCode) {
  const result = await pool.query('SELECT * FROM qr_codes WHERE qr_code = $1', [qrCode]);
  return result.rows[0] || null;
}

/**
 * Fetches every record for the dashboard, newest first.
 */
async function getAllRecords() {
  const result = await pool.query('SELECT * FROM qr_codes ORDER BY created_at DESC');
  return result.rows;
}

/**
 * @param {object} record - a row from qr_codes
 * @returns {boolean} true if expires_at is set and in the past
 */
function isExpired(record) {
  if (!record || !record.expires_at) return false;
  return new Date(record.expires_at).getTime() < Date.now();
}

/**
 * Computes the record's effective status. This is deliberately NOT
 * stored as a column value for "expired" — it's derived live from
 * `expires_at` vs. the current time on every read. That guarantees a
 * code can never be stuck showing a stale status because a background
 * job didn't run; the moment the clock passes expires_at, every read
 * sees it as expired automatically.
 *
 * @returns {'active'|'expired'|'revoked'}
 */
function computeStatus(record) {
  if (record.status === 'revoked') return 'revoked';
  if (isExpired(record)) return 'expired';
  return 'active';
}

/**
 * Manually disables a code regardless of its expiry date — e.g. the
 * owner wants to kill a link immediately after sharing it by mistake.
 */
async function revokeRecord(qrCode) {
  const result = await pool.query(
    "UPDATE qr_codes SET status = 'revoked' WHERE qr_code = $1 RETURNING id",
    [qrCode]
  );
  return result.rowCount > 0;
}

/**
 * Permanently deletes records that expired more than `olderThanDays`
 * days ago. Not called automatically — wire it to a scheduled job
 * (e.g. node-cron, or your platform's cron feature) if you want the
 * table to stay tidy over time. Nothing breaks if this never runs:
 * computeStatus() already rejects expired codes at lookup time
 * regardless of whether old rows have been purged.
 *
 * @param {number} olderThanDays
 * @returns {Promise<number>} how many rows were deleted
 */
async function purgeExpired(olderThanDays = 30) {
  const result = await pool.query(
    `DELETE FROM qr_codes
     WHERE expires_at IS NOT NULL
       AND expires_at < NOW() - ($1 || ' days')::interval`,
    [olderThanDays]
  );
  return result.rowCount;
}

module.exports = {
  createRecord,
  getRecordByCode,
  getAllRecords,
  isExpired,
  computeStatus,
  revokeRecord,
  purgeExpired,
};
