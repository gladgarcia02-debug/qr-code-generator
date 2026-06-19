/**
 * models/userStore.js
 * ----------------------
 * Database access for user accounts — the counterpart to qrStore.js.
 * Every query is parameterized ($1, $2, ...), never string-concatenated,
 * for the same SQL-injection reasons documented in qrStore.js.
 */

const pool = require('../config/db');

/**
 * Creates a new user row. `passwordHash` must already be a bcrypt
 * hash (see models/userModel.js) — this function never sees or stores
 * a raw password.
 *
 * @param {{ username: string, email: string, passwordHash: string }} fields
 * @returns {Promise<object>} the inserted row (no password_hash column)
 */
async function createUser({ username, email, passwordHash }) {
  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, created_at`,
    [username, email, passwordHash]
  );
  return result.rows[0];
}

/**
 * Looks up a user by whatever they typed into the login form's single
 * "username or email" field. Returns null if neither matches — same
 * "not found is a normal outcome, not an error" convention as
 * qrStore.getRecordByCode().
 */
async function getUserByEmailOrUsername(identifier) {
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1 OR username = $1',
    [identifier]
  );
  return result.rows[0] || null;
}

async function getUserById(id) {
  const result = await pool.query(
    'SELECT id, username, email, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function getUserByEmail(email) {
  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function getUserByUsername(username) {
  const result = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  return result.rows[0] || null;
}

module.exports = {
  createUser,
  getUserByEmailOrUsername,
  getUserById,
  getUserByEmail,
  getUserByUsername,
};
