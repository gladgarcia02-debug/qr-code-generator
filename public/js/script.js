/**
 * public/js/script.js
 * ----------------------
 * Small client-side enhancements only — all real validation and QR
 * generation happens on the server (middleware/validateInput.js and
 * models/qrModel.js). This file just makes the form nicer to use:
 *   1. Updates the placeholder/hint/input-type when the user switches
 *      between Text / URL / Email / Phone.
 *   2. Shows a "Generating…" state on the button while the form submits,
 *      so there's no dead silence while the server builds the image.
 */

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('qrForm');
  const textInput = document.getElementById('qrText');
  const hint = document.getElementById('qrTextHint');
  const typeInputs = document.querySelectorAll('input[name="qrType"]');
  const generateBtn = document.getElementById('generateBtn');

  // Per-type input config: what kind of keyboard/autocomplete to hint at,
  // placeholder copy, and the helper text shown beneath the field.
  const TYPE_CONFIG = {
    text: {
      inputType: 'text',
      placeholder: 'Any text you want to encode…',
      hint: 'Plain text is stored as-is — notes, codes, addresses, anything.',
    },
    url: {
      inputType: 'url',
      placeholder: 'https://example.com',
      hint: 'Enter a web address, including or excluding "https://".',
    },
    email: {
      inputType: 'email',
      placeholder: 'name@example.com',
      hint: 'Scanning opens the camera owner\u2019s mail app, addressed to this email.',
    },
    phone: {
      inputType: 'tel',
      placeholder: '+1 555 123 4567',
      hint: 'Scanning opens the dialer pre-filled with this number.',
    },
  };

  function applyTypeConfig(type) {
    const config = TYPE_CONFIG[type] || TYPE_CONFIG.text;
    if (textInput) {
      textInput.type = config.inputType;
      textInput.placeholder = config.placeholder;
    }
    if (hint) {
      hint.textContent = config.hint;
    }

    // Fallback for browsers without CSS :has() support: manually toggle
    // an "is-checked" class on whichever tab label is currently active.
    typeInputs.forEach(function (input) {
      const label = input.closest('.type-tab');
      if (label) {
        label.classList.toggle('is-checked', input.checked);
      }
    });
  }

  // Initialize based on whichever radio is checked on page load
  // (this matters after a server-side validation error re-renders
  // the page with the user's previous choice still selected).
  const initiallyChecked = document.querySelector('input[name="qrType"]:checked');
  if (initiallyChecked) {
    applyTypeConfig(initiallyChecked.value);
  }

  typeInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      applyTypeConfig(input.value);
      textInput.focus();
    });
  });

  if (form && generateBtn) {
    form.addEventListener('submit', function () {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating…';
    });
  }

  // --- Expiration value/unit toggle ---------------------------------
  // The numeric "amount" input is only meaningful once a real unit
  // (minutes/hours/days/months/years) is chosen. When "Never Expires"
  // is selected, disable it so it's visually inert and doesn't submit
  // a stray number that the server would otherwise have to ignore.
  const expiryUnit = document.getElementById('expiryUnit');
  const expiryValue = document.getElementById('expiryValue');

  function syncExpiryValueState() {
    if (!expiryUnit || !expiryValue) return;
    const isNever = expiryUnit.value === 'never';
    expiryValue.disabled = isNever;
    expiryValue.required = !isNever;
    if (isNever) {
      expiryValue.value = '';
    }
  }

  if (expiryUnit) {
    syncExpiryValueState();
    expiryUnit.addEventListener('change', syncExpiryValueState);
  }
});
