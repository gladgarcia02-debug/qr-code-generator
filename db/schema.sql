-- db/schema.sql
-- ---------------------------------------------------------------------
-- Run this once against your PostgreSQL database to create the tables
-- this app needs:
--
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- Safe to re-run: every statement is IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS, so running this against a database that already has these
-- tables (e.g. after pulling the auth feature into an existing
-- deployment) just adds what's missing instead of erroring out.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,

  username      VARCHAR(30) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,

  -- bcrypt hashes are always 60 chars; never store a raw password here.
  password_hash VARCHAR(60) NOT NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Login looks users up by email or username — both are already UNIQUE
-- above, which Postgres backs with an index automatically, so no
-- extra index is needed here.

CREATE TABLE IF NOT EXISTS qr_codes (
  id           SERIAL PRIMARY KEY,

  -- Owner of this code. Every code is created by an authenticated
  -- user (see middleware/auth.js requireAuth on /generate), so this
  -- is NOT NULL — there's no such thing as an ownerless code. Deleting
  -- a user cascades to their codes rather than leaving orphan rows.
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Short random identifier embedded in the QR image's URL, e.g.
  -- the QR encodes https://yoursite.com/q/9c87bcb3 and this column
  -- holds "9c87bcb3". Indexed below since every scan looks it up.
  qr_code      VARCHAR(32) UNIQUE NOT NULL,

  -- What kind of content this is, so the scan handler knows whether
  -- to redirect (url/email/phone) or just display text (text).
  type         VARCHAR(20) NOT NULL CHECK (type IN ('text', 'url', 'email', 'phone')),

  -- The actual destination: a fully-formed URL, "mailto:...", "tel:...",
  -- or raw text content, depending on `type`.
  target_url   TEXT NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL = "Never Expires". Any non-null timestamp in the past means
  -- the code is expired.
  expires_at   TIMESTAMPTZ,

  -- Manual override state. 'active' is the normal state; 'revoked'
  -- lets a user kill a code early regardless of its expiry date
  -- (e.g. they posted a QR code publicly by mistake).
  -- NOTE: "expired" is intentionally NOT a stored status value — it's
  -- always computed live from expires_at vs. NOW() at read time, so a
  -- code can never go stale by skipping a cleanup job. See
  -- models/qrStore.js computeStatus().
  status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))
);

-- Adds user_id to a pre-existing qr_codes table (e.g. a database that
-- was created before this column existed). Skipped automatically if
-- the column is already there. NOT NULL is intentionally not added
-- here — running it on a table with existing ownerless rows would
-- fail; assign those rows an owner manually first if you're migrating
-- a pre-auth deployment, then add the constraint by hand.
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users (id) ON DELETE CASCADE;

-- Every scan does a lookup by qr_code — this is the hot path.
CREATE INDEX IF NOT EXISTS idx_qr_codes_qr_code ON qr_codes (qr_code);

-- Speeds up the dashboard's sort/filter and any future cleanup job
-- that purges old expired rows.
CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON qr_codes (expires_at);

CREATE INDEX IF NOT EXISTS idx_qr_codes_created_at ON qr_codes (created_at DESC);

-- The dashboard's main query is "every code belonging to this user,
-- newest first" — this composite index serves that directly.
CREATE INDEX IF NOT EXISTS idx_qr_codes_user_id_created_at ON qr_codes (user_id, created_at DESC);

-- Session storage for express-session via connect-pg-simple (see
-- config/session.js). connect-pg-simple can also create this table
-- itself on startup (createTableIfMissing: true, currently enabled),
-- but production deployments should prefer creating it here ahead of
-- time — auto-create needs DDL privileges on every boot and is racy
-- if multiple instances start at once. This is the table's official
-- definition, safe to leave in place even with createTableIfMissing on.
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

ALTER TABLE session DROP CONSTRAINT IF EXISTS session_pkey;
ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
