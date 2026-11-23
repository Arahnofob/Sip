import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDue } from '../server/scheduler.js';

const TZ = 'Europe/Kyiv'; // UTC+2 in winter
// Local Kyiv time -> timestamp
const at = (key, hour, min = 0) => Date.parse(`${key}T${String(hour - 2).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`);

const member = (id, name, extra = {}) => ({ id, name, tz: TZ, lang: 'en', glass: 250, goals: [{ since: 0, ml: 2000 }], createdAt: 0, ...extra });

function room(entries) {
  return {
    createdAt: at('2026-11-01', 10),
    members: [member('a', 'Andrii'), member('b', 'Rina')],
    entries: entries.map(([memberId, key, ml, hour = 10], i) => ({ id: String(i), memberId, ml, ts: at(key, hour) })),
    stake: { text: 'loser makes breakfast' },
  };
}

const kinds = (r, now) => collectDue(r, now).messages.map((m) => `${m.memberId}:${m.tag}`);

test('morning: round result once per day, phrased per person', () => {
  const r = room([
    ['a', '2026-11-18', 1500],
    ['b', '2026-11-18', 2300],
  ]);
  assert.deepEqual(kinds(r, at('2026-11-19', 8, 59)), []); // too early
  const { messages } = collectDue(r, at('2026-11-19', 9, 5));
  const toA = messages.find((m) => m.memberId === 'a');
  const toB = messages.find((m) => m.memberId === 'b');
  assert.match(toA.title, /Round 18 goes to Rina/);
  assert.match(toA.body, /2\.3 L vs 1\.5 L/);
  assert.match(toB.title, /Round 18 is yours/);
  assert.deepEqual(kinds(r, at('2026-11-19', 10)), []); // already sent today
});

test('Monday morning also announces the champion of the week with the stake', () => {
  const r = room([
    ['a', '2026-11-17', 3000], // last week (Mon 16 .. Sun 22)
    ['b', '2026-11-17', 1000],
    ['a', '2026-11-22', 1000], // Sunday = yesterday for Monday 23rd
    ['b', '2026-11-22', 1200],
  ]);
  const { messages } = collectDue(r, at('2026-11-23', 9, 30));
  const week = messages.filter((m) => m.tag === 'week');
  assert.equal(week.length, 2);
  assert.match(week.find((m) => m.memberId === 'a').title, /You're the champion/);
  assert.match(week.find((m) => m.memberId === 'b').body, /loser makes breakfast/);
});

test('midday: only if nothing logged yet', () => {
  const r = room([['b', '2026-11-19', 800, 9]]);
  const { messages } = collectDue(r, at('2026-11-19', 12, 1));
  const mid = messages.filter((m) => m.tag === 'reminder');
  assert.deepEqual(mid.map((m) => m.memberId), ['a']);
  assert.match(mid[0].body, /Rina already has 0\.8 L/);
  assert.equal(mid[0].drink, true);
});

test('evening: behind -> "leads by", short of goal -> "ml to your goal", done & ahead -> nothing', () => {
  const r = room([
    ['a', '2026-11-19', 2500],
    ['b', '2026-11-19', 1200],
  ]);
  const { messages } = collectDue(r, at('2026-11-19', 20, 10));
  const ev = messages.filter((m) => m.tag === 'reminder');
  assert.deepEqual(ev.map((m) => m.memberId), ['b']);
  assert.match(ev[0].title, /Andrii leads by 1300 ml/);
  assert.match(ev[0].body, /4h left in Round 19/);

  const r2 = room([['a', '2026-11-19', 1500]]);
  const msgs2 = collectDue(r2, at('2026-11-19', 21)).messages;
  assert.match(msgs2.find((m) => m.memberId === 'a').title, /500 ml to your goal/);
});

test('reminders can be switched off per person', () => {
  const r = room([]);
  r.members[0].reminders = false;
  assert.deepEqual(kinds(r, at('2026-11-19', 12, 30)), ['b:reminder']);
});
