/* Regression tests for timeout detection, retry targeting and resilience settings. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'resilience.js');
let src = fs.readFileSync(srcPath, 'utf8');

const injected = `
  const __assert = (label, cond, actual) => {
    if (!cond) throw new Error(label + ': ' + JSON.stringify(actual));
    console.log('PASS ' + label);
  };

  __assert('uses isolated resilience storage key', SETTINGS_KEY === 'yyChatgptResilienceSettings', SETTINGS_KEY);
  __assert('matches Chinese timeout text', timeoutTextMatches('消息发送超时，请重试。') === true, null);
  __assert('matches English timeout text', timeoutTextMatches('Message sending timed out. Please try again') === true, null);
  __assert('does not match generic network error', timeoutTextMatches('Network error. Please reconnect.') === false, null);
  __assert('default recovery text is continue', DEFAULTS.timeoutRecoveryText === '继续', DEFAULTS.timeoutRecoveryText);
  __assert('default recovery limit is three', DEFAULTS.timeoutRecoveryMax === 3, DEFAULTS.timeoutRecoveryMax);
  __assert('default keepalive interval is four minutes', DEFAULTS.keepAliveIntervalMinutes === 4, DEFAULTS.keepAliveIntervalMinutes);

  settings = {
    ...DEFAULTS,
    timeoutRecoveryText: 'x'.repeat(80),
    timeoutRecoveryDelayMs: 1,
    timeoutRecoveryMax: 99,
    keepAliveIntervalMinutes: 99
  };
  normalizeSettings();
  __assert('recovery text is capped at 40 chars', settings.timeoutRecoveryText.length === 40, settings.timeoutRecoveryText.length);
  __assert('recovery delay lower bound is 500ms', settings.timeoutRecoveryDelayMs === 500, settings.timeoutRecoveryDelayMs);
  __assert('recovery max upper bound is 10', settings.timeoutRecoveryMax === 10, settings.timeoutRecoveryMax);
  __assert('keepalive upper bound is 30 minutes', settings.keepAliveIntervalMinutes === 30, settings.keepAliveIntervalMinutes);

  settings = { ...DEFAULTS, timeoutRecoveryDelayMs: 999999, timeoutRecoveryMax: -4, keepAliveIntervalMinutes: 0.1 };
  normalizeSettings();
  __assert('recovery delay upper bound is 10s', settings.timeoutRecoveryDelayMs === 10000, settings.timeoutRecoveryDelayMs);
  __assert('invalid negative recovery max falls back then clamps safely', settings.timeoutRecoveryMax === 1, settings.timeoutRecoveryMax);
  __assert('keepalive lower bound is one minute', settings.keepAliveIntervalMinutes === 1, settings.keepAliveIntervalMinutes);

  const retryButton = {
    innerText: '', textContent: '', disabled: false,
    getAttribute(name) { return name === 'aria-label' ? 'Retry' : null; }
  };
  const retryRoot = {
    nodeType: Node.ELEMENT_NODE,
    parentElement: null,
    querySelectorAll(selector) { return selector === 'button' ? [retryButton] : []; }
  };
  __assert('retry can be found from aria-label only', retryButtonNear(retryRoot) === retryButton, null);

  const timeoutNode = { nodeType: Node.ELEMENT_NODE, textContent: '消息发送超时，请重试' };
  __assert('node timeout detection uses visible text', nodeHasTimeout(timeoutNode) === true, null);

  const input = {
    value: '',
    focus() {},
    dispatchEvent() {}
  };
  __assert('fallback recovery text can be written into textarea-like composer', writeComposer(input, '继续') === true && input.value === '继续', input.value);
`;

const pos = src.lastIndexOf('})();');
if (pos < 0) throw new Error('Unable to locate resilience IIFE end');
src = src.slice(0, pos) + injected + '\n' + src.slice(pos);

const noop = () => {};
globalThis.window = globalThis;
window.__YY_CHATGPT_RESILIENCE__ = false;
window.addEventListener = noop;
window.setInterval = () => 1;
window.clearInterval = noop;
window.setTimeout = setTimeout;
window.clearTimeout = clearTimeout;
globalThis.location = { pathname: '/c/test' };
globalThis.navigator = { language: 'zh-CN', onLine: true };
globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
globalThis.Event = class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
globalThis.InputEvent = globalThis.Event;
globalThis.document = {
  documentElement: {},
  addEventListener: noop,
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById() { return null; },
  createElement() { return { style: {}, appendChild: noop }; },
  createRange() { return { selectNodeContents: noop }; },
  execCommand() { return true; },
  hidden: false
};
globalThis.chrome = {
  storage: {
    sync: {
      async get() { return {}; },
      async set() {}
    },
    onChanged: { addListener: noop }
  }
};
globalThis.MutationObserver = class MutationObserver { observe() {} };
globalThis.fetch = async () => ({ ok: true, status: 200 });

globalThis.getSelection = () => ({ removeAllRanges: noop, addRange: noop });

vm.runInThisContext(src, { filename: srcPath });
console.log('All resilience tests passed');
