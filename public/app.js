import { dict, BADGE_ICONS } from './i18n.js';

// ---------- small utilities ----------
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const ls = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {}
  },
};

const BADGE_ORDER = Object.keys(BADGE_ICONS);
const QUICK = [150, 250, 330, 500];
const GLASSES = [200, 250, 300, 330, 400, 500];
const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const guessLang = () => (/^(uk|ru|be)/i.test(navigator.language || '') ? 'uk' : 'en');

let lang = ls.get('lang') || guessLang();
let token = ls.get('token');
let state = null;
let tab = 'today';
let badgeFor = null;
let settingsDirty = false;
let prevTotals = null; // in-memory, to animate hits as they land
const lastPct = new Map(); // previous bar widths, so bars grow instead of jumping

const t = (key, ...args) => {
  const v = (dict[lang] || dict.uk)[key] ?? dict.uk[key];
  return typeof v === 'function' ? v(...args) : v;
};
const locale = () => (lang === 'uk' ? 'uk-UA' : 'en-GB');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtL = (ml) => (ml / 1000).toLocaleString(locale(), { maximumFractionDigits: 2 });
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  $toast.hidden = false;
  requestAnimationFrame(() => $toast.classList.add('show'));
  if (action)
    $toast.querySelector('button').onclick = () => {
      hideToast();
      action.run();
    };
  toastTimer = setTimeout(hideToast, action ? 5000 : 2600);
}
function hideToast() {
  $toast.classList.remove('show');
  setTimeout(() => ($toast.hidden = true), 250);
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    // This device was logged out (maybe from another device): stop its notifications too.
    try {
      const sub = await (await swReg())?.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {}
    await setToken(null);
    state = null;
    prevTotals = null;
    events?.close();
    boot();
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error, status: res.status });
  return data;
}

function showError(err) {
  if (err?.code === 'offline') toast(t('offline'));
  else if (err?.code === 'room_not_found') toast(t('roomNotFound'));
  else if (err?.code === 'bad_login_code') toast(t('badLoginCode'));
  else if (err?.code === 'too_many_attempts') toast(t('tooManyAttempts'));
  else toast(t('error'));
}

// The service worker reads the token from Cache Storage for the "Hit back" notification action.
async function setToken(v) {
  token = v;
  ls.set('token', v);
  try {
    const cache = await caches.open('sip-auth');
    if (v) await cache.put('/__token', new Response(v));
    else await cache.delete('/__token');
  } catch {}
}

function setLang(v) {
  lang = v === 'en' ? 'en' : 'uk';
  ls.set('lang', lang);
  document.documentElement.lang = lang;
  document.title = t('appName');
}

// "YYYY-MM-DD" in a time zone, and whole days between two such keys.
function dayKeyIn(ts, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ---------- components ----------
function avatar(m, size = '') {
  const initial = [...(m?.name || '?')][0].toUpperCase();
  return `<span class="avatar ${size}" style="--c:${m?.color || '#666'}">${esc(initial)}</span>`;
}

/** A skewed fighting-game power bar that grows from its last width. */
function powerBar(key, pct, side = 'left') {
  const from = lastPct.has(key) ? lastPct.get(key) : 0;
  lastPct.set(key, pct);
  const w = (p) => `${clamp(p, 0, 1) * 100}%`;
  return `<div class="pbar ${side} ${pct >= 1 ? 'full' : ''}"><i data-to="${w(pct)}" style="width:${w(from)}"></i></div>`;
}

function animateBars() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of $app.querySelectorAll('[data-to]')) {
        if (el.classList.contains('tug-spark')) el.style.left = el.dataset.to;
        else el.style.width = el.dataset.to;
      }
    }),
  );
}

const memberById = (id) => state.room.members.find((m) => m.id === id);
const statsById = (id) => state.stats.members.find((s) => s.memberId === id);
const others = () => state.room.members.filter((m) => m.id !== state.me.id);
const inviteLink = () => `${location.origin}/?join=${state.room.code}`;

// ---------- onboarding ----------
function goalOptions(selected = 2000) {
  const opts = [];
  for (let ml = 1000; ml <= 4000; ml += 250) opts.push(`<option value="${ml}" ${ml === selected ? 'selected' : ''}>${fmtL(ml)} ${t('lUnit')}</option>`);
  return opts.join('');
}

function langSwitch() {
  return `<div class="lang-switch" role="group" aria-label="Language">
    <button type="button" data-lang="uk" class="${lang === 'uk' ? 'on' : ''}">УКР</button>
    <button type="button" data-lang="en" class="${lang === 'en' ? 'on' : ''}">ENG</button>
  </div>`;
}
function bindLangSwitch(rerender) {
  for (const b of $app.querySelectorAll('[data-lang]'))
    b.onclick = () => {
      setLang(b.dataset.lang);
      rerender();
    };
}

function profileFields() {
  return `
    <label class="field"><span>${t('yourName')}</span>
      <input name="name" required maxlength="24" autocomplete="given-name" placeholder="${esc(t('namePh'))}"></label>
    <label class="field"><span>${t('dailyGoal')}</span>
      <select name="goal">${goalOptions()}</select></label>`;
}

