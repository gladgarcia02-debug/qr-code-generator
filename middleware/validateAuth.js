/**
 * middleware/validateAuth.js
 * -----------------------------
 * Server-side validation for registration and login, mirroring the
 * pattern in validateInput.js: an express-validator chain followed by
 * a final middleware that re-renders the form with errors + whatever
 * the user already typed (minus the password fields) if anything
 * fails, rather than ever trusting client-side checks alone.
 */

const { body, validationResult } = require('express-validator');

// Deliberately conservative: letters, numbers, underscore only, so a
// username can always be safely shown back in HTML and URLs without
// extra escaping concerns.
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

const validateRegisterInput = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Please choose a username.')
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters.')
    .matches(USERNAME_REGEX)
    .withMessage('Username can only contain letters, numbers, and underscores.'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Please enter your email address.')
    .isEmail()
    .withMessage('Please enter a valid email address.')
    .isLength({ max: 255 })
    .withMessage('Email is too long.')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Please choose a password.')
    // bcrypt only uses the first 72 bytes of input — capping here
    // avoids silently truncating (and hashing CPU time on) anything
    // longer than that without telling the user.
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters.'),

  body('confirmPassword')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match.'),

  // Final middleware: collect errors and short-circuit before the
  // controller runs. Never echoes password fields back into the form.
  (req, res, next) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(400).render('register', {
        errors: result.array(),
        formData: { username: req.body.username, email: req.body.email },
      });
    }
    next();
  },
];

const validateLoginInput = [
  body('identifier')
    .trim()
    .notEmpty()
    .withMessage('Please enter your username or email.'),

  body('password')
    .notEmpty()
    .withMessage('Please enter your password.'),

  (req, res, next) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(400).render('login', {
        errors: result.array(),
        formData: { identifier: req.body.identifier },
        next: req.body.next || req.query.next || '',
      });
    }
    next();
  },
];

module.exports = { validateRegisterInput, validateLoginInput };
