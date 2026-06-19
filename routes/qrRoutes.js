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

// Show the form (GET, no data yet)
router.get('/', qrController.renderHome);

// Handle form submission: validate first, then generate the QR code
router.post('/generate', validateQRInput, qrController.generateQR);

// Stream a real PNG file back for the user to save
router.get('/download', qrController.downloadQR);

// Lists every QR code with its live status (Active/Expired/Revoked)
router.get('/dashboard', qrController.showDashboard);

// Manually disable a code from the dashboard
router.post('/qr/:code/revoke', qrController.revokeQR);

// What a phone actually hits when it scans any generated QR code —
// this is where expiration is enforced. Defined after the more
// specific routes above so it doesn't shadow them.
router.get('/q/:code', qrController.resolveQR);

module.exports = router;
