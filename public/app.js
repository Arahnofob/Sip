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
const lastPct = new Map();

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

let toastTimer;
function toast(msg, action) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  $toast.hidden = false;
  requestAnimationFrame(() => $toast.classList.add('show'));
  if (action) $toast.querySelector('button').onclick = () => {
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
    await setToken(null);
    boot();
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error, status: res.status });
  return data;
}

function showError(err) {
  if (err?.code === 'offline') toast(t('offline'));
  else if (err?.code === 'room_not_found') toast(t('roomNotFound'));
  else toast(t('error'));
}

// The service worker reads the token from Cache Storage for the "Me too" notification action.
async function setToken(v) {
  token = v;
  ls.set('token', v);
  try {
    const cache = await caches.open('kovtok-auth');
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

// ---------- components ----------
let glassSeq = 0;
function glassSVG(pct, color, key) {
  const uid = `g${++glassSeq}`;
  const from = lastPct.has(key) ? lastPct.get(key) : 0;
  const y = (p) => 8 + (1 - clamp(p, 0, 1)) * 118;
  return `
  <svg class="glass" viewBox="0 0 100 132" aria-hidden="true" style="--c:${color}">
    <defs><clipPath id="${uid}"><path d="M10 8 L90 8 L81 121 Q80 127 74 127 L26 127 Q20 127 19 121 Z"/></clipPath></defs>
    <g clip-path="url(#${uid})">
      <rect x="0" y="0" width="100" height="132" class="glass-bg"/>
      <g class="water" data-key="${esc(key)}" data-to="${y(pct)}" style="transform:translateY(${y(from)}px)">
        <path class="wave w2" d="M0 0 Q12.5 -5 25 0 T50 0 T75 0 T100 0 T125 0 T150 0 T175 0 T200 0 V140 H0 Z"/>
        <path class="wave w1" d="M0 0 Q12.5 -4 25 0 T50 0 T75 0 T100 0 T125 0 T150 0 T175 0 T200 0 V140 H0 Z"/>
      </g>
    </g>
    <path class="glass-rim" d="M10 8 L90 8 L81 121 Q80 127 74 127 L26 127 Q20 127 19 121 Z"/>
    <path class="glass-shine" d="M20 18 L26 108"/>
  </svg>`;
}

function animateGlasses() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const g of $app.querySelectorAll('.water[data-to]')) g.style.transform = `translateY(${g.dataset.to}px)`;
    }),
  );
}

