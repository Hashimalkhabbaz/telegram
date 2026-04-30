// ==UserScript==
// @name         Travian Reinforcement/Resource Executor
// @namespace    local.travian.reinforcement-resource.executor
// @version      1.1.0
// @description  Sends all non-hero troops as reinforcement or all resources by merchant from every village using the queued localStorage URL.
// @match        https://*.travian.com/*
// @match        https://*.travian.com.sa/*
// @match        https://*.hispano.travian.com/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_PREFIX = "travian-reinforcement-url:";
  const ACTIVE_ACCOUNT_KEY = "travian-active-account";
  const LOGIC_KEY = "travianLogicEnabled";
  const STATE_KEY = "travian-reinforcement-executor-state";
  const ERROR_REPORT_URL = "http://localhost:3000/api/executor-error";
  const MIN_DELAY_MS = 3000;
  const MAX_DELAY_MS = 5000;
  const RESOURCE_MIN_DELAY_MS = 2000;
  const RESOURCE_MAX_DELAY_MS = 3000;

  function log(message, extra) {
    if (typeof extra === "undefined") {
      console.log(`[Travian Executor] ${message}`);
      return;
    }

    console.log(`[Travian Executor] ${message}`, extra);
  }

  function randomDelay(minDelayMs = MIN_DELAY_MS, maxDelayMs = MAX_DELAY_MS) {
    return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function readState() {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("[Travian Executor] Failed to parse state:", error);
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
      console.error("[Travian Executor] Invalid queued URL:", rawUrl, error);
      return null;
    }
  }

  function getModeFromTargetUrl(url) {
    if (url.pathname.endsWith("/karte.php")) {
      return "resources";
    }

    return "reinforcement";
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

  function parseNumber(text) {
    const cleaned = String(text || "")
      .replace(/[^\d-]/g, "")
      .trim();
    const value = Number(cleaned || "0");
    return Number.isFinite(value) ? value : 0;
  }

  function getActiveAccountName() {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY) || "";
  }

  async function reportExecutorError(state, message) {
    const payload = {
      accountName: getActiveAccountName(),
      villageId: state && state.villageIds ? state.villageIds[state.index] : "",
      targetUrl: state && state.targetUrl ? state.targetUrl : window.location.href,
      mode: state && state.mode ? state.mode : "",
      message
    };

    return new Promise((resolve) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "POST",
          url: ERROR_REPORT_URL,
          headers: {
            "Content-Type": "application/json"
          },
          data: JSON.stringify(payload),
          onload: (response) => {
            if (response.status < 200 || response.status >= 300) {
              log(`Discord error report failed with status ${response.status}.`);
            }

            resolve();
          },
          onerror: (error) => {
            console.error("[Travian Executor] Failed to report error to server:", error);
            resolve();
          }
        });
        return;
      }

      fetch(ERROR_REPORT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })
        .then((response) => {
          if (!response.ok) {
            log(`Discord error report failed with status ${response.status}.`);
          }
        })
        .catch((error) => {
          console.error("[Travian Executor] Failed to report error to server:", error);
        })
        .finally(resolve);
    });
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

      const amount = parseNumber(rawValue);
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
      console.error("[Travian Executor] Send button not found.");
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
      console.error("[Travian Executor] Confirm button not found.");
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

    state.phase = state.mode === "resources" ? "open-resources" : "send";
    writeState(state);
    window.location.href = nextUrl;
  }

  function findSendMerchantsLink() {
    return Array.from(document.querySelectorAll("a.a.arrow")).find((link) => {
      const text = (link.textContent || "").trim().toLowerCase();
      const onclick = link.getAttribute("onclick") || "";
      return text.includes("send merchant") || onclick.includes("openSendResourcesDialog");
    });
  }

  function findResourceDialogRoot() {
    const selector = ".resourceSelector, input[name='lumber'], input[name='clay'], input[name='iron'], input[name='crop']";
    const element = document.querySelector(selector);
    if (!element) {
      return null;
    }

    return element.closest("form") || element.closest(".dialog") || element.closest("[class*='dialog']") || document;
  }

  async function waitForResourceDialog(timeoutMs = 10000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const dialog = findResourceDialogRoot();
      if (dialog) {
        return dialog;
      }

      await wait(250);
    }

    return null;
  }

  function getAvailableMerchants(dialog) {
    const candidates = Array.from(dialog.querySelectorAll("div, span, p"));
    const merchantLine = candidates.find((element) => {
      const text = element.textContent || "";
      return text.includes("Merchants") && element.querySelector(".nominator");
    });

    if (!merchantLine) {
      return null;
    }

    const nominator = merchantLine.querySelector(".nominator");
    return parseNumber(nominator ? nominator.textContent : "");
  }

  function getResourceValidationError(dialog) {
    const validation = dialog.querySelector(".customValidationRenderElement.targetSelectionValidation.show");
    const message = validation ? validation.textContent.trim() : "";
    return message || "";
  }

  function fillAllResources(dialog) {
    const buttons = Array.from(dialog.querySelectorAll(".resourceSelector button.fillup:not([disabled])"));

    buttons.forEach((button) => {
      button.click();
    });

    return buttons.length;
  }

  function clickSendResourcesButton(dialog) {
    const button =
      dialog.querySelector("button.send[type='submit']") ||
      Array.from(dialog.querySelectorAll("button[type='submit'], button")).find((candidate) =>
        (candidate.textContent || "").trim().toLowerCase().includes("send resources")
      );

    if (!button || button.disabled) {
      return false;
    }

    button.click();
    return true;
  }

  async function handleResourceMapPage(state) {
    const delay = randomDelay(RESOURCE_MIN_DELAY_MS, RESOURCE_MAX_DELAY_MS);
    log(`On map page for village ${state.villageIds[state.index]}. Waiting ${delay}ms before opening merchants.`);
    await wait(delay);

    const merchantsLink = findSendMerchantsLink();
    if (!merchantsLink) {
      log("Send merchant(s) link not found on map page.");
      await reportExecutorError(state, "Send merchant(s) link not found.");
      state.index += 1;
      state.phase = "navigate";
      writeState(state);
      await goToNextVillageOrFinish(state);
      return true;
    }

    state.phase = "resources-dialog";
    writeState(state);
    merchantsLink.click();
    return handleResourceDialog(state);
  }

  async function handleResourceDialog(state) {
    const dialog = await waitForResourceDialog();
    if (!dialog) {
      log("Resource dialog did not open.");
      await reportExecutorError(state, "Resource dialog did not open.");
      state.index += 1;
      state.phase = "navigate";
      writeState(state);
      await goToNextVillageOrFinish(state);
      return true;
    }

    const validationError = getResourceValidationError(dialog);
    if (validationError) {
      log(`Resource send validation error: ${validationError}`);
      await reportExecutorError(state, validationError);
      cleanup(state, false);
      return true;
    }

    const availableMerchants = getAvailableMerchants(dialog);
    if (availableMerchants === 0) {
      const message = "No merchants available.";
      log(`${message} Village ${state.villageIds[state.index]} skipped.`);
      await reportExecutorError(state, message);
      state.index += 1;
      state.phase = "navigate";
      writeState(state);
      await goToNextVillageOrFinish(state);
      return true;
    }

    const filledButtons = fillAllResources(dialog);
    log(`Clicked ${filledButtons} resource fill buttons for village ${state.villageIds[state.index]}.`);

    await wait(500);

    const postFillValidationError = getResourceValidationError(dialog);
    if (postFillValidationError) {
      log(`Resource send validation error: ${postFillValidationError}`);
      await reportExecutorError(state, postFillValidationError);
      cleanup(state, false);
      return true;
    }

    const sent = clickSendResourcesButton(dialog);
    if (!sent) {
      log("Send resources button not found or disabled.");
      await reportExecutorError(state, "Send resources button not found or disabled.");
      state.index += 1;
      state.phase = "navigate";
      writeState(state);
      await goToNextVillageOrFinish(state);
      return true;
    }

    state.index += 1;
    state.phase = "navigate";
    writeState(state);
    log(`Sent resources from village ${state.villageIds[state.index - 1]}.`);

    await wait(randomDelay(RESOURCE_MIN_DELAY_MS, RESOURCE_MAX_DELAY_MS));
    await goToNextVillageOrFinish(state);
    return true;
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
      mode: getModeFromTargetUrl(parsedTarget),
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
      log(`Started new ${state.mode} run.`, state);
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

    if (state.phase === "open-resources") {
      await handleResourceMapPage(state);
      return;
    }

    if (state.phase === "resources-dialog") {
      await handleResourceDialog(state);
      return;
    }

    log(`Unknown phase "${state.phase}". Resetting executor state.`);
    cleanup(state, false);
  }

  window.addEventListener("load", () => {
    window.setTimeout(() => {
      startOrResume().catch((error) => {
        console.error("[Travian Executor] Unexpected error:", error);
        const state = readState();
        cleanup(state, false);
      });
    }, 250);
  });
})();
