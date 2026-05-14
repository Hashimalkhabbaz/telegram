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
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || "").trim();
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
              : typeof item.pendingResourcesTarget === "string"
                ? item.pendingResourcesTarget.trim()
                : typeof item.resourcesTarget === "string"
                  ? item.resourcesTarget.trim()
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

    input[type="url"],
    input[type="number"] {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 14px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }

    input[type="url"] {
      min-width: 280px;
    }

    .actions-cell {
      min-width: 420px;
    }

    .action-block + .action-block {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid rgba(223, 199, 162, 0.7);
    }

    .action-title {
      margin-bottom: 8px;
      color: var(--ink);
      font-weight: 700;
    }

    .resources-box {
      display: grid;
      grid-template-columns: minmax(80px, 1fr) minmax(80px, 1fr) auto;
      gap: 10px;
      align-items: stretch;
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

      .actions-cell {
        min-width: 0;
      }

      .resources-box {
        grid-template-columns: 1fr;
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
      if (!account || !account.pendingReinforcementUrl) {
        return "";
      }

      return account.pendingReinforcementUrl.startsWith("sendResoureses:")
        ? ""
        : account.pendingReinforcementUrl;
    }

    function getStoredResourcesTarget(accountName) {
      const account = accounts.find((item) => item.accountName === accountName);
      if (!account || !account.pendingReinforcementUrl) {
        return "";
      }

      return account.pendingReinforcementUrl.startsWith("sendResoureses:")
        ? account.pendingReinforcementUrl
        : "";
    }

    function parseResourcesTarget(value) {
      const commandMatch = String(value || "").trim().match(/^sendResoureses:x=(-?\\d+),y=(-?\\d+)$/);
      if (commandMatch) {
        return { x: commandMatch[1], y: commandMatch[2] };
      }

      const legacyMatch = String(value || "").trim().match(/^(-?\\d+)\\s*-\\s*(-?\\d+)$/);
      if (legacyMatch) {
        return { x: legacyMatch[1], y: legacyMatch[2] };
      }

      return { x: "", y: "" };
    }

    function validateReinforcementUrl(value) {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch (error) {
        return false;
      }
    }

    function validateCoordinate(value) {
      if (String(value).trim() === "") {
        return false;
      }

      const number = Number(value);
      return Number.isInteger(number) && number >= -400 && number <= 400;
    }

    function getStatusId(prefix, accountName) {
      return prefix + "-" + accountName.replace(/[^a-zA-Z0-9_-]/g, "_");
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
          const resourcesTarget = getStoredResourcesTarget(account.accountName);
          const resourcesCoords = parseResourcesTarget(resourcesTarget);
          const safeAccountName = escapeHtml(account.accountName);
          const safeStoredUrl = escapeHtml(storedUrl);
          const safeResourceX = escapeHtml(resourcesCoords.x);
          const safeResourceY = escapeHtml(resourcesCoords.y);

          return \`
            <tr>
              <td data-label="Account">
                <div class="account-name">\${safeAccountName}</div>
                <div class="stamp">Last seen: \${formatDate(account.updatedAt)}</div>
              </td>
              <td class="actions-cell" data-label="Actions">
                <div class="action-block">
                  <div class="action-title">Troops</div>
                  <div class="url-box">
                    <input
                      type="url"
                      data-url-account-name="\${safeAccountName}"
                      placeholder="https://eternos.x3.hispano.travian.com/build.php?gid=16&tt=2&eventType=5&targetMapId=136970"
                      value="\${safeStoredUrl}"
                    >
                    <button type="button" data-save-url-name="\${safeAccountName}">Save URL</button>
                  </div>
                  <div class="hint">Queued on the server once. After the userscript fetches it, the server clears it.</div>
                  <div class="saved" id="\${getStatusId("url-saved", account.accountName)}">\${storedUrl ? "Queued for next sync." : ""}</div>
                </div>

                <div class="action-block">
                  <div class="action-title">Resources</div>
                  <div class="resources-box">
                    <input
                      type="number"
                      data-resource-x-name="\${safeAccountName}"
                      placeholder="X"
                      min="-400"
                      max="400"
                      step="1"
                      value="\${safeResourceX}"
                    >
                    <input
                      type="number"
                      data-resource-y-name="\${safeAccountName}"
                      placeholder="Y"
                      min="-400"
                      max="400"
                      step="1"
                      value="\${safeResourceY}"
                    >
                    <button type="button" data-save-resource-name="\${safeAccountName}">Send Resources</button>
                  </div>
                  <div class="hint">Queued as sendResoureses:x=4,y=-2. After the userscript fetches it, the server clears it.</div>
                  <div class="saved" id="\${getStatusId("resources-saved", account.accountName)}">\${resourcesTarget ? escapeHtml(resourcesTarget) + " queued for next sync." : ""}</div>
                </div>
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>\${rows}</tbody>
        </table>
      \`;

      for (const button of root.querySelectorAll("[data-save-url-name]")) {
        button.addEventListener("click", async () => {
          const accountName = button.getAttribute("data-save-url-name");
          const input = root.querySelector('[data-url-account-name="' + CSS.escape(accountName) + '"]');
          const statusId = getStatusId("url-saved", accountName);
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
          } catch (error) {
            status.textContent = error.message || "Failed to save URL.";
            status.style.color = "#9a2f2f";
          } finally {
            button.disabled = false;
          }
        });
      }

      for (const button of root.querySelectorAll("[data-save-resource-name]")) {
        button.addEventListener("click", async () => {
          const accountName = button.getAttribute("data-save-resource-name");
          const xInput = root.querySelector('[data-resource-x-name="' + CSS.escape(accountName) + '"]');
          const yInput = root.querySelector('[data-resource-y-name="' + CSS.escape(accountName) + '"]');
          const statusId = getStatusId("resources-saved", accountName);
          const status = document.getElementById(statusId);
          const x = xInput.value.trim();
          const y = yInput.value.trim();

          if (!validateCoordinate(x) || !validateCoordinate(y)) {
            status.textContent = "Please enter valid X and Y coordinates.";
            status.style.color = "#9a2f2f";
            return;
          }

          button.disabled = true;
          status.textContent = "Saving...";
          status.style.color = "#7d6242";

          try {
            const response = await fetch("/api/accounts/resources", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                accountName,
                x: Number(x),
                y: Number(y)
              })
            });

            const payload = await response.json();

            if (!response.ok || !payload.ok) {
              throw new Error(payload.error || "Failed to save resources target.");
            }

            accounts = Array.isArray(payload.accounts) ? payload.accounts : accounts;
            renderTable();
          } catch (error) {
            status.textContent = error.message || "Failed to save resources target.";
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

function summarizeHttpErrorBody(body) {
  const text = String(body || "");
  const plainText = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cloudflareCode = plainText.match(/error\s+code:\s*(\d+)|error\s+(\d+)/i);
  const rayId = plainText.match(/cloudflare\s+ray\s+id:\s*([a-z0-9]+)/i);
  const details = [];

  if (cloudflareCode) {
    details.push(`Cloudflare error ${cloudflareCode[1] || cloudflareCode[2]}`);
  }

  if (rayId) {
    details.push(`Ray ID ${rayId[1]}`);
  }

  if (details.length > 0) {
    return details.join(", ");
  }

  return plainText.slice(0, 300) || "No response body";
}

async function sendDiscordMessage(text) {
  if (!DISCORD_WEBHOOK_URL) {
    return { skipped: true };
  }

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "TelegramHeartbeatMonitor/1.0"
    },
    body: JSON.stringify({
      content: text
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook error (${response.status}): ${summarizeHttpErrorBody(body)}`);
  }

  return { skipped: false };
}

