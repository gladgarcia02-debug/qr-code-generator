/**
 * models/userModel.js
 * ----------------------
 * The "M" in MVC for user accounts. Like qrModel.js, this module has
 * no Express or SQL in it at all — just the password hashing rules,
 * kept separate from models/userStore.js (which owns the database
 * access) so the hashing logic can be reasoned about and tested on
 * its own.
 */

const bcrypt = require('bcrypt');

// 12 rounds is bcrypt's commonly recommended minimum for new projects
// in 2024+ — high enough to be slow for an attacker brute-forcing
// stolen hashes, low enough not to noticeably delay a real login.
const SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS
  ? parseInt(process.env.BCRYPT_SALT_ROUNDS, 10)
  : 12;

/**
 * @param {string} plainPassword
 * @returns {Promise<string>} a 60-character bcrypt hash, safe to store
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * @param {string} plainPassword - what the user just typed in
 * @param {string} passwordHash - what's stored in users.password_hash
 * @returns {Promise<boolean>} true if they match
 */
async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { hashPassword, verifyPassword };
