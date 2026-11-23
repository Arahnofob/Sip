// Push notification texts, in the recipient's language.
// Phrased to avoid Ukrainian gendered past-tense verbs (випив/випила).

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const fmtL = (ml) => {
  const l = ml / 1000;
  return `${l.toFixed(l >= 10 ? 0 : 1).replace(/\.0$/, '')}`;
};

const T = {
  uk: {
    drankTitle: (name, ml) => `💧 ${name}: +${ml} мл`,
    drankBody: [
      'Твоя черга! Склянка води чекає 😉',
      'Не відставай — випий трохи води 💦',
      'Час на ковток води! 🥤',
      'Пий воду — разом легше 💙',
    ],
    ahead: (name, theirs, mine) => `${name} попереду: ${fmtL(theirs)} л проти твоїх ${fmtL(mine)} л. Наздоганяй! 🏃`,
    goalTitle: (name) => `🎉 ${name}: денну норму виконано!`,
    goalBody: (mine, goal) =>
      mine >= goal ? 'Ви обоє молодці сьогодні 💙' : `У тебе ${fmtL(mine)} з ${fmtL(goal)} л. Твоя черга!`,
    nudgeTitle: (name) => `👋 ${name} нагадує`,
    nudgeBody: ['Час випити склянку води 💧', 'Ковточок води? 🥤', 'Не забувай пити воду 💙'],
    testTitle: '💧 Сповіщення працюють!',
    testBody: 'Тепер ти дізнаватимешся, коли твоя половинка п’є воду.',
    drinkAction: (ml) => `Я теж: +${ml} мл`,
  },
  en: {
    drankTitle: (name, ml) => `💧 ${name}: +${ml} ml`,
    drankBody: [
      'Your turn! A glass of water is waiting 😉',
      "Don't fall behind — have some water 💦",
      'Time for a sip! 🥤',
      'Hydrate together 💙',
    ],
    ahead: (name, theirs, mine) => `${name} is ahead: ${fmtL(theirs)} L vs your ${fmtL(mine)} L. Catch up! 🏃`,
    goalTitle: (name) => `🎉 ${name} hit today's goal!`,
    goalBody: (mine, goal) =>
      mine >= goal ? 'You both did great today 💙' : `You're at ${fmtL(mine)} of ${fmtL(goal)} L. Your turn!`,
    nudgeTitle: (name) => `👋 ${name} is nudging you`,
    nudgeBody: ['Time for a glass of water 💧', 'Sip of water? 🥤', "Don't forget to drink water 💙"],
    testTitle: '💧 Notifications work!',
    testBody: "You'll now know when your partner drinks water.",
    drinkAction: (ml) => `Me too: +${ml} ml`,
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
  const body =
    senderToday > recipientToday && recipientToday < recipientGoal
      ? t.ahead(senderName, senderToday, recipientToday)
      : pick(t.drankBody);
  return { title: t.drankTitle(senderName, ml), body };
}

export function nudgeMessage({ lang, senderName }) {
  const t = texts(lang);
  return { title: t.nudgeTitle(senderName), body: pick(t.nudgeBody) };
}
