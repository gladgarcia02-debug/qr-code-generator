# QR Code Generator (with Expiration & Authentication)

A full-stack QR code generator built with **Node.js**, **Express.js**, **PostgreSQL**, and **EJS**, following the **MVC** (Model–View–Controller) pattern. Generate QR codes from text, URLs, emails, or phone numbers — either permanent or set to expire after a chosen amount of minutes, hours, days, months, or years — preview them instantly, download them as PNG, and track every code's status from a personal, login-protected dashboard.

---

## Features

- **User accounts**: register, log in, log out, with passwords hashed via **bcrypt** and sessions persisted in PostgreSQL
- Every route except the public scan link (`/q/:code`) requires login — visiting any other page while logged out redirects to `/login` and returns you to where you were headed after signing in
- Generate QR codes for **plain text, URLs, email addresses, and phone numbers**
- **Optional expiration**, in minutes / hours / days / months / years, or **"Never Expires"** for a permanent code
- Expiration is enforced **live, at scan time** — checked against the database every time the code is scanned, not just at creation
- A **dashboard** scoped to the logged-in user, listing only *their own* QR codes with live status (Active / Expired / Revoked) and a human-readable "time remaining" / "expired X ago" string
- Manual **revoke** and **delete** actions, both scoped so a user can only ever affect their own codes
- Custom **"QR Code Expired"** page shown on scan once a code is past its expiry date
- One-click **download as a real PNG file**
- Server-side input validation with specific, friendly error messages
- Clean MVC separation: routes → controllers → models → views

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express.js |
| Database | PostgreSQL (via [`pg`](https://www.npmjs.com/package/pg)) |
| Templating | EJS |
| QR generation | [`qrcode`](https://www.npmjs.com/package/qrcode) |
| Validation | [`express-validator`](https://www.npmjs.com/package/express-validator) |
| Password hashing | [`bcrypt`](https://www.npmjs.com/package/bcrypt) |
| Sessions | [`express-session`](https://www.npmjs.com/package/express-session) + [`connect-pg-simple`](https://www.npmjs.com/package/connect-pg-simple) (sessions stored in Postgres, not memory) |
| Styling | Hand-written CSS (no framework) |

---

## Project Structure

```
qr-code-generator/
├── server.js                  # Entry point — config, session, DB check, start
├── package.json
├── .env.example                # Template for your local .env
├── db/
│   └── schema.sql              # CREATE TABLE for users, qr_codes, session
├── config/
│   ├── db.js                   # PostgreSQL connection pool
│   └── session.js              # express-session + connect-pg-simple setup
├── routes/
│   ├── authRoutes.js           # /register, /login, /logout
│   └── qrRoutes.js             # URL → controller mapping (all behind requireAuth)
├── controllers/
│   ├── authController.js       # Registration, login, logout, session lifecycle
│   └── qrController.js         # Request handling, expiration checks, ownership
├── models/
│   ├── qrModel.js               # QR rendering + expiry-date math
│   ├── qrStore.js               # All SQL queries (CRUD on qr_codes, owner-scoped)
│   ├── userModel.js             # bcrypt hashing/verification (no SQL)
│   └── userStore.js             # All SQL queries on users
├── middleware/
│   ├── auth.js                 # requireAuth, redirectIfAuthenticated, attachCurrentUser
│   ├── validateAuth.js         # express-validator rules for register/login
│   └── validateInput.js        # express-validator rules for QR generation
├── utils/
│   └── timeFormatter.js        # "3 days remaining" / "Expired 2h ago"
├── views/
│   ├── index.ejs               # Generator form + result panel
│   ├── dashboard.ejs           # Logged-in user's own codes, status, time remaining
│   ├── login.ejs               # Login form
│   ├── register.ejs            # Registration form
│   ├── expired.ejs             # Shown when a scanned code is dead
│   ├── scan.ejs                # Displays plain-text codes on scan
│   ├── error.ejs               # 404 / 500 page
│   └── partials/
│       ├── header.ejs          # Nav bar; shows username + logout, or login/sign up links
│       └── footer.ejs
└── public/
    ├── css/style.css
    └── js/script.js
```

**MVC mapping:**
- **Model** → `models/qrModel.js` + `models/qrStore.js` (QR codes), `models/userModel.js` + `models/userStore.js` (accounts)
- **View** → everything in `views/` and `public/`
- **Controller** → `controllers/qrController.js` and `controllers/authController.js`, wired up by `routes/qrRoutes.js` and `routes/authRoutes.js`

---

## 1. Database Schema

`db/schema.sql` (abridged — see the actual file for full comments and the `session` table):

```sql
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(30) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(60) NOT NULL,           -- bcrypt hash, never the raw password
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  qr_code      VARCHAR(32) UNIQUE NOT NULL,      -- short ID in the scan URL
  type         VARCHAR(20) NOT NULL CHECK (type IN ('text', 'url', 'email', 'phone')),
  target_url   TEXT NOT NULL,                    -- real destination/content
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,                      -- NULL = never expires
  status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_qr_code ON qr_codes (qr_code);
CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON qr_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_codes_created_at ON qr_codes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_codes_user_id_created_at ON qr_codes (user_id, created_at DESC);

-- Session storage for express-session (connect-pg-simple). See section 5.
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
```

A few intentional design choices worth calling out:
- **`qr_codes.user_id` is `NOT NULL`.** Every QR code requires a logged-in owner (see `requireAuth` on `/generate` in section 6) — there's no such thing as an ownerless code, so the ownership check in section 4 can never be ambiguous.
- **`ON DELETE CASCADE`** on `user_id`: deleting a user's account also deletes every code they own, rather than leaving orphan rows pointing at a user that no longer exists.
- **`password_hash VARCHAR(60)`** — bcrypt hashes are always exactly 60 characters, so the column is sized exactly to that, not left as unconstrained `TEXT`.
- **`status` only stores `'active'` or `'revoked'`** — never `'expired'`. Whether a code is expired is *computed on every read* by comparing `expires_at` to the current time (see `qrStore.computeStatus()`), rather than written to a column. This means a code can never be "stuck" showing the wrong status because a cleanup job didn't run — the moment the clock passes `expires_at`, every single read sees it as expired, instantly and automatically.
- **`expires_at` is `TIMESTAMPTZ`** (timestamp with time zone), not a plain `TIMESTAMP`. This avoids an entire category of bugs where the server and database disagree about what time zone a stored value is in.

`db/schema.sql` is idempotent (every statement is `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), so it's safe to run again against a database that already has these tables. Run it against your database:
```bash
psql "$DATABASE_URL" -f db/schema.sql
```

---

## 2. User Model

Two files split the same way as the QR-code model — one with no SQL at all, one with all the SQL.

### `models/userModel.js` — password hashing, no SQL
```js
const bcrypt = require('bcrypt');
const SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS ? parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) : 12;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}
```
12 rounds is bcrypt's commonly recommended minimum cost in 2024+: slow enough to make brute-forcing a stolen hash impractical, fast enough not to noticeably delay a real login. Raise `BCRYPT_SALT_ROUNDS` over time as hardware gets faster.

### `models/userStore.js` — all SQL on `users`
```js
async function createUser({ username, email, passwordHash }) {
  // INSERTs a new user row; passwordHash is already a bcrypt hash —
  // this function never sees or stores a raw password.
}

async function getUserByEmailOrUsername(identifier) {
  // Backs login: looks a user up by whatever they typed into the
  // single "username or email" field. Returns null if neither matches.
}

async function getUserById(id) { /* ... */ }
async function getUserByEmail(email) { /* ... */ }
async function getUserByUsername(username) { /* ... */ }
```
Same parameterized-query convention as `qrStore.js` — every value is passed as `$1`, `$2`, etc., never string-concatenated into the query text.

---

## 3. QR Model Updates

### `models/qrModel.js` — expiry-date calculation
```js
const SUPPORTED_EXPIRY_UNITS = ['never', 'minutes', 'hours', 'days', 'months', 'years'];

function calculateExpiryDate(expiryValue, expiryUnit) {
  if (!expiryUnit || expiryUnit === 'never') return null;

  const amount = parseInt(expiryValue, 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const date = new Date();
  switch (expiryUnit) {
    case 'minutes': date.setMinutes(date.getMinutes() + amount); break;
    case 'hours':   date.setHours(date.getHours() + amount); break;
    case 'days':    date.setDate(date.getDate() + amount); break;
    case 'months':  date.setMonth(date.getMonth() + amount); break;
    case 'years':   date.setFullYear(date.getFullYear() + amount); break;
    default: return null;
  }
  return date;
}
```
This uses JS `Date`'s own calendar arithmetic (`setMonth`, `setFullYear`) rather than a fixed "1 month = 30 days" approximation — a 1-year expiry correctly lands on the same calendar date next year, accounting for leap years and variable month lengths.

### `models/qrStore.js` — all database access
Every SQL query in the app lives in this one file, so nothing else needs to know SQL at all. Key functions:

```js
async function createRecord({ type, targetUrl, expiresAt, userId }) {
  // INSERTs a new row owned by userId, retrying with a fresh random ID
  // on the rare chance of a collision, and returns the inserted row.
}

async function getRecordByCode(qrCode) {
  // SELECTs a single row by its public ID, regardless of owner — this
  // backs the public scan route, which has no concept of "logged in".
  // Returns null if missing.
}

async function getRecordsByUser(userId) {
  // SELECTs every row owned by userId, newest first, for the
  // dashboard. Scoping happens in the SQL itself (WHERE user_id = $1),
  // not by filtering in JS after fetching everything.
}

function isExpired(record) {
  // true if expires_at is set and in the past.
}

function computeStatus(record) {
  // 'revoked' | 'expired' | 'active' — computed live, never stored.
}

async function revokeRecord(qrCode, userId) {
  // UPDATEs status to 'revoked', scoped to WHERE qr_code = $1 AND
  // user_id = $2 — the ownership check is part of the query itself.
}

async function deleteRecord(qrCode, userId) {
  // DELETEs the row, same ownership scoping as revokeRecord().
}

async function purgeExpired(olderThanDays = 30) {
  // Optional cleanup: DELETEs rows that expired long ago.
}
```

Every query uses parameterized placeholders (`$1`, `$2`, ...) — see the security section below for why that matters.

---

## 4. Authentication Controller, Middleware & Session

### `middleware/auth.js` — route protection
```js
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  next();
}

function attachCurrentUser(req, res, next) {
  res.locals.currentUser = (req.session && req.session.user) || null;
  next();
}
```
- `requireAuth` is mounted on every route that needs a logged-in user (see section 7). It preserves the page the visitor was trying to reach as `?next=`, so logging in sends them back there instead of always dropping them on the dashboard.
- `attachCurrentUser` is mounted once, globally, in `server.js` — it's what makes `currentUser` available in *every* EJS view (e.g. `views/partials/header.ejs`) without each controller having to pass it explicitly.

### `controllers/authController.js` — registration, login, logout
```js
async function register(req, res) {
  // 1. Check the username/email aren't already taken.
  // 2. hashPassword() the raw password — never stored in plaintext.
  // 3. createUser() in Postgres.
  // 4. Regenerate the session and store { id, username, email } in it.
  // 5. Redirect to /dashboard.
}

async function login(req, res) {
  // 1. Look the user up by username-or-email.
  // 2. verifyPassword() against the stored hash.
  // 3. On success: regenerate the session, store the user, redirect
  //    to ?next= if it's a safe same-site path, else /dashboard.
  // 4. On failure: the SAME generic "incorrect username/email or
  //    password" message whether the account doesn't exist or the
  //    password is wrong — telling them apart would let the login
  //    form be used to enumerate which emails have accounts.
}

function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
}
```
Both `register` and `login` funnel through the same helper to actually establish the session:
```js
function loginUserSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = { id: user.id, username: user.username, email: user.email };
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}
```
`req.session.regenerate()` issues a brand-new session ID before storing the logged-in user — a textbook **session-fixation** defense, so a session ID handed to an anonymous visitor can never be "upgraded" into an authenticated one by tricking them into logging in on a session ID an attacker already knows.

### `config/session.js` — session configuration
```js
module.exports = session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                                      // not readable by client-side JS
    secure: process.env.NODE_ENV === 'production',        // HTTPS-only in production
    sameSite: 'lax',                                      // blocks cross-site POST replay (CSRF)
    maxAge: 7 * 24 * 60 * 60 * 1000,                      // 7 days
  },
});
```
Sessions are stored in PostgreSQL (`connect-pg-simple`), not the default in-memory store — `MemoryStore` leaks memory under load and forgets every session on restart or in a multi-instance deployment, neither of which is acceptable for real logins. `server.js` throws at startup if `SESSION_SECRET` isn't set, so a missing secret fails loudly instead of silently signing cookies with `undefined`.

---

## 5. Login & Registration Pages

`views/login.ejs` and `views/register.ejs` follow the same EJS structure as `views/index.ejs` — the same `.panel` / `.field` / `.btn` classes, server-rendered validation errors at the top of the form, and the user's previously-typed values (except passwords) preserved on a failed submission. `views/login.ejs` carries the `next` redirect target through as a hidden input so it survives the POST.

`middleware/validateAuth.js` re-validates everything server-side with `express-validator`, the same pattern as `middleware/validateInput.js`:
- **Registration**: username (3-30 chars, letters/numbers/underscore only), valid email, password 8-72 characters (bcrypt only uses the first 72 bytes of input — capping here avoids silently truncating anything longer without telling the user), and a `confirmPassword` match check.
- **Login**: just "non-empty" — login intentionally doesn't enforce the registration password shape, since a user's actual password could predate a rule change.

---

## 6. Protected Dashboard Implementation

`GET /dashboard` (`showDashboard` in `qrController.js`) now calls `qrStore.getRecordsByUser(req.session.user.id)` instead of fetching every row — a user can only ever see their own codes, enforced in the SQL query itself rather than by filtering after the fact. The view also prints who's logged in:

```html
<p class="dashboard-meta__user">
  Logged in as <strong><%= currentUser.username %></strong> (<%= currentUser.email %>)
