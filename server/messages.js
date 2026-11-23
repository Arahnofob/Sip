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
