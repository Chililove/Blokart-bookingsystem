// Shared client-side field validation for both the customer (app.js) and staff
// (staff.js) pages. One source of truth for the rules + the red/error UI, so
// the two pages can't drift apart. Server still re-validates everything.
window.Validation = (function () {
  // Phone field accepts digits, +, spaces and separators - nothing else.
  const PHONE_DISALLOWED = /[^\d+\s()\-]/g;
  const digits = (v) => v.replace(/\D/g, '');

  function isName(v) {
    const t = (v || '').trim();
    return t.length >= 1 && t.length <= 80;
  }
  // Email is optional: blank passes, but a filled one must look like an email.
  function isEmail(v) {
    const t = (v || '').trim();
    return t === '' || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) && t.length <= 120);
  }
  // minDigits differs per page: customer adds a country code separately (6),
  // staff types the whole number (8). Max 15 = E.164.
  function isPhone(v, minDigits = 8, maxDigits = 15) {
    const d = digits(v || '');
    return /^[+\d\s()\-]*$/.test(v || '') && d.length >= minDigits && d.length <= maxDigits;
  }

  // Strip disallowed characters from a phone <input> as the user types, keeping
  // the caret roughly in place. This is the "make it impossible" half.
  function attachPhoneFilter(input) {
    input.addEventListener('input', () => {
      const cleaned = input.value.replace(PHONE_DISALLOWED, '');
      if (cleaned !== input.value) {
        const drop = input.value.length - cleaned.length;
        const pos = Math.max(0, (input.selectionStart || cleaned.length) - drop);
        input.value = cleaned;
        try { input.setSelectionRange(pos, pos); } catch (e) { /* unsupported */ }
      }
    });
  }

  // fields: [{ id, test(value)->bool, msg()->localized string, phone?:bool }].
  // Each field id must have a matching "<id>Err" element for its message.
  // Returns a controller: validity(), show(force), wire(onChange), touchAll().
  function createValidator(fields) {
    const touched = new Set();

    function validity() {
      const out = {};
      for (const f of fields) out[f.id] = f.test(document.getElementById(f.id).value);
      return out;
    }

    // Paint red + message. force=true reveals all (used on submit); otherwise
    // only fields the user has already left (blurred), to avoid nagging.
    function show(force) {
      const v = validity();
      for (const f of fields) {
        const input = document.getElementById(f.id);
        const errEl = document.getElementById(f.id + 'Err');
        const invalid = !v[f.id] && (force || touched.has(f.id));
        input.classList.toggle('invalid', invalid);
        input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
        if (errEl) errEl.textContent = invalid ? f.msg() : '';
      }
      return v;
    }

    function wire(onChange) {
      for (const f of fields) {
        const el = document.getElementById(f.id);
        if (f.phone) attachPhoneFilter(el);
        el.addEventListener('input', () => { if (touched.has(f.id)) show(false); if (onChange) onChange(); });
        el.addEventListener('blur', () => { touched.add(f.id); show(false); });
      }
    }

    function touchAll() { for (const f of fields) touched.add(f.id); }

    return { validity, show, wire, touchAll };
  }

  return { isName, isEmail, isPhone, attachPhoneFilter, createValidator };
})();