</p>
```

Revoke and delete are scoped the same way — `revokeRecord(qrCode, userId)` and `deleteRecord(qrCode, userId)` both include `AND user_id = $2` directly in their `UPDATE`/`DELETE` query, so a request for a code that exists but belongs to someone else fails exactly the same way (silently, 0 rows affected) as a code that doesn't exist at all. There's no separate "fetch the record, then check `record.user_id === req.session.user.id` in JS" step to ever forget.

---

## 7. Route Definitions

`routes/authRoutes.js`:
```js
router.get('/register', redirectIfAuthenticated, authController.renderRegister);
router.post('/register', redirectIfAuthenticated, validateRegisterInput, authController.register);
router.get('/login', redirectIfAuthenticated, authController.renderLogin);
router.post('/login', redirectIfAuthenticated, validateLoginInput, authController.login);
router.post('/logout', requireAuth, authController.logout);   // POST only — see note below
```

`routes/qrRoutes.js`:
```js
router.get('/', requireAuth, qrController.renderHome);
router.post('/generate', requireAuth, validateQRInput, qrController.generateQR);
router.get('/download', requireAuth, qrController.downloadQR);
router.get('/dashboard', requireAuth, qrController.showDashboard);
router.post('/qr/:code/revoke', requireAuth, qrController.revokeQR);
router.post('/qr/:code/delete', requireAuth, qrController.deleteQR);
router.get('/q/:code', qrController.resolveQR);   // public — NOT behind requireAuth
```
Every route requires login except the actual scan handler — whoever scans a code is very likely not the person who created it, so gating `/q/:code` would break the feature for everyone except the owner. Logout is a `POST`, not a plain link, specifically so it can't be triggered by a stray `<img>` tag, link prefetch, or other unintended GET request.

---

## 8. Controller Logic for Expiration Checking

`controllers/qrController.js` — the part that matters most, `resolveQR`, runs on **every single scan**:

```js
async function resolveQR(req, res) {
  const { code } = req.params;
  const record = await qrStore.getRecordByCode(code);

  res.set('Cache-Control', 'no-store'); // see security notes below

  if (!record) {
    return res.status(404).render('expired', { /* "doesn't exist" copy */ });
  }

  const status = qrStore.computeStatus(record);

  if (status === 'expired') {
    return res.status(410).render('expired', { /* "has expired" copy */ });
  }

  if (status === 'revoked') {
    return res.status(410).render('expired', { /* "was revoked" copy */ });
  }

  // Still valid:
  if (record.type === 'text') {
    return res.render('scan', { content: record.target_url });
  }
  return res.redirect(record.target_url); // url / email / phone
}
```

The check is **always live** — it re-evaluates `expires_at` against `NOW()` on every scan, so there's no caching, background job, or sync step that could leave a code working past its expiry date.

`generateQR` is the other half — it now **always** writes a row to the database (even for "Never Expires" codes, which simply get `expires_at = NULL`), and the QR image always encodes a link to `/q/:code` on your own server rather than the raw content directly. That's what makes the expiration check above possible: the server has to be in the loop on every scan.

---

## 9. EJS Form for Expiration

In `views/index.ejs`, the expiration control is a number input paired with a unit dropdown:

```html
<div class="field">
  <label for="expiryUnit" class="field-label">Expiration</label>
  <div class="expiry-row">
    <input type="number" id="expiryValue" name="expiryValue"
           min="1" max="1000" placeholder="e.g. 30" />
    <select id="expiryUnit" name="expiryUnit">
      <option value="never">Never Expires</option>
      <option value="minutes">Minutes</option>
      <option value="hours">Hours</option>
      <option value="days">Days</option>
      <option value="months">Months</option>
      <option value="years">Years</option>
    </select>
  </div>
