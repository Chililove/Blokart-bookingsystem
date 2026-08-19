// Staff calendar behaviour: login, 10-minute auto-refresh, day view, closures,
// and creating bookings. Reads text from `S` (staff.translations.js).

let LANG = 'da';
try { const saved = localStorage.getItem('staffLang'); if (saved && S[saved]) LANG = saved; } catch (e) {}
function tr() { return S[LANG]; }

function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-t]').forEach(el => {
    const v = tr()[el.dataset.t];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('.langbar button').forEach(b => b.classList.toggle('active', b.dataset.lang === LANG));
  if (CFG) { buildDurations(); refresh(); } // re-render dynamic parts in new language
}

document.querySelectorAll('.langbar button').forEach(b => b.addEventListener('click', () => {
  LANG = b.dataset.lang;
  try { localStorage.setItem('staffLang', LANG); } catch (e) {}
  applyLang();
}));

let CODE = null, CFG = null, currentDay = null, pollTimer = null, countdownTimer = null, nextPoll = 0;
function authHeaders(extra={}) { return Object.assign({ 'x-staff-code': CODE, 'Content-Type':'application/json' }, extra); }
function todayStr(){ return new Date().toISOString().slice(0,10); }

function buildDurations() {
  const dur = document.getElementById('sDur');
  const cur = dur.value;
  dur.innerHTML = '';
  CFG.durationsMinutes.forEach(m => { const o=document.createElement('option'); o.value=m; o.textContent=(m/60)+' '+tr().hUnit; dur.appendChild(o); });
  if (cur) dur.value = cur;
}

// Login
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('code').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
async function login() {
  CODE = document.getElementById('code').value;
  const res = await fetch('/api/bookings/list?from=0&to=1', { headers: authHeaders() });
  if (res.status === 401) { document.getElementById('loginMsg').innerHTML = `<div class="notice bad">${tr().wrongCode}</div>`; return; }
  CFG = await (await fetch('/api/config')).json();
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  buildDurations();
  currentDay = todayStr();
  document.getElementById('day').value = currentDay;
  startPolling();
  refresh();
}

// Auto-refresh every 10 min
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, CFG.pollIntervalMs);
  nextPoll = Date.now() + CFG.pollIntervalMs;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const s = Math.max(0, Math.round((nextPoll - Date.now())/1000));
    const m = Math.floor(s/60), ss = String(s%60).padStart(2,'0');
    document.getElementById('liveMeta').textContent = tr().live(m, ss);
  }, 1000);
}

