(() => {
  'use strict';

  if (window.__YY_CODEX_USAGE_BRIDGE__) return;
  window.__YY_CODEX_USAGE_BRIDGE__ = true;

  const ENDPOINTS = [
    '/backend-api/codex/usage',
    '/backend-api/wham/usage'
  ];
  const POLL_MS = 60_000;
  const MESSAGE_DATA = 'YY_CODEX_USAGE_DATA';
  const MESSAGE_ERROR = 'YY_CODEX_USAGE_ERROR';
  const MESSAGE_REQUEST = 'YY_CODEX_USAGE_REQUEST';

  const nativeFetch = window.fetch.bind(window);
  let authHeader = null;
  let accountId = null;
  let lastPayload = null;
  let lastFetchAt = 0;
  let inFlight = null;
  let retryTimer = null;

  function post(type, payload = {}) {
    window.postMessage({ source: 'yy-codex-usage-meter', type, ...payload }, '*');
  }

  function isBackendUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname.includes('/backend-api/');
    } catch {
      return false;
    }
  }

  function isUsageUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && ENDPOINTS.some((p) => parsed.pathname === p);
    } catch {
      return false;
    }
  }

  function mergeHeaders(input, init) {
    const headers = new Headers();
    try {
      if (input instanceof Request) {
        input.headers.forEach((value, key) => headers.set(key, value));
      }
    } catch {}
    try {
      if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      }
    } catch {}
    return headers;
  }

  function captureAuth(headers, url) {
    if (!isBackendUrl(url)) return;

    const nextAuth = headers.get('authorization');
    const nextAccount = headers.get('chatgpt-account-id') || headers.get('ChatGPT-Account-Id');
    const changed =
      (nextAuth && nextAuth !== authHeader) ||
      (nextAccount && nextAccount !== accountId);

    if (nextAuth) authHeader = nextAuth;
    if (nextAccount) accountId = nextAccount;

    if (changed) {
      setTimeout(() => refresh(true), 0);
    }
  }

  function emitPayload(payload) {
    if (!payload?.rate_limit) return;
    lastPayload = payload;
    post(MESSAGE_DATA, { payload, fetchedAt: Date.now() });
  }

  async function inspectUsageResponse(response, url) {
    if (!isUsageUrl(url)) return;
    try {
      if (!response.ok) return;
      const payload = await response.clone().json();
      emitPayload(payload);
    } catch {}
  }

  window.fetch = function patchedFetch(input, init) {
    let url = '';
    try {
      url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
      captureAuth(mergeHeaders(input, init), url);
    } catch {}

    const promise = nativeFetch(input, init);
    promise.then((response) => inspectUsageResponse(response, url)).catch(() => {});
    return promise;
  };

  // 保持常见的函数检查尽量接近原生表现。
  try {
    Object.defineProperty(window.fetch, 'name', { value: 'fetch' });
    window.fetch.toString = nativeFetch.toString.bind(nativeFetch);
  } catch {}

  // XHR 兼容：如果网页以后把认证或 usage 请求改走 XHR，也可以继续工作。
  const xhrMeta = new WeakMap();
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    xhrMeta.set(this, { url: String(url), headers: new Headers() });
    return nativeOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const meta = xhrMeta.get(this);
    if (meta) {
      try { meta.headers.set(name, value); } catch {}
    }
    return nativeSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    const meta = xhrMeta.get(this);
    if (meta) {
      captureAuth(meta.headers, meta.url);
      if (isUsageUrl(meta.url)) {
        this.addEventListener('load', () => {
          try {
            if (this.status >= 200 && this.status < 300) {
              emitPayload(JSON.parse(this.responseText));
            }
          } catch {}
        }, { once: true });
      }
    }
    return nativeSend.apply(this, args);
  };

  function requestHeaders() {
    const headers = new Headers({ Accept: 'application/json' });
    if (authHeader) headers.set('Authorization', authHeader);
    if (accountId) headers.set('ChatGPT-Account-Id', accountId);
    return headers;
  }

  async function fetchEndpoint(path) {
    const response = await nativeFetch(path, {
      method: 'GET',
      headers: requestHeaders(),
      credentials: 'include',
      cache: 'no-store'
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const payload = await response.json();
    if (!payload?.rate_limit) throw new Error('usage response missing rate_limit');
    return payload;
  }

  async function refresh(force = false) {
    const now = Date.now();
    if (!force && now - lastFetchAt < POLL_MS) {
      if (lastPayload) emitPayload(lastPayload);
      return lastPayload;
    }
    if (inFlight) return inFlight;

    inFlight = (async () => {
      let lastError = null;
      for (const endpoint of ENDPOINTS) {
        try {
          const payload = await fetchEndpoint(endpoint);
          lastFetchAt = Date.now();
          emitPayload(payload);
          return payload;
        } catch (error) {
          lastError = error;
        }
      }

      post(MESSAGE_ERROR, {
        message: lastError?.message || 'Unable to read Codex usage',
        hasAuth: Boolean(authHeader),
        hasAccountId: Boolean(accountId)
      });
      throw lastError || new Error('Unable to read Codex usage');
    })().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => refresh(true).catch(() => {}), 4_000);
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'yy-codex-usage-widget') return;
    if (data.type === MESSAGE_REQUEST) {
      if (lastPayload && Date.now() - lastFetchAt < POLL_MS) emitPayload(lastPayload);
      refresh(Boolean(data.force)).catch(() => scheduleRetry());
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastFetchAt >= POLL_MS) {
      refresh(true).catch(() => scheduleRetry());
    }
  });

  setTimeout(() => refresh(true).catch(() => scheduleRetry()), 1_500);
  setInterval(() => refresh(false).catch(() => {}), POLL_MS);
})();