</div>
```

`public/js/script.js` disables the number input whenever "Never Expires" is selected, so it's clear the field doesn't apply and nothing stray gets submitted:

```js
function syncExpiryValueState() {
  const isNever = expiryUnit.value === 'never';
  expiryValue.disabled = isNever;
  expiryValue.required = !isNever;
  if (isNever) expiryValue.value = '';
}
expiryUnit.addEventListener('change', syncExpiryValueState);
```

This is a UX nicety only — the server never trusts it. `middleware/validateInput.js` independently re-validates both fields and requires a positive `expiryValue` whenever `expiryUnit` isn't `"never"`.

---

## 10. Dashboard Table & Time Remaining

`views/dashboard.ejs` renders each user's own codes (see section 6) as a table:

| Code | Type | Target | Created | Expires | Status | Time Remaining | |
|---|---|---|---|---|---|---|---|
| `9c87bcb3` | url | `https://example.com` | Jun 19, 2026 | Jun 19, 2027 | 🟢 Active | 1 year remaining | Revoke · Delete |
| `a1b2c3d4` | email | `mailto:a@b.com` | Jun 1, 2026 | Jun 8, 2026 | 🔴 Expired | Expired 3 days ago | Delete |

Status is rendered as a colored badge (green/red/gray for Active/Expired/Revoked), and "Time Remaining" comes from `utils/timeFormatter.js`:

