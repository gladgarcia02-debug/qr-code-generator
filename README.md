# QR Code Generator (with Expiration)

A full-stack QR code generator built with **Node.js**, **Express.js**, **PostgreSQL**, and **EJS**, following the **MVC** (Model–View–Controller) pattern. Generate QR codes from text, URLs, emails, or phone numbers — either permanent or set to expire after a chosen amount of minutes, hours, days, months, or years — preview them instantly, download them as PNG, and track every code's status from a dashboard.

---

## Features

- Generate QR codes for **plain text, URLs, email addresses, and phone numbers**
- **Optional expiration**, in minutes / hours / days / months / years, or **"Never Expires"** for a permanent code
- Expiration is enforced **live, at scan time** — checked against the database every time the code is scanned, not just at creation
- A **dashboard** listing every QR code with its live status (Active / Expired / Revoked) and a human-readable "time remaining" / "expired X ago" string
- Manual **revoke** action to kill a code early, regardless of its expiry date
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
| Styling | Hand-written CSS (no framework) |

---

## Project Structure

```
qr-code-generator/
├── server.js                  # Entry point — config, DB check, start
├── package.json
├── .env.example                # Template for your local .env
├── db/
│   └── schema.sql              # CREATE TABLE for qr_codes
├── config/
│   └── db.js                   # PostgreSQL connection pool
├── routes/
│   └── qrRoutes.js             # URL → controller mapping
├── controllers/
│   └── qrController.js         # Request handling, expiration checks
├── models/
│   ├── qrModel.js               # QR rendering + expiry-date math
│   └── qrStore.js               # All SQL queries (CRUD on qr_codes)
├── middleware/
│   └── validateInput.js        # express-validator rules
├── utils/
│   └── timeFormatter.js        # "3 days remaining" / "Expired 2h ago"
├── views/
│   ├── index.ejs               # Generator form + result panel
│   ├── dashboard.ejs           # All codes, status, time remaining
│   ├── expired.ejs             # Shown when a scanned code is dead
│   ├── scan.ejs                # Displays plain-text codes on scan
│   ├── error.ejs               # 404 / 500 page
│   └── partials/
│       ├── header.ejs
│       └── footer.ejs
└── public/
    ├── css/style.css
    └── js/script.js
```

**MVC mapping:**
- **Model** → `models/qrModel.js` (rendering + date math) and `models/qrStore.js` (all database access)
- **View** → everything in `views/` and `public/`
- **Controller** → `controllers/qrController.js`, wired up by `routes/qrRoutes.js`

---

## 1. Database Schema

`db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS qr_codes (
  id           SERIAL PRIMARY KEY,
  qr_code      VARCHAR(32) UNIQUE NOT NULL,   -- short ID in the scan URL
  type         VARCHAR(20) NOT NULL CHECK (type IN ('text', 'url', 'email', 'phone')),
  target_url   TEXT NOT NULL,                  -- real destination/content
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,                    -- NULL = never expires
  status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_qr_code ON qr_codes (qr_code);
CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON qr_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_codes_created_at ON qr_codes (created_at DESC);
```

A couple of intentional design choices worth calling out:
- **`status` only stores `'active'` or `'revoked'`** — never `'expired'`. Whether a code is expired is *computed on every read* by comparing `expires_at` to the current time (see `qrStore.computeStatus()`), rather than written to a column. This means a code can never be "stuck" showing the wrong status because a cleanup job didn't run — the moment the clock passes `expires_at`, every single read sees it as expired, instantly and automatically.
- **`expires_at` is `TIMESTAMPTZ`** (timestamp with time zone), not a plain `TIMESTAMP`. This avoids an entire category of bugs where the server and database disagree about what time zone a stored value is in.

Run it once against your database:
```bash
psql "$DATABASE_URL" -f db/schema.sql
```

---

## 2. Model Updates

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
async function createRecord({ type, targetUrl, expiresAt }) {
  // INSERTs a new row, retrying with a fresh random ID on the rare
  // chance of a collision, and returns the inserted row.
}

async function getRecordByCode(qrCode) {
  // SELECTs a single row by its public ID; returns null if missing.
}

async function getAllRecords() {
  // SELECTs every row, newest first, for the dashboard.
}

function isExpired(record) {
  // true if expires_at is set and in the past.
}

function computeStatus(record) {
  // 'revoked' | 'expired' | 'active' — computed live, never stored.
}

async function revokeRecord(qrCode) {
  // UPDATEs status to 'revoked'.
}