function renderWelcome(prefillCode = '') {
  $app.innerHTML = `
  <main class="onboard">
    ${langSwitch()}
    <div class="hero">
      <img src="/icons/icon-192.png" alt="" class="hero-icon">
      <p class="kicker">${t('subtitle')}</p>
      <h1>${t('appName')}</h1>
      <p class="tagline">${t('tagline')}</p>
    </div>
    <form class="card stack" id="create">
      ${profileFields()}
      <button class="btn primary big" type="submit">${t('create')}</button>
    </form>
    <details class="card" ${prefillCode ? 'open' : ''}>
      <summary>${t('haveCode')}</summary>
      <form id="code" class="row">
        <input name="code" required placeholder="${esc(t('codePh'))}" value="${esc(prefillCode)}" autocapitalize="off" autocomplete="off">
        <button class="btn" type="submit">${t('join')}</button>
      </form>
    </details>
  </main>`;
  bindLangSwitch(() => renderWelcome());
  $app.querySelector('#create').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.submitter.disabled = true;
    try {
      const { token: tok } = await api('/api/rooms', { method: 'POST', body: { name: f.get('name'), goal: Number(f.get('goal')), tz: browserTz(), lang } });
      await setToken(tok);
      tab = 'today';
      await enterApp();
    } catch (err) {
      showError(err);
      e.submitter.disabled = false;
    }
  };
  $app.querySelector('#code').onsubmit = (e) => {
    e.preventDefault();
    const raw = String(new FormData(e.target).get('code')).trim();
    const m = raw.match(/join=([a-z0-9]+)/i);
    renderJoin((m ? m[1] : raw).toLowerCase());
  };
}

async function renderJoin(code) {
  let info;
  try {
    info = await api(`/api/join/${encodeURIComponent(code)}`);
  } catch (err) {
    showError(err);
    history.replaceState(null, '', '/');
    return renderWelcome();
  }
  const names = info.members.map((m) => esc(m.name)).join(' & ');
  $app.innerHTML = `
  <main class="onboard">
    ${langSwitch()}
    <div class="hero">
      <div class="hero-vs">${info.members.map((m) => avatar(m, 'xl')).join('')}${
        info.members.length === 1 ? '<span class="vs-badge small">VS</span><span class="avatar xl mystery">?</span>' : ''
      }</div>
      <h1 class="h2">${t('joinTitle', names, info.members.length)}</h1>
    </div>
    ${
      info.full
        ? ''
        : `<form class="card stack" id="join">
      <h2>${t('joinAsNew')}</h2>
      ${profileFields()}
      <button class="btn primary big" type="submit">${t('joinBtn')}</button>
    </form>`
    }
    <details class="card" ${info.full ? 'open' : ''}>
      <summary>${t('imAlready')}</summary>
      <form class="stack" id="relogin">
        <div class="field"><span>${t('whoAreYou')}</span>
          <div class="chips">${info.members
            .map((m) => `<label class="chip radio"><input type="radio" name="memberId" value="${esc(m.id)}" required><span>${esc(m.name)}</span></label>`)
            .join('')}</div>
        </div>
        <label class="field"><span>${t('loginCodeLabel')}</span>
          <input name="loginCode" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" maxlength="12"></label>
        <p class="hint">${t('loginCodeHint')}</p>
        <button class="btn" type="submit">${t('loginBtn')}</button>
      </form>
    </details>
    <button type="button" class="btn ghost" id="back">${t('back')}</button>
  </main>`;
  bindLangSwitch(() => renderJoin(code));
  const finish = async (body, btn) => {
    btn.disabled = true;
    try {
      const { token: tok } = await api(`/api/join/${encodeURIComponent(code)}`, { method: 'POST', body });
      await setToken(tok);
      history.replaceState(null, '', '/');
      tab = 'today';
      await enterApp();
    } catch (err) {
      showError(err);
      btn.disabled = false;
    }
  };
  const form = $app.querySelector('#join');
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      finish({ name: f.get('name'), goal: Number(f.get('goal')), tz: browserTz(), lang }, e.submitter);
    };
  const relogin = $app.querySelector('#relogin');
  relogin.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(relogin);
    if (!f.get('memberId')) return toast(t('pickYourself'));
    finish({ memberId: f.get('memberId'), loginCode: f.get('loginCode') }, e.submitter);
  };
  $app.querySelector('#back').onclick = () => {
    history.replaceState(null, '', '/');
    renderWelcome();
  };
}

// ---------- state ----------
async function loadState() {
  state = await api('/api/state');
  if (state.me.lang && state.me.lang !== lang) setLang(state.me.lang);
  if (state.me.tz !== browserTz()) api('/api/me', { method: 'PATCH', body: { tz: browserTz() } }).catch(() => {});
  return { overtakes: detectOvertakes(state), hits: detectHits(state), badges: detectBadges(state) };
}

function detectHits(st) {
  const now = Object.fromEntries(st.stats.members.map((s) => [s.memberId, s.todayMl]));
  const hits = [];
  if (prevTotals) {
    for (const [id, ml] of Object.entries(now)) {
      if (prevTotals[id] !== undefined && ml > prevTotals[id]) hits.push({ id, ml: ml - prevTotals[id] });
    }
  }
  prevTotals = now;
  return hits;
}

// We remember the totals this device last saw (in localStorage), so an overtake that
// happened while the app was closed still plays when you open it.
function detectOvertakes(st) {
  const mine = st.stats.members.find((s) => s.memberId === st.me.id);
  const scope = `${st.room.code}:${st.me.id}:${mine.today}`;
  const now = Object.fromEntries(st.stats.members.map((s) => [s.memberId, s.todayMl]));
  let prev = null;
  try {
    const saved = JSON.parse(ls.get('seenTotals') || 'null');
    if (saved?.scope === scope) prev = saved.totals;
  } catch {}
  ls.set('seenTotals', JSON.stringify({ scope, totals: now }));
  if (!prev) return [];
  const events = [];
  for (const w of Object.keys(now)) {
    for (const l of Object.keys(now)) {
      if (w === l || !(w in prev) || !(l in prev)) continue;
      // w drank, was level or behind l (who had drunk something), and is now ahead.
      if (now[w] > prev[w] && prev[l] > 0 && prev[w] <= prev[l] && now[w] > now[l]) {
        events.push({ winner: w, loser: l, w: now[w], l: now[l] });
      }
    }
  }
  return events;
}

