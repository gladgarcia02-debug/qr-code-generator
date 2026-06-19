/**
 * controllers/qrController.js
 * -----------------------------
 * The "C" in MVC. Reads requests, asks the Model layer (qrModel +
 * qrStore) to do the actual work, and decides what the View should
 * render. No SQL and no QR-encoding logic lives here directly.
 */

const {
  formatQRData,
  generateQRCodeDataURL,
  generateQRCodeBuffer,
  calculateExpiryDate,
} = require('../models/qrModel');

const qrStore = require('../models/qrStore');
const { formatTimeRemaining } = require('../utils/timeFormatter');

/**
 * GET /
 * Renders the empty form on first visit.
 */
function renderHome(req, res) {
  res.render('index', {
    errors: [],
    qrImage: null,
    encodedData: null,
    targetUrl: null,
    expiresAt: null,
    formData: {},
  });
}

/**
 * POST /generate
 * Runs only after `validateQRInput` middleware has confirmed the
 * input is well-formed.
 *
 * Every code — including "Never Expires" ones — gets a row in the
 * database and a QR image that encodes a link to THIS server
 * (/q/:code), not the raw content directly. That's what makes the
 * expiration check in resolveQR() below possible: the server has to
 * be in the loop on every scan to enforce it.
 */
async function generateQR(req, res) {
  try {
    const { qrType, qrText, qrSize, expiryUnit, expiryValue } = req.body;

    // Turn "5551234567" + type "phone" into "tel:5551234567", etc.
    const targetUrl = formatQRData(qrType, qrText);
    const width = qrSize ? parseInt(qrSize, 10) : 300;
    const expiresAt = calculateExpiryDate(expiryValue, expiryUnit);

    // Persist the record first so we have its qr_code ID to build the
    // scan URL that actually gets encoded into the image. requireAuth
    // guarantees req.session.user exists by the time this runs, so
    // every code always has a real owner.
    const record = await qrStore.createRecord({
      type: qrType,
      targetUrl,
      expiresAt,
      userId: req.session.user.id,
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const scanUrl = `${baseUrl}/q/${record.qr_code}`;

    const qrImage = await generateQRCodeDataURL(scanUrl, { width });

    res.render('index', {
      errors: [],
      qrImage,
      encodedData: scanUrl,
      targetUrl,
      expiresAt: record.expires_at,
      formData: req.body,
    });
  } catch (err) {
    console.error('QR generation failed:', err);
    res.status(500).render('index', {
      errors: [{ msg: 'Something went wrong while generating your QR code. Please try again.' }],
      qrImage: null,
      encodedData: null,
      targetUrl: null,
      expiresAt: null,
      formData: req.body,
    });
  }
}

/**
 * GET /download?data=...&size=...
 * Regenerates the same QR image as a raw PNG buffer so the browser
 * saves a genuine .png file. `data` here is whatever was actually
 * encoded in the image (the /q/:code scan URL), not the underlying
 * target content — downloading always reproduces the exact same
 * scannable image the user was just shown.
 */
async function downloadQR(req, res) {
  try {
    const { data, size } = req.query;

    if (!data || !data.trim()) {
      return res.status(400).send('Missing "data" query parameter for QR code download.');
    }

    const width = size ? parseInt(size, 10) : 300;
    const buffer = await generateQRCodeBuffer(data, { width });

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="qrcode.png"',
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    console.error('QR download failed:', err);
    res.status(500).send('Failed to generate the QR code file for download.');
  }
}

/**
 * GET /q/:code
 * This is the URL encoded INSIDE every generated QR image. Every scan
 * hits this route, which is exactly where expiration gets enforced —
 * the check happens at the moment of access, not at creation time, so
 * a code that was valid yesterday is correctly rejected today without
 * any extra moving parts.
 *
 * Security notes (see also the README's "best practices" section):
 *  - We send Cache-Control: no-store on every response from this route.
 *    Without it, a browser or CDN could cache a 302 redirect from
 *    before expiry and keep "honoring" it after the code should have
 *    stopped working.
 *  - We return 410 Gone (not 404) for expired/revoked codes, and a
 *    distinct 404 only for IDs that never existed — these are
 *    genuinely different situations and standard HTTP codes communicate
 *    that correctly to clients/monitoring tools.
 *  - target_url is never interpolated into a raw HTML string for the
 *    redirect — res.redirect() and EJS's default `<%= %>` escaping
 *    handle that safely (see views/scan.ejs).
 */
async function resolveQR(req, res) {
  try {
    const { code } = req.params;
    const record = await qrStore.getRecordByCode(code);

    res.set('Cache-Control', 'no-store');

    if (!record) {
      return res.status(404).render('expired', {
        title: 'QR Code Not Found',
        heading: 'This QR code doesn\u2019t exist',
        message: 'We couldn\u2019t find a code matching this link. It may have been mistyped or never existed.',
      });
    }

    const status = qrStore.computeStatus(record);

    if (status === 'expired') {
      return res.status(410).render('expired', {
        title: 'QR Code Expired',
        heading: 'This QR code has expired',
        message: `This code stopped working on ${new Date(record.expires_at).toLocaleString()}. Ask whoever shared it to generate a new one.`,
      });
    }

    if (status === 'revoked') {
      return res.status(410).render('expired', {
        title: 'QR Code Revoked',
        heading: 'This QR code is no longer active',
        message: 'The owner of this code disabled it.',
      });
    }

    // Plain text has no app to hand off to — just display it.
    if (record.type === 'text') {
      return res.render('scan', { content: record.target_url });
    }

    // url / email / phone all become a real redirect: the browser/OS
    // takes it from there (opens the link, mail app, or dialer).
    return res.redirect(record.target_url);
  } catch (err) {
    console.error('QR resolution failed:', err);
    return res.status(500).render('error', {
      title: 'Server Error',
      message: 'Something went wrong while looking up this QR code.',
      statusCode: 500,
    });
  }
}

/**
 * GET /dashboard
 * Lists only the logged-in user's own QR codes, each with its
 * live-computed status and a human-readable time-remaining string.
 */
async function showDashboard(req, res) {
  try {
    const records = await qrStore.getRecordsByUser(req.session.user.id);

    const rows = records.map((record) => {
      const status = qrStore.computeStatus(record);
      return {
        ...record,
        status,
        timeRemaining: formatTimeRemaining(record.expires_at, status),
      };
    });

    res.render('dashboard', { rows, error: null });
  } catch (err) {
    console.error('Dashboard load failed:', err);
    res.status(500).render('dashboard', {
      rows: [],
      error: 'Could not load QR codes right now. Please try again shortly.',
    });
  }
}

/**
 * POST /qr/:code/revoke
 * Lets a user manually disable one of their own codes from the
 * dashboard, regardless of its expiry date. revokeRecord() scopes the
 * update to req.session.user.id, so this silently no-ops (rather than
 * erroring) for a code that doesn't exist or belongs to someone else
 * — the dashboard never offers that button for a code that isn't
 * already in the user's own list, so reaching this branch means
 * someone hand-crafted the request.
 */
async function revokeQR(req, res) {
  try {
    await qrStore.revokeRecord(req.params.code, req.session.user.id);
  } catch (err) {
    console.error('Revoke failed:', err);
  }
  res.redirect('/dashboard');
}

/**
 * POST /qr/:code/delete
 * Permanently removes one of the user's own codes. Same ownership
 * scoping as revokeQR — deleteRecord() only ever touches a row that
 * both matches the code and belongs to req.session.user.id.
 */
async function deleteQR(req, res) {
  try {
    await qrStore.deleteRecord(req.params.code, req.session.user.id);
  } catch (err) {
    console.error('Delete failed:', err);
  }
  res.redirect('/dashboard');
}

module.exports = {
  renderHome,
  generateQR,
  downloadQR,
  resolveQR,
  showDashboard,
  revokeQR,
  deleteQR,
};