```js
function formatTimeRemaining(expiresAt, status) {
  if (status === 'revoked') return 'Revoked';
  if (!expiresAt) return 'Never expires';

  const diff = new Date(expiresAt).getTime() - Date.now();
  if (status === 'expired') return `Expired ${formatDuration(-diff)} ago`;
  return `${formatDuration(diff)} remaining`;
}
```

Active codes get a **Revoke** button (disables the code without waiting for its expiry date); every code gets a **Delete** button (permanently removes the row). Both post to a `/qr/:code/...` endpoint that's owner-scoped server-side (section 6) — the dashboard itself only ever renders these buttons next to codes it already confirmed belong to the logged-in user.

---

## 11. Best Practices for Handling Expired QR Codes Securely

A few things this implementation already does, and why they matter:

1. **Check expiration at scan time, not generation time.** Baking a "valid until" assumption into the QR image itself would be unenforceable — anyone could keep using an old code forever. The check has to happen server-side, on every access, against the current time.

2. **`Cache-Control: no-store` on every `/q/:code` response.** Without this, a browser, proxy, or CDN could cache a `302` redirect issued *before* expiry and keep serving it from cache *after* expiry — silently defeating the whole feature.

3. **Distinct HTTP status codes for distinct situations.** `404` for an ID that never existed vs. `410 Gone` for one that did exist but is now expired/revoked. This isn't just pedantry — monitoring tools, link checkers, and well-behaved clients treat these differently, and it avoids leaking "this ID format would have worked, just not right now" as a side channel.