async function purgeExpired(olderThanDays = 30) {
  // Optional cleanup: DELETEs rows that expired long ago.
}
```

Every query uses parameterized placeholders (`$1`, `$2`, ...) — see the security section below for why that matters.

---

## 3. Controller Logic for Expiration Checking

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

## 4. Route Modifications

`routes/qrRoutes.js`:

```js
router.get('/', qrController.renderHome);
router.post('/generate', validateQRInput, qrController.generateQR);
router.get('/download', qrController.downloadQR);
router.get('/dashboard', qrController.showDashboard);
router.post('/qr/:code/revoke', qrController.revokeQR);
router.get('/q/:code', qrController.resolveQR);   // the actual scan handler
```

`GET /q/:code` is what's physically encoded inside every QR image and is what a phone's camera hits when scanning.

---

## 5. EJS Form for Expiration

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

## 6. Dashboard Implementation

`GET /dashboard` (`showDashboard` in the controller) loads every record, computes its status and "time remaining" string, and renders `views/dashboard.ejs` as a table:

| Code | Type | Target | Created | Expires | Status | Time Remaining | |
|---|---|---|---|---|---|---|---|
| `9c87bcb3` | url | `https://example.com` | Jun 19, 2026 | Jun 19, 2027 | 🟢 Active | 1 year remaining | Revoke |
| `a1b2c3d4` | email | `mailto:a@b.com` | Jun 1, 2026 | Jun 8, 2026 | 🔴 Expired | Expired 3 days ago | |

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

Active codes get a **Revoke** button (a small form posting to `/qr/:code/revoke`) so they can be manually disabled without waiting for the expiry date.

> **Note:** this dashboard has no authentication in front of it — anyone with the URL can see every code and revoke any of them. See the security section below before deploying this publicly.

---

## 7. Best Practices for Handling Expired QR Codes Securely

A few things this implementation already does, and why they matter:

1. **Check expiration at scan time, not generation time.** Baking a "valid until" assumption into the QR image itself would be unenforceable — anyone could keep using an old code forever. The check has to happen server-side, on every access, against the current time.

2. **`Cache-Control: no-store` on every `/q/:code` response.** Without this, a browser, proxy, or CDN could cache a `302` redirect issued *before* expiry and keep serving it from cache *after* expiry — silently defeating the whole feature.

3. **Distinct HTTP status codes for distinct situations.** `404` for an ID that never existed vs. `410 Gone` for one that did exist but is now expired/revoked. This isn't just pedantry — monitoring tools, link checkers, and well-behaved clients treat these differently, and it avoids leaking "this ID format would have worked, just not right now" as a side channel.

4. **Parameterized SQL everywhere, no string concatenation.** Every query in `qrStore.js` uses `$1`, `$2`, etc. placeholders, so user input is always sent to PostgreSQL as data, never as part of the SQL command text. This is what prevents SQL injection — it's automatic as long as every query keeps doing this consistently.

5. **Unpredictable, non-sequential IDs.** `qr_code` values are random hex (`crypto.randomBytes`), not auto-incrementing integers. Sequential IDs would let someone enumerate `/q/1`, `/q/2`, `/q/3`... and discover codes that were never meant to be shared.

6. **Output is escaped, not concatenated into raw HTML.** `views/scan.ejs` renders text content with EJS's default `<%= %>` (auto-escaping), not `<%- %>` (raw, unescaped). If you ever change that, stored text content becomes a stored-XSS vector.

7. **Rate-limit the public-facing routes before deploying.** `/generate` (to stop someone from flooding your database with rows) and `/q/:code` (to slow down ID-guessing attempts) are both good candidates for [`express-rate-limit`](https://www.npmjs.com/package/express-rate-limit). Not included here to keep the example focused, but add it before going live.

8. **Add authentication in front of `/dashboard` and the revoke action before deploying publicly.** As shipped, anyone with the URL can view every code's destination and revoke any code. At minimum, put these routes behind a login (e.g. `express-session` + a simple password check, or a proper auth library) if this will be reachable from the internet.

9. **Don't log sensitive `target_url` values in plaintext if they contain PII.** If people will encode personal emails/phone numbers, be mindful of where your server logs end up and for how long they're retained.

10. **Periodically purge old expired rows.** Nothing breaks if you never do this (expired codes are rejected at lookup time regardless), but calling `qrStore.purgeExpired()` on a schedule (`node-cron`, or your host's scheduled-jobs feature) keeps the table from growing forever with dead rows.

---

## Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- A running PostgreSQL database (local install, Docker, or a managed host like Render/Railway/Supabase)

### 2. Install dependencies
```bash
npm install
```
Installs `express`, `ejs`, `qrcode`, `express-validator`, `pg`, and `dotenv`.

### 3. Configure your database connection
```bash
cp .env.example .env
```
Edit `.env` and set `DATABASE_URL` (or the individual `DB_*` fields) to point at your PostgreSQL instance.

### 4. Create the table
```bash
psql "$DATABASE_URL" -f db/schema.sql
```

### 5. Run the app
```bash
npm start          # production / simple start
npm run dev         # auto-restarts on file changes (requires nodemon)
```

### 6. Open it
```
http://localhost:3000            # generator
http://localhost:3000/dashboard  # all codes + status
```

If PostgreSQL isn't reachable, `server.js` fails fast at startup with a clear error message instead of booting successfully and only failing on the first request.

---

## Possible Next Steps

- Add authentication in front of `/dashboard` (see security best practice #8 above).
- Add `express-rate-limit` on `/generate` and `/q/:code`.
- Add a color picker for custom foreground/background colors (`qrcode` already supports this via the `color` option in `models/qrModel.js`).
- Add a logo-overlay option (requires compositing with a library like `sharp`).
- Wire `qrStore.purgeExpired()` into a scheduled job.
- Add per-code scan counters if you want basic analytics (a `scan_count` column + an `UPDATE ... SET scan_count = scan_count + 1` in `resolveQR`).