async function sendAlertMessage(text) {
  const channels = [
    { name: "Telegram", promise: sendTelegramMessage(text) },
    { name: "Discord", promise: sendDiscordMessage(text) }
  ];
  const results = await Promise.allSettled(
    channels.map(async (channel) => ({
      name: channel.name,
      result: await channel.promise
    }))
  );
  let delivered = false;
  const failedChannels = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      if (!result.value.result?.skipped) {
        delivered = true;
      }
      continue;
    }

    const channel = channels[results.indexOf(result)];
    failedChannels.push(channel.name);
    console.error(`${channel.name} alert failed:`, result.reason.message || result.reason);
  }

  if (!delivered) {
    throw new Error(`Failed to send alert through: ${failedChannels.join(", ") || "all channels"}`);
  }
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

async function handleUpdateAccountResources(response, request) {
  try {
    const body = await readRequestBody(request);
    const parsed = JSON.parse(body || "{}");
    const accountName =
      typeof parsed.accountName === "string" ? parsed.accountName.trim() : "";
    const x = Number(parsed.x);
    const y = Number(parsed.y);

    if (!accountName) {
      return sendJson(
        response,
        400,
        { ok: false, error: "accountName is required." },
        { "Access-Control-Allow-Origin": "*" }
      );
    }

    const hasValidCoordinates =
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= -400 &&
      x <= 400 &&
      y >= -400 &&
      y <= 400;

    if (!hasValidCoordinates) {
      return sendJson(
        response,
        400,
        { ok: false, error: "Valid x and y coordinates are required." },
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

    const resourcesTarget = `sendResoureses:x=${x},y=${y}`;
    existingAccount.pendingReinforcementUrl = resourcesTarget;
    existingAccount.updatedAt = new Date().toISOString();
    saveAccounts();

    return sendJson(
      response,
      200,
      {
        ok: true,
        accountName,
        resourcesTarget,
        accounts: getAccountsPayload()
      },
      { "Access-Control-Allow-Origin": "*" }
    );
  } catch (error) {
    console.error("Failed to save resources target:", error);
    return sendJson(
      response,
      500,
      { ok: false, error: "Failed to save resources target." },
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

      const hasPendingAccountWork =
        account &&
        consume &&
        account.pendingReinforcementUrl;

      if (hasPendingAccountWork) {
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

  if (request.method === "POST" && url.pathname === "/api/accounts/resources") {
    return handleUpdateAccountResources(response, request);
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
