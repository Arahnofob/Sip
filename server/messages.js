// Push notification texts, in the recipient's language.
// Phrased to avoid Ukrainian gendered past-tense verbs (випив/випила).

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const fmtL = (ml) => {
  const l = ml / 1000;
  return `${l.toFixed(l >= 10 ? 0 : 1).replace(/\.0$/, '')}`;
};

const T = {
  uk: {
    drankTitle: (name, ml) => `💦 ${name} атакує: +${ml} мл`,
    drankBody: [
      'Твій хід! Відповідай склянкою води ⚔️',
      'Захищайся — пий воду! 🛡️',
      'Не дай себе обійти. Пий! 💪',
      'Удар пропущено. Час відповісти 🥊',
    ],
    ahead: (name, theirs, mine) => `${name} тисне: ${fmtL(theirs)} л проти твоїх ${fmtL(mine)} л. Відповідай! 🥊`,
    overtakeTitle: (name) => `🏁 ${name} тебе обганяє!`,
    overtakeBody: (theirs, mine) => `${theirs} проти твоїх ${mine} мл. Відіграйся! 💪`,
    goalTitle: (name) => `🏆 ${name}: денну норму знищено!`,
    goalBody: (mine, goal) =>
      mine >= goal ? 'Ви обоє сьогодні непереможні 💪' : `У тебе лише ${fmtL(mine)} з ${fmtL(goal)} л. Відповідай! 🥊`,
    nudgeTitle: (name) => `👊 ${name} кидає тобі виклик`,
    nudgeBody: ['Слабо випити склянку води? 💧', 'Що, вже здаєшся? 😏', 'Пий — або програєш раунд 🥊'],
    testTitle: '💧 Сповіщення працюють!',
    testBody: 'Тепер ти дізнаватимешся, коли твоя половинка п’є воду.',
    drinkAction: (ml) => `⚔️ Відповісти: +${ml} мл`,
  },
  en: {
    drankTitle: (name, ml) => `💦 ${name} strikes: +${ml} ml`,
    drankBody: [
      'Your move! Hit back with a glass of water ⚔️',
      'Defend yourself — drink! 🛡️',
      "Don't let them pull away. Drink! 💪",
      'You took a hit. Time to answer 🥊',
    ],
    ahead: (name, theirs, mine) => `${name} is pushing: ${fmtL(theirs)} L vs your ${fmtL(mine)} L. Hit back! 🥊`,
    overtakeTitle: (name) => `🏁 ${name} just overtook you!`,
    overtakeBody: (theirs, mine) => `${theirs} vs your ${mine} ml. Strike back! 💪`,
    goalTitle: (name) => `🏆 ${name} crushed today's goal!`,
    goalBody: (mine, goal) =>
      mine >= goal ? 'You are both unbeatable today 💪' : `You're only at ${fmtL(mine)} of ${fmtL(goal)} L. Hit back! 🥊`,
    nudgeTitle: (name) => `👊 ${name} challenges you`,
    nudgeBody: ["Bet you can't finish a glass of water 💧", 'Giving up already? 😏', 'Drink — or lose the round 🥊'],
    testTitle: '💧 Notifications work!',
    testBody: "You'll now know when your partner drinks water.",
    drinkAction: (ml) => `⚔️ Hit back: +${ml} ml`,
  },
};

const BADGES = {
  uk: {
    first_drop: 'Перша кров', first_goal: 'Ціль знищено', early_bird: 'Ранковий удар', streak_3: 'Комбо ×3',
    streak_7: 'Комбо ×7', big_day: 'Нокаут', team_spirit: 'Союзники', champion: 'Чемпіон тижня',
    streak_30: 'Непереможний', team_week: 'Нерозлийвода', liters_100: 'Легенда',
  },
  en: {
    first_drop: 'First blood', first_goal: 'Target down', early_bird: 'Dawn strike', streak_3: 'Combo ×3',
    streak_7: 'Combo ×7', big_day: 'Knockout', team_spirit: 'Allies', champion: 'Champion',
    streak_30: 'Unstoppable', team_week: 'Inseparable', liters_100: 'Legend',
  },
};
export const BADGE_ICONS = {
  first_drop: '🩸', first_goal: '🎯', early_bird: '🌅', streak_3: '🔥', streak_7: '⚡', big_day: '🥊',
  team_spirit: '🤝', champion: '👑', streak_30: '🛡️', team_week: '💞', liters_100: '🏆',
};
export const TEAM_BADGES = new Set(['team_spirit', 'team_week']);

const pickLang = (lang) => (lang === 'en' ? 'en' : 'uk');

/** Partner (or the team) unlocked an achievement. */
export function achvMessage({ lang, name, badge }) {
  const l = pickLang(lang);
  const b = `${BADGE_ICONS[badge]} ${BADGES[l][badge]}`;
  if (TEAM_BADGES.has(badge)) {
    return l === 'uk'
      ? { title: `🤝 Командне досягнення: ${b}`, body: 'Ви зробили це разом 💪' }
      : { title: `🤝 Team achievement: ${b}`, body: 'You did it together 💪' };
  }
  return l === 'uk'
    ? { title: `🏅 ${name}: нове досягнення «${b}»`, body: 'А в тебе вже є? 😏' }
    : { title: `🏅 ${name} unlocked “${b}”`, body: 'Got that one yet? 😏' };
}

