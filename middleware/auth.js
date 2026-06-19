/**
 * middleware/auth.js
 * --------------------
 * Route protection. The whole app (other than /login, /register, and
 * the public /q/:code scan route) requires a logged-in user, so every
 * generated QR code always has a real owner — see requireAuth below.
 */

/**
 * Blocks the request unless req.session.user is set, redirecting to
 * the login page instead. The original destination is preserved as
 * ?next=... so login() can send the user back where they were headed
 * instead of always dropping them on the dashboard.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?next=${next_}`);
}

/**
 * Keeps already-logged-in users off /login and /register — landing on
 * a login form while already authenticated is just confusing.
 */
function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  return next();
}

/**
 * Makes the logged-in user available to every EJS view as
 * `currentUser` (null if logged out), without each controller having
 * to pass it explicitly. Mounted once, globally, in server.js.
 */
function attachCurrentUser(req, res, next) {
  res.locals.currentUser = (req.session && req.session.user) || null;
  next();
}

module.exports = { requireAuth, redirectIfAuthenticated, attachCurrentUser };