4. **Parameterized SQL everywhere, no string concatenation.** Every query in `qrStore.js` uses `$1`, `$2`, etc. placeholders, so user input is always sent to PostgreSQL as data, never as part of the SQL command text. This is what prevents SQL injection — it's automatic as long as every query keeps doing this consistently.

5. **Unpredictable, non-sequential IDs.** `qr_code` values are random hex (`crypto.randomBytes`), not auto-incrementing integers. Sequential IDs would let someone enumerate `/q/1`, `/q/2`, `/q/3`... and discover codes that were never meant to be shared.

6. **Output is escaped, not concatenated into raw HTML.** `views/scan.ejs` renders text content with EJS's default `<%= %>` (auto-escaping), not `<%- %>` (raw, unescaped). If you ever change that, stored text content becomes a stored-XSS vector.

7. **Rate-limit the public-facing routes before deploying.** `/generate` (to stop someone from flooding your database with rows) and `/q/:code` (to slow down ID-guessing attempts) are both good candidates for [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit). Not included here to keep the example focused, but add it before going live.

8. **`/dashboard`, revoke, and delete are now behind `requireAuth` and scoped to the logged-in user** (see sections 4–7) — anyone reaching them without a valid session is redirected to `/login`, and ownership is enforced in the SQL itself, not just in the UI.