/** Midday: nothing logged yet today. */
export function middayMessage({ lang, leaderName, leaderMl }) {
  const l = pickLang(lang);
  if (l === 'uk') {
    return {
      title: '☀️ Обід, а в тебе ще 0 мл!',
      body: leaderMl > 0 ? `${leaderName} вже має ${fmtL(leaderMl)} л. Час на перший удар 🥊` : 'Час на перший удар 🥊',
    };
  }
  return {
    title: "☀️ It's midday and you're at 0 ml!",
    body: leaderMl > 0 ? `${leaderName} already has ${fmtL(leaderMl)} L. Time for your first hit 🥊` : 'Time for your first hit 🥊',
  };
}

/** Evening: last chance in today's round. */
export function eveningMessage({ lang, leaderName, diff, left, hoursLeft, round }) {
  const l = pickLang(lang);
  if (leaderName) {
    return l === 'uk'
      ? { title: `⏰ ${leaderName} попереду на ${diff} мл`, body: `До кінця раунду ${round}: ${hoursLeft} год. Встигнеш відігратися? 💪` }
      : { title: `⏰ ${leaderName} leads by ${diff} ml`, body: `${hoursLeft}h left in Round ${round}. Can you turn it around? 💪` };
  }
  return l === 'uk'
    ? { title: `⏰ До норми ще ${left} мл`, body: `${hoursLeft} год до кінця дня. Не здавайся! 💧` }
    : { title: `⏰ ${left} ml to your goal`, body: `${hoursLeft}h left today. Don't give up! 💧` };
}

/** Morning: who won yesterday's round. */
export function roundMessage({ lang, round, iWon, tie, winnerName, winnerMl, myMl }) {
  const l = pickLang(lang);
  const score = `${fmtL(winnerMl)} ${l === 'uk' ? 'л проти' : 'L vs'} ${fmtL(myMl)} ${l === 'uk' ? 'л' : 'L'}`;
  if (tie) {
    return l === 'uk'
      ? { title: `🥊 Раунд ${round}: нічия!`, body: `${fmtL(myMl)} л у кожного. Сьогодні вирішальний бій ⚔️` }
      : { title: `🥊 Round ${round}: a tie!`, body: `${fmtL(myMl)} L each. Today decides it ⚔️` };
  }
  if (iWon) {
    return l === 'uk'
      ? { title: `🥊 Раунд ${round} твій! 🏆`, body: `${score}. Тримай темп сьогодні 💪` }
      : { title: `🥊 Round ${round} is yours! 🏆`, body: `${score}. Keep it up today 💪` };
  }
  return l === 'uk'
    ? { title: `🥊 Раунд ${round} за ${winnerName}`, body: `${score}. Новий день — новий раунд. Відіграйся! 🔥` }
    : { title: `🥊 Round ${round} goes to ${winnerName}`, body: `${score}. New day, new round. Strike back! 🔥` };
}

/** Monday morning: champion of last week (+ the stake). */
export function weekMessage({ lang, iWon, tie, winnerName, winnerMl, myMl, stake }) {
  const l = pickLang(lang);
  const st = stake ? (l === 'uk' ? ` Ставка: «${stake}» 🎲` : ` Stake: “${stake}” 🎲`) : '';
  if (tie) {
    return l === 'uk'
      ? { title: '👑 Тиждень завершився нічиєю!', body: `${fmtL(myMl)} л у кожного.${st}` }
      : { title: '👑 Last week ended in a tie!', body: `${fmtL(myMl)} L each.${st}` };
  }
  if (iWon) {
    return l === 'uk'
      ? { title: '👑 Ти чемпіон тижня!', body: `${fmtL(winnerMl)} л проти ${fmtL(myMl)} л.${st}` }
      : { title: "👑 You're the champion of the week!", body: `${fmtL(winnerMl)} L vs ${fmtL(myMl)} L.${st}` };
  }
  return l === 'uk'
    ? { title: `👑 Чемпіон тижня — ${winnerName}`, body: `${fmtL(winnerMl)} л проти твоїх ${fmtL(myMl)} л.${st}` }
    : { title: `👑 Champion of the week: ${winnerName}`, body: `${fmtL(winnerMl)} L vs your ${fmtL(myMl)} L.${st}` };
}

export function stakeMessage({ lang, name, text }) {
  return pickLang(lang) === 'uk'
    ? { title: `🎲 ${name} ставить на кон:`, body: `«${text}». Хто програє тиждень — виконує!` }
    : { title: `🎲 ${name} set this week's stake:`, body: `“${text}”. The week's loser pays up!` };
}

export function texts(lang) {
  return T[lang] || T.uk;
}

export function drankMessage({ lang, senderName, ml, senderToday, recipientToday, senderGoal, recipientGoal }) {
  const t = texts(lang);
  const justHitGoal = senderToday >= senderGoal && senderToday - ml < senderGoal;
  if (justHitGoal) {
    return { title: t.goalTitle(senderName), body: t.goalBody(recipientToday, recipientGoal) };
  }
  if (isOvertake(senderToday - ml, senderToday, recipientToday)) {
    return { title: t.overtakeTitle(senderName), body: t.overtakeBody(senderToday, recipientToday) };
  }
  const body =
    senderToday > recipientToday && recipientToday < recipientGoal
      ? t.ahead(senderName, senderToday, recipientToday)
      : pick(t.drankBody);
  return { title: t.drankTitle(senderName, ml), body };
}

/**
 * Did this glass take the sender past someone? Only counts when the other person
 * has drunk something today (no "overtake" on the first sip of the morning) and the
 * sender was level or behind before it.
 */
export function isOvertake(senderBefore, senderAfter, other) {
  return other > 0 && senderBefore <= other && senderAfter > other;
}

export function nudgeMessage({ lang, senderName }) {
  const t = texts(lang);
  return { title: t.nudgeTitle(senderName), body: pick(t.nudgeBody) };
}
