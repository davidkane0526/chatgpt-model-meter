(() => {
  'use strict';

  // MAIN world, read-only observation only. Never mutates ChatGPT request bodies or auth headers.
  if (window.__YY_MUM_MODEL__) return;
  window.__YY_MUM_MODEL__ = true;

  const OUT = 'yy-mum-model';
  const IN = 'yy-mum-widget';
  const MAX_TEXT = 2 * 1024 * 1024;
  const MAX_STREAM = 64 * 1024 * 1024;
  const MAX_TURNS = 1;
  const KEEP_TURNS = 8;
  const MAX_DEPTH = 16;

  const SKIP = new Set([
    'content', 'parts', 'text', 'prompt', 'tools', 'attachments', 'safe_urls',
    'citations', 'thoughts', 'search_result_groups', 'image_results',
    'finished_text', 'initial_text', 'blocked_urls', 'aggregate_result'
  ]);

  const SLUG = /^[\w.:+/-]{1,120}$/;
  const ECHO_KEYS = new Set(['model_slug', 'resolved_model_slug']);
  const EXEC_KEYS = new Set([
    'model_slug', 'resolved_model_slug', 'actual_model_slug',
    'execution_model_slug', 'served_model_slug', 'inference_model_slug'
  ]);
  const STE_NAME = /(?:^|[./_])(?:server_)?ste_metadata(?:$|[./_])/i;
  const STE_SIGNATURE_KEYS = [
    'requested_model_experience', 'did_auto_switch_to_reasoning',
    'is_autoswitcher_enabled', 'auto_switcher_race_winner',
    'server_ttfvt_ms', 'cluster_region', 'turn_use_case', 'product_experience'
  ];
  const STE_FLAGS = [
    'product_experience', 'requested_model_experience',
    'did_auto_switch_to_reasoning', 'is_autoswitcher_enabled',
    'auto_switcher_race_winner', 'is_search', 'tool_invoked', 'tool_name',
    'turn_use_case', 'plan_type', 'server_ttfvt_ms', 'cluster_region'
  ];

  let serial = 0;
  let paused = false;
  let flushTimer = 0;
  const turns = [];
  const notes = [];
  const msgOwner = new Map();

  const parse = (s) => {
    try { return typeof s === 'string' && s.length <= MAX_TEXT ? JSON.parse(s) : null; }
    catch { return null; }
  };
  const id = (v) => typeof v === 'string' && SLUG.test(v) ? v : '';
  const text = (v) => typeof v === 'string' ? v.replace(/[\x00-\x1f]/g, '').slice(0, 120) : '';

  function note(s) {
    if (!notes.includes(s)) notes.push(s);
    while (notes.length > 6) notes.shift();
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      window.postMessage({
        source: OUT,
        type: 'YY_MUM_DATA',
        snapshot: {
          v: 3,
          paused,
          notes: [...notes],
          turns: turns.slice(-MAX_TURNS).reverse().map((t) => ({
            n: t.n,
            t: t.time,
            api: t.api,
            ui: t.ui,
            requested: t.requested,
            effort: t.effort,
            exec: [...t.exec],
            execEvidence: t.execEvidence.map((e) => ({ ...e })),
            echo: [...t.echo],
            flags: { ...t.flags },
            paths: [...t.paths],
            events: [...t.events],
            transports: [...t.transports],
            state: t.state,
            approx: t.approx,
            closed: t.closed
          }))
        }
      }, '*');
    }, 80);
  }

  /* ---------------- UI-selected model label (diagnostic only) ---------------- */

  const MODEL_TEXT = /(?:gpt[-\s]?\d|\bo\d\b|auto|thinking|instant|pro\b|mini\b|luna|sol\b|astra|terra)/i;
  const TOOL_TEXT = /deep research|study mode|canvas|image|voice|search|connector|plugin/i;

  function candidateLabel(node) {
    if (!node) return '';
    const s = text((node.textContent || '').trim());
    if (!s || s.length > 48 || TOOL_TEXT.test(s) || !MODEL_TEXT.test(s)) return '';
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return '';
    return s;
  }

  function uiLabel() {
    const found = [];
    const add = (node) => {
      const s = candidateLabel(node);
      if (s && !found.includes(s)) found.push(s);
    };

    let root = document.getElementById('prompt-textarea');
    for (let i = 0; root && i < 9; i++, root = root.parentElement) {
      root.querySelectorAll?.(
        '[class*="composer-pill"],[class*="SliderTriggerModelLabel"],[data-testid*="model-switcher"],button[aria-haspopup="menu"]'
      ).forEach(add);
      if (found.length) return found[0];
    }

    document.querySelectorAll?.('[data-testid*="model-switcher"],[aria-label*="model" i]').forEach(add);
    return found.length === 1 ? found[0] : '';
  }

  /* ---------------- endpoint recognition ---------------- */

  function endpoint(raw) {
    try {
      const u = new URL(raw, location.href);
      if (u.origin !== location.origin) return null;
      if (/^\/backend-api\/f\/conversation\/?$/.test(u.pathname)) return { kind: 'send', api: 'f/conversation' };
      if (/^\/backend-api\/conversation\/?$/.test(u.pathname)) return { kind: 'send', api: 'conversation' };

      const status = u.pathname.match(/^\/backend-api\/(?:f\/)?conversation\/([\w-]+)\/(stream_status|stream)\/?$/);
      if (status) return { kind: 'resume', api: status[2], conversation: status[1] };

      if (/^\/(ces|cdn|assets|_next|static)\//.test(u.pathname)) return null;
      if (/\/(sentinel|settings|pets|conversations|gizmos|models)(\/|$)/.test(u.pathname)) return null;

      return {
        kind: 'sniff',
        api: u.pathname.replace(/\/[0-9a-f-]{16,}/gi, '/{id}').replace('/backend-api/', '').slice(0, 56)
      };
    } catch { return null; }
  }

  /* ---------------- turn records ---------------- */

  function requestModel(body) {
    return id(body?.model) || id(body?.requested_model) || id(body?.requested_model_slug) || '';
  }

  function startTurn(body, api) {
    const b = typeof body === 'string' ? parse(body) : body;
    if (!b || typeof b !== 'object') {
      note('请求体不可读，本次未建立记录');
      return null;
    }

    const t = {
      n: ++serial,
      time: Date.now(),
      api,
      conversation: id(b.conversation_id),
      exchange: id(b.turn_exchange_id),
      turnId: id(b.turn_id) || id(b.working_turn_id),
      userIds: (Array.isArray(b.messages) ? b.messages : [])
        .filter((m) => m?.author?.role === 'user')
        .map((m) => id(m.id)).filter(Boolean),
      ui: uiLabel(),
      requested: requestModel(b),
      effort: id(b.thinking_effort) || id(b.reasoning_effort),
      exec: [],
      execEvidence: [],
      echo: [],
      flags: {},
      paths: [], events: [], transports: [],
      state: '已发送',
      approx: false,
      closed: false
    };

    turns.push(t);
    while (turns.length > KEEP_TURNS) turns.shift();
    flush();
    return t;
  }

  function mark(t, transport) {
    if (t && transport && !t.transports.includes(transport)) t.transports.push(transport);
  }

  function seenEvent(t, name) {
    if (!t || !name) return;
    const s = text(name).slice(0, 48);
    if (s && !t.events.includes(s)) {
      t.events.push(s);
      while (t.events.length > 24) t.events.shift();
    }
  }

  function rememberPath(t, path) {
    if (!t || !path || t.paths.includes(path)) return;
    t.paths.push(path);
    while (t.paths.length > 16) t.paths.shift();
  }

  function recordEcho(t, slug, path, transport, approx) {
    if (!t || !slug) return;
    if (!t.echo.includes(slug)) t.echo.push(slug);
    rememberPath(t, path);
    mark(t, transport);
    if (t.state === '已发送') t.state = '流中，等 STE';
    if (approx) t.approx = true;
    flush();
  }

  function execPriority(key, steMode) {
    const explicit = steMode === 'explicit';
    if (key === 'model_slug') return explicit ? 100 : 80;
    if (key === 'resolved_model_slug') return explicit ? 94 : 74;
    return explicit ? 90 : 70;
  }

  function recordExec(t, slug, path, transport, approx, steMode, key) {
    if (!t || !slug) return;
    const priority = execPriority(key, steMode);
    const source = steMode === 'explicit' ? 'STE' : 'strong-STE-fallback';
    const best = t.execEvidence.reduce((m, e) => Math.max(m, e.priority || 0), 0);

    if (priority > best) t.execEvidence.length = 0;
    if (priority >= best && !t.execEvidence.some((e) => e.slug === slug && e.priority === priority)) {
      t.execEvidence.push({ slug, source, priority, path: path.slice(0, 100) });
    }

    const nextBest = t.execEvidence.reduce((m, e) => Math.max(m, e.priority || 0), 0);
    t.exec = [...new Set(t.execEvidence.filter((e) => e.priority === nextBest).map((e) => e.slug))];
    rememberPath(t, path);
    mark(t, transport);
    t.state = '已确认执行模型';
    if (approx || steMode !== 'explicit') t.approx = true;
    flush();
  }

  function ownerFor(meta = {}, ctx = {}) {
    const conversation = id(meta.conversation_id) || ctx.conversation || '';
    const exchange = id(meta.turn_exchange_id) || ctx.exchange || '';
    const turnId = id(meta.working_turn_id) || id(meta.turn_id) || ctx.turnId || '';
    const parent = id(meta.parent_id) || ctx.parent || '';

    const live = turns.filter((t) => !conversation || !t.conversation || t.conversation === conversation);
    let hit = exchange ? live.find((t) => t.exchange && t.exchange === exchange) : null;
    if (!hit && turnId) hit = live.find((t) => t.turnId && t.turnId === turnId);
    if (!hit && parent) hit = live.find((t) => t.userIds.includes(parent)) || msgOwner.get(parent);
    if (!hit && ctx.turn && (!conversation || !ctx.turn.conversation || ctx.turn.conversation === conversation)) hit = ctx.turn;
    if (hit) return { turn: hit, approx: false };

    const last = live[live.length - 1];
    return last ? { turn: last, approx: true } : { turn: null, approx: false };
  }

  /* ---------------- SSE ---------------- */

  function frames(chunk, onValue) {
    for (const frame of chunk.split(/\r?\n\r?\n/)) {
      let name = '';
      const data = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      const body = data.join('\n');
      if (!body || body === '[DONE]') continue;
      const v = parse(body);
      if (v !== null) onValue(v, name);
    }
  }

  function makeStream(onValue) {
    let buffer = '';
    return {
      feed(chunk, last) {
        buffer += chunk;
        let cut;
        while ((cut = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, cut.index);
          buffer = buffer.slice(cut.index + cut[0].length);
          frames(frame + '\n\n', onValue);
        }
        if (buffer.length > MAX_TEXT) {
          buffer = '';
          note('单个事件过大，已跳过');
        }
        if (last) {
          if (buffer) frames(buffer + '\n\n', onValue);
          buffer = '';
        }
      }
    };
  }

  function decodeItem(s) {
    if (typeof s !== 'string' || !s) return '';
    if (/(^|\n)\s*(data:|event:)/.test(s)) return s;
    if (s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
      try {
        const bin = atob(s);
        return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      } catch { return s; }
    }
    return s;
  }

  /* ---------------- evidence classification ---------------- */

  function explicitSte(node, path, ctx) {
    if (ctx.steMode === 'explicit') return true;
    if (STE_NAME.test(String(ctx.event || ''))) return true;
    if (STE_NAME.test(String(node?.type || ''))) return true;
    return STE_NAME.test(path);
  }

  function strongSteFallback(node, path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    if (/message(?:\.|\[\])?metadata/i.test(path)) return false;
    if ('author' in node || 'content' in node || 'message' in node) return false;

    const hasModel = [...EXEC_KEYS].some((k) => typeof node[k] === 'string' && id(node[k]));
    if (!hasModel) return false;
    let score = 0;
    for (const key of STE_SIGNATURE_KEYS) if (key in node) score++;
    return score >= 3;
  }

  function applyIdentifiers(node, ctx) {
    return {
      ...ctx,
      conversation: id(node.conversation_id) || ctx.conversation || '',
      exchange: id(node.turn_exchange_id) || ctx.exchange || '',
      turnId: id(node.working_turn_id) || id(node.turn_id) || ctx.turnId || '',
      parent: id(node.parent_id) || ctx.parent || ''
    };
  }

  function walk(node, ctx, depth, path) {
    if (paused || depth > MAX_DEPTH || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 240)) walk(item, ctx, depth + 1, path + '[]');
      return;
    }

    let next = applyIdentifiers(node, ctx);
    if (depth === 0) seenEvent(next.turn, next.event || String(node.type || ''));

    if (node.type === 'stream_handoff') {
      const found = ownerFor(node, next);
      if (found.turn) {
        found.turn.exchange = found.turn.exchange || id(node.turn_exchange_id);
        found.turn.conversation = found.turn.conversation || id(node.conversation_id);
        found.turn.turnId = found.turn.turnId || id(node.working_turn_id) || id(node.turn_id);
        found.turn.state = '已移交后台，等 STE';
        mark(found.turn, next.transport);
        next = { ...next, turn: found.turn, approx: found.approx };
        flush();
      }
    }

    if (node.author && node.metadata && typeof node.metadata === 'object') {
      const mid = id(node.id);
      const found = ownerFor({ ...node.metadata, conversation_id: node.conversation_id }, next);
      if (found.turn) {
        if (mid) {
          msgOwner.set(mid, found.turn);
          if (msgOwner.size > 800) msgOwner.delete(msgOwner.keys().next().value);
        }
        found.turn.exchange = found.turn.exchange || id(node.metadata.turn_exchange_id);
        found.turn.turnId = found.turn.turnId || id(node.metadata.working_turn_id);
        next = {
          ...next,
          turn: found.turn,
          approx: found.approx,
          role: node.author?.role,
          parent: id(node.metadata.parent_id) || next.parent
        };
      }
    }

    let steMode = next.steMode || '';
    if (explicitSte(node, path, next)) steMode = 'explicit';
    else if (!steMode && strongSteFallback(node, path)) steMode = 'heuristic';

    if (steMode && !next.turn) {
      const found = ownerFor(node, next);
      if (found.turn) next = { ...next, turn: found.turn, approx: found.approx };
    }
    next = { ...next, steMode };

    if (steMode && next.turn) {
      for (const key of STE_FLAGS) {
        if (key in node && (typeof node[key] !== 'object' || node[key] === null)) {
          next.turn.flags[key] = typeof node[key] === 'string' ? text(node[key]) : node[key];
        }
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (SKIP.has(key)) continue;
      const here = path ? `${path}.${key}` : key;

      if (key === 'encoded_item' && typeof value === 'string') {
        makeStream((v, name) => walk(v, { ...next, event: name || next.event }, depth + 1, 'encoded_item'))
          .feed(decodeItem(value), true);
        continue;
      }

      if (EXEC_KEYS.has(key)) {
        const slug = id(value);
        if (!slug || next.role === 'user') continue;
        if (steMode) recordExec(next.turn, slug, here, next.transport, next.approx, steMode, key);
        else if (ECHO_KEYS.has(key)) recordEcho(next.turn, slug, here, next.transport, next.approx);
        continue;
      }

      // Delta patch: the model key may be encoded in JSON pointer p, not as an object key.
      if (key === 'p' && typeof value === 'string' && typeof node.v === 'string') {
        const m = value.match(/\/(model_slug|resolved_model_slug|actual_model_slug|execution_model_slug|served_model_slug|inference_model_slug)(?:$|\/)/);
        if (m) {
          const slug = id(node.v);
          if (slug) {
            const patchSte = steMode || STE_NAME.test(value) ? (steMode || 'explicit') : '';
            if (patchSte) recordExec(next.turn, slug, `patch ${value.slice(0, 80)}`, next.transport, next.approx, patchSte, m[1]);
            else if (ECHO_KEYS.has(m[1])) recordEcho(next.turn, slug, `patch ${value.slice(0, 80)}`, next.transport, next.approx);
          }
        }
        continue;
      }

      if (typeof value === 'object' && value !== null) walk(value, next, depth + 1, here);
    }

    if (node.type === 'message_stream_complete' || node.type === 'conversation_turn_done' || node.type === 'done') {
      const found = next.turn ? { turn: next.turn } : ownerFor(node, next);
      if (found.turn) closeStream(found.turn);
    }
  }

  const consume = (value, ctx) => walk(value, ctx, 0, '');

  function closeStream(turn) {
    if (!turn) return;
    turn.closed = true;
    if (!turn.exec.length && turn.state !== '请求失败') turn.state = '流已结束，没有 STE 事件';
    else if (turn.exec.length) turn.state = '已确认执行模型';
    flush();
  }

  /* ---------------- fetch ---------------- */

  const nativeFetch = window.fetch;
  window.fetch = new Proxy(nativeFetch, {
    apply(target, self, args) {
      const [input, init] = args;
      let ep = null;
      try {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
        ep = endpoint(url);
      } catch {}
      if (paused || !ep) return Reflect.apply(target, self, args);

      let turn = null;
      let bodyRead = Promise.resolve();
      if (ep.kind === 'send') {
        if (typeof init?.body === 'string') {
          turn = startTurn(init.body, ep.api);
        } else if (input instanceof Request && !init?.body) {
          try {
            bodyRead = input.clone().text().then((s) => { turn = startTurn(s, ep.api); }).catch(() => {});
          } catch { note('请求体已被消费，本次未记录发送模型'); }
        }
      }

      const promise = Reflect.apply(target, self, args);
      promise.then((response) => {
        const stream = /text\/event-stream/i.test(response.headers.get('content-type') || '');
        if (ep.kind === 'sniff' && !stream) return;

        let clone;
        try { clone = response.clone(); }
        catch { note('响应不可复制'); return; }

        void (async () => {
          await bodyRead;
          if (!clone.body) return;
          const ctx = {
            turn,
            conversation: turn?.conversation || ep.conversation || '',
            exchange: turn?.exchange || '',
            turnId: turn?.turnId || '',
            parent: '',
            transport: ep.kind === 'resume' ? ep.api : (stream ? 'HTTP SSE' : 'HTTP JSON'),
            steMode: ''
          };
          const reader = clone.body.getReader();
          const decoder = new TextDecoder();
          const parser = stream ? makeStream((v, name) => consume(v, { ...ctx, event: name })) : null;
          let total = 0;
          let buffer = '';

          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (paused || total > MAX_STREAM) { try { await reader.cancel(); } catch {} break; }
              const s = decoder.decode(value, { stream: true });
              if (parser) parser.feed(s, false);
              else {
                buffer += s;
                if (buffer.length > MAX_TEXT) { try { await reader.cancel(); } catch {} return; }
              }
            }

            if (parser) parser.feed(decoder.decode(), true);
            else {
              const v = parse(buffer + decoder.decode());
              if (v) consume(v, ctx);
            }

            if (ep.kind === 'send' && !turn?.exchange) closeStream(turn);
          } finally { try { reader.releaseLock(); } catch {} }
        })().catch(() => note('响应采集失败，页面请求不受影响'));
      }, () => {
        if (turn) {
          turn.state = '请求失败';
          turn.closed = true;
          flush();
        }
      });
      return promise;
    }
  });

  try {
    Object.defineProperty(window.fetch, 'name', { value: 'fetch' });
    window.fetch.toString = nativeFetch.toString.bind(nativeFetch);
  } catch {}

  /* ---------------- WebSocket handoff ---------------- */

  const NativeSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeSocket, {
    construct(target, args, newTarget) {
      const ws = Reflect.construct(target, args, newTarget);
      let eligible = false;
      try {
        const host = new URL(args[0], location.href).hostname;
        eligible = /(^|\.)chatgpt\.com$/.test(host) || /(^|\.)openai\.com$/.test(host);
      } catch {}

      if (eligible) {
        let chain = Promise.resolve();
        ws.addEventListener('message', (e) => {
          if (paused) return;
          chain = chain.then(async () => {
            const raw = typeof e.data === 'string' ? e.data
              : e.data instanceof Blob ? await e.data.text()
              : e.data instanceof ArrayBuffer ? new TextDecoder().decode(e.data) : '';
            if (!raw || paused) return;
            const v = parse(raw);
            if (v) consume(v, {
              turn: null, conversation: '', exchange: '', turnId: '', parent: '',
              transport: 'WebSocket', steMode: ''
            });
          }).catch(() => {});
        });
      }
      return ws;
    }
  });

  /* ---------------- XHR fallback ---------------- */

  const xp = XMLHttpRequest.prototype;
  const nativeOpen = xp.open;
  const nativeSend = xp.send;
  const xhrMeta = new WeakMap();

  xp.open = function(method, url, ...rest) {
    xhrMeta.set(this, { ep: endpoint(url) });
    return nativeOpen.call(this, method, url, ...rest);
  };

  xp.send = function(body) {
    const meta = xhrMeta.get(this);
    if (!paused && meta?.ep?.kind === 'send') {
      const turn = startTurn(body, meta.ep.api);
      this.addEventListener('loadend', () => {
        if (paused) return;
        try {
          const ctx = {
            turn, conversation: turn?.conversation || '', exchange: turn?.exchange || '',
            turnId: turn?.turnId || '', parent: '', transport: 'XHR', steMode: ''
          };
          if (/text\/event-stream/i.test(this.getResponseHeader('content-type') || '')) {
            makeStream((v, name) => consume(v, { ...ctx, event: name })).feed(this.responseText, true);
          } else {
            const v = this.responseType === 'json' ? this.response : parse(this.responseText);
            if (v) consume(v, ctx);
          }
          if (!turn?.exchange) closeStream(turn);
        } catch { note('XHR 响应不可读'); }
      }, { once: true });
    }
    return nativeSend.apply(this, arguments);
  };

  /* ---------------- control ---------------- */

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== IN) return;
    if (data.type === 'YY_MUM_REQUEST') flush();
    if (data.type === 'YY_MUM_CLEAR') {
      turns.length = 0;
      notes.length = 0;
      msgOwner.clear();
      serial = 0;
      flush();
    }
    if (data.type === 'YY_MUM_PAUSE') {
      paused = !!data.paused;
      flush();
    }
  });

  flush();
})();
