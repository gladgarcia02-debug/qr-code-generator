/**
 * config/db.js
 * --------------
 * Sets up a single shared PostgreSQL connection pool for the whole
 * app. Every other file that needs the database (models/qrStore.js)
 * requires this module rather than creating its own connection —
 * pooling means concurrent requests reuse a small set of open
 * connections instead of opening a new one each time.
 */

const { Pool } = require('pg');

const pool = new Pool({
  // If DATABASE_URL is set (the common convention on Render, Railway,
  // Heroku, etc.), pg uses it and ignores the individual fields below.
  connectionString: process.env.DATABASE_URL,

  // Fallback for local development without a connection string.
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'qr_generator',

  // Most managed Postgres providers (Render, Railway, Supabase, etc.)
  // require SSL but use certificates that fail strict verification
  // unless you've imported their CA — rejectUnauthorized: false is
  // the commonly accepted middle ground for this use case. Defaults
  // to OFF, since local development typically doesn't use SSL.
  // Set DB_SSL=true in production environments that need it.
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Without this handler, an error on an idle client in the pool (e.g.
// the database restarting) would crash the whole Node process with an
// uncaught exception.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = pool;
