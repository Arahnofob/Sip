import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import webpush from 'web-push';
import { Store } from './store.js';
import { computeStats, currentGoal, dayKey, isValidTimeZone, todayTotal } from './stats.js';
import { drankMessage, nudgeMessage, texts } from './messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_MEMBERS = 6;
const COLORS = ['#3b8cff', '#a259ff', '#22c38e', '#ff9f43', '#ff4f8b', '#19c6d1'];
const LANGS = ['uk', 'en'];

const store = new Store(DATA_DIR);
const db = store.data;

// ---------- Web Push (VAPID keys are generated once and kept in the data file) ----------
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  db.vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
} else if (!db.vapid) {
  db.vapid = webpush.generateVAPIDKeys();
  store.flush();
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:water-together@example.com', db.vapid.publicKey, db.vapid.privateKey);

// ---------- helpers ----------
const id = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const newCode = () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(10)) s += alphabet[b % alphabet.length];
  return s;
};

// Personal code for logging in as yourself on another device (shown only in your own Settings).
const LOGIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newLoginCode = () => {
  let s = '';
  for (const b of crypto.randomBytes(6)) s += LOGIN_ALPHABET[b % LOGIN_ALPHABET.length];
  return s;
};
const normalizeLoginCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sameCode = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanName(v) {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
  if (!name) throw new HttpError(400, 'name_required');
  return name;
}
const cleanInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const cleanTz = (v) => (isValidTimeZone(v) ? v : 'UTC');
const cleanLang = (v) => (LANGS.includes(v) ? v : 'uk');

function newMember(room, body) {
  if (room.members.length >= MAX_MEMBERS) throw new HttpError(400, 'room_full');
  const used = new Set(room.members.map((m) => m.color));
  const member = {
    id: id(),
    name: cleanName(body.name),
    color: COLORS.find((c) => !used.has(c)) || COLORS[0],
    tz: cleanTz(body.tz),
    lang: cleanLang(body.lang),
    glass: cleanInt(body.glass, 50, 1500, 250),
    goals: [{ since: Date.now(), ml: cleanInt(body.goal, 500, 6000, 2000) }],
    loginCode: newLoginCode(),
    createdAt: Date.now(),
  };
  room.members.push(member);
  return member;
}

// Members created before login codes existed get one now.
let migrated = false;
for (const room of Object.values(db.rooms)) {
  for (const m of room.members) {
    if (!m.loginCode) {
      m.loginCode = newLoginCode();
      migrated = true;
    }
  }
}
if (migrated) store.flush();

function newSession(room, member) {
  const token = id(24);
  db.sessions[token] = { roomId: room.id, memberId: member.id, createdAt: Date.now() };
  return token;
}

function authFrom(token) {
  const s = token && db.sessions[token];
  if (!s) return null;
  const room = db.rooms[s.roomId];
  const me = room?.members.find((m) => m.id === s.memberId);
  return room && me ? { room, me, token } : null;
}

function auth(req, _res, next) {
  const header = req.get('authorization') || '';
  const ctx = authFrom(header.startsWith('Bearer ') ? header.slice(7) : null);
  if (!ctx) throw new HttpError(401, 'unauthorized');
  req.ctx = ctx;
  next();
}

const devicesOf = (member) => Object.values(db.sessions).filter((s) => s.memberId === member.id).length;

// Drop push subscriptions that were registered by sessions that no longer exist.
function pruneSubscriptions(member) {
  const subs = db.subscriptions[member.id] || [];
  db.subscriptions[member.id] = subs.filter((s) => !s.token || db.sessions[s.token]);
}

const publicMember = (m) => ({ id: m.id, name: m.name, color: m.color, goal: currentGoal(m) });