async function enterApp() {
  let fx;
  try {
    fx = await loadState();
  } catch {
    if (!token) return;
    $app.innerHTML = `<main class="onboard"><div class="card stack center"><p>${t('offline')}</p><button class="btn primary" id="retry">↻</button></div></main>`;
    $app.querySelector('#retry').onclick = enterApp;
    return;
  }
  render();
  connectEvents();
  syncPush();
  playEffects(fx);
}

function render() {
  if (!state) return;
  const tabs = [
    ['today', '⚔️', t('today')],
    ['stats', '🏆', t('stats')],
    ['settings', '⚙️', t('settings')],
  ];
  $app.innerHTML = `
    <header class="top">
      <div class="brand"><img src="/icons/icon-192.png" alt=""><span>${t('appName')}</span></div>
      <div class="top-avatars">${state.room.members.map((m) => avatar(m, 'sm')).join('')}</div>
    </header>
    <main class="view" id="view"></main>
    <nav class="tabs">${tabs
      .map(
        ([k, icon, label]) =>
          `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-current="${tab === k ? 'page' : 'false'}"><span class="ti">${icon}</span>${label}</button>`,
      )
      .join('')}</nav>`;
  for (const b of $app.querySelectorAll('[data-tab]'))
    b.onclick = () => {
      tab = b.dataset.tab;
      settingsDirty = false;
      render();
      window.scrollTo(0, 0);
    };
  const view = $app.querySelector('#view');
  if (tab === 'today') renderToday(view);
  else if (tab === 'stats') renderStats(view);
  else renderSettings(view);
}

// ---------- the arena (today) ----------
function fighter(m, side, leading) {
  const s = statsById(m.id);
  const pct = s.goal ? s.todayMl / s.goal : 0;
  const isMe = m.id === state.me.id;
  return `
    <div class="fighter ${side} ${isMe ? 'me' : ''}" data-id="${esc(m.id)}" style="--c:${m.color}">
      <div class="f-avatar">${avatar(m, 'xl')}${leading ? '<i class="f-crown" aria-hidden="true">👑</i>' : ''}</div>
      <div class="f-name">${esc(m.name)}${isMe ? ` <small>${t('you')}</small>` : ''}</div>
      <div class="f-ml"><b>${fmtL(s.todayMl)}</b><small> / ${fmtL(s.goal)} ${t('lUnit')}</small></div>
      ${powerBar(m.id, pct, side)}
      <div class="f-meta"><span class="${pct >= 1 ? 'ko' : ''}">${pct >= 1 ? 'MAX' : `${Math.round(pct * 100)}%`}</span>${s.streak ? `<span title="${esc(t('streak'))}">🔥${s.streak}</span>` : ''}</div>
    </div>`;
}

function mysteryFighter() {
  return `
    <div class="fighter right mystery">
      <div class="f-avatar"><span class="avatar xl mystery">?</span></div>
      <div class="f-name">${t('opponent')}</div>
      <div class="f-ml"><small>${t('waiting')}</small></div>
      <div class="pbar right"><i></i></div>
    </div>`;
}

function arena() {
  const me = state.me;
  const meM = memberById(me.id);
  const opp = others();
  const myStats = statsById(me.id);
  const round = Math.max(1, daysBetween(dayKeyIn(state.room.createdAt || Date.now(), me.tz), myStats.today) + 1);
  const top = `<div class="arena-top"><span class="round">${t('round', round)}</span></div>`;

  if (opp.length >= 2) {
    // Battle royale: everyone ranked by today's total.
    const ranked = [...state.room.members].sort((a, b) => statsById(b.id).todayMl - statsById(a.id).todayMl);
    return `<section class="arena royale" style="--cl:${meM.color};--cr:${ranked[0].color}">${top}
      <ol>${ranked
        .map((m, i) => {
          const s = statsById(m.id);
          return `<li class="fighter ${m.id === me.id ? 'me' : ''}" data-id="${esc(m.id)}" style="--c:${m.color}">
            <span class="rank">${i + 1}</span><div class="f-avatar">${avatar(m, 'sm')}</div>
            <div class="r-body"><div class="r-top"><span class="f-name">${esc(m.name)}</span><b>${fmtL(s.todayMl)} ${t('lUnit')}</b></div>
            ${powerBar(m.id, s.goal ? s.todayMl / s.goal : 0)}</div></li>`;
        })
        .join('')}</ol></section>`;
  }

  const other = opp[0];
  const a = myStats.todayMl;
  const b = other ? statsById(other.id).todayMl : 0;
  let verdict;
  if (!other) verdict = t('inviteVerdict');
  else if (a === 0 && b === 0) verdict = t('verdictStart');
  else if (a === b) verdict = t('verdictTie');
  else if (a > b) verdict = t('verdictYou', a - b);
  else verdict = t('verdictThem', esc(other.name), b - a);

  const share = a + b > 0 ? a / (a + b) : 0.5;
  const fromShare = lastPct.has('tug') ? lastPct.get('tug') : 0.5;
  lastPct.set('tug', share);

  return `
    <section class="arena ${other && b > a ? 'losing' : ''}" style="--cl:${meM.color};--cr:${other ? other.color : '#555a78'}">
      ${top}
      <div class="versus">
        ${fighter(meM, 'left', other && a > b)}
        <div class="vs"><span class="vs-badge">VS</span></div>
        ${other ? fighter(other, 'right', b > a) : mysteryFighter()}
      </div>
      ${
        other
          ? `<div class="tug" aria-hidden="true">
              <i class="tug-l" data-to="${share * 100}%" style="width:${fromShare * 100}%"></i>
              <b class="tug-spark" data-to="${share * 100}%" style="left:${fromShare * 100}%">⚡</b>
            </div>`
          : ''
      }
      <p class="verdict">${verdict}</p>
    </section>`;
}