document.getElementById('refreshBtn').addEventListener('click', () => { nextPoll = Date.now()+CFG.pollIntervalMs; refresh(); });
document.getElementById('prevDay').addEventListener('click', () => { currentDay = shiftDay(-1); document.getElementById('day').value = currentDay; refresh(); });
document.getElementById('nextDay').addEventListener('click', () => { currentDay = shiftDay(1); document.getElementById('day').value = currentDay; refresh(); });
document.getElementById('day').addEventListener('change', e => { currentDay = e.target.value; refresh(); });
function shiftDay(n){ const d=new Date(currentDay+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

// Fetch and render
async function refresh() {
  if (!CFG) return;
  nextPoll = Date.now() + CFG.pollIntervalMs;
  const from = new Date(currentDay+'T00:00:00').getTime();
  const to   = new Date(currentDay+'T23:59:59').getTime();
  const [listRes, slotsRes] = await Promise.all([
    fetch(`/api/bookings/list?from=${from}&to=${to}`, { headers: authHeaders() }),
    fetch(`/api/slots?date=${currentDay}&durationMinutes=${CFG.durationsMinutes[0]}`)
  ]);
  const list = await listRes.json();
  const slots = await slotsRes.json();
  renderClosure(list.closures, slots.closure);
  renderCal(slots);
  renderBookings(list.bookings);
}

function renderClosure(closures, closure) {
  const area = document.getElementById('closureArea');
  if (closure) {
    area.innerHTML = `<div class="closed-banner">${tr().closedBanner(closure.reason)}
      <button class="btn btn-ghost" id="openDay" style="margin-left:10px;padding:6px 16px;">${tr().reopen}</button></div>`;
    document.getElementById('openDay').addEventListener('click', async () => {
      await fetch('/api/closures', { method:'DELETE', headers: authHeaders(), body: JSON.stringify({ date: currentDay }) });
      refresh();
    });
  } else {
    area.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <strong>${tr().closeLabel}</strong>
      <input id="reason" placeholder="${tr().reasonPh}" style="flex:1;min-width:220px;" />
      <button class="btn" id="closeDay" style="padding:9px 18px;">${tr().closeBtn}</button></div>
      <label style="font-weight:normal;margin-top:8px;display:flex;gap:8px;align-items:center;">
        <input type="checkbox" id="cancelExisting" style="width:auto;" />
        <span>${tr().cancelAllLabel}<span class="tip" tabindex="0">⚠<span class="tip-text">${tr().cancelAllTip}</span></span></span>
      </label>
      <div class="hint">${tr().closeHint}</div>`;
    document.getElementById('closeDay').addEventListener('click', async () => {
      const reason = document.getElementById('reason').value.trim();
      if (!reason) { alert(tr().needReason); return; }
      const cancelExisting = document.getElementById('cancelExisting').checked;
      if (cancelExisting && !confirm(tr().confirmCancelAll)) return;
      const r = await (await fetch('/api/closures', { method:'POST', headers: authHeaders(), body: JSON.stringify({ date: currentDay, reason, cancelExisting }) })).json();
      if (r.cancelledCount) alert(tr().closedDone(r.cancelledCount));
      refresh();
    });
  }
}

function renderCal(slots) {
  let html = `<table class="cal"><tr><th>${tr().colTime}</th><th>${tr().colSingleFree}</th><th>${tr().colDoubleFree}</th></tr>`;
  slots.slots.forEach(s => {
    const sc = s.singleAvailable < 1 ? 'free-zero' : 'free-good';
    const dc = s.doubleAvailable < 1 ? 'free-zero' : 'free-good';
    html += `<tr><td>${s.time}</td><td class="${sc}">${s.singleAvailable} / ${CFG.fleet.totalSingle}</td><td class="${dc}">${s.doubleAvailable} / ${CFG.fleet.permanentDouble + CFG.fleet.convertibleDouble}</td></tr>`;
  });
  html += '</table>';
  document.getElementById('calTable').innerHTML = html;
}

function renderBookings(bookings) {
  const el = document.getElementById('bookingList');
  if (!bookings.length) { el.innerHTML = `<p class="hint">${tr().noBookings}</p>`; return; }
  bookings.sort((a,b)=>a.start-b.start);
  let html = `<table class="cal"><tr><th>${tr().colTime}</th><th>${tr().colCart}</th><th>${tr().colCustomer}</th><th>${tr().colSource}</th><th></th></tr>`;
  bookings.forEach(b => {
    const t = new Date(b.start), e = new Date(b.end);
    const hhmm = d => String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    const statusTxt = b.status === 'pending_payment' ? ` <span class="pill online">${tr().awaiting}</span>` : '';
    html += `<tr>
      <td>${hhmm(t)}–${hhmm(e)}</td>
      <td><span class="pill ${b.type}">${b.type==='double'?tr().double:tr().single}</span></td>
      <td>${b.name}<br><a href="tel:${b.phone}">${b.phone}</a>${statusTxt}</td>
      <td><span class="pill ${b.source}">${b.source==='staff'?tr().shop:tr().online}</span></td>
      <td><button class="xbtn" data-id="${b.id}">${tr().cancel}</button></td>
    </tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
  el.querySelectorAll('.xbtn').forEach(btn => btn.addEventListener('click', async () => {
    const reason = prompt(tr().cancelPrompt, tr().cancelDefault);
    if (reason === null) return;
    await fetch('/api/bookings/cancel', { method:'POST', headers: authHeaders(), body: JSON.stringify({ id: Number(btn.dataset.id), reason }) });
    refresh();
  }));
}

// Create booking
document.getElementById('createBtn').addEventListener('click', async () => {
  const payload = {
    singleQty: Number(document.getElementById('sSingle').value) || 0,
    doubleQty: Number(document.getElementById('sDouble').value) || 0,
    date: currentDay,
    startTime: document.getElementById('sTime').value.trim(),
    durationMinutes: Number(document.getElementById('sDur').value),
    name: document.getElementById('sName').value,
    phone: document.getElementById('sPhone').value,
    note: document.getElementById('sNote').value,
    payment: 'shop',
  };
  const res = await fetch('/api/staff/bookings', { method:'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  const data = await res.json();
  const msg = document.getElementById('createMsg');
  if (data.ok) {
    const n = data.bookings ? data.bookings.length : 1;
    msg.innerHTML = `<div class="notice ok">${tr().createdN(n)}</div>`;
    ['sSingle','sDouble'].forEach(id => document.getElementById(id).value = '0');
    ['sTime','sName','sPhone','sNote'].forEach(id => document.getElementById(id).value = '');
    refresh();
  } else {
    msg.innerHTML = `<div class="notice bad">${data.error}</div>`;
  }
});

applyLang(); // localize static text on load
