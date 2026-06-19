/**
 * middleware/validateInput.js
 * ----------------------------
 * Server-side validation. Even though the form has basic client-side
 * checks (for instant feedback), we never trust the client — every
 * request is re-validated here before it touches the controller/model.
 *
 * We use express-validator's `body()` chain plus a `.custom()` validator
 * so the rules can change depending on which "type" the user picked
 * (e.g. an email needs a different shape than a phone number).
 */

const { body, validationResult } = require('express-validator');
const { SUPPORTED_TYPES, SUPPORTED_EXPIRY_UNITS } = require('../models/qrModel');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[\d\s\-().]{7,20}$/;
const URL_REGEX = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#]\S*)?$/i;

/**
 * Validation chain applied to POST /generate.
 * If validation fails, we re-render the form (HTTP 400) with the
 * collected error messages and the user's original input, so they
 * never lose what they typed.
 */
const validateQRInput = [
  body('qrType')
    .trim()
    .notEmpty()
    .withMessage('Please select a QR code type.')
    .isIn(SUPPORTED_TYPES)
    .withMessage('Invalid QR code type selected.'),

  body('qrText')
    .trim()
    .notEmpty()
    .withMessage('Please enter some content to generate a QR code.')
    .isLength({ max: 2000 })
    .withMessage('Input is too long. Please keep it under 2000 characters.')
    .custom((value, { req }) => {
      const type = req.body.qrType;
      const trimmed = value.trim();

      if (type === 'email' && !EMAIL_REGEX.test(trimmed)) {
        throw new Error('Please enter a valid email address (e.g. name@example.com).');
      }

      if (type === 'phone' && !PHONE_REGEX.test(trimmed)) {
        throw new Error('Please enter a valid phone number (e.g. +1 555 123 4567).');
      }

      if (type === 'url' && !URL_REGEX.test(trimmed)) {
        throw new Error('Please enter a valid URL (e.g. www.example.com).');
      }

      return true;
    }),

  body('qrSize')
    .optional({ checkFalsy: true })
    .isInt({ min: 150, max: 600 })
    .withMessage('QR size must be between 150 and 600 pixels.'),

  body('expiryUnit')
    .optional({ checkFalsy: true })
    .isIn(SUPPORTED_EXPIRY_UNITS)
    .withMessage('Invalid expiration unit selected.'),

  body('expiryValue')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 1000 })
    .withMessage('Expiration amount must be a whole number between 1 and 1000.'),

  // Cross-field check: if a real unit was chosen (anything but
  // "never"), a positive amount is required to go with it. Attached
  // to expiryValue so its error message surfaces next to that field.
  body('expiryValue').custom((value, { req }) => {
    const unit = req.body.expiryUnit;
    const hasUnit = unit && unit !== 'never';
    const hasAmount = value !== undefined && value !== null && value !== '';

    if (hasUnit && !hasAmount) {
      throw new Error('Please enter how many minutes/hours/days/months/years until this code expires.');
    }
    return true;
  }),

  // Final middleware in the chain: collect any errors raised above
  // and short-circuit the request before it reaches the controller.
  (req, res, next) => {
    const result = validationResult(req);
    if (!result.isEmpty()) {
      return res.status(400).render('index', {
        errors: result.array(),
        qrImage: null,
        encodedData: null,
        targetUrl: null,
        expiresAt: null,
        formData: req.body,
      });
    }
    next();
  },
];

module.exports = { validateQRInput };
