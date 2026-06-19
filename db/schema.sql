-- db/schema.sql
-- ---------------------------------------------------------------------
-- Run this once against your PostgreSQL database to create the table
-- this app needs:
--
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS qr_codes (
  id           SERIAL PRIMARY KEY,

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

-- Every scan does a lookup by qr_code — this is the hot path.
CREATE INDEX IF NOT EXISTS idx_qr_codes_qr_code ON qr_codes (qr_code);

-- Speeds up the dashboard's sort/filter and any future cleanup job
-- that purges old expired rows.
CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON qr_codes (expires_at);

CREATE INDEX IF NOT EXISTS idx_qr_codes_created_at ON qr_codes (created_at DESC);