function statePayload(room, me) {
  const now = Date.now();
  const byId = new Map(room.members.map((m) => [m.id, m]));
  const todayEntries = room.entries
    .filter((e) => {
      const owner = byId.get(e.memberId);
      return owner && dayKey(e.ts, owner.tz) === dayKey(now, owner.tz);
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 100);
  return {
    me: {
      id: me.id,
      name: me.name,
      color: me.color,
      goal: currentGoal(me),
      glass: me.glass,
      tz: me.tz,
      lang: me.lang,
      loginCode: me.loginCode,
      devices: devicesOf(me),
    },
    room: { code: room.code, createdAt: room.createdAt, members: room.members.map(publicMember) },
    todayEntries,
    stats: computeStats(room, now),
    pushReady: room.members.filter((m) => (db.subscriptions[m.id] || []).length > 0).map((m) => m.id),
    vapidPublicKey: db.vapid.publicKey,
  };
}

// ---------- live updates (Server-Sent Events) ----------
const streams = new Map(); // roomId -> Set<res>

function broadcast(roomId) {
  for (const res of streams.get(roomId) || []) res.write(`event: update\ndata: ${Date.now()}\n\n`);
}

// ---------- push ----------
async function pushTo(member, payload) {
  const subs = db.subscriptions[member.id] || [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: 'high' });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.subscriptions[member.id] = (db.subscriptions[member.id] || []).filter((s) => s.endpoint !== sub.endpoint);
          store.save();
        } else {
          console.warn('push failed', err.statusCode || '', err.body || err.message);
        }
      }
    }),
  );
}

function notifyOthers(room, sender, build) {
  for (const m of room.members) {
    if (m.id === sender.id) continue;
    const msg = build(m);
    pushTo(m, {
      ...msg,
      tag: `water-${sender.id}`,
      url: '/',
      glass: m.glass,
      action: texts(m.lang).drinkAction(m.glass),
    }).catch(() => {});
  }
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

app.get('/healthz', (_req, res) => res.send('ok'));

app.post('/api/rooms', (req, res) => {
  const room = { id: id(), code: newCode(), createdAt: Date.now(), members: [], entries: [], lastNudge: {} };
  const me = newMember(room, req.body);
  db.rooms[room.id] = room;
  const token = newSession(room, me);
  store.save();
  res.json({ token });
});

function roomByCode(code) {
  const room = Object.values(db.rooms).find((r) => r.code === String(code || '').toLowerCase());
  if (!room) throw new HttpError(404, 'room_not_found');
  return room;
}

// Who is already in this space (shown on the invite page).
app.get('/api/join/:code', (req, res) => {
  const room = roomByCode(req.params.code);
  res.json({ members: room.members.map((m) => ({ id: m.id, name: m.name, color: m.color })), full: room.members.length >= MAX_MEMBERS });
});

// Wrong login codes per member: at most 10 tries per 15 minutes.
const failedLogins = new Map();

app.post('/api/join/:code', (req, res) => {
  const room = roomByCode(req.params.code);
  let me;
  if (req.body.memberId) {
    // Logging in as someone who already joined (e.g. on a second device) needs their personal code,
    // so nobody with the invite link can act as someone else.
    me = room.members.find((m) => m.id === req.body.memberId);
    if (!me) throw new HttpError(404, 'member_not_found');
    const now = Date.now();
    const f = failedLogins.get(me.id);
    const recent = f && now - f.since < 15 * 60_000 ? f : { n: 0, since: now };
    if (recent.n >= 10) throw new HttpError(429, 'too_many_attempts');
    if (!sameCode(normalizeLoginCode(req.body.loginCode), me.loginCode)) {
      failedLogins.set(me.id, { ...recent, n: recent.n + 1 });
      throw new HttpError(403, 'bad_login_code');
    }
    failedLogins.delete(me.id);
  } else {
    me = newMember(room, req.body);
  }
  const token = newSession(room, me);
  store.save();
  broadcast(room.id); // others see the new fighter / the new device count right away
  res.json({ token });
});

app.get('/api/state', auth, (req, res) => {
  res.json(statePayload(req.ctx.room, req.ctx.me));
});

app.post('/api/entries', auth, (req, res) => {
  const { room, me } = req.ctx;
  const ml = cleanInt(req.body.ml, 10, 3000, null);
  if (!ml) throw new HttpError(400, 'bad_amount');
  const entry = { id: id(), memberId: me.id, ml, ts: Date.now() };
  room.entries.push(entry);
  store.save();
  broadcast(room.id);

  const senderToday = todayTotal(room, me);
  notifyOthers(room, me, (m) =>
    drankMessage({
      lang: m.lang,
      senderName: me.name,
      ml,
      senderToday,
      recipientToday: todayTotal(room, m),
      senderGoal: currentGoal(me),
      recipientGoal: currentGoal(m),
    }),
  );
  res.json({ entry });
});

app.delete('/api/entries/:id', auth, (req, res) => {
  const { room, me } = req.ctx;
  const idx = room.entries.findIndex((e) => e.id === req.params.id && e.memberId === me.id);
  if (idx === -1) throw new HttpError(404, 'entry_not_found');
  room.entries.splice(idx, 1);
  store.save();
  broadcast(room.id);
  res.json({ ok: true });
});

app.post('/api/nudge', auth, (req, res) => {
  const { room, me } = req.ctx;
  room.lastNudge ||= {};
  const last = room.lastNudge[me.id] || 0;
  if (Date.now() - last < 60_000) throw new HttpError(429, 'too_soon');
  room.lastNudge[me.id] = Date.now();
  store.save();
  notifyOthers(room, me, (m) => nudgeMessage({ lang: m.lang, senderName: me.name }));
  res.json({ ok: true });
});

app.patch('/api/me', auth, (req, res) => {
  const { room, me } = req.ctx;
  const b = req.body || {};
  if (b.name !== undefined) me.name = cleanName(b.name);
  if (b.tz !== undefined) me.tz = cleanTz(b.tz);
  if (b.lang !== undefined) me.lang = cleanLang(b.lang);
  if (b.glass !== undefined) me.glass = cleanInt(b.glass, 50, 1500, me.glass);
  if (b.goal !== undefined) {
    const goal = cleanInt(b.goal, 500, 6000, null);
    if (!goal) throw new HttpError(400, 'bad_goal');
    if (goal !== currentGoal(me)) {
      // A goal change made today replaces today's earlier change instead of stacking up.
      const today = dayKey(Date.now(), me.tz);
      me.goals = me.goals.filter((g, i) => i === 0 || dayKey(g.since, me.tz) !== today);
      me.goals.push({ since: Date.now(), ml: goal });
    }
  }
  store.save();
  broadcast(room.id);
  res.json(statePayload(room, me));
});

app.post('/api/push/subscribe', auth, (req, res) => {
  const { me, room } = req.ctx;
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new HttpError(400, 'bad_subscription');
  const clean = {
    endpoint: String(sub.endpoint),
    keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) },
    token: req.ctx.token, // which login registered it, so logging that device out also stops its pushes
  };
  // An endpoint belongs to one browser; make sure only the current person on it receives pushes.
  for (const mid of Object.keys(db.subscriptions)) {
    db.subscriptions[mid] = db.subscriptions[mid].filter((s) => s.endpoint !== clean.endpoint);
  }
  (db.subscriptions[me.id] ||= []).push(clean);
  store.save();
  broadcast(room.id);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', auth, (req, res) => {
  const { me, room } = req.ctx;
  const endpoint = String(req.body?.endpoint || '');
  db.subscriptions[me.id] = (db.subscriptions[me.id] || []).filter((s) => s.endpoint !== endpoint);
  store.save();
  broadcast(room.id);
  res.json({ ok: true });
});

