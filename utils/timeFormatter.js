/**
 * utils/timeFormatter.js
 * -------------------------
 * Pure formatting helpers — no database or Express dependency — used
 * by the dashboard view to turn raw timestamps into human-friendly
 * text like "3 days remaining" or "Expired 2 hours ago".
 */

/**
 * Converts a millisecond duration into the single largest whole unit
 * that fits (e.g. 90000ms -> "1 minute", not "0 hours" or "90 seconds").
 * @param {number} ms - a positive duration in milliseconds
 * @returns {string}
 */
function formatDuration(ms) {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  const pluralize = (value, unit) => `${value} ${unit}${value === 1 ? '' : 's'}`;

  if (ms < MINUTE) return 'less than a minute';
  if (ms < HOUR) return pluralize(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return pluralize(Math.floor(ms / HOUR), 'hour');
  if (ms < MONTH) return pluralize(Math.floor(ms / DAY), 'day');
  if (ms < YEAR) return pluralize(Math.floor(ms / MONTH), 'month');
  return pluralize(Math.floor(ms / YEAR), 'year');
}

/**
 * Produces the dashboard's "Time Remaining" column text for a record.
 *
 * @param {Date|string|null} expiresAt - the record's expires_at value
 * @param {'active'|'expired'|'revoked'} status - precomputed status
 *   (pass the result of qrStore.computeStatus(record))
 * @returns {string}
 */
function formatTimeRemaining(expiresAt, status) {
  if (status === 'revoked') return 'Revoked';
  if (!expiresAt) return 'Never expires';

  const target = new Date(expiresAt).getTime();
  const now = Date.now();

  if (status === 'expired' || target <= now) {
    return `Expired ${formatDuration(now - target)} ago`;
  }

  return `${formatDuration(target - now)} remaining`;
}

module.exports = { formatDuration, formatTimeRemaining };
