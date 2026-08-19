// Behaviour for the booking page: language switching, quantity steppers,
// availability slots, and submitting an order. Reads text from `T`
// (translations.js) and talks to the server's /api endpoints.

const state = { qtySingle:0, qtyDouble:0, date:null, duration:null, time:null, pay:'flatpay', cfg:null, lang:'da' };
function tr() { return T[state.lang]; }

// Escape anything user- or staff-supplied before it goes into innerHTML,
// so a name/reason can never inject markup or script (stored XSS).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function applyLang() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-t]').forEach(el => {
    const v = tr()[el.dataset.t];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('.langbar button').forEach(b => b.classList.toggle('active', b.dataset.lang === state.lang));
  rebuildDurations(); renderConsent(); renderQty(); loadSlots(); update();
}
document.querySelectorAll('.langbar button').forEach(b => b.addEventListener('click', () => { state.lang = b.dataset.lang; applyLang(); }));

async function loadConfig() {
  state.cfg = await (await fetch('/api/config')).json();
  document.getElementById('priceSingle').textContent = state.cfg.prices.single + ' kr.';
  document.getElementById('priceDouble').textContent = state.cfg.prices.double + ' kr.';
  state.duration = state.cfg.durationsMinutes[0];
  const today = new Date();
  const max = new Date(Date.now() + state.cfg.maxDaysAhead*86400000);
  const di = document.getElementById('date');
  di.min = today.toISOString().slice(0,10);
  di.max = max.toISOString().slice(0,10);
  rebuildDurations();
}

function rebuildDurations() {
  if (!state.cfg) return;
  const dur = document.getElementById('duration');
  const cur = state.duration;
  dur.innerHTML = '';
  state.cfg.durationsMinutes.forEach(m => {
    const o = document.createElement('option');
    const h = m/60;
    o.value = m; o.textContent = h + ' ' + (h === 1 ? tr().hour : tr().hours);
    dur.appendChild(o);
  });
  dur.value = cur;
}

// Quantity steppers
function maxFor(type) {
  if (!state.cfg) return 0;
  return type === 'double'
    ? state.cfg.fleet.permanentDouble + state.cfg.fleet.convertibleDouble
    : state.cfg.fleet.totalSingle;
}
document.querySelectorAll('.stepbtn').forEach(btn => btn.addEventListener('click', () => {
  const type = btn.dataset.q, d = Number(btn.dataset.d);
  const key = type === 'double' ? 'qtyDouble' : 'qtySingle';
  const next = Math.max(0, Math.min(maxFor(type), state[key] + d));
  state[key] = next;
  state.time = null; // re-validate slot against new quantity
  renderQty(); loadSlots(); update();
}));

function renderQty() {
  document.getElementById('qSingle').textContent = state.qtySingle;
  document.getElementById('qDouble').textContent = state.qtyDouble;
  // disable +/- at fleet limits
  document.querySelectorAll('.stepbtn').forEach(btn => {
    const type = btn.dataset.q, d = Number(btn.dataset.d);
    const key = type === 'double' ? 'qtyDouble' : 'qtySingle';
    btn.disabled = (d < 0 && state[key] <= 0) || (d > 0 && state[key] >= maxFor(type));
  });
  renderOrderSummary();
}

// Group total formatted for the current language (thousands separator).
function fmt(n) {
  const loc = state.lang === 'de' ? 'de-DE' : state.lang === 'en' ? 'en-GB' : 'da-DK';
  return n.toLocaleString(loc);
}
function orderLine(qty, name, price) {
  return `<div class="order-row"><div><div class="oname">${name}</div>` +
         `<div class="ounit">${qty} × ${fmt(price)} kr.</div></div>` +
         `<div class="oprice">${fmt(qty * price)} kr.</div></div>`;
}
function renderOrderSummary() {
  const el = document.getElementById('orderSummary');
  if (!state.cfg) { el.innerHTML = ''; return; }
  const p = state.cfg.prices;
  let html = '';
  if (state.qtySingle > 0) html += orderLine(state.qtySingle, tr().singleTitle, p.single);
  if (state.qtyDouble > 0) html += orderLine(state.qtyDouble, tr().doubleTitle, p.double);
  if (html) {
    const total = state.qtySingle * p.single + state.qtyDouble * p.double;
    html += `<div class="order-total"><span class="olabel">${tr().totalWord}</span>` +
            `<span class="oamount">${fmt(total)} kr.</span></div>`;
  }
  el.innerHTML = html;
}

// Availability check - must mirror server-side math
function fits(sBooked, dBooked, addS, addD) {
  const f = state.cfg.fleet;
  const nd = dBooked + addD, ns = sBooked + addS;
  if (nd > f.permanentDouble + f.convertibleDouble) return false;
  const conv = Math.min(Math.max(nd - f.permanentDouble, 0), f.convertibleDouble);
  if (ns + conv > f.totalSingle) return false;
  return true;
}

document.querySelectorAll('[data-pay]').forEach(el => el.addEventListener('click', () => {
  document.querySelectorAll('[data-pay]').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected'); state.pay = el.dataset.pay; update();
}));
document.getElementById('date').addEventListener('change', e => { state.date = e.target.value; state.time=null; loadSlots(); update(); });
document.getElementById('duration').addEventListener('change', e => { state.duration = Number(e.target.value); state.time=null; loadSlots(); update(); });
['name','phone','email'].forEach(id => document.getElementById(id).addEventListener('input', update));
document.getElementById('cc').addEventListener('change', update);

