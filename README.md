# Telegram Heartbeat Monitor

Small Node.js app for Render that watches for heartbeat pings from your userscript.

If no ping is received for 20 minutes, it sends a Telegram alert saying the bot is off.

## What it does

- `POST /ping` records a heartbeat from your userscript
- checks once per minute for missed heartbeats
- sends one offline alert after the timeout is reached
- sends one recovery message when heartbeats start again

## Environment variables

Copy `.env.example` to `.env` for local use.

- `TELEGRAM_BOT_TOKEN`: your Telegram bot token
- `TELEGRAM_CHAT_IDS`: comma-separated chat IDs
- `PING_SECRET`: shared secret used by the userscript when calling `/ping`
- `ALERT_AFTER_MINUTES`: timeout before alerting, default `20`
- `CHECK_INTERVAL_MS`: how often the server checks, default `60000`

## Run locally

```bash
node server.js
```

## Deploy to Render

Create a new Web Service and point it to this repo.

- Runtime: `Node`
- Build command: leave empty
- Start command: `node server.js`

Add these environment variables in Render:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_IDS`
- `PING_SECRET`
- `ALERT_AFTER_MINUTES`
- `CHECK_INTERVAL_MS`

## Userscript change

Replace the direct Telegram send block with a ping to your Render app:

```js
const MONITOR_URL = "https://your-render-service.onrender.com/ping";
const PING_SECRET = "same-secret-you-set-in-render";

fetch(MONITOR_URL, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "x-ping-secret": PING_SECRET
    },
    body: JSON.stringify({
        url: window.location.href,
        time: new Date().toISOString()
    })
}).catch(err => console.error("Monitor ping failed:", err));
```

If you still want the userscript to send its normal Telegram messages too, keep that part and add this ping alongside it.