function avatar(m, size = '') {
  const initial = [...(m?.name || '?')][0].toUpperCase();
  return `<span class="avatar ${size}" style="--c:${m?.color || '#888'}">${esc(initial)}</span>`;
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
  for (const b of $app.querySelectorAll('[data-lang]')) b.onclick = () => {
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
      <img src="/icons/icon.svg" alt="" class="hero-icon">
      <h1>${t('appName')}</h1>
      <p>${t('tagline')}</p>
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
      <div class="hero-avatars">${info.members.map((m) => avatar(m, 'lg')).join('')}</div>
      <h1 class="h2">${t('joinTitle', names)}</h1>
    </div>
    ${
      info.full
        ? ''
        : `<form class="card stack" id="join">
      <h3>${t('joinAsNew')}</h3>
      ${profileFields()}
      <button class="btn primary big" type="submit">${t('join')}</button>
    </form>`
    }
    <div class="card stack">
      <h3>${t('imAlready')}</h3>
      <div class="chips">${info.members.map((m) => `<button type="button" class="chip person" data-id="${esc(m.id)}">${avatar(m, 'sm')} ${esc(m.name)}</button>`).join('')}</div>
    </div>
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
  for (const b of $app.querySelectorAll('.person')) b.onclick = () => finish({ memberId: b.dataset.id }, b);
  $app.querySelector('#back').onclick = () => {
    history.replaceState(null, '', '/');
    renderWelcome();
  };
}

// ---------- main app ----------
async function loadState() {
  state = await api('/api/state');
  if (state.me.lang && state.me.lang !== lang) setLang(state.me.lang);
  if (state.me.tz !== browserTz()) api('/api/me', { method: 'PATCH', body: { tz: browserTz() } }).catch(() => {});
}

async function enterApp() {
  try {
    await loadState();
  } catch (err) {
    if (!token) return;
    $app.innerHTML = `<main class="onboard"><div class="card stack center"><p>${t('offline')}</p><button class="btn primary" id="retry">↻</button></div></main>`;
    $app.querySelector('#retry').onclick = enterApp;
    return;
  }
  render();
  connectEvents();
  syncPush();
}

function render() {
  if (!state) return;
  const tabs = [
    ['today', '💧', t('today')],
    ['stats', '🏆', t('stats')],
    ['settings', '⚙️', t('settings')],
  ];
  $app.innerHTML = `
    <header class="top">
      <div class="brand"><img src="/icons/icon.svg" alt=""><span>${t('appName')}</span></div>
      <div class="top-avatars">${state.room.members.map((m) => avatar(m, 'sm')).join('')}</div>
    </header>
    <main class="view" id="view"></main>
    <nav class="tabs">${tabs
      .map(([k, icon, label]) => `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-current="${tab === k ? 'page' : 'false'}"><span class="ti">${icon}</span>${label}</button>`)
      .join('')}</nav>`;
  for (const b of $app.querySelectorAll('[data-tab]')) b.onclick = () => {
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

function personCard(m) {
  const s = statsById(m.id);
  const pct = s.goal ? s.todayMl / s.goal : 0;
  const isMe = m.id === state.me.id;
  const html = `
    <div class="person-card ${isMe ? 'me' : ''} ${pct >= 1 ? 'done' : ''}" style="--c:${m.color}">
      ${glassSVG(pct, m.color, m.id)}
      <div class="pc-name">${esc(m.name)}${isMe ? ` <small>(${t('you')})</small>` : ''}</div>
      <div class="pc-amount"><b>${fmtL(s.todayMl)}</b> / ${fmtL(s.goal)} ${t('lUnit')}</div>
      <div class="pc-meta">${pct >= 1 ? `<span class="pill ok">✓ ${Math.round(pct * 100)}%</span>` : `<span class="pill">${Math.round(pct * 100)}%</span>`}
        ${s.streak ? `<span class="pill fire" title="${esc(t('streak'))}">🔥 ${s.streak}</span>` : ''}</div>
    </div>`;
  lastPct.set(m.id, pct);
  return html;
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
  const members = [state.room.members.find((m) => m.id === me.id), ...partners];
  const noPushPartners = partners.filter((p) => !state.pushReady.includes(p.id));
  const quick = [...new Set([...QUICK])].filter((ml) => ml !== me.glass);

  view.innerHTML = `
    <section class="people ${members.length > 2 ? 'many' : ''}">${members.map(personCard).join('')}</section>

    <section class="add">
      <button class="btn primary huge" type="button" data-ml="${me.glass}">+ ${me.glass} ${t('ml')} 💧</button>
      <div class="chips">
        ${quick.map((ml) => `<button class="chip" type="button" data-ml="${ml}">+${ml}</button>`).join('')}
        <button class="chip" type="button" id="custom">${t('custom')}…</button>
      </div>
    </section>

    ${
      partners.length
        ? `<button class="btn soft nudge" type="button" id="nudge">${partners.length === 1 ? t('nudge', esc(partners[0].name)) : t('nudgeAll')}</button>
           ${noPushPartners.length ? `<p class="hint">🔕 ${noPushPartners.map((p) => t('partnerNoNotifs', esc(p.name))).join('<br>')}</p>` : ''}`
        : inviteCard()
    }

    <div id="push-banner"></div>

    <section class="card log">
      <h2>${t('todayLog')}</h2>
      ${
        state.todayEntries.length
          ? `<ul>${state.todayEntries
              .map((e) => {
                const m = memberById(e.memberId);
                const time = new Date(e.ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
                return `<li>${avatar(m, 'sm')}<span class="who">${esc(m?.name)}</span><span class="ml">+${e.ml} ${t('ml')}</span><time>${time}</time>${
                  e.memberId === me.id ? `<button class="x" type="button" data-del="${esc(e.id)}" aria-label="✕">✕</button>` : '<span class="x"></span>'
                }</li>`;
              })
              .join('')}</ul>`
          : `<p class="empty">${t('emptyLog')}</p>`
      }
    </section>`;

  animateGlasses();
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
        toast(t('nudged'));
      } catch (err) {
        err.status === 429 ? toast(t('nudgeTooSoon')) : showError(err);
      }
      setTimeout(() => (nudge.disabled = false), 1500);
    };
  for (const b of view.querySelectorAll('[data-del]')) b.onclick = async () => {
    try {
      await api(`/api/entries/${b.dataset.del}`, { method: 'DELETE' });
      await refresh();
      toast(t('removed'));
    } catch (err) {
      showError(err);
    }
  };
}

async function addWater(ml, btn) {
  if (btn) {
    btn.disabled = true;
    btn.classList.add('pop');
  }
  const before = statsById(state.me.id);
  try {
    const { entry } = await api('/api/entries', { method: 'POST', body: { ml } });
    await refresh();
    const after = statsById(state.me.id);
    if (before.todayMl < before.goal && after.todayMl >= after.goal) {
      celebrate();
      toast(t('goalDone'));
    } else {
      toast(t('added', ml), {
        label: t('undo'),
        run: async () => {
          await api(`/api/entries/${entry.id}`, { method: 'DELETE' }).catch(showError);
          refresh();
        },
      });
    }
  } catch (err) {
    showError(err);
  } finally {
    if (btn) {
      btn.disabled = false;
      setTimeout(() => btn.classList.remove('pop'), 300);
    }
  }
}

function celebrate() {
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const bits = ['💧', '💙', '✨', '🎉', '💦'];
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

function inviteCard() {
  return `<section class="card invite stack">
    <h2>💌 ${t('invitePartner')}</h2>
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

// ---------- rewards / stats ----------
function renderStats(view) {
  const st = state.stats;
  const members = state.room.members;
  const maxWeek = Math.max(1, ...st.leaderboard.map((l) => l.weekTotal));
  const winners = st.lastWeekWinners || [];
  if (!badgeFor || !memberById(badgeFor)) badgeFor = state.me.id;

  const allLast7 = st.members.flatMap((s) => s.last7.flatMap((d) => [d.ml, d.goal]));
  const chartMax = Math.max(1, ...allLast7);
  const days = st.members[0].last7.map((d) => d.day);
  const meIndex = st.members.findIndex((s) => s.memberId === state.me.id);
  const myLast7 = st.members[meIndex].last7;

  const bs = statsById(badgeFor);
  const earned = BADGE_ORDER.filter((b) => bs.badges[b]).length;

  view.innerHTML = `
    ${
      members.length > 1
        ? `<section class="card team">
        <div class="team-big"><span class="emoji">💞</span><div><b>${t('streakDays', st.team.streak)}</b><span>${t('teamStreak')}</span></div></div>
        <div class="team-small"><b>${st.team.days}</b><span>${t('teamDays')}</span></div>
      </section>`
        : ''
    }

    <section class="card">
      <h2>${t('thisWeek')}</h2>
      <ol class="leader">${st.leaderboard
        .map((l, i) => {
          const m = memberById(l.memberId);
          return `<li style="--c:${m.color}">
            <span class="rank">${i === 0 && l.weekTotal > 0 && members.length > 1 ? '🥇' : i + 1}</span>
            ${avatar(m, 'sm')}
            <div class="lb-body"><div class="lb-top"><span>${esc(m.name)}${winners.includes(m.id) ? ' 👑' : ''}</span><b>${fmtL(l.weekTotal)} ${t('lUnit')}</b></div>
            <div class="bar"><i style="width:${(l.weekTotal / maxWeek) * 100}%"></i></div></div>
          </li>`;
        })
        .join('')}</ol>
      ${winners.length === 1 ? `<p class="hint">${t('lastWeekWinner', esc(memberById(winners[0])?.name))}</p>` : winners.length > 1 ? `<p class="hint">${t('lastWeekTie')}</p>` : ''}
    </section>

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
            <div><dt>👑 ${t('crowns')}</dt><dd>${s.crowns}</dd></div>
            <div><dt>💧 ${t('lifetime')}</dt><dd>${fmtL(s.lifetime)} ${t('lUnit')}</dd></div>
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

  for (const b of view.querySelectorAll('[data-badge-for]')) b.onclick = () => {
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
  view.querySelector('#logout').onclick = async () => {
    if (!confirm(t('logoutConfirm'))) return;
    await disablePush().catch(() => {});
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    await setToken(null);
    state = null;
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
  await loadState();
  if (tab === 'settings' && settingsDirty) return; // don't clobber what someone is typing
  render();
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
