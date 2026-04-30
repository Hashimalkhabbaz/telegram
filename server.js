const fs = require("fs");
const http = require("http");
const path = require("path");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const DISCORD_WEBHOOK_URL =
  process.env.DISCORD_WEBHOOK_URL ||
  "https://discord.com/api/webhooks/1496404854644408330/56zwQWe9A1FxEJPr5Zp-UCmBkCbXfqiAc5ddc4_wtAc4_29xSO7wde0EI9Jvsjo3EzXW";
const PING_SECRET = process.env.PING_SECRET;
const ALERT_AFTER_MINUTES = Number(process.env.ALERT_AFTER_MINUTES || 20);
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60_000);
const DISPLAY_TIME_ZONE = process.env.DISPLAY_TIME_ZONE || "Asia/Riyadh";
const ACCOUNTS_FILE_PATH = path.join(__dirname, "accounts.json");

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }

    const envContent = fs.readFileSync(filePath, "utf8");

    for (const rawLine of envContent.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = value;
    }
  } catch (error) {
    console.error("Failed to load .env file:", error);
  }
}

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
let accounts = loadAccounts();

function loadAccounts() {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE_PATH)) {
      return [];
    }

    const raw = fs.readFileSync(ACCOUNTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item.accountName === "string")
      .map((item) => ({
        accountName: item.accountName.trim(),
        pendingReinforcementUrl:
          typeof item.pendingReinforcementUrl === "string"
            ? item.pendingReinforcementUrl.trim()
            : typeof item.reinforcementUrl === "string"
              ? item.reinforcementUrl.trim()
              : "",
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
      }))
      .filter((item) => item.accountName);
  } catch (error) {
    console.error("Failed to load accounts:", error);
    return [];
  }
}

function saveAccounts() {
  fs.writeFileSync(ACCOUNTS_FILE_PATH, JSON.stringify(accounts, null, 2));
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Ping-Secret");
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function formatServerTime(date = new Date()) {
  return `${formatDateTime(date)} (${DISPLAY_TIME_ZONE})`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return map[char];
  });
}

