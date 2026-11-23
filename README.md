# 💧 Ковток (Kovtok) — drink water together

A tiny web app for two (or a few) people to track how much water they drink each day.
**Every time one of you logs a glass, the other gets a push notification** nudging them to drink too.

> застосунок, де ми вдвох додаємо кількість води, яку ми випили за день. Кожен раз, коли хтось додає нову порцію, інша людина отримує сповіщення, спонукаючи випити теж.

## Features

It's a **water fight**: every glass you log is a hit on your opponent.

- **The arena**: you vs your partner, with fighting-game power bars toward each daily goal, a tug-of-war bar showing who dominates today, a 👑 on the leader, and a running "Round N" counter (one round per day).
- **Strike button**: one tap logs "my glass" (configurable size). There are also quick amounts and a custom one, and you can undo or delete your own hits.
- **Hit effects**: when your partner drinks, a damage number (+250) flies off their fighter, yours flinches and the arena flashes, live.
- **Push notifications to your partner** on every hit:
  - "💦 Дарина атакує: +250 мл. Твій хід! Відповідай склянкою води ⚔️"
  - "🏁 Дарина тебе обганяє! 600 проти твоїх 500 мл. Відіграйся! 💪"
  - "🏆 Дарина: денну норму знищено!"
  - On Android/desktop the notification has a **"⚔️ Hit back: +250 ml"** button, so you can log a glass without opening the app.
- **🏁 Overtakes**: when one of you passes the other's total for the day (500 vs 400, then +200 → 600 vs 500), a race plays. The leader gets a crown and confetti; the one who was passed gets "Overtaken!" and a **Strike back** button. If it happened while the app was closed, it plays the next time you open it.
- **👊 Throw a challenge**: taunt your partner with a push (limited to once a minute).
- **Trophies**:
  - **Scoreboard**: rounds won (each finished day goes to whoever drank more) and 👑 weeks won
  - battle of the week leaderboard, 🔥 personal streaks, 🤝 team streak (days you both hit your goals)
  - 11 achievements: First blood, Dawn strike, Combo ×3/×7, Knockout (3 L in a day), Champion, Unstoppable…
  - a 7-day chart for both of you
- Ukrainian 🇺🇦 and English, dark arena theme, installable to your home screen (PWA), works across time zones.
- Changing your goal doesn't rewrite your past streaks.

## How it works

- `server/`: Node.js + Express. It stores data in a single JSON file (`DATA_DIR/db.json`), sends Web Push (VAPID keys are generated automatically on first start and stored in the same file), and streams live updates over Server-Sent Events.
- `public/`: plain HTML/CSS/JS with no build step, plus a service worker for notifications.
- No accounts or passwords. One of you creates a "space" and sends the invite link, and the other opens it and joins. To log in on another device, open the invite link again and tap your name. **Keep the invite link private**: anyone with it can join your space.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # unit tests for streaks / rewards
```

Push notifications work on `localhost` for testing in desktop Chrome/Firefox/Edge. On phones you need HTTPS, so deploy it.

## Deploy (you need HTTPS + a persistent disk)

Any host that runs a Docker image or Node.js app with a persistent volume works. With the Dockerfile, mount the volume at `/data`; without Docker, set `DATA_DIR` to the volume's path.

**Railway** (simplest): New Project → Deploy from GitHub repo → right-click the service → **Attach Volume** with mount path `/data` → Settings → Networking → **Generate Domain**. (The Docker image already stores its data in `/data`, so no variables are needed.)

**Fly.io**:
```bash
fly launch --no-deploy            # uses the Dockerfile
fly volumes create data --size 1
# add to fly.toml:
# [mounts]
#   source = "data"
#   destination = "/data"
fly deploy
```

**Your own server / Raspberry Pi**: `docker build -t kovtok . && docker run -d -p 3000:3000 -v kovtok-data:/data kovtok`, then put it behind HTTPS (Caddy, Cloudflare Tunnel or Tailscale Funnel).

Optional environment variables: `PORT`, `DATA_DIR`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (if you want to manage keys yourself), `VAPID_SUBJECT` (a `mailto:` contact for push services).

⚠️ Without a persistent volume, all data *and the push keys* are lost on every redeploy, so both phones would need to re-enable notifications.

## Getting notifications on your phones

- **iPhone (iOS 16.4+)**: open the site in Safari → Share → **Add to Home Screen** → open Kovtok from the home screen icon → Settings → Enable notifications. (iOS only allows web push for apps added to the home screen.)
- **Android**: open in Chrome → tap **Enable** on the banner. Installing to the home screen is optional but nicer.
- Use **Settings → Send test** to check it works.
