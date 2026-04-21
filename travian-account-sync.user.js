// ==UserScript==
// @name         Travian Account Sync
// @namespace    local.travian.account.sync
// @version      1.1.0
// @description  Sends the current Travian account name to your local server and syncs the saved reinforcement URL into Travian localStorage.
// @match        https://*.travian.com/*
// @match        https://*.travian.com.sa/*
// @match        https://*.hispano.travian.com/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  const SERVER_URL = "http://localhost:3000/api/accounts";
  const SEND_DELAY_MS = 1500;
  const STORAGE_PREFIX = "travian-reinforcement-url:";
  const ACTIVE_ACCOUNT_KEY = "travian-active-account";

  function getAccountName() {
    const playerNameElement = document.querySelector(".content .playerName");
    return playerNameElement ? playerNameElement.textContent.trim() : "";
  }

  function sendAccountName(accountName) {
    if (!accountName) {
      return;
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: SERVER_URL,
      headers: {
        "Content-Type": "application/json"
      },
      data: JSON.stringify({ accountName }),
      onload: (response) => {
        if (response.status >= 200 && response.status < 300) {
          console.log("[Travian Account Sync] Sent account:", accountName);
          return;
        }

        console.error(
          "[Travian Account Sync] Server rejected account sync:",
          response.status,
          response.responseText
        );
      },
      onerror: (error) => {
        console.error("[Travian Account Sync] Request failed:", error);
      }
    });
  }

  function fetchAccount(accountName) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `${SERVER_URL}?accountName=${encodeURIComponent(accountName)}&consume=1`,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`Account fetch failed with ${response.status}`));
            return;
          }

          try {
            const payload = JSON.parse(response.responseText || "{}");
            resolve(payload.account || null);
          } catch (error) {
            reject(error);
          }
        },
        onerror: (error) => {
          reject(error);
        }
      });
    });
  }

  async function syncReinforcementUrl(accountName) {
    try {
      const account = await fetchAccount(accountName);

      if (!account || !account.pendingReinforcementUrl) {
        console.log("[Travian Account Sync] No queued reinforcement URL on server for:", accountName);
        return;
      }

      localStorage.setItem(STORAGE_PREFIX + accountName, account.pendingReinforcementUrl);
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountName);
      console.log("[Travian Account Sync] One-time reinforcement URL synced to Travian localStorage for:", accountName);
    } catch (error) {
      console.error("[Travian Account Sync] Failed to sync reinforcement URL:", error);
    }
  }

  function init() {
    const accountName = getAccountName();

    if (!accountName) {
      console.warn("[Travian Account Sync] Could not find player name on this page.");
      return;
    }

    localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountName);
    sendAccountName(accountName);
    syncReinforcementUrl(accountName);
  }

  window.setTimeout(init, SEND_DELAY_MS);
})();
