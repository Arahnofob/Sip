// Timed pushes, checked every minute. Each kind fires at most once per local day per person,
// inside a window (so a restart a bit after the hour still sends it):
//   09:00–12:00  yesterday's round result (+ on Mondays: champion of the week)
//   12:00–15:00  midday nudge if you haven't logged anything yet
//   20:00–22:00  evening "last chance" if you're behind or short of your goal
// Pure apart from the `room.sent` bookkeeping, so it's easy to test with a fake clock.

import { computeStats, dayKey, hourIn } from './stats.js';
import { eveningMessage, middayMessage, roundMessage, weekMessage } from './messages.js';

export const WINDOWS = { results: [9, 12], midday: [12, 15], evening: [20, 22] };

/** Returns { messages: [{ memberId, tag, drink, title, body }], changed } and marks what was sent. */
export function collectDue(room, now = Date.now()) {
  const messages = [];
  let changed = false;
  if (!room.members?.length) return { messages, changed };
  room.sent ||= {};
  const stats = computeStats(room, now);
  const statsOf = new Map(stats.members.map((s) => [s.memberId, s]));
  const nameOf = (id) => room.members.find((m) => m.id === id)?.name || '?';

  for (const m of room.members) {
    if (m.reminders === false) continue;
    const tz = m.tz || 'UTC';
    const hour = hourIn(now, tz);
    const today = dayKey(now, tz);
    const sent = (room.sent[m.id] ||= {});
    const mine = statsOf.get(m.id);
    const others = stats.members.filter((s) => s.memberId !== m.id);
    const leader = others.reduce((best, s) => (!best || s.todayMl > best.todayMl ? s : best), null);
    const due = (kind) => {
      const [from, to] = WINDOWS[kind];
      if (hour < from || hour >= to || sent[kind] === today) return false;
      sent[kind] = today;
      changed = true;
      return true;
    };

    if (due('results')) {
      const y = stats.yesterday;
      if (y?.counted) {
        const winners = y.winners;
        const tie = winners.length > 1 && winners.includes(m.id);
        const iWon = winners.length === 1 && winners[0] === m.id;
        const w = winners[0];
        messages.push({
          memberId: m.id,
          tag: 'round',
          ...roundMessage({ lang: m.lang, round: y.round, iWon, tie, winnerName: nameOf(w), winnerMl: y.totals[w], myMl: y.totals[m.id] || 0 }),
        });
      }
      const isMonday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
      const wk = stats.lastWeek;
      if (isMonday && wk?.winners.length) {
        const w = wk.winners[0];
        messages.push({
          memberId: m.id,
          tag: 'week',
          ...weekMessage({
            lang: m.lang,
            iWon: wk.winners.length === 1 && w === m.id,
            tie: wk.winners.length > 1 && wk.winners.includes(m.id),
            winnerName: nameOf(w),
            winnerMl: wk.totals[w],
            myMl: wk.totals[m.id] || 0,
            stake: room.stake?.text,
          }),
        });
      }
    }

    if (due('midday') && mine.todayMl === 0) {
      messages.push({
        memberId: m.id,
        tag: 'reminder',
        drink: true,
        ...middayMessage({ lang: m.lang, leaderName: leader ? nameOf(leader.memberId) : '', leaderMl: leader?.todayMl || 0 }),
      });
    }

    if (due('evening')) {
      const hoursLeft = 24 - hour;
      const round = stats.yesterday ? stats.yesterday.round + 1 : 1;
      if (leader && leader.todayMl > mine.todayMl) {
        messages.push({
          memberId: m.id,
          tag: 'reminder',
          drink: true,
          ...eveningMessage({ lang: m.lang, leaderName: nameOf(leader.memberId), diff: leader.todayMl - mine.todayMl, hoursLeft, round }),
        });
      } else if (mine.todayMl < mine.goal) {
        messages.push({
          memberId: m.id,
          tag: 'reminder',
          drink: true,
          ...eveningMessage({ lang: m.lang, left: mine.goal - mine.todayMl, hoursLeft, round }),
        });
      }
    }
  }
  return { messages, changed };
}
