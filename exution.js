// ==UserScript==
// @name         Travian Reinforcement Executor
// @namespace    local.travian.reinforcement.executor
// @version      1.0.0
// @description  Sends all non-hero troops as reinforcement from every village using the queued localStorage reinforcement URL.
// @match        https://*.travian.com/*
// @match        https://*.travian.com.sa/*
// @match        https://*.hispano.travian.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_PREFIX = "travian-reinforcement-url:";
  const LOGIC_KEY = "travianLogicEnabled";
  const STATE_KEY = "travian-reinforcement-executor-state";
  const MIN_DELAY_MS = 3000;
  const MAX_DELAY_MS = 5000;

  function log(message, extra) {
    if (typeof extra === "undefined") {
      console.log(`[Travian Reinforcement Executor] ${message}`);
      return;
    }

    console.log(`[Travian Reinforcement Executor] ${message}`, extra);
  }

  function randomDelay() {
    return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function readState() {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("[Travian Reinforcement Executor] Failed to parse state:", error);
      sessionStorage.removeItem(STATE_KEY);
      return null;
    }
  }

  function writeState(state) {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function clearState() {
    sessionStorage.removeItem(STATE_KEY);
  }

  function setLogicEnabled(value) {
    localStorage.setItem(LOGIC_KEY, value ? "true" : "false");
  }

  function getQueuedStorageKey() {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const value = localStorage.getItem(key);
        if (value) {
          return key;
        }
      }
    }

    return null;
  }

  function collectVillageIds() {
    const entries = Array.from(document.querySelectorAll(".villageList .listEntry.village[data-did]"));
    const ids = entries
      .map((entry) => entry.dataset.did)
      .filter((id, index, list) => Boolean(id) && list.indexOf(id) === index);

    return ids;
  }

  function parseTargetUrl(rawUrl) {
    try {
      return new URL(rawUrl, window.location.origin);
    } catch (error) {
      console.error("[Travian Reinforcement Executor] Invalid reinforcement URL:", rawUrl, error);
      return null;
    }
  }

  function buildVillageTargetUrl(rawUrl, villageId) {
    const url = parseTargetUrl(rawUrl);
    if (!url) {
      return null;
    }

    url.searchParams.set("newdid", villageId);
    return url.toString();
  }

  function cleanup(state, keepLogicDisabled) {
    if (state && state.storageKey) {
      localStorage.removeItem(state.storageKey);
      log(`Removed processed storage key: ${state.storageKey}`);
    }

    clearState();

    if (!keepLogicDisabled) {
      setLogicEnabled(true);
    }
  }

  function isSendTroopsPage() {
    return Boolean(document.querySelector("form[action*='build.php?gid=16'][method='post']"));
  }

  function isConfirmationPage() {
    return Boolean(document.querySelector("#confirmSendTroops"));
  }

  function fillTroopsWithoutHero() {
    const troopInputs = Array.from(document.querySelectorAll("table#troops input[name^='troop[']"));
    let totalFilled = 0;

    troopInputs.forEach((input) => {
      const troopName = input.name || "";
      if (troopName === "troop[t11]") {
        input.value = "";
        return;
      }

      if (input.disabled) {
        return;
      }

      const maxLink = input.parentElement ? input.parentElement.querySelector("a") : null;
      const maxSpan = input.parentElement ? input.parentElement.querySelector("span") : null;
      const rawValue = (maxLink ? maxLink.textContent : maxSpan ? maxSpan.textContent : "")
        .replace(/[^\d-]/g, "")
        .trim();

      const amount = Number(rawValue || "0");
      if (!Number.isFinite(amount) || amount <= 0) {
        input.value = "";
        return;
      }

      input.disabled = false;
      input.value = String(amount);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      totalFilled += amount;
    });

    return totalFilled;
  }

  function chooseReinforcement() {
    const reinforcementRadio = document.querySelector("input[name='eventType'][value='5']");
    if (!reinforcementRadio) {
      return false;
    }

    reinforcementRadio.disabled = false;
    reinforcementRadio.checked = true;
    reinforcementRadio.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function handleSendPage(state) {
    if (!isSendTroopsPage()) {
      return false;
    }

    const delay = randomDelay();
    log(`On send page for village ${state.villageIds[state.index]}. Waiting ${delay}ms before filling troops.`);
    await wait(delay);

    chooseReinforcement();
    const totalTroops = fillTroopsWithoutHero();
    if (totalTroops <= 0) {
      log(`No non-hero troops available in village ${state.villageIds[state.index]}. Skipping send.`);
      state.index += 1;
      state.phase = "navigate";
      writeState(state);
      await goToNextVillageOrFinish(state);
      return true;
    }

    state.phase = "confirm";
    writeState(state);

    const sendButton = document.querySelector("button#ok[name='ok']");
    if (!sendButton) {
      console.error("[Travian Reinforcement Executor] Send button not found.");
      cleanup(state, false);
      return true;
    }

    log(`Sending ${totalTroops} troops from village ${state.villageIds[state.index]}.`);
    sendButton.click();
    return true;
  }

  async function handleConfirmPage(state) {
    if (!isConfirmationPage()) {
      return false;
    }

    const delay = randomDelay();
    log(`On confirmation page for village ${state.villageIds[state.index]}. Waiting ${delay}ms before confirming.`);
    await wait(delay);

    const confirmButton = document.querySelector("#confirmSendTroops");
    if (!confirmButton) {
      console.error("[Travian Reinforcement Executor] Confirm button not found.");
      cleanup(state, false);
      return true;
    }

    const nextIndex = state.index + 1;
    state.index = nextIndex;
    state.phase = "navigate";
    writeState(state);

    confirmButton.click();
    return true;
  }

  async function goToNextVillageOrFinish(state) {
    if (state.index >= state.villageIds.length) {
      log("Finished all villages. Cleaning up state and restoring logic flag.");
      cleanup(state, false);
      return;
    }

    const villageId = state.villageIds[state.index];
    const nextUrl = buildVillageTargetUrl(state.targetUrl, villageId);
    if (!nextUrl) {
      cleanup(state, false);
      return;
    }

    const delay = randomDelay();
    log(`Navigating to village ${villageId} target page in ${delay}ms.`);
    await wait(delay);

    state.phase = "send";
    writeState(state);
    window.location.href = nextUrl;
  }

  function createInitialState() {
    const storageKey = getQueuedStorageKey();
    if (!storageKey) {
      return null;
    }

    const targetUrl = localStorage.getItem(storageKey);
    const parsedTarget = parseTargetUrl(targetUrl);
    if (!parsedTarget) {
      localStorage.removeItem(storageKey);
      return null;
    }

    const villageIds = collectVillageIds();
    if (villageIds.length === 0) {
      log("No villages found on the page yet.");
      return null;
    }

    return {
      storageKey,
      targetUrl: parsedTarget.toString(),
      villageIds,
      index: 0,
      phase: "navigate",
      createdAt: Date.now()
    };
  }

  async function startOrResume() {
    let state = readState();

    if (!state) {
      state = createInitialState();
      if (!state) {
        return;
      }

      setLogicEnabled(false);
      writeState(state);
      log("Started new reinforcement run.", state);
    }

    if (!localStorage.getItem(state.storageKey)) {
      log("Queued reinforcement key disappeared during execution. Cleaning up.");
      cleanup(state, false);
      return;
    }

    if (state.phase === "navigate") {
      await goToNextVillageOrFinish(state);
      return;
    }

    if (state.phase === "send") {
      const handled = await handleSendPage(state);
      if (!handled) {
        log("Waiting for the troop send page to load.");
      }
      return;
    }

    if (state.phase === "confirm") {
      const handled = await handleConfirmPage(state);
      if (!handled) {
        log("Waiting for the confirmation page to load.");
      }
      return;
    }

    log(`Unknown phase "${state.phase}". Resetting executor state.`);
    cleanup(state, false);
  }

  window.addEventListener("load", () => {
    window.setTimeout(() => {
      startOrResume().catch((error) => {
        console.error("[Travian Reinforcement Executor] Unexpected error:", error);
        const state = readState();
        cleanup(state, false);
      });
    }, 250);
  });
})();