async function loadSlots() {
  const box = document.getElementById('slots');
  const banner = document.getElementById('closedBanner');
  banner.innerHTML = '';
  if (!state.date) { box.innerHTML = `<span class="hint">${tr().pickDate}</span>`; return; }
  box.innerHTML = `<span class="hint">${tr().loadingTimes}</span>`;
  const data = await (await fetch(`/api/slots?date=${state.date}&durationMinutes=${state.duration}`)).json();
  if (data.closure) {
    banner.innerHTML = `<div class="closed-banner">🚫 ${tr().closedTitle}<br><strong>${esc(data.closure.reason)}</strong><br>${tr().closedSub}</div>`;
    box.innerHTML = ''; return;
  }
  const totalQty = state.qtySingle + state.qtyDouble;
  if (totalQty < 1) { box.innerHTML = `<span class="hint">${tr().pickQty}</span>`; return; }
  box.innerHTML = '';
  data.slots.forEach(s => {
    const ok = !s.past && fits(s.sBooked, s.dBooked, state.qtySingle, state.qtyDouble);
    const div = document.createElement('div');
    div.className = 'slot' + (ok ? '' : ' full');
    div.innerHTML = `${s.time}<small>S ${s.singleAvailable} · D ${s.doubleAvailable}</small>`;
    if (ok) div.addEventListener('click', () => {
      document.querySelectorAll('.slot').forEach(x => x.classList.remove('selected'));
      div.classList.add('selected'); state.time = s.time; update();
    });
    box.appendChild(div);
  });
  // drop selection if chosen slot no longer fits
  if (state.time && !document.querySelector('.slot.selected')) state.time = null;
}

function renderConsent() {
  if (!state.cfg) return;
  const c = state.cfg.links || {};
  const termsTxt = tr().consentTerms, privTxt = tr().consentPrivacy;
  const terms = c.termsUrl ? `<a href="${c.termsUrl}" target="_blank" rel="noopener">${termsTxt}</a>` : termsTxt;
  const priv = c.privacyUrl ? `<a href="${c.privacyUrl}" target="_blank" rel="noopener">${privTxt}</a>` : privTxt;
  document.getElementById('consentBox').innerHTML =
    `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:normal;">
       <input type="checkbox" id="consent" style="width:auto;margin-top:4px;" />
       <span>${tr().consentAccept} ${terms} ${tr().consentAnd} ${priv} <span class="req">*</span></span>
     </label>`;
  document.getElementById('consent').addEventListener('change', update);
}

function update() {
  const name = document.getElementById('name').value.trim();
  const local = document.getElementById('phone').value.replace(/[^0-9]/g,'');
  const phoneOk = local.length >= 6;
  const consentEl = document.getElementById('consent');
  const consentOk = consentEl && consentEl.checked;
  const totalQty = state.qtySingle + state.qtyDouble;
  const ready = totalQty >= 1 && state.date && state.time && name && phoneOk && consentOk;
  document.getElementById('bookBtn').disabled = !ready;
  const sum = document.getElementById('summary');
  if (totalQty >= 1 && state.time) {
    const total = state.qtySingle*state.cfg.prices.single + state.qtyDouble*state.cfg.prices.double;
    sum.textContent = `${state.date} · ${state.time} · ${state.duration/60} ${state.duration/60===1?tr().hour:tr().hours} · ${total} kr.`;
  } else sum.textContent = '';
}

document.getElementById('bookBtn').addEventListener('click', async () => {
  const btn = document.getElementById('bookBtn'); btn.disabled = true;
  const msg = document.getElementById('message'); msg.innerHTML = '';
  const fullPhone = document.getElementById('cc').value + document.getElementById('phone').value.replace(/[^0-9]/g,'');
  const payload = {
    singleQty: state.qtySingle, doubleQty: state.qtyDouble,
    date: state.date, startTime: state.time, durationMinutes: state.duration,
    name: document.getElementById('name').value, phone: fullPhone,
    email: document.getElementById('email').value, payment: state.pay, lang: state.lang,
    consent: !!(document.getElementById('consent') && document.getElementById('consent').checked),
  };
  const res = await fetch('/api/bookings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  const data = await res.json();
  if (!data.ok) { msg.innerHTML = `<div class="notice bad">${esc(data.error)}</div>`; loadSlots(); update(); return; }
  if (data.payment === 'flatpay') { window.location.href = data.checkoutUrl; }
  else {
    msg.innerHTML = `<div class="notice ok">${tr().okShop(data.total)}</div>`;
    document.getElementById('summary').textContent = '';
    // reset to prevent accidental repeat booking
    state.qtySingle = 0; state.qtyDouble = 0; state.time = null;
    renderQty(); loadSlots();
  }
});

// Default to the visitor's browser language when it's one we support.
(function initLang(){
  const b = (navigator.language || 'da').slice(0,2).toLowerCase();
  state.lang = ['da','de','en'].includes(b) ? b : 'da';
})();
loadConfig().then(applyLang);