9. **Don't log sensitive `target_url` values in plaintext if they contain PII.** If people will encode personal emails/phone numbers, be mindful of where your server logs end up and for how long they're retained.

10. **Periodically purge old expired rows.** Nothing breaks if you never do this (expired codes are rejected at lookup time regardless), but calling `qrStore.purgeExpired()` on a schedule (`node-cron`, or your host's scheduled-jobs feature) keeps the table from growing forever with dead rows.

---

## 12. Security Best Practices for Production Deployment

This implementation already does the following — they're not optional add-ons, they're load-bearing for the auth system to be safe to expose on the internet:

1. **Passwords are never stored or logged in plaintext.** Only `password_hash` (a bcrypt hash) ever reaches the database; `console.error` calls in `authController.js` log error objects, never `req.body`, so a stack trace can't leak a raw password into your logs.

2. **Session IDs are regenerated on login (`req.session.regenerate()`).** Prevents session fixation — an attacker who handed a victim a pre-authentication session ID can't have it "become" authenticated once the victim logs in.

3. **Sessions live in PostgreSQL, not memory.** Survives restarts and works correctly if you ever run more than one app instance behind a load balancer, which Node's default in-memory session store does not.

4. **Cookies are `httpOnly`, `sameSite: 'lax'`, and `secure` in production.** `httpOnly` blocks the session cookie from being read by client-side JS (so a successful XSS still can't steal the session); `sameSite: 'lax'` stops it being sent on cross-site form submissions, the core defense against CSRF; `secure` (gated on `NODE_ENV=production`) ensures it's never sent over plain HTTP.

5. **Generic, identical error messages on failed login.** "Incorrect username/email or password" is returned whether the account doesn't exist or the password is wrong — distinguishing the two would let the login form be used to enumerate registered emails.

6. **Open-redirect protection on the post-login `?next=` parameter.** `login()` only honors `next` if it's a relative path starting with a single `/` (rejecting `//evil.com` and full URLs) — otherwise a crafted login link could redirect a freshly-authenticated user to an attacker's site.

7. **Ownership checks live in the SQL `WHERE` clause, not application logic alone.** `revokeRecord`/`deleteRecord`/`getRecordsByUser` all filter by `user_id` in the query itself (see section 6) — defense in depth against a future code change that forgets a manual check.

Before deploying this publicly, also add:

8. **A real `SESSION_SECRET`, generated per environment, never committed.** Use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and put the result only in your host's environment-variable settings (Render/Railway/Heroku dashboard, Docker secrets, etc.) — never in a file that could end up in version control. Rotating it invalidates every existing session, so treat it like any other credential.

9. **`app.set('trust proxy', 1)` in production if you're behind a reverse proxy** (Render, Railway, Heroku, nginx, etc.) — already wired up in `server.js`, gated on `NODE_ENV=production`. Without it, Express can't see that the original request was HTTPS, and the `secure` cookie flag above would never actually get set.

10. **Rate-limit `/login` and `/register`.** As shipped, nothing stops repeated password-guessing or account-creation spam — add [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit) (e.g. 5-10 attempts per IP per 15 minutes) specifically on these two routes. This matters more here than on the public QR routes, since it's the difference between "annoying" and "an attacker can brute-force a weak password."

11. **CSRF tokens for defense in depth.** `sameSite: 'lax'` already blocks the common case, but a dedicated CSRF middleware (e.g. [`csrf-csrf`](https://www.npmjs.com/package/csrf-csrf) — `csurf` itself is deprecated) on state-changing POSTs (`/login`, `/register`, `/qr/:code/revoke`, `/qr/:code/delete`) is the standard belt-and-suspenders layer for production auth.

12. **`helmet`** for the standard set of security-related HTTP response headers (`X-Content-Type-Options`, a `Content-Security-Policy`, etc.) — one line to add, broad payoff.

13. **A password reset flow and email verification**, if this will have real users who can lose access to their password. Not included here — it requires an email-sending service, which is a separate piece of infrastructure to provision.

14. **Account lockout or CAPTCHA after repeated failed logins**, on top of rate-limiting, if this is internet-facing — slows down both brute-force and credential-stuffing attacks that rate-limiting alone only partially mitigates.

15. **Least-privilege database credentials.** The Postgres role this app connects as only needs `SELECT`/`INSERT`/`UPDATE`/`DELETE` on its own tables — it doesn't need to be a superuser or own the database. Most managed Postgres providers default to a more privileged role than necessary; tighten it before going live.

16. **Run `npm audit` periodically** and keep `bcrypt`, `express-session`, and `connect-pg-simple` reasonably current — they sit directly in the authentication trust boundary.

---

## Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- A running PostgreSQL database (local install, Docker, or a managed host like Render/Railway/Supabase)

### 2. Install dependencies
```bash
npm install
```
Installs `express`, `ejs`, `qrcode`, `express-validator`, `pg`, `dotenv`, `bcrypt`, `express-session`, and `connect-pg-simple`.

### 3. Configure your environment
```bash
cp .env.example .env
```
Edit `.env` and set:
- `DATABASE_URL` (or the individual `DB_*` fields) to point at your PostgreSQL instance.
- `SESSION_SECRET` to a long random value — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  `server.js` refuses to start without this set.

### 4. Create the tables
```bash
psql "$DATABASE_URL" -f db/schema.sql
```
Creates `users`, `qr_codes` (with the `user_id` foreign key), and `session`.

### 5. Run the app
```bash
npm start          # production / simple start
npm run dev         # auto-restarts on file changes (requires nodemon)
```

### 6. Open it
```
http://localhost:3000            # redirects to /login if you're not signed in
http://localhost:3000/register   # create an account
http://localhost:3000/dashboard  # your own codes + status, once logged in
```

If PostgreSQL isn't reachable, `server.js` fails fast at startup with a clear error message instead of booting successfully and only failing on the first request.

---

## Possible Next Steps

- Rate-limit `/login` and `/register` with `express-rate-limit` (see security best practice #10 above) — the single highest-value addition before going live.
- Add CSRF tokens (e.g. `csrf-csrf`) and `helmet` for defense-in-depth security headers (best practices #11-12).
- Add a password reset flow and email verification (best practice #13) — needs an email-sending service.
- Add account lockout or CAPTCHA after repeated failed logins (best practice #14).
- Add `express-rate-limit` on `/generate` and `/q/:code` to slow down DB-flooding and ID-guessing.
- Add a color picker for custom foreground/background colors (`qrcode` already supports this via the `color` option in `models/qrModel.js`).
- Add a logo-overlay option (requires compositing with a library like `sharp`).
- Wire `qrStore.purgeExpired()` into a scheduled job.
- Add per-code scan counters if you want basic analytics (a `scan_count` column + an `UPDATE ... SET scan_count = scan_count + 1` in `resolveQR`).
