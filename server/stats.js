// Pure functions that turn raw water entries into daily totals, streaks,
// weekly leaderboards and badges. No I/O here so it is easy to test.

const formatters = new Map();

function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      f = formatterFor('UTC');
    }
    formatters.set(tz, f);
  }
  return f;
}

function parts(ts, tz) {
  const out = {};
  for (const p of formatterFor(tz || 'UTC').formatToParts(new Date(ts))) out[p.type] = p.value;
  return out;
}

/** "YYYY-MM-DD" for a timestamp in the given IANA time zone. */
export function dayKey(ts, tz) {
  const p = parts(ts, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local hour (0-23) for a timestamp in the given time zone. */
export function hourIn(ts, tz) {
  return Number(parts(ts, tz).hour) % 24;
}

export function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Monday of the week containing `key`. */
export function weekStart(key) {
  const d = new Date(`${key}T00:00:00Z`);
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  return addDays(key, -mondayOffset);
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Goal (ml) that applied to a member on a given day, so changing your goal doesn't rewrite history. */
export function goalFor(member, key) {
  const goals = member.goals && member.goals.length ? member.goals : [{ since: 0, ml: 2000 }];
  let goal = goals[0].ml;
  for (const g of goals) {
    if (dayKey(g.since, member.tz) <= key) goal = g.ml;
  }
  return goal;
}

export function currentGoal(member) {
  const goals = member.goals || [];
  return goals.length ? goals[goals.length - 1].ml : 2000;
}

function dailyTotals(member, entries) {
  const totals = new Map();
  for (const e of entries) {
    if (e.memberId !== member.id) continue;
    const k = dayKey(e.ts, member.tz);
    totals.set(k, (totals.get(k) || 0) + e.ml);
  }
  return totals;
}

/** Longest run of consecutive day keys in a sorted array. */
function longestRun(sortedKeys) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of sortedKeys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

/**
 * Current streak: consecutive days with the goal met, ending today.
 * If today isn't done yet the streak is still "alive" and counts from yesterday.
 */
function currentStreak(today, isMet) {
  let k = isMet(today) ? today : addDays(today, -1);
  let n = 0;
  while (isMet(k)) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export const BADGES = [
  'first_drop',
  'first_goal',
  'early_bird',
  'streak_3',
  'streak_7',
  'big_day',
  'team_spirit',
  'champion',
  'streak_30',
  'team_week',
  'liters_100',
];

export function computeStats(room, now = Date.now()) {
  const members = room.members;
  const entries = room.entries;

  const perMember = members.map((m) => {
    const tz = m.tz || 'UTC';
    const today = dayKey(now, tz);
    const totals = dailyTotals(m, entries);
    const isMet = (k) => (totals.get(k) || 0) >= goalFor(m, k);
    const metDays = [...totals.keys()].filter(isMet).sort();

    const ws = weekStart(today);
    let weekTotal = 0;
    let lifetime = 0;
    let maxDay = 0;
    for (const [k, ml] of totals) {
      lifetime += ml;
      maxDay = Math.max(maxDay, ml);
      if (k >= ws && k <= today) weekTotal += ml;
    }

    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const k = addDays(today, -i);
      last7.push({ day: k, ml: totals.get(k) || 0, goal: goalFor(m, k) });
    }

    const earlyBird = entries.some((e) => e.memberId === m.id && hourIn(e.ts, tz) < 8);

    return {
      memberId: m.id,
      today,
      todayMl: totals.get(today) || 0,
      goal: currentGoal(m),
      streak: currentStreak(today, isMet),
      bestStreak: longestRun(metDays),
      daysMet: metDays.length,
      weekTotal,
      lifetime,
      maxDay,
      last7,
      earlyBird,
      totals,
      isMet,
    };
  });

  // Team: days on which everyone (2+ people) hit their goal.
  const team = { streak: 0, bestStreak: 0, days: 0 };
  if (perMember.length >= 2) {
    const allMet = (k) => perMember.every((s) => s.isMet(k));
    const candidate = [...perMember[0].totals.keys()].filter(allMet).sort();
    team.days = candidate.length;
    team.bestStreak = longestRun(candidate);
    team.streak = currentStreak(perMember[0].today, allMet);
  }

  // Weekly crowns: the biggest drinker of each finished week (ties share the crown).
  const crowns = Object.fromEntries(members.map((m) => [m.id, 0]));
  const weekly = new Map(); // weekStart -> Map(memberId -> ml)
  for (const s of perMember) {
    for (const [k, ml] of s.totals) {
      const w = weekStart(k);
      if (!weekly.has(w)) weekly.set(w, new Map());
      const wm = weekly.get(w);
      wm.set(s.memberId, (wm.get(s.memberId) || 0) + ml);
    }
  }
  const thisWeek = weekStart(perMember[0]?.today || dayKey(now, 'UTC'));
  const lastWeek = addDays(thisWeek, -7);
  let lastWeekWinners = [];
  for (const [w, wm] of weekly) {
    if (w >= thisWeek || members.length < 2) continue;
    const max = Math.max(...wm.values());
    if (max <= 0) continue;
    const winners = [...wm.entries()].filter(([, ml]) => ml === max).map(([id]) => id);
    for (const id of winners) if (id in crowns) crowns[id]++;
    if (w === lastWeek) lastWeekWinners = winners;
  }

  // Rounds: every finished day is a round, won by whoever drank the most (ties: nobody).
  // Only days after everyone had joined count, and a no-show loses the round.
  const rounds = Object.fromEntries(members.map((m) => [m.id, 0]));
  if (perMember.length >= 2) {
    const tz0 = members[0].tz || 'UTC';
    const start = dayKey(Math.max(...members.map((m) => m.createdAt || 0)), tz0);
    const today0 = perMember[0].today;
    const days = new Set(perMember.flatMap((s) => [...s.totals.keys()]));
    for (const k of days) {
      if (k < start || k >= today0) continue;
      const ml = perMember.map((s) => s.totals.get(k) || 0);
      const max = Math.max(...ml);
      if (max > 0 && ml.filter((v) => v === max).length === 1) rounds[perMember[ml.indexOf(max)].memberId]++;
    }
  }

  const result = perMember.map((s) => {
    const badges = {
      first_drop: s.lifetime > 0,
      first_goal: s.daysMet >= 1,
      early_bird: s.earlyBird,
      streak_3: s.bestStreak >= 3,
      streak_7: s.bestStreak >= 7,
      big_day: s.maxDay >= 3000,
      team_spirit: team.days >= 1,
      champion: crowns[s.memberId] >= 1,
      streak_30: s.bestStreak >= 30,
      team_week: team.bestStreak >= 7,
      liters_100: s.lifetime >= 100000,
    };
    return {
      memberId: s.memberId,
      today: s.today,
      todayMl: s.todayMl,
      goal: s.goal,
      streak: s.streak,
      bestStreak: s.bestStreak,
      daysMet: s.daysMet,
      weekTotal: s.weekTotal,
      lifetime: s.lifetime,
      last7: s.last7,
      crowns: crowns[s.memberId] || 0,
      rounds: rounds[s.memberId] || 0,
      badges,
    };
  });

  const leaderboard = [...result]
    .sort((a, b) => b.weekTotal - a.weekTotal)
    .map((s) => ({ memberId: s.memberId, weekTotal: s.weekTotal }));

  // Yesterday's round and last week's battle (for the morning results).
  let yesterday = null;
  let lastWeekResult = null;
  if (perMember.length >= 2) {
    const tz0 = members[0].tz || 'UTC';
    const start = dayKey(Math.max(...members.map((m) => m.createdAt || 0)), tz0);
    const yKey = addDays(perMember[0].today, -1);
    const totals = Object.fromEntries(perMember.map((s) => [s.memberId, s.totals.get(addDays(s.today, -1)) || 0]));
    const max = Math.max(...Object.values(totals));
    const created = dayKey(room.createdAt ?? Math.min(...members.map((m) => m.createdAt || 0)), tz0);
    yesterday = {
      day: yKey,
      round: daysBetween(created, yKey) + 1,
      totals,
      winners: max > 0 ? Object.keys(totals).filter((id) => totals[id] === max) : [],
      counted: yKey >= start && max > 0,
    };
    const wm = weekly.get(lastWeek) || new Map();
    lastWeekResult = {
      start: lastWeek,
      totals: Object.fromEntries(members.map((m) => [m.id, wm.get(m.id) || 0])),
      winners: lastWeekWinners,
    };
  }

  return { members: result, team, leaderboard, lastWeekWinners, yesterday, lastWeek: lastWeekResult };
}

/** Today's total for one member (used to decide push wording). */
export function todayTotal(room, member, now = Date.now()) {
  const today = dayKey(now, member.tz);
  let sum = 0;
  for (const e of room.entries) {
    if (e.memberId === member.id && dayKey(e.ts, member.tz) === today) sum += e.ml;
  }
  return sum;
}