app.post('/api/push/test', auth, async (req, res) => {
  const t = texts(req.ctx.me.lang);
  await pushTo(req.ctx.me, { title: t.testTitle, body: t.testBody, tag: 'test', url: '/' });
  res.json({ ok: true });
});

app.post('/api/logout', auth, (req, res) => {
  delete db.sessions[req.ctx.token];
  pruneSubscriptions(req.ctx.me);
  store.save();
  res.json({ ok: true });
});

// Log out every other device that is logged in as me (and stop their notifications).
app.post('/api/logout-others', auth, (req, res) => {
  const { room, me, token } = req.ctx;
  for (const [tok, s] of Object.entries(db.sessions)) {
    if (s.memberId === me.id && tok !== token) delete db.sessions[tok];
  }
  // Keep only this device's notifications; it re-registers right after (older entries
  // don't record which device they belong to, so this is the only safe way to cut the rest).
  db.subscriptions[me.id] = (db.subscriptions[me.id] || []).filter((s) => s.token === token);
  store.save();
  broadcast(room.id);
  res.json(statePayload(room, me));
});

// EventSource can't send headers, so the token comes in the query string.
app.get('/api/events', (req, res) => {
  const ctx = authFrom(String(req.query.token || ''));
  if (!ctx) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const set = streams.get(ctx.room.id) || new Set();
  streams.set(ctx.room.id, set);
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
  });
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found')));

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, file) {
      if (file.endsWith('sw.js') || file.endsWith('.html') || file.endsWith('.webmanifest')) {
        res.set('Cache-Control', 'no-cache');
      }
    },
  }),
);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'server_error' : err.message });
});

const server = app.listen(PORT, () => console.log(`💧 Water Together running on http://localhost:${PORT}`));

function shutdown() {
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