async function renderPushBanner(el) {
  const status = await pushStatus();
  if (status === 'on' || !el.isConnected) return (el.innerHTML = '');
  if (status === 'ios') {
    el.innerHTML = `<div class="banner info">📲 ${t('iosHint')}</div>`;
  } else if (status === 'off') {
    el.innerHTML = `<div class="banner">
      <div><b>🔔 ${t('enableNotifs')}</b><p>${t('enableNotifsText')}</p></div>
      <button class="btn primary" type="button">${t('enable')}</button></div>`;
    el.querySelector('button').onclick = async () => {
      await enablePush();
      renderPushBanner(el);
    };
  } else el.innerHTML = '';
}

function renderToday(view) {
  const me = state.me;
  const partners = others();
  const noPushPartners = partners.filter((p) => !state.pushReady.includes(p.id));
  const quick = QUICK.filter((ml) => ml !== me.glass);
  const behind = partners.some((p) => statsById(p.id).todayMl > statsById(me.id).todayMl);

  view.innerHTML = `
    ${arena()}

    <section class="add">
      <button class="attack ${behind ? 'rage' : ''}" type="button" data-ml="${me.glass}">
        <span class="atk-label">💦 ${t('attack')}</span><span class="atk-ml">+${me.glass} ${t('ml')}</span>
      </button>
      <div class="combo">
        ${quick.map((ml) => `<button class="chip" type="button" data-ml="${ml}">+${ml}</button>`).join('')}
        <button class="chip" type="button" id="custom">${t('custom')}</button>
      </div>
    </section>

    ${
      partners.length
        ? `<button class="btn taunt" type="button" id="nudge">${t('taunt')}</button>
           ${noPushPartners.length ? `<p class="hint">🔕 ${noPushPartners.map((p) => t('partnerNoNotifs', esc(p.name))).join('<br>')}</p>` : ''}`
        : inviteCard()
    }

    <div id="push-banner"></div>

    <section class="card log">
      <h2>${t('fightLog')}</h2>
      ${
        state.todayEntries.length
          ? `<ul>${state.todayEntries
              .map((e) => {
                const m = memberById(e.memberId);
                const time = new Date(e.ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
                return `<li style="--c:${m?.color || '#666'}">${avatar(m, 'sm')}<span class="who">${esc(m?.name)}</span><span class="ml">💥 +${e.ml}</span><time>${time}</time>${
                  e.memberId === me.id ? `<button class="x" type="button" data-del="${esc(e.id)}" aria-label="✕">✕</button>` : '<span class="x"></span>'
                }</li>`;
              })
              .join('')}</ul>`
          : `<p class="empty">${t('emptyLog')}</p>`
      }
    </section>`;

  animateBars();
  renderPushBanner(view.querySelector('#push-banner'));
  bindInvite(view);

  for (const b of view.querySelectorAll('[data-ml]')) b.onclick = () => addWater(Number(b.dataset.ml), b);
  view.querySelector('#custom').onclick = () => {
    const v = prompt(t('customPrompt'), String(me.glass));
    const ml = Math.round(Number(v));
    if (ml >= 10 && ml <= 3000) addWater(ml);
  };
  const nudge = view.querySelector('#nudge');
  if (nudge)
    nudge.onclick = async () => {
      nudge.disabled = true;
      try {
        await api('/api/nudge', { method: 'POST' });
        toast(t('taunted'));
      } catch (err) {
        err.status === 429 ? toast(t('tauntTooSoon')) : showError(err);
      }
      setTimeout(() => (nudge.disabled = false), 1500);
    };
  for (const b of view.querySelectorAll('[data-del]'))
    b.onclick = () => {
      b.disabled = true;
      deleteEntry(b.dataset.del).finally(() => (b.disabled = false));
    };
}

async function addWater(ml, btn) {
  if (btn) btn.disabled = true;
  navigator.vibrate?.(25);
  const before = statsById(state.me.id);
  try {
    const { entry } = await api('/api/entries', { method: 'POST', body: { ml } });
    await refresh();
    const after = statsById(state.me.id);
    if (before.todayMl < before.goal && after.todayMl >= after.goal) {
      celebrate(['🏆', '💥', '🔥', '💧', '⚡']);
      toast(t('goalDone'));
    } else {
      toast(t('added', ml), {
        label: t('undo'),
        run: () => deleteEntry(entry.id),
      });
    }
  } catch (err) {
    showError(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// If the server no longer has the entry (say it restarted mid-change and this screen
// was showing stale data), deleting it is already done: just re-sync.
async function deleteEntry(id) {
  try {
    await api(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    if (err.status !== 404) {
      showError(err);
      await refresh().catch(() => {});
      return;
    }
  }
  await refresh().catch(() => {});
  toast(t('removed'));
}

// Achievements this device has already celebrated, per person (in localStorage). The first time a
// device sees someone, their existing achievements are recorded quietly; only new ones pop up.
function detectBadges(st) {
  const key = `seenBadges:${st.room.code}:${st.me.id}`;
  let seen = null;
  try {
    seen = JSON.parse(ls.get(key) || 'null');
  } catch {}
  const earned = Object.fromEntries(st.stats.members.map((s) => [s.memberId, Object.keys(s.badges).filter((b) => s.badges[b])]));
  const fresh = [];
  if (seen) {
    for (const [id, list] of Object.entries(earned)) {
      if (!seen[id]) continue;
      for (const b of list) if (!seen[id].includes(b)) fresh.push({ memberId: id, badge: b });
    }
  }
  const merged = { ...(seen || {}) };
  for (const [id, list] of Object.entries(earned)) merged[id] = [...new Set([...(merged[id] || []), ...list])];
  ls.set(key, JSON.stringify(merged));
  return fresh;
}

// ---------- effects ----------
// Full-screen moments (overtakes, achievements) play one after another, never on top of each other.
let modalChain = Promise.resolve();
function queueModal(open) {
  modalChain = modalChain.then(() => new Promise((resolve) => open(resolve))).catch(() => {});
}

function playEffects(fx) {
  if (!fx) return;
  if (tab === 'today') playHits(fx.hits);
  setTimeout(
    () => {
      showOvertakes(fx.overtakes);
      showBadges(fx.badges);
    },
    fx.hits?.length ? 650 : 0,
  );
}

function showBadges(fresh) {
  if (!fresh?.length || !state) return;
  const me = state.me.id;
  const mine = fresh.filter((f) => f.memberId === me).map((f) => f.badge);
  if (mine.length) queueModal((done) => achievementOverlay(mine, done));
  // Partner's new achievements: a toast (team ones are already in my own popup).
  for (const f of fresh) {
    if (f.memberId === me || mine.includes(f.badge)) continue;
    const name = memberById(f.memberId)?.name;
    queueModal((done) => {
      toast(t('partnerAchv', name, BADGE_ICONS[f.badge], t('badge')[f.badge][0]));
      setTimeout(done, 1200);
    });
  }
}

function achievementOverlay(badges, done) {
  const el = document.createElement('div');
  el.className = 'achv';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'achv-title');
  el.innerHTML = `
    <div class="achv-card ${badges.length > 1 ? 'many' : ''}">
      <div class="achv-rays" aria-hidden="true"></div>
      <p class="achv-kicker" id="achv-title">${badges.length > 1 ? t('achvMany', badges.length) : t('achvUnlocked')}</p>
      <ul class="achv-list">${badges
        .map((b, i) => {
          const [name, desc] = t('badge')[b];
          return `<li style="--i:${i}"><div class="achv-badge">${BADGE_ICONS[b]}</div><h2>${esc(name)}</h2><p>${esc(desc)}</p></li>`;
        })
        .join('')}</ul>
      <button class="btn primary big" type="button" data-close>${t('achvBtn')}</button>
    </div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    el.classList.add('closing');
    setTimeout(() => {
      el.remove();
      done?.();
    }, 220);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) close();
  });
  document.body.appendChild(el);
  el.querySelector('.btn').focus({ preventScroll: true });
  navigator.vibrate?.([30, 50, 30, 50, 200]);
  setTimeout(() => celebrate([...badges.map((b) => BADGE_ICONS[b]), '✨', '🏅']), 350);
}

/** Damage numbers fly off whoever drank; everyone else takes the hit. */
function playHits(hits) {
  if (!hits?.length) return;
  const arenaEl = $app.querySelector('.arena');
  for (const h of hits) {
    const striker = $app.querySelector(`.fighter[data-id="${CSS.escape(h.id)}"]`);
    if (!striker) continue;
    const m = memberById(h.id);
    const r = striker.querySelector('.f-avatar').getBoundingClientRect();
    const dmg = document.createElement('div');
    dmg.className = 'dmg';
    dmg.textContent = `+${h.ml}`;
    dmg.style.left = `${r.left + r.width / 2}px`;
    dmg.style.top = `${r.top + 6}px`;
    dmg.style.setProperty('--c', m?.color || '#fff');
    document.body.appendChild(dmg);
    setTimeout(() => dmg.remove(), 1300);
    striker.classList.add('striking');
    for (const o of $app.querySelectorAll('.fighter[data-id]')) if (o !== striker) o.classList.add('hit');
  }
  arenaEl?.classList.add('impact');
  if (hits.some((h) => h.id !== state.me.id)) navigator.vibrate?.([60, 40, 60]);
}

function celebrate(bits = ['💥', '🔥', '💧', '⚡', '🏆']) {
  if (reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    s.textContent = bits[i % bits.length];
    s.style.left = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 0.6}s`;
    s.style.fontSize = `${16 + Math.random() * 18}px`;
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3200);
}

function showOvertakes(events) {
  if (!events?.length || !state) return;
  const me = state.me.id;
  // The pass that matters most to me: someone passing me, then me passing someone.
  const ev = events.find((e) => e.loser === me) || events.find((e) => e.winner === me);
  if (ev) return queueModal((done) => overtakeOverlay(ev, done));
  const e = events[events.length - 1];
  toast(t('overtakeOthers', memberById(e.winner)?.name, memberById(e.loser)?.name));
}

function overtakeOverlay(ev, done) {
  const winner = memberById(ev.winner);
  const loser = memberById(ev.loser);
  if (!winner || !loser) return done?.();
  const iWon = ev.winner === state.me.id;
  const other = iWon ? loser : winner;

  const el = document.createElement('div');
  el.className = `overtake ${iWon ? 'win' : 'lose'}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'ot-title');
  el.innerHTML = `
    <div class="ot-card">
      <div class="ot-race" aria-hidden="true">
        <div class="ot-track"></div>
        <div class="ot-finish">🏁</div>
        <div class="ot-runner ot-loser" style="--c:${loser.color}">${avatar(loser, 'lg')}<b class="ot-num">${ev.l}</b></div>
        <div class="ot-runner ot-winner" style="--c:${winner.color}"><i class="ot-trail"></i><i class="ot-crown">👑</i>${avatar(winner, 'lg')}<b class="ot-num">${ev.w}</b></div>
      </div>
      <h2 id="ot-title">${iWon ? t('overtakeWinTitle') : t('overtakeLoseTitle')}</h2>
      <p>${iWon ? t('overtakeWinText', esc(other.name), ev.w, ev.l) : t('overtakeLoseText', esc(other.name), ev.w, ev.l)}</p>
      <div class="ot-actions">${
        iWon
          ? `<button class="btn primary big" type="button" data-close>${t('yay')}</button>`
          : `<button class="btn primary big" type="button" data-strike>${t('strikeBack', state.me.glass)}</button>
             <button class="btn ghost" type="button" data-close>${t('later')}</button>`
      }</div>
    </div>`;

  let timer;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    el.classList.add('closing');
    setTimeout(() => {
      el.remove();
      done?.();
    }, 220);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) close();
  });
  const strike = el.querySelector('[data-strike]');
  if (strike)
    strike.onclick = () => {
      close();
      addWater(state.me.glass);
    };

  document.body.appendChild(el);
  el.querySelector('.btn').focus({ preventScroll: true });
  navigator.vibrate?.(iWon ? [40, 60, 40, 60, 120] : [250]);
  if (iWon) {
    setTimeout(() => celebrate(['🏁', '💥', '⚡', '🔥', '👑']), 900);
    timer = setTimeout(close, 6000);
  }
}

function inviteCard() {
  return `<section class="card invite stack">
    <h2>🥊 ${t('invitePartner')}</h2>
    <p>${t('inviteText')}</p>
    <div class="link-box"><code>${esc(inviteLink())}</code></div>
    <div class="row">
      <button class="btn" type="button" data-copy>${t('copyLink')}</button>
      ${navigator.share ? `<button class="btn primary" type="button" data-share>${t('share')}</button>` : ''}
    </div>
  </section>`;
}

function bindInvite(root) {
  const copy = root.querySelector('[data-copy]');
  if (copy)
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(inviteLink());
        toast(t('copied'));
      } catch {
        prompt('', inviteLink());
      }
    };
  const share = root.querySelector('[data-share]');
  if (share) share.onclick = () => navigator.share({ title: t('appName'), text: t('shareMsg'), url: inviteLink() }).catch(() => {});
}

// ---------- trophies / stats ----------
function scoreboard() {
  const members = state.room.members;
  if (members.length < 2) return '';
  const me = memberById(state.me.id);
  if (members.length === 2) {
    const other = others()[0];
    const a = statsById(me.id);
    const b = statsById(other.id);
    const side = (m) => `<div class="sb-f" style="--c:${m.color}">${avatar(m, 'lg')}<span>${esc(m.name)}</span></div>`;
    return `<section class="card scoreboard" style="--cl:${me.color};--cr:${other.color}">
      <h2>${t('scoreboard')}</h2>
      <div class="sb-row">
        ${side(me)}
        <div class="sb-score"><b class="l">${a.rounds}</b><i>:</i><b class="r">${b.rounds}</b></div>
        ${side(other)}
      </div>
      <p class="sb-label">${t('roundsWon')}</p>
      <div class="sb-mini"><span>${t('weeksWon')}</span><b><span class="l">${a.crowns}</span> : <span class="r">${b.crowns}</span></b></div>
    </section>`;
  }
  const ranked = [...members].sort((x, y) => statsById(y.id).rounds - statsById(x.id).rounds);
  return `<section class="card scoreboard">
    <h2>${t('scoreboard')}</h2>
    <ol class="sb-list">${ranked
      .map((m) => {
        const s = statsById(m.id);
        return `<li style="--c:${m.color}">${avatar(m, 'sm')}<span>${esc(m.name)}</span><b>${s.rounds}</b><small>👑 ${s.crowns}</small></li>`;
      })
      .join('')}</ol>
    <p class="sb-label">${t('roundsWon')}</p>
  </section>`;
}

function renderStats(view) {
  const st = state.stats;
  const members = state.room.members;
  const maxWeek = Math.max(1, ...st.leaderboard.map((l) => l.weekTotal));
  const winners = st.lastWeekWinners || [];
  if (!badgeFor || !memberById(badgeFor)) badgeFor = state.me.id;

  const allLast7 = st.members.flatMap((s) => s.last7.flatMap((d) => [d.ml, d.goal]));
  const chartMax = Math.max(1, ...allLast7);
  const days = st.members[0].last7.map((d) => d.day);
  const myLast7 = statsById(state.me.id).last7;

  const bs = statsById(badgeFor);
  const earned = BADGE_ORDER.filter((b) => bs.badges[b]).length;

  view.innerHTML = `
    ${scoreboard()}

    <section class="card">
      <h2>${t('thisWeek')}</h2>
      <ol class="leader">${st.leaderboard
        .map((l, i) => {
          const m = memberById(l.memberId);
          return `<li style="--c:${m.color}">
            <span class="rank">${i === 0 && l.weekTotal > 0 && members.length > 1 ? '🥇' : i + 1}</span>
            ${avatar(m, 'sm')}
            <div class="lb-body"><div class="lb-top"><span>${esc(m.name)}${winners.includes(m.id) ? ' 👑' : ''}</span><b>${fmtL(l.weekTotal)} ${t('lUnit')}</b></div>
            <div class="pbar"><i style="width:${(l.weekTotal / maxWeek) * 100}%"></i></div></div>
          </li>`;
        })
        .join('')}</ol>
      ${
        winners.length === 1
          ? `<p class="hint">${t('lastWeekWinner', esc(memberById(winners[0])?.name))}</p>`
          : winners.length > 1
            ? `<p class="hint">${t('lastWeekTie')}</p>`
            : ''
      }
    </section>

    ${
      members.length > 1
        ? `<section class="card team">
        <div class="team-big"><span class="emoji">🤝</span><div><b>${t('streakDays', st.team.streak)}</b><span>${t('teamStreak')}</span></div></div>
        <div class="team-small"><b>${st.team.days}</b><span>${t('teamDays')}</span></div>
      </section>`
        : ''
    }

    <section class="card">
      <h2>${t('last7')}</h2>
      <div class="chart" role="img" aria-label="${esc(t('last7'))}">
        ${days
          .map((day, di) => {
            const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' });
            const goalH = (myLast7[di].goal / chartMax) * 100;
            return `<div class="col">
              <div class="bars">
                <span class="goal-line" style="bottom:${goalH}%"></span>
                ${st.members
                  .map((s) => {
                    const m = memberById(s.memberId);
                    const d = s.last7[di];
                    return `<span class="b ${d.ml >= d.goal ? 'met' : ''}" style="--c:${m.color};height:${(d.ml / chartMax) * 100}%" title="${esc(m.name)}: ${fmtL(d.ml)} ${t('lUnit')}"></span>`;
                  })
                  .join('')}
              </div>
              <span class="day ${di === 6 ? 'today' : ''}">${esc(label)}</span>
            </div>`;
          })
          .join('')}
      </div>
      <div class="legend">${members.map((m) => `<span><i style="--c:${m.color}"></i>${esc(m.name)}</span>`).join('')}<span><i class="dash"></i>${t('dailyGoal')}</span></div>
    </section>

    <section class="stat-grid">${st.members
      .map((s) => {
        const m = memberById(s.memberId);
        return `<div class="card stat" style="--c:${m.color}">
          <div class="stat-head">${avatar(m, 'sm')}<b>${esc(m.name)}</b></div>
          <dl>
            <div><dt>🔥 ${t('streak')}</dt><dd>${s.streak}</dd></div>
            <div><dt>⭐ ${t('bestStreak')}</dt><dd>${s.bestStreak}</dd></div>
            <div><dt>🥊 ${t('rounds')}</dt><dd>${s.rounds}</dd></div>
            <div><dt>👑 ${t('crowns')}</dt><dd>${s.crowns}</dd></div>
            <div class="wide"><dt>💧 ${t('lifetime')}</dt><dd>${fmtL(s.lifetime)} ${t('lUnit')}</dd></div>
          </dl>
        </div>`;
      })
      .join('')}</section>

    <section class="card">
      <div class="badges-head">
        <h2>${t('badges')} <small>${earned}/${BADGE_ORDER.length}</small></h2>
        ${
          members.length > 1
            ? `<div class="seg">${members.map((m) => `<button type="button" data-badge-for="${esc(m.id)}" class="${m.id === badgeFor ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>`
            : ''
        }
      </div>
      <ul class="badges">${BADGE_ORDER.map((b) => {
        const [name, desc] = t('badge')[b];
        const on = bs.badges[b];
        return `<li class="${on ? 'on' : ''}"><span class="bi">${on ? BADGE_ICONS[b] : '🔒'}</span><b>${esc(name)}</b><small>${esc(desc)}</small></li>`;
      }).join('')}</ul>
    </section>`;

  for (const b of view.querySelectorAll('[data-badge-for]'))
    b.onclick = () => {
      badgeFor = b.dataset.badgeFor;
      renderStats(view);
    };
}

// ---------- settings ----------
async function renderSettings(view) {
  const me = state.me;
  const glasses = [...new Set([...GLASSES, me.glass])].sort((a, b) => a - b);
  view.innerHTML = `
    <form class="card stack" id="profile">
      <h2>${t('profile')}</h2>
      <label class="field"><span>${t('yourName')}</span><input name="name" maxlength="24" required value="${esc(me.name)}"></label>
      <label class="field"><span>${t('dailyGoal')}</span><select name="goal">${goalOptions(me.goal)}</select></label>
      <div class="field"><span>${t('glassSize')}</span>
        <div class="chips">${glasses
          .map((g) => `<label class="chip radio"><input type="radio" name="glass" value="${g}" ${g === me.glass ? 'checked' : ''}><span>${g} ${t('ml')}</span></label>`)
          .join('')}</div>
      </div>
      <div class="field"><span>${t('language')}</span>
        <div class="chips">
          <label class="chip radio"><input type="radio" name="lang" value="uk" ${me.lang === 'uk' ? 'checked' : ''}><span>Українська</span></label>
          <label class="chip radio"><input type="radio" name="lang" value="en" ${me.lang === 'en' ? 'checked' : ''}><span>English</span></label>
        </div>
      </div>
      <button class="btn primary" type="submit">${t('save')}</button>
    </form>

    <section class="card stack" id="notif">
      <h2>🔔 ${t('notifications')}</h2>
      <div id="notif-body" class="stack"></div>
    </section>

    <section class="card stack" id="devices">
      <h2>📱 ${t('devicesTitle')}</h2>
      <p>${t('devicesCount', me.devices || 1)}</p>
      <div class="field"><span>${t('loginCodeLabel')}</span>
        <div class="login-code"><code>${esc(me.loginCode || '')}</code></div>
      </div>
      <p class="hint">${t('loginCodeInfo')}</p>
      ${(me.devices || 1) > 1 ? `<button class="btn" type="button" id="logout-others">${t('logoutOthers')}</button>` : ''}
    </section>

    ${inviteCard()}
    <p class="hint center">${t('inviteCode')}: <code>${esc(state.room.code)}</code></p>

    <section class="card stack">
      <h2>${t('members')}</h2>
      <ul class="members">${state.room.members
        .map(
          (m) =>
            `<li>${avatar(m, 'sm')} <span>${esc(m.name)}</span> <small>${fmtL(m.goal)} ${t('lUnit')}</small> ${state.pushReady.includes(m.id) ? '🔔' : '🔕'}</li>`,
        )
        .join('')}</ul>
    </section>

    ${!isStandalone() ? `<p class="hint center">📲 ${isIOS ? t('iosHint') : t('installHint')}</p>` : ''}

    <button class="btn ghost danger" type="button" id="logout">${t('logout')}</button>`;

  bindInvite(view);
  const form = view.querySelector('#profile');
  form.oninput = () => (settingsDirty = true);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      state = await api('/api/me', {
        method: 'PATCH',
        body: { name: f.get('name'), goal: Number(f.get('goal')), glass: Number(f.get('glass')), lang: f.get('lang') },
      });
      setLang(state.me.lang);
      settingsDirty = false;
      render();
      toast(t('saved'));
    } catch (err) {
      showError(err);
    }
  };
  const lo = view.querySelector('#logout-others');
  if (lo)
    lo.onclick = async () => {
      if (!confirm(t('logoutOthersConfirm'))) return;
      try {
        state = await api('/api/logout-others', { method: 'POST' });
        await syncPush();
        await refresh();
        toast(t('loggedOutOthers'));
      } catch (err) {
        showError(err);
      }
    };
  view.querySelector('#logout').onclick = async () => {
    if (!confirm(t('logoutConfirm'))) return;
    await disablePush().catch(() => {});
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    await setToken(null);
    state = null;
    prevTotals = null;
    events?.close();
    renderWelcome();
  };
  renderNotifSettings(view.querySelector('#notif-body'));
}

async function renderNotifSettings(el) {
  const status = await pushStatus();
  if (!el.isConnected) return;
  if (status === 'on') {
    el.innerHTML = `<p>✅ ${t('notifsOn')}</p><div class="row"><button class="btn" type="button" id="test">${t('testNotif')}</button><button class="btn ghost" type="button" id="off">${t('disable')}</button></div>`;
    el.querySelector('#test').onclick = async () => {
      await api('/api/push/test', { method: 'POST' }).catch(showError);
      toast(t('testSent'));
    };
    el.querySelector('#off').onclick = async () => {
      await disablePush();
      renderNotifSettings(el);
    };
  } else if (status === 'off') {
    el.innerHTML = `<p>${t('notifsOff')}</p><button class="btn primary" type="button" id="on">${t('enable')}</button>`;
    el.querySelector('#on').onclick = async () => {
      await enablePush();
      renderNotifSettings(el);
    };
  } else {
    el.innerHTML = `<p>${status === 'ios' ? t('iosHint') : status === 'denied' ? t('notifsDenied') : t('notifsUnsupported')}</p>`;
  }
}

// ---------- push ----------
function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function swReg() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.ready;
}

async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS && !isStandalone() ? 'ios' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await swReg();
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast(t('notifsDenied'));
    const reg = await swReg();
    const key = b64ToBytes(state.vapidPublicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // If the server's key changed, the old subscription is useless.
      const old = sub.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
      if (old && old.toString() !== key.toString()) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    await refresh();
  } catch (err) {
    console.error(err);
    showError(err);
  }
}

async function disablePush() {
  const reg = await swReg();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
  await refresh().catch(() => {});
}

// Make sure the server knows this device's subscription belongs to the person logged in here.
async function syncPush() {
  try {
    if ((await pushStatus()) !== 'on') return;
    const sub = await (await swReg()).pushManager.getSubscription();
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  } catch {}
}

// ---------- live updates ----------
let events = null;
let refreshTimer = null;

async function refresh() {
  if (!token) return;
  const fx = await loadState();
  if (!(tab === 'settings' && settingsDirty)) render(); // don't clobber what someone is typing
  playEffects(fx);
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(() => {}), 150);
}

function connectEvents() {
  events?.close();
  if (!token || !('EventSource' in window)) return;
  events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener('update', scheduleRefresh);
  // Re-sync whenever the live connection (re)opens, e.g. after the server restarts.
  events.addEventListener('open', scheduleRefresh);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state) scheduleRefresh();
});
setInterval(() => {
  if (document.visibilityState === 'visible' && state) scheduleRefresh();
}, 60_000);

// ---------- boot ----------
async function boot() {
  setLang(lang);
  const joinCode = new URLSearchParams(location.search).get('join');
  if (token) {
    if (joinCode) history.replaceState(null, '', '/');
    await setToken(token); // keep the service worker copy in sync
    return enterApp();
  }
  if (joinCode) return renderJoin(joinCode.toLowerCase());
  renderWelcome();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
