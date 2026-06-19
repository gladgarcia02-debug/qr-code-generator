/**
 * config/session.js
 * --------------------
 * Builds the express-session middleware used by server.js. Sessions
 * are persisted in PostgreSQL (via connect-pg-simple) rather than kept
 * in memory, so logins survive a server restart and work correctly
 * across multiple app instances behind a load balancer — the default
 * MemoryStore does neither and leaks memory under load.
 */

const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db');

if (!process.env.SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET is not set. Add a long, random value to your .env file ' +
    '(e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`).'
  );
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

module.exports = session({
  store: new pgSession({
    pool,
    tableName: 'session',
    // Convenient for local dev so the table just appears on first run.
    // Production deployments should create the table ahead of time
    // (see db/schema.sql) and can set this to false.
    createTableIfMissing: true,
  }),

  secret: process.env.SESSION_SECRET,

  // We only write a session row once something meaningful is stored in
  // it (login). Without this, every visitor — including anonymous ones
  // hitting the login page — would get a session row, bloating the
  // table with sessions nobody ever uses.
  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true, // inaccessible to client-side JS — blocks session-cookie theft via XSS
    secure: process.env.NODE_ENV === 'production', // cookie only sent over HTTPS in production
    sameSite: 'lax', // blocks the cookie being sent on cross-site form posts (CSRF)
    maxAge: ONE_DAY_MS * 7, // 7 days
  },
});
