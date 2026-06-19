/**
 * controllers/authController.js
 * ---------------------------------
 * The "C" in MVC for registration, login, and logout. No SQL and no
 * bcrypt calls happen directly here — those live in models/userStore.js
 * and models/userModel.js respectively; this file just orchestrates
 * the request/response and session lifecycle around them.
 */

const userModel = require('../models/userModel');
const userStore = require('../models/userStore');

/**
 * GET /register
 */
function renderRegister(req, res) {
  res.render('register', { errors: [], formData: {} });
}

/**
 * POST /register
 * Runs only after validateRegisterInput has confirmed the input is
 * well-formed. Still has to check for duplicate username/email here,
 * since "is this taken" can only be answered by querying the database.
 */
async function register(req, res) {
  try {
    const username = req.body.username.trim();
    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    const [existingUsername, existingEmail] = await Promise.all([
      userStore.getUserByUsername(username),
      userStore.getUserByEmail(email),
    ]);

    if (existingUsername || existingEmail) {
      return res.status(400).render('register', {
        errors: [{
          msg: existingUsername
            ? 'That username is already taken.'
            : 'An account with that email already exists.',
        }],
        formData: { username, email },
      });
    }

    const passwordHash = await userModel.hashPassword(password);
    const user = await userStore.createUser({ username, email, passwordHash });

    await loginUserSession(req, user);
    return res.redirect('/dashboard');
  } catch (err) {
    // Fallback for the rare race where two requests both pass the
    // pre-check above and collide on the UNIQUE constraint at insert
    // time — the pre-check above already covers the common case.
    if (err && err.code === '23505') {
      return res.status(400).render('register', {
        errors: [{ msg: 'That username or email is already taken.' }],
        formData: { username: req.body.username, email: req.body.email },
      });
    }
    console.error('Registration failed:', err);
    return res.status(500).render('register', {
      errors: [{ msg: 'Something went wrong while creating your account. Please try again.' }],
      formData: { username: req.body.username, email: req.body.email },
    });
  }
}

/**
 * GET /login
 */
function renderLogin(req, res) {
  res.render('login', { errors: [], formData: {}, next: req.query.next || '' });
}

/**
 * POST /login
 * Deliberately returns the same generic error whether the account
 * doesn't exist or the password is wrong — telling them apart would
 * let an attacker use the login form to enumerate registered emails.
 */
async function login(req, res) {
  try {
    const identifier = req.body.identifier.trim();
    const { password } = req.body;
    const nextUrl = req.body.next || req.query.next || '';

    const user = await userStore.getUserByEmailOrUsername(identifier);
    const passwordMatches = user
      ? await userModel.verifyPassword(password, user.password_hash)
      : false;

    if (!user || !passwordMatches) {
      return res.status(401).render('login', {
        errors: [{ msg: 'Incorrect username/email or password.' }],
        formData: { identifier },
        next: nextUrl,
      });
    }

    await loginUserSession(req, user);

    // Only ever redirect back to a same-site relative path — never to
    // a value that could send the user off to an attacker-controlled
    // domain (an "open redirect").
    const isSafeRelativePath = nextUrl.startsWith('/') && !nextUrl.startsWith('//');
    return res.redirect(isSafeRelativePath ? nextUrl : '/dashboard');
  } catch (err) {
    console.error('Login failed:', err);
    return res.status(500).render('login', {
      errors: [{ msg: 'Something went wrong while signing you in. Please try again.' }],
      formData: { identifier: req.body.identifier },
      next: req.body.next || req.query.next || '',
    });
  }
}

/**
 * POST /logout
 * Destroys the session server-side (so the session row in Postgres is
 * actually gone, not just the cookie) and clears the cookie itself.
 */
function logout(req, res) {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy failed:', err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
}

/**
 * Regenerates the session ID before storing the logged-in user, so a
 * session ID that existed before authentication (e.g. handed out to
 * an anonymous visitor) can never be reused to "ride along" into an
 * authenticated session — a textbook session-fixation defense.
 *
 * @param {import('express').Request} req
 * @param {{ id: number, username: string, email: string }} user
 * @returns {Promise<void>}
 */
function loginUserSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = { id: user.id, username: user.username, email: user.email };
      req.session.save((saveErr) => {
        if (saveErr) return reject(saveErr);
        resolve();
      });
    });
  });
}

module.exports = { renderRegister, register, renderLogin, login, logout };
