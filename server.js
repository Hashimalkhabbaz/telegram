const http = require("http");

const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const PING_SECRET = process.env.PING_SECRET;
const ALERT_AFTER_MINUTES = Number(process.env.ALERT_AFTER_MINUTES || 20);
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60_000);
const DISPLAY_TIME_ZONE = process.env.DISPLAY_TIME_ZONE || "Asia/Riyadh";

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN environment variable.");
}

if (TELEGRAM_CHAT_IDS.length === 0) {
  throw new Error("Missing TELEGRAM_CHAT_IDS environment variable.");
}

if (!PING_SECRET) {
  throw new Error("Missing PING_SECRET environment variable.");
}

let lastSeenAt = null;
let alertSent = false;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

async function sendTelegramMessage(text) {
  await Promise.all(
    TELEGRAM_CHAT_IDS.map(async (chatId) => {
      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text
          })
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Telegram API error (${response.status}): ${body}`);
      }
    })
  );
}

async function notifyOffline() {
  const now = new Date();
  const lastSeenText = lastSeenAt ? formatDateTime(new Date(lastSeenAt)) : "never";

  const message =
    "🚨 Alert: bot is off.\n" +
    `No heartbeat received for ${ALERT_AFTER_MINUTES} minutes.\n` +
    `Last heartbeat: ${lastSeenText} Saudi time\n` +
    `Alert time: ${formatDateTime(now)} Saudi time`;

  await sendTelegramMessage(message);
}

async function notifyOnline() {
  const now = new Date();

  const message =
    "✅ Bot is back online.\n" +
    `Heartbeat received at ${formatDateTime(now)} Saudi time`;

  await sendTelegramMessage(message);
}

async function handlePing(response, request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const secret = request.headers["x-ping-secret"] || url.searchParams.get("secret");

  if (secret !== PING_SECRET) {
    return sendJson(response, 401, { ok: false, error: "Unauthorized" });
  }

  const wasOffline = alertSent;
  lastSeenAt = Date.now();
  alertSent = false;

  sendJson(response, 200, {
    ok: true,
    message: "Heartbeat received",
    lastSeenAt: new Date(lastSeenAt).toISOString()
  });

  if (wasOffline) {
    try {
      await notifyOnline();
    } catch (error) {
      console.error("Failed to send recovery notification:", error);
    }
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/") {
    return sendJson(response, 200, {
      ok: true,
      service: "telegram-heartbeat-monitor",
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
      alertSent,
      alertAfterMinutes: ALERT_AFTER_MINUTES
    });
  }

  if (request.method === "POST" && url.pathname === "/ping") {
    return handlePing(response, request);
  }

  return sendJson(response, 404, { ok: false, error: "Not found" });
});

setInterval(async () => {
  if (!lastSeenAt || alertSent) {
    return;
  }

  const offlineForMs = Date.now() - lastSeenAt;
  const thresholdMs = ALERT_AFTER_MINUTES * 60 * 1000;

  if (offlineForMs < thresholdMs) {
    return;
  }

  try {
    await notifyOffline();
    alertSent = true;
  } catch (error) {
    console.error("Failed to send offline alert:", error);
  }
}, CHECK_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Heartbeat monitor listening on port ${PORT}`);
});
