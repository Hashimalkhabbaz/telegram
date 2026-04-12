// ==UserScript==
// @name         Travian Farm Heartbeat + Attack Alert
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Ping Render when the farm page is visited and only send Telegram alerts for attacks
// @match        https://eternos.x3.hispano.travian.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      telegram-lhmf.onrender.com
// @connect      api.telegram.org
// ==/UserScript==

(function () {
    'use strict';

    const TELEGRAM_BOT_TOKEN = "7938237788:AAFcUwr3jC_6Ju47lCQeXVTjlyhthT3TM-c";
    const TELEGRAM_CHAT_IDS = ["747431078", "2053823460"];
    const MONITOR_URL = "https://telegram-lhmf.onrender.com/ping";
    const PING_SECRET = "11223344";
    const ATTACK_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

    const url = window.location.href;
    const isFarmPage =
        url.includes("build.php?gid=16&tt=99") ||
        /build\.php\?.*gid=16.*tt=99/.test(url);

    function cleanText(text) {
        return (text || "")
            .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
            .replace(/[()]/g, '')
            .trim();
    }

    function collectAttackEntries() {
        return Array.from(document.querySelectorAll('.listEntry.village'))
            .filter(entry => entry.classList.contains('attack'));
    }

    function getStoredValue(key, defaultValue) {
        try {
            if (typeof GM_getValue === 'function') {
                return GM_getValue(key, defaultValue);
            }
        } catch (error) {
            console.error(`Failed to read ${key}:`, error);
        }

        return defaultValue;
    }

    function setStoredValue(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(key, value);
            }
        } catch (error) {
            console.error(`Failed to write ${key}:`, error);
        }
    }

    function sendHeartbeat(now) {
        GM_xmlhttpRequest({
            method: "POST",
            url: MONITOR_URL,
            headers: {
                "Content-Type": "application/json",
                "x-ping-secret": PING_SECRET
            },
            data: JSON.stringify({
                url,
                visitedAt: now.toISOString(),
                page: "farm"
            }),
            onerror: (err) => console.error("Monitor ping failed:", err)
        });
    }

    function sendTelegramNotification(message) {
        TELEGRAM_CHAT_IDS.forEach(chatId => {
            GM_xmlhttpRequest({
                method: "POST",
                url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify({
                    chat_id: chatId,
                    text: message
                }),
                onerror: (err) => console.error("Telegram send failed:", err)
            });
        });
    }

    function maybeSendAttackAlert() {
        const attackEntries = collectAttackEntries();

        if (attackEntries.length === 0) {
            setStoredValue('lastAttackSignature', '');
            return;
        }

        const villages = attackEntries.map(entry => {
            const name = cleanText(entry.querySelector('.name')?.textContent) || 'Unknown';
            const x = cleanText(entry.querySelector('.coordinateX')?.textContent) || '?';
            const y = cleanText(entry.querySelector('.coordinateY')?.textContent) || '?';
            return `${name} (${x}|${y})`;
        });

        const signature = villages.join(' | ');
        const nowMs = Date.now();
        const lastAlertAt = Number(getStoredValue('lastAttackAlertAt', 0));
        const lastSignature = getStoredValue('lastAttackSignature', '');
        const isSameRecentAlert =
            signature === lastSignature &&
            nowMs - lastAlertAt < ATTACK_ALERT_COOLDOWN_MS;

        if (isSameRecentAlert) {
            return;
        }

        setStoredValue('lastAttackAlertAt', nowMs);
        setStoredValue('lastAttackSignature', signature);

        const message =
            "⚔️ Attack alert detected.\n" +
            `Villages under attack:\n• ${villages.join('\n• ')}\n` +
            `${url}`;

        sendTelegramNotification(message);
    }

    window.addEventListener('load', () => {
        setTimeout(() => {
            if (isFarmPage) {
                sendHeartbeat(new Date());
            }

            maybeSendAttackAlert();
        }, 2000);
    });
})();
