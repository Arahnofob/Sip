import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, computeStats, dayKey, goalFor, weekStart } from '../server/stats.js';
import { drankMessage } from '../server/messages.js';

const TZ = 'Europe/Kyiv';
// Wednesday 2026-11-18, 12:00 Kyiv time (UTC+2 in winter)
const NOW = Date.parse('2026-11-18T10:00:00Z');
const at = (key, hour = 12) => Date.parse(`${key}T${String(hour - 2).padStart(2, '0')}:00:00Z`);

const member = (id, goal = 2000) => ({ id, name: id, tz: TZ, goals: [{ since: 0, ml: goal }] });

function room(entries, members = [member('a'), member('b')]) {
  return { members, entries: entries.map(([memberId, key, ml, hour], i) => ({ id: String(i), memberId, ml, ts: at(key, hour) })) };
}

test('date helpers', () => {
  assert.equal(dayKey(Date.parse('2026-11-18T22:30:00Z'), TZ), '2026-11-19'); // already tomorrow in Kyiv
  assert.equal(dayKey(Date.parse('2026-11-18T22:30:00Z'), 'UTC'), '2026-11-18');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(weekStart('2026-11-18'), '2026-11-16'); // Wednesday -> Monday
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // Sunday -> Monday
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
});

test('streak counts consecutive goal days and stays alive before today is done', () => {
  const r = room([
    ['a', '2026-11-15', 2000],
    ['a', '2026-11-16', 2500],
    ['a', '2026-11-17', 1000],
    ['a', '2026-11-17', 1000],
    ['a', '2026-11-18', 500], // today not done yet
  ]);
  const a = computeStats(r, NOW).members[0];
  assert.equal(a.todayMl, 500);
  assert.equal(a.streak, 3);
  assert.equal(a.bestStreak, 3);
  assert.equal(a.daysMet, 3);
  assert.equal(a.badges.streak_3, true);
  assert.equal(a.badges.streak_7, false);
});

test('a missed day breaks the streak', () => {
  const r = room([
    ['a', '2026-11-14', 2000],
    ['a', '2026-11-15', 2000],
    ['a', '2026-11-16', 2000],
    ['a', '2026-11-17', 300],
    ['a', '2026-11-18', 2000],
  ]);
  const a = computeStats(r, NOW).members[0];
  assert.equal(a.streak, 1);
  assert.equal(a.bestStreak, 3);
});

test('team streak, weekly crowns, leaderboard and last week winner', () => {
  const r = room([
    // last week (Mon 9 .. Sun 15): b drinks more
    ['a', '2026-11-10', 2000],
    ['b', '2026-11-10', 3000],
    // this week
    ['a', '2026-11-16', 2000],
    ['b', '2026-11-16', 2000],
    ['a', '2026-11-17', 2500],
    ['b', '2026-11-17', 2000],
    ['a', '2026-11-18', 600],
  ]);
  const s = computeStats(r, NOW);
  assert.equal(s.team.streak, 2);
  assert.equal(s.team.days, 3); // Nov 10, 16, 17
  assert.deepEqual(s.lastWeekWinners, ['b']);
  const [a, b] = s.members;
  assert.equal(a.crowns, 0);
  assert.equal(b.crowns, 1);
  assert.equal(b.badges.champion, true);
  assert.equal(b.badges.big_day, true);
  assert.equal(a.weekTotal, 5100);
  assert.equal(s.leaderboard[0].memberId, 'a');
  assert.equal(a.badges.team_spirit, true);
});

test('early bird badge uses local time', () => {
  const r = room([['a', '2026-11-18', 250, 7]]);
  assert.equal(computeStats(r, NOW).members[0].badges.early_bird, true);
  const r2 = room([['a', '2026-11-18', 250, 9]]);
  assert.equal(computeStats(r2, NOW).members[0].badges.early_bird, false);
});

test('changing the goal does not rewrite past days', () => {
  const m = member('a', 2000);
  m.goals.push({ since: at('2026-11-18', 9), ml: 3000 });
  assert.equal(goalFor(m, '2026-11-17'), 2000);
  assert.equal(goalFor(m, '2026-11-18'), 3000);
  const r = room(
    [
      ['a', '2026-11-16', 2000],
      ['a', '2026-11-17', 2000],
    ],
    [m, member('b')],
  );
  assert.equal(computeStats(r, NOW).members[0].streak, 2);
});

test('last7 always has seven days ending today', () => {
  const s = computeStats(room([]), NOW).members[0];
  assert.equal(s.last7.length, 7);
  assert.equal(s.last7[6].day, '2026-11-18');
  assert.equal(s.last7[0].day, '2026-11-12');
});

test('push wording: goal reached beats the normal message', () => {
  const msg = drankMessage({ lang: 'en', senderName: 'Dana', ml: 500, senderToday: 2100, recipientToday: 800, senderGoal: 2000, recipientGoal: 2000 });
  assert.match(msg.title, /goal/);
  const ahead = drankMessage({ lang: 'uk', senderName: 'Dana', ml: 250, senderToday: 1200, recipientToday: 800, senderGoal: 2000, recipientGoal: 2000 });
  assert.match(ahead.body, /попереду/);
});
