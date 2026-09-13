(() => {
'use strict';
if (window.__YY_CHATGPT_RESILIENCE__) return;
window.__YY_CHATGPT_RESILIENCE__ = true;
const SETTINGS_KEY = 'yyCodexUsageMeterSettings';
const STYLE_ID = 'yy-chatgpt-resilience-style';
const SECTION_ID = 'yy-chatgpt-resilience-settings';
const DEFAULTS = Object.freeze({
keepAlive: true,
autoRecoverTimeout: true,
timeoutRecoveryText: '继续',
timeoutRecoveryDelayMs: 2000,
timeoutRecoveryMax: 3,
keepAliveIntervalMinutes: 4
});
const TIMEOUT_PATTERNS = [
/消息发送超时[，,。\s]*请重试/i,
/message\s+(?:sending|send)\s+timed\s+out[.,!\s]*please\s+(?:retry|try\s+again)/i,
/message\s+timed\s+out[.,!\s]*please\s+(?:retry|try\s+again)/i
];
const RETRY_TEXT = /^(?:重试|重新发送|再次尝试|retry|try again)$/i;
const COOLDOWN_MS = 15_000;
const KEEPALIVE_MIN_MS = 60_000;
const KEEPALIVE_MAX_MS = 30 * 60_000;
let settings = { ...DEFAULTS };
let recoveryAttempts = 0;
let lastTimeoutHandledAt = 0;
let recoveryTimer = 0;
let recoveryResetTimer = 0;
let keepAliveTimer = 0;
let lastKeepAliveAt = 0;
let lastPathname = location.pathname;
let lastStatus = '';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function timeoutTextMatches(value) {
const text = String(value || '').replace(/\s+/g, ' ').trim();
if (!text) return false;
return TIMEOUT_PATTERNS.some((pattern) => pattern.test(text));
}
function language() {
const picker = document.querySelector('.yy-cum-settings-panel [data-setting="language"]');
const value = picker?.value;
if (value === 'zh' || value === 'en') return value;
return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
function words() {
if (language() === 'zh') {
return {
title: '连接稳定性', keepAlive: '页面连接保活', autoRecover: '发送超时自动恢复',
recoveryText: '恢复消息', delay: '恢复延迟', max: '最大连续恢复', status: '状态',
active: '运行中', disabled: '已关闭', offline: '离线', recovered: '已自动恢复',
busy: '等待当前生成结束', inputBusy: '输入框已有内容，已暂停自动恢复',
retrying: '正在重试原消息', continuing: '正在发送恢复消息', exhausted: '达到恢复上限，已停止',
keepAliveOk: '保活正常', keepAliveFail: '保活请求失败'
};
}
return {
title: 'Connection resilience', keepAlive: 'Keep page connection alive', autoRecover: 'Auto-recover send timeout',
recoveryText: 'Recovery message', delay: 'Recovery delay', max: 'Max consecutive recovery', status: 'Status',
active: 'Active', disabled: 'Disabled', offline: 'Offline', recovered: 'Recovered automatically',
busy: 'Waiting for generation to finish', inputBusy: 'Composer is not empty; auto-recovery paused',
retrying: 'Retrying original message', continuing: 'Sending recovery message', exhausted: 'Recovery limit reached; stopped',
keepAliveOk: 'Keep-alive OK', keepAliveFail: 'Keep-alive request failed'
};
}
async function readSettings() {
try {
const stored = await chrome.storage.sync.get(SETTINGS_KEY);
const source = stored?.[SETTINGS_KEY];
if (source && typeof source === 'object') settings = { ...DEFAULTS, ...source };
} catch {}
normalizeSettings();
syncUi();
restartKeepAlive();
}
function normalizeSettings() {
settings.keepAlive = settings.keepAlive !== false;
settings.autoRecoverTimeout = settings.autoRecoverTimeout !== false;
settings.timeoutRecoveryText = String(settings.timeoutRecoveryText || DEFAULTS.timeoutRecoveryText).slice(0, 40);
settings.timeoutRecoveryDelayMs = clamp(Number(settings.timeoutRecoveryDelayMs) || DEFAULTS.timeoutRecoveryDelayMs, 500, 10_000);
settings.timeoutRecoveryMax = clamp(Math.round(Number(settings.timeoutRecoveryMax) || DEFAULTS.timeoutRecoveryMax), 1, 10);
settings.keepAliveIntervalMinutes = clamp(Number(settings.keepAliveIntervalMinutes) || DEFAULTS.keepAliveIntervalMinutes, 1, 30);
}
async function patchSettings(patch) {
settings = { ...settings, ...patch };
normalizeSettings();
try {
const stored = await chrome.storage.sync.get(SETTINGS_KEY);
const source = stored?.[SETTINGS_KEY] && typeof stored[SETTINGS_KEY] === 'object' ? stored[SETTINGS_KEY] : {};
await chrome.storage.sync.set({ [SETTINGS_KEY]: { ...source, ...patch } });
} catch {}
syncUi();
restartKeepAlive();
}
function setStatus(text) {
lastStatus = String(text || '');
const node = document.querySelector(`#${SECTION_ID} [data-resilience-status]`);
if (node) node.textContent = lastStatus || (settings.autoRecoverTimeout || settings.keepAlive ? words().active : words().disabled);
}
function installStyle() {
if (document.getElementById(STYLE_ID)) return;
const style = document.createElement('style');
style.id = STYLE_ID;
style.textContent = `
#${SECTION_ID}{margin:9px 0 0;padding:9px 0 0;border-top:1px solid rgba(127,127,127,.18)}
#${SECTION_ID} .yy-res-title{font-size:12px;font-weight:750;margin:0 0 5px;opacity:.9}
#${SECTION_ID} .yy-res-line{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px;min-height:30px}
#${SECTION_ID} .yy-res-line.yy-res-value{grid-template-columns:88px 1fr 38px}
#${SECTION_ID} .yy-res-line.yy-res-text{grid-template-columns:88px 1fr}
#${SECTION_ID} input[type="checkbox"]{width:16px;height:16px;margin:0;cursor:pointer}
#${SECTION_ID} input[type="text"],#${SECTION_ID} input[type="number"]{box-sizing:border-box;width:100%;height:27px;border:1px solid rgba(127,127,127,.25);border-radius:7px;padding:0 7px;background:rgba(127,127,127,.08);color:inherit;font:inherit;outline:none}
#${SECTION_ID} input[type="number"]{text-align:right;font-variant-numeric:tabular-nums}
#${SECTION_ID} .yy-res-unit{text-align:right;opacity:.62;font-variant-numeric:tabular-nums}
#${SECTION_ID} .yy-res-status{margin-top:5px;min-height:16px;font-size:11px;line-height:1.35;opacity:.62}
`;
document.documentElement.appendChild(style);
}
function ensureSettingsUi() {
const panel = document.querySelector('.yy-cum-settings-panel');
if (!panel || panel.querySelector(`#${SECTION_ID}`)) return;
installStyle();
const section = document.createElement('div');
section.id = SECTION_ID;
section.innerHTML = `
<div class="yy-res-title" data-res-i18n="title"></div>
<label class="yy-res-line"><span data-res-i18n="keepAlive"></span><input type="checkbox" data-res-setting="keepAlive"></label>
<label class="yy-res-line"><span data-res-i18n="autoRecover"></span><input type="checkbox" data-res-setting="autoRecoverTimeout"></label>
<label class="yy-res-line yy-res-text"><span data-res-i18n="recoveryText"></span><input type="text" maxlength="40" data-res-setting="timeoutRecoveryText"></label>
<label class="yy-res-line yy-res-value"><span data-res-i18n="delay"></span><input type="number" min="0.5" max="10" step="0.5" data-res-setting="timeoutRecoveryDelaySeconds"><span class="yy-res-unit">s</span></label>
<label class="yy-res-line yy-res-value"><span data-res-i18n="max"></span><input type="number" min="1" max="10" step="1" data-res-setting="timeoutRecoveryMax"><span class="yy-res-unit">×</span></label>
<div class="yy-res-status"><span data-res-i18n="status"></span>: <span data-resilience-status></span></div>`;
const actions = panel.querySelector('.yy-cum-settings-actions');
if (actions) panel.insertBefore(section, actions);
else panel.appendChild(section);
section.addEventListener('click', (event) => event.stopPropagation());
section.addEventListener('pointerdown', (event) => event.stopPropagation());
section.querySelector('[data-res-setting="keepAlive"]')?.addEventListener('change', (event) => patchSettings({ keepAlive: event.target.checked }));
section.querySelector('[data-res-setting="autoRecoverTimeout"]')?.addEventListener('change', (event) => patchSettings({ autoRecoverTimeout: event.target.checked }));
section.querySelector('[data-res-setting="timeoutRecoveryText"]')?.addEventListener('change', (event) => patchSettings({ timeoutRecoveryText: event.target.value.trim() || DEFAULTS.timeoutRecoveryText }));
section.querySelector('[data-res-setting="timeoutRecoveryDelaySeconds"]')?.addEventListener('change', (event) => patchSettings({ timeoutRecoveryDelayMs: clamp(Number(event.target.value) || 2, .5, 10) * 1000 }));
section.querySelector('[data-res-setting="timeoutRecoveryMax"]')?.addEventListener('change', (event) => patchSettings({ timeoutRecoveryMax: clamp(Math.round(Number(event.target.value) || 3), 1, 10) }));
syncUi();
}
function syncUi() {
ensureSettingsUi();
const section = document.getElementById(SECTION_ID);
if (!section) return;
const dict = words();
section.querySelectorAll('[data-res-i18n]').forEach((node) => {
const key = node.dataset.resI18n;
if (dict[key]) node.textContent = dict[key];
});
const set = (key, value, prop = 'value') => {
const node = section.querySelector(`[data-res-setting="${key}"]`);
if (node) node[prop] = value;
};
set('keepAlive', settings.keepAlive, 'checked');
set('autoRecoverTimeout', settings.autoRecoverTimeout, 'checked');
set('timeoutRecoveryText', settings.timeoutRecoveryText);
set('timeoutRecoveryDelaySeconds', String(settings.timeoutRecoveryDelayMs / 1000));
set('timeoutRecoveryMax', String(settings.timeoutRecoveryMax));
setStatus(lastStatus);
}
function isGenerating() {
return Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop generating" i], button[aria-label*="停止生成" i]'));
}
function composer() {
return document.querySelector('#prompt-textarea, textarea[data-id="root"], [contenteditable="true"][data-lexical-editor="true"]');
}
function composerText(node) {
if (!node) return '';
if ('value' in node && typeof node.value === 'string') return node.value.trim();
return String(node.innerText || node.textContent || '').trim();
}
function sendButton() {
const selectors = [
'button[data-testid="send-button"]',
'button[aria-label*="Send prompt" i]',
'button[aria-label*="Send message" i]',
'button[aria-label*="发送" i]'
];
for (const selector of selectors) {
const button = document.querySelector(selector);
if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button;
}
return null;
}
function retryButtonNear(node) {
let root = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
for (let depth = 0; root && depth < 7; depth += 1, root = root.parentElement) {
const buttons = root.querySelectorAll?.('button') || [];
for (const button of buttons) {
const visible = String(button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim();
const aria = String(button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
if ((RETRY_TEXT.test(visible) || RETRY_TEXT.test(aria)) && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button;
}
}
return null;
}
function writeComposer(node, text) {
if (!node) return false;
node.focus();
if ('value' in node && typeof node.value === 'string') {
const proto = Object.getPrototypeOf(node);
const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
if (descriptor?.set) descriptor.set.call(node, text);
else node.value = text;
node.dispatchEvent(new Event('input', { bubbles: true }));
node.dispatchEvent(new Event('change', { bubbles: true }));
return composerText(node) === text;
}
try {
const selection = window.getSelection();
const range = document.createRange();
range.selectNodeContents(node);
selection.removeAllRanges();
selection.addRange(range);
document.execCommand('insertText', false, text);
} catch {}
if (composerText(node) !== text) node.textContent = text;
try {
node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
} catch {
node.dispatchEvent(new Event('input', { bubbles: true }));
}
return composerText(node) === text;
}
function nodeHasTimeout(node) {
if (!node) return false;
const text = node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.textContent;
return timeoutTextMatches(text);
}
function findExistingTimeoutNode() {
const selectors = '[role="alert"], [data-testid*="error" i], [class*="error" i], [class*="danger" i]';
for (const node of document.querySelectorAll(selectors)) {
if (nodeHasTimeout(node)) return node;
}
return null;
}
function armRecoveryReset() {
if (recoveryResetTimer) clearTimeout(recoveryResetTimer);
recoveryResetTimer = window.setTimeout(() => {
recoveryAttempts = 0;
recoveryResetTimer = 0;
if (settings.autoRecoverTimeout || settings.keepAlive) setStatus(words().active);
}, 60_000);
}
function recheckAfterAttempt(candidate) {
window.setTimeout(() => {
const existing = candidate?.isConnected && nodeHasTimeout(candidate) ? candidate : findExistingTimeoutNode();
if (!existing || isGenerating()) return;
lastTimeoutHandledAt = 0;
scheduleRecovery(existing);
}, 20_000);
}
async function recoverFromTimeout(candidate) {
recoveryTimer = 0;
if (!settings.autoRecoverTimeout || !navigator.onLine) return;
if (candidate && !candidate.isConnected && !findExistingTimeoutNode()) return;
if (candidate?.isConnected && !nodeHasTimeout(candidate) && !findExistingTimeoutNode()) return;
const dict = words();
if (recoveryAttempts >= settings.timeoutRecoveryMax) {
setStatus(dict.exhausted);
return;
}
if (isGenerating()) {
setStatus(dict.busy);
return;
}
const retry = retryButtonNear(candidate || findExistingTimeoutNode());
if (retry) {
recoveryAttempts += 1;
setStatus(`${dict.retrying} (${recoveryAttempts}/${settings.timeoutRecoveryMax})`);
retry.click();
armRecoveryReset();
recheckAfterAttempt(candidate);
return;
}
const input = composer();
if (!input) return;
if (composerText(input)) {
setStatus(dict.inputBusy);
return;
}
if (!writeComposer(input, settings.timeoutRecoveryText)) return;
await sleep(120);
const send = sendButton();
if (!send || isGenerating()) return;
recoveryAttempts += 1;
setStatus(`${dict.continuing} (${recoveryAttempts}/${settings.timeoutRecoveryMax})`);
send.click();
armRecoveryReset();
recheckAfterAttempt(candidate);
}
function scheduleRecovery(candidate) {
if (!settings.autoRecoverTimeout) return;
const now = Date.now();
if (now - lastTimeoutHandledAt < COOLDOWN_MS || recoveryTimer) return;
lastTimeoutHandledAt = now;
if (recoveryAttempts >= settings.timeoutRecoveryMax) {
setStatus(words().exhausted);
return;
}
recoveryTimer = window.setTimeout(() => recoverFromTimeout(candidate), settings.timeoutRecoveryDelayMs);
}
function inspectMutationNode(node) {
if (!node) return;
if (nodeHasTimeout(node)) scheduleRecovery(node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
}
const timeoutObserver = new MutationObserver((mutations) => {
for (const mutation of mutations) {
if (mutation.type === 'characterData') inspectMutationNode(mutation.target);
else for (const node of mutation.addedNodes) inspectMutationNode(node);
}
});
async function keepAliveTick() {
if (!settings.keepAlive || !navigator.onLine) {
if (!navigator.onLine) setStatus(words().offline);
return;
}
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8_000);
try {
const response = await fetch('/api/auth/session', {
method: 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
});
lastKeepAliveAt = Date.now();
if (response.ok) setStatus(words().keepAliveOk);
else setStatus(`${words().keepAliveFail} (${response.status})`);
} catch {
setStatus(words().keepAliveFail);
} finally {
clearTimeout(timer);
}
}
function restartKeepAlive() {
if (keepAliveTimer) clearInterval(keepAliveTimer);
keepAliveTimer = 0;
if (!settings.keepAlive) return;
const interval = clamp(settings.keepAliveIntervalMinutes * 60_000, KEEPALIVE_MIN_MS, KEEPALIVE_MAX_MS);
keepAliveTimer = window.setInterval(keepAliveTick, interval);
}
function resetConversationState() {
recoveryAttempts = 0;
lastTimeoutHandledAt = 0;
if (recoveryTimer) clearTimeout(recoveryTimer);
if (recoveryResetTimer) clearTimeout(recoveryResetTimer);
recoveryTimer = 0;
recoveryResetTimer = 0;
setStatus(settings.keepAlive || settings.autoRecoverTimeout ? words().active : words().disabled);
}
document.addEventListener('change', (event) => {
if (event.target?.matches?.('.yy-cum-settings-panel [data-setting="language"]')) syncUi();
}, true);
window.addEventListener('online', () => {
setStatus(words().active);
if (settings.keepAlive && Date.now() - lastKeepAliveAt > 30_000) keepAliveTick();
});
window.addEventListener('offline', () => setStatus(words().offline));
document.addEventListener('visibilitychange', () => {
if (!document.hidden && settings.keepAlive) {
const interval = clamp(settings.keepAliveIntervalMinutes * 60_000, KEEPALIVE_MIN_MS, KEEPALIVE_MAX_MS);
if (Date.now() - lastKeepAliveAt >= interval) keepAliveTick();
}
});
chrome.storage.onChanged.addListener((changes, area) => {
if (area !== 'sync' || !changes[SETTINGS_KEY]) return;
const next = changes[SETTINGS_KEY].newValue;
if (next && typeof next === 'object') {
settings = { ...DEFAULTS, ...next };
normalizeSettings();
syncUi();
restartKeepAlive();
}
});
timeoutObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
window.setInterval(() => {
if (location.pathname !== lastPathname) {
lastPathname = location.pathname;
resetConversationState();
}
ensureSettingsUi();
}, 1000);
readSettings().then(() => {
ensureSettingsUi();
const existing = findExistingTimeoutNode();
if (existing) scheduleRecovery(existing);
});
})();
