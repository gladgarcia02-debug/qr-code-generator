/**
 * routes/qrRoutes.js
 * --------------------
 * Maps URLs + HTTP verbs to controller functions. Keeping routing
 * separate from controller logic means server.js stays tiny and this
 * file gives a one-glance map of every endpoint the app exposes.
 */

const express = require('express');
const router = express.Router();

const qrController = require('../controllers/qrController');
const { validateQRInput } = require('../middleware/validateInput');
const { requireAuth } = require('../middleware/auth');

// Every route below except the public scan route requires login —
// generating, downloading, and managing codes are all tied to an
// account, so an anonymous visitor is redirected to /login first.

// Show the form (GET, no data yet)
router.get('/', requireAuth, qrController.renderHome);

// Handle form submission: validate first, then generate the QR code
router.post('/generate', requireAuth, validateQRInput, qrController.generateQR);

// Stream a real PNG file back for the user to save
router.get('/download', requireAuth, qrController.downloadQR);

// Lists the logged-in user's own QR codes with their live status
// (Active/Expired/Revoked)
router.get('/dashboard', requireAuth, qrController.showDashboard);

// Manually disable one of the user's own codes from the dashboard
router.post('/qr/:code/revoke', requireAuth, qrController.revokeQR);

// Permanently delete one of the user's own codes from the dashboard
router.post('/qr/:code/delete', requireAuth, qrController.deleteQR);

// What a phone actually hits when it scans any generated QR code —
// this is where expiration is enforced. Deliberately NOT behind
// requireAuth: whoever scans a code is very likely not the person who
// created it. Defined after the more specific routes above so it
// doesn't shadow them.
router.get('/q/:code', qrController.resolveQR);

module.exports = router;