function getAccountsPageHtml() {
  const initialAccounts = JSON.stringify(
    accounts
      .slice()
      .sort((first, second) => first.accountName.localeCompare(second.accountName))
  ).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Travian Accounts</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6efe4;
      --panel: #fffaf2;
      --panel-strong: #fff;
      --line: #dfc7a2;
      --ink: #2f2418;
      --muted: #7d6242;
      --accent: #a24f2d;
      --accent-strong: #7d3418;
      --success: #2f6b3a;
      --shadow: 0 18px 42px rgba(86, 49, 19, 0.12);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(162, 79, 45, 0.18), transparent 28%),
        linear-gradient(180deg, #f4ead8 0%, var(--bg) 100%);
      color: var(--ink);
      min-height: 100vh;
    }

    .wrap {
      width: min(1100px, calc(100% - 32px));
      margin: 36px auto;
    }

    .hero {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 28px;
      box-shadow: var(--shadow);
    }

    h1 {
      margin: 0 0 10px;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1;
    }

    .sub {
      margin: 0;
      color: var(--muted);
      font-size: 1.02rem;
    }

    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 20px;
    }

    .stat {
      background: var(--panel-strong);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      min-width: 160px;
    }

    .stat strong {
      display: block;
      font-size: 1.25rem;
      margin-bottom: 4px;
    }

    .table-card {
      margin-top: 22px;
      background: rgba(255, 250, 242, 0.94);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.55);
    }

    .toolbar p {
      margin: 0;
      color: var(--muted);
    }

    button {
      appearance: none;
      border: 0;
      border-radius: 12px;
      background: var(--accent);
      color: #fff7f0;
      padding: 11px 16px;
      font: inherit;
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease;
    }

    button:hover {
      background: var(--accent-strong);
      transform: translateY(-1px);
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 16px 18px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid rgba(223, 199, 162, 0.7);
    }

    th {
      color: var(--muted);
      font-size: 0.95rem;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.45);
    }

    .account-name {
      font-weight: 700;
      font-size: 1.05rem;
    }

    .stamp {
      color: var(--muted);
      font-size: 0.92rem;
      margin-top: 4px;
    }

    .url-box {
      display: flex;
      gap: 10px;
      align-items: stretch;
    }

    input[type="url"] {
      width: 100%;
      min-width: 280px;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 14px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }

    .hint {
      margin-top: 8px;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.4;
    }

    .saved {
      margin-top: 8px;
      color: var(--success);
      font-size: 0.9rem;
      min-height: 1.2em;
    }

    .empty {
      padding: 26px 22px;
      color: var(--muted);
    }

    @media (max-width: 820px) {
      .wrap {
        width: min(100% - 20px, 1100px);
        margin: 20px auto;
      }

      .hero,
      .table-card {
        border-radius: 18px;
      }

      table,
      thead,
      tbody,
      th,
      td,
      tr {
        display: block;
      }

      thead {
        display: none;
      }

      tr {
        padding: 18px;
        border-bottom: 1px solid rgba(223, 199, 162, 0.7);
      }

      td {
        padding: 8px 0;
        border-bottom: 0;
      }

      td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 0.88rem;
        margin-bottom: 6px;
      }

      .url-box {
        flex-direction: column;
      }

      input[type="url"] {
        min-width: 0;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Travian Accounts</h1>
      <p class="sub">This page lists account names received from your userscript. Paste any URL for each account and send it once. The userscript will copy that URL into Travian localStorage, then the server will clear it automatically.</p>
      <div class="stats">
        <div class="stat">
          <strong id="accountCount">0</strong>
          <span>Accounts received</span>
        </div>
        <div class="stat">
          <strong>/api/accounts</strong>
          <span>POST from userscript</span>
        </div>
      </div>
    </section>

    <section class="table-card">
      <div class="toolbar">
        <p>Paste any valid <code>http://</code> or <code>https://</code> URL. Each URL is delivered one time, then removed from the server.</p>
        <button id="refreshBtn" type="button">Refresh</button>
      </div>

      <div id="tableRoot"></div>
    </section>
  </div>

  <script>
    let accounts = ${initialAccounts};

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => {
        const map = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        };

        return map[char];
      });
    }

    function formatDate(value) {
      if (!value) {
        return "Unknown";
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return "Unknown";
      }

      return date.toLocaleString();
    }

    function getStoredUrl(accountName) {
      const account = accounts.find((item) => item.accountName === accountName);
      return account && account.pendingReinforcementUrl ? account.pendingReinforcementUrl : "";
    }

    function validateReinforcementUrl(value) {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch (error) {
        return false;
      }
    }

    function renderTable() {
      const root = document.getElementById("tableRoot");
      const count = document.getElementById("accountCount");
      count.textContent = String(accounts.length);

      if (accounts.length === 0) {
        root.innerHTML = '<div class="empty">No accounts received yet. Open Travian with the userscript enabled, then refresh this page.</div>';
        return;
      }

      const rows = accounts
        .slice()
        .sort((first, second) => first.accountName.localeCompare(second.accountName))
        .map((account) => {
          const storedUrl = getStoredUrl(account.accountName);
          const safeAccountName = escapeHtml(account.accountName);
          const safeStoredUrl = escapeHtml(storedUrl);

          return \`
            <tr>
              <td data-label="Account">
                <div class="account-name">\${safeAccountName}</div>
                <div class="stamp">Last seen: \${formatDate(account.updatedAt)}</div>
              </td>
              <td data-label="Reinforcement URL">
                <div class="url-box">
                  <input
                    type="url"
                    data-account-name="\${safeAccountName}"
                    placeholder="https://eternos.x3.hispano.travian.com/build.php?gid=16&tt=2&eventType=5&targetMapId=136970"
                    value="\${safeStoredUrl}"
                  >
                  <button type="button" data-save-name="\${safeAccountName}">Save</button>
                </div>
                <div class="hint">Queued on the server once. After the userscript fetches it, the server clears it.</div>
                <div class="saved" id="saved-\${account.accountName.replace(/[^a-zA-Z0-9_-]/g, "_")}">\${storedUrl ? "Queued for next sync." : ""}</div>
              </td>
            </tr>
          \`;
        })
        .join("");

      root.innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Reinforcement URL</th>
            </tr>
          </thead>
          <tbody>\${rows}</tbody>
        </table>
      \`;

      for (const button of root.querySelectorAll("[data-save-name]")) {
        button.addEventListener("click", async () => {
          const accountName = button.getAttribute("data-save-name");
          const input = root.querySelector('[data-account-name="' + CSS.escape(accountName) + '"]');
          const statusId = "saved-" + accountName.replace(/[^a-zA-Z0-9_-]/g, "_");
          const status = document.getElementById(statusId);
          const value = input.value.trim();

          if (!validateReinforcementUrl(value)) {
            status.textContent = "Please paste a valid URL.";
            status.style.color = "#9a2f2f";
            return;
          }

          button.disabled = true;
          status.textContent = "Saving...";
          status.style.color = "#7d6242";

          try {
            const response = await fetch("/api/accounts/url", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                accountName,
                reinforcementUrl: value
              })
            });

            const payload = await response.json();

            if (!response.ok || !payload.ok) {
              throw new Error(payload.error || "Failed to save URL.");
            }

            accounts = Array.isArray(payload.accounts) ? payload.accounts : accounts;
            renderTable();
            status.textContent = "Queued once. Open Travian on this account to sync it.";
            status.style.color = "#2f6b3a";
          } catch (error) {
            status.textContent = error.message || "Failed to save URL.";
            status.style.color = "#9a2f2f";
          } finally {
            button.disabled = false;
          }
        });
      }
    }

    async function refreshAccounts() {
      const response = await fetch("/api/accounts");
      const payload = await response.json();
      accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      renderTable();
    }

    document.getElementById("refreshBtn").addEventListener("click", () => {
      refreshAccounts().catch((error) => {
        console.error(error);
      });
    });

    renderTable();
  </script>
</body>
</html>`;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
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

async function sendDiscordMessage(text) {
  if (!DISCORD_WEBHOOK_URL) {
    return;
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: text
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook error (${response.status}): ${body}`);
  }
}

async function sendAlertMessage(text) {
  await Promise.all([sendTelegramMessage(text), sendDiscordMessage(text)]);
}

async function notifyOffline() {
  const now = new Date();
  const lastSeenText = lastSeenAt ? formatServerTime(new Date(lastSeenAt)) : "Never";

  const message =
    "🚨 Bot Offline Alert\n\n" +
    `⏳ No heartbeat for: ${ALERT_AFTER_MINUTES} minutes\n` +
    `📡 Last heartbeat: ${lastSeenText}\n` +
    `🕒 Server time: ${formatServerTime(now)}`;

  await sendAlertMessage(message);
}

async function notifyOnline() {
  const now = new Date();

  const message =
    "✅ Bot Back Online\n\n" +
    `📡 Heartbeat received\n` +
    `🕒 Server time: ${formatServerTime(now)}`;

  await sendAlertMessage(message);
}

function getAccountsPayload() {
  return accounts
    .slice()
    .sort((first, second) => first.accountName.localeCompare(second.accountName));
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

async function handleCreateOrUpdateAccount(response, request) {
  try {
    const body = await readRequestBody(request);
    let accountName = "";

    if ((request.headers["content-type"] || "").includes("application/json")) {
      const parsed = JSON.parse(body || "{}");
      accountName = typeof parsed.accountName === "string" ? parsed.accountName.trim() : "";
    } else {
      const params = new URLSearchParams(body);
      accountName = (params.get("accountName") || "").trim();
    }

    if (!accountName) {
      return sendJson(
        response,
        400,
        { ok: false, error: "accountName is required." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    const now = new Date().toISOString();
    const existingAccount = accounts.find((item) => item.accountName === accountName);

    if (existingAccount) {
      existingAccount.updatedAt = now;
    } else {
      accounts.push({
        accountName,
        createdAt: now,
        updatedAt: now
      });
    }

    saveAccounts();

    return sendJson(
      response,
      200,
      {
        ok: true,
        accountName,
        accounts: getAccountsPayload()
      },
      { "Access-Control-Allow-Origin": "*" }
    );
  } catch (error) {
    console.error("Failed to save account:", error);
    return sendJson(
      response,
      500,
      { ok: false, error: "Failed to save account." },
      { "Access-Control-Allow-Origin": "*" }
    );
  }
}

async function handleUpdateAccountUrl(response, request) {
  try {
    const body = await readRequestBody(request);
    const parsed = JSON.parse(body || "{}");
    const accountName =
      typeof parsed.accountName === "string" ? parsed.accountName.trim() : "";
    const reinforcementUrl =
      typeof parsed.reinforcementUrl === "string"
        ? parsed.reinforcementUrl.trim()
        : "";

    if (!accountName) {
      return sendJson(
        response,
        400,
        { ok: false, error: "accountName is required." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    if (!reinforcementUrl) {
      return sendJson(
        response,
        400,
        { ok: false, error: "reinforcementUrl is required." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(reinforcementUrl);
    } catch (error) {
      return sendJson(
        response,
        400,
        { ok: false, error: "Invalid URL." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    const hasValidProtocol =
      parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

    if (!hasValidProtocol) {
      return sendJson(
        response,
        400,
        { ok: false, error: "URL must start with http:// or https:// ." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    const existingAccount = accounts.find((item) => item.accountName === accountName);

    if (!existingAccount) {
      return sendJson(
        response,
        404,
        { ok: false, error: "Account not found." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    existingAccount.pendingReinforcementUrl = reinforcementUrl;
    existingAccount.updatedAt = new Date().toISOString();
    saveAccounts();

    return sendJson(
      response,
      200,
      {
        ok: true,
        accountName,
        reinforcementUrl,
        accounts: getAccountsPayload()
      },
      { "Access-Control-Allow-Origin": "*" }
    );
  } catch (error) {
    console.error("Failed to save reinforcement URL:", error);
    return sendJson(
      response,
      500,
      { ok: false, error: "Failed to save reinforcement URL." },
      { "Access-Control-Allow-Origin": "*" }
    );
  }
}

async function handleExecutorError(response, request) {
  try {
    const body = await readRequestBody(request);
    const parsed = JSON.parse(body || "{}");
    const message =
      typeof parsed.message === "string" ? parsed.message.trim() : "";

    if (!message) {
      return sendJson(
        response,
        400,
        { ok: false, error: "message is required." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    const accountName =
      typeof parsed.accountName === "string" && parsed.accountName.trim()
        ? parsed.accountName.trim()
        : "Unknown account";
    const villageId =
      typeof parsed.villageId === "string" && parsed.villageId.trim()
        ? parsed.villageId.trim()
        : "Unknown village";
    const mode =
      typeof parsed.mode === "string" && parsed.mode.trim()
        ? parsed.mode.trim()
        : "executor";
    const targetUrl =
      typeof parsed.targetUrl === "string" && parsed.targetUrl.trim()
        ? parsed.targetUrl.trim()
        : "Unknown target";

    const discordMessage =
      "Travian executor error\n\n" +
      `Account: ${accountName}\n` +
      `Village: ${villageId}\n` +
      `Mode: ${mode}\n` +
      `Error: ${message}\n` +
      `Target: ${targetUrl}\n` +
      `Server time: ${formatServerTime(new Date())}`;

    await sendDiscordMessage(discordMessage);

    return sendJson(
      response,
      200,
      { ok: true },
      { "Access-Control-Allow-Origin": "*" }
    );
  } catch (error) {
    console.error("Failed to send executor error:", error);
    return sendJson(
      response,
      500,
      { ok: false, error: "Failed to send executor error." },
      { "Access-Control-Allow-Origin": "*" }
    );
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname.startsWith("/api/accounts") || url.pathname === "/api/executor-error") {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/") {
    return sendJson(response, 200, {
      ok: true,
      service: "telegram-heartbeat-monitor",
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
      alertSent,
      alertAfterMinutes: ALERT_AFTER_MINUTES,
      accountsEndpoint: "/api/accounts",
      accountsPage: "/accounts"
    });
  }

  if (request.method === "GET" && url.pathname === "/accounts") {
    return sendHtml(response, 200, getAccountsPageHtml());
  }

  if (request.method === "GET" && url.pathname === "/api/accounts") {
    const accountName = (url.searchParams.get("accountName") || "").trim();
    const consume = url.searchParams.get("consume") === "1";

    if (accountName) {
      const account = accounts.find((item) => item.accountName === accountName);
      let payloadAccount = account || null;

      if (account && consume && account.pendingReinforcementUrl) {
        payloadAccount = { ...account };
        account.pendingReinforcementUrl = "";
        account.updatedAt = new Date().toISOString();
        saveAccounts();
      }

      return sendJson(
        response,
        200,
        { ok: true, account: payloadAccount },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    return sendJson(
      response,
      200,
      { ok: true, accounts: getAccountsPayload() },
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  if (request.method === "POST" && url.pathname === "/api/accounts") {
    return handleCreateOrUpdateAccount(response, request);
  }

  if (request.method === "POST" && url.pathname === "/api/accounts/url") {
    return handleUpdateAccountUrl(response, request);
  }

  if (request.method === "POST" && url.pathname === "/api/executor-error") {
    return handleExecutorError(response, request);
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
