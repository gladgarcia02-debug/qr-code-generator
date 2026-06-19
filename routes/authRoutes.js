/**
 * routes/authRoutes.js
 * -----------------------
 * URL -> controller mapping for registration, login, and logout.
 */

const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { requireAuth, redirectIfAuthenticated } = require('../middleware/auth');
const { validateRegisterInput, validateLoginInput } = require('../middleware/validateAuth');

router.get('/register', redirectIfAuthenticated, authController.renderRegister);
router.post('/register', redirectIfAuthenticated, validateRegisterInput, authController.register);

router.get('/login', redirectIfAuthenticated, authController.renderLogin);
router.post('/login', redirectIfAuthenticated, validateLoginInput, authController.login);

// Logging out only ever changes server-side state for the user who's
// already authenticated, so it's gated by requireAuth like any other
// protected action, and only reachable via POST (a plain link/GET
// would let it be triggered by a stray <img>/prefetch).
router.post('/logout', requireAuth, authController.logout);

module.exports = router;
