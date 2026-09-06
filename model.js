(() => {
  'use strict';

  // MAIN world。只读旁路：不改请求参数、不改认证头、不阻塞页面响应。
  //
  // 实际执行的模型只在流末尾的 server_ste_metadata 事件里。流中间那些 message 事件带的
  // metadata.model_slug 是请求侧的回显，整条流都是同一个值 —— 拿它当「执行模型」永远显示一致，
  // 测不出重路由。所以这里把两者分成 exec / echo 两个桶，只有 STE 才算执行证据。
  if (window.__YY_MUM_MODEL__) return;
  window.__YY_MUM_MODEL__ = true;

  const OUT = 'yy-mum-model';
  const IN = 'yy-mum-widget';
  const MAX_TEXT = 2 * 1024 * 1024;
  const MAX_STREAM = 64 * 1024 * 1024;
  // 只看当前这一轮。多留几条纯粹是给晚到的 WebSocket 帧留关联余地，不外发、不展示。
  const MAX_TURNS = 1;
  const KEEP_TURNS = 6;
  const MAX_DEPTH = 14;

  // 遍历时跳过正文类字段：既避免误抓，也避免在长回复上做无谓递归。
  const SKIP = new Set([
    'content', 'parts', 'text', 'prompt', 'tools', 'attachments', 'safe_urls',
    'citations', 'thoughts', 'search_result_groups', 'image_results',
    'finished_text', 'initial_text', 'blocked_urls', 'aggregate_result'
  ]);
  const SLUG = /^[\w.:+-]{1,80}$/;
  const SLUG_KEYS = new Set([
    'model_slug', 'resolved_model_slug', 'default_model_slug',
    'intended_default_model_slug', 'requested_model_slug'
  ]);
  const STE_NAME = /server_ste_metadata|ste_metadata/;

  // STE 事件可能没有稳定的外层键名或事件名，所以再用它自己的特征字段做指纹。
  const STE_HINTS = [
    'requested_model_experience', 'did_auto_switch_to_reasoning',
    'is_autoswitcher_enabled', 'server_ttfvt_ms', 'turn_use_case'
  ];
  const STE_FLAGS = [
    'product_experience', 'requested_model_experience',
    'did_auto_switch_to_reasoning', 'is_autoswitcher_enabled',
    'auto_switcher_race_winner', 'is_search', 'tool_invoked', 'tool_name',
    'turn_use_case', 'plan_type', 'server_ttfvt_ms', 'cluster_region'
  ];

  let serial = 0;
  let paused = false;
  const turns = [];
  const notes = [];
  const msgOwner = new Map();
  let flushTimer = 0;

  const parse = (s) => {
    try { return typeof s === 'string' && s.length <= MAX_TEXT ? JSON.parse(s) : null; } catch { return null; }
  };
  const id = (v) => (typeof v === 'string' && SLUG.test(v) ? v : '');
  const text = (v) => (typeof v === 'string' ? v.replace(/[\x00-\x1f]/g, '').slice(0, 80) : '');

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
          v: 2,
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
    }, 90);
  }

  /* ---------------- 界面上选中的模型名（尽力而为，取不到不影响主功能） ---------------- */

  // 输入框旁边显示模型名的控件。名字随版本变过，所以多认几种，
  // 再用模型名特征筛一遍，免得把「深度研究」这类工具药丸当成模型。
  const MODEL_TEXT = /gpt|o\d|auto|thinking|instant|terra|luna|sol|astra|pro|mini/i;

  function uiLabel() {
    let el = document.getElementById('prompt-textarea');
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      const pills = el.querySelectorAll(
        '[class*="composer-pill"],[class*="SliderTriggerModelLabel"],[data-testid*="model-switcher"]'
      );
      for (const pill of pills) {
        const s = text((pill.textContent || '').trim());
        if (s && s.length <= 40 && MODEL_TEXT.test(s)) return s;
      }
    }
    const seen = [];
    document.querySelectorAll('[data-testid*="model-switcher"]').forEach((node) => {
      const s = text((node.textContent || '').trim());
      if (s && MODEL_TEXT.test(s) && !seen.includes(s)) seen.push(s);
    });
    return seen.length === 1 ? seen[0] : '';
  }

  /* ---------------- 接口识别 ---------------- */

  function endpoint(raw) {
    try {
      const u = new URL(raw, location.href);
      if (u.origin !== location.origin) return null;
      // chat 和 work 都可能走 f/conversation，接口名只作诊断，不用来判断窗口类型。
      if (/^\/backend-api\/f\/conversation\/?$/.test(u.pathname)) return { kind: 'send', api: 'f/conversation' };
      if (/^\/backend-api\/conversation\/?$/.test(u.pathname)) return { kind: 'send', api: 'conversation' };
      // 移交后台的轮次从这里续流。实测 work 走的是它，不是 ws.chatgpt.com。
      const status = u.pathname.match(/^\/backend-api\/(?:f\/)?conversation\/([\w-]+)\/(stream_status|stream)\/?$/);
      if (status) return { kind: 'resume', api: status[2], conversation: status[1] };
      // 续流端点会变（实测 work 用 resume_sse_endpoint 事件告知地址，不是固定路径）。
      // 与其猜路径，不如认内容：backend-api 下任何 event-stream 响应都过一遍解析器。
      // 静态资源与遥测：跟对话无关，直接排除，省掉每次的 content-type 检查
      if (/^\/(ces|cdn|assets|_next|static)\//.test(u.pathname)) return null;
      if (/\/(sentinel|settings|pets|conversations|gizmos|models)(\/|$)/.test(u.pathname)) return null;
      // 续流地址由 stream_handoff 的 options 动态下发，路径无法预判，
      // 所以其余同源请求都进兜底通道 —— 真正的过滤在 content-type 上，只解析 event-stream。
      return { kind: 'sniff', api: u.pathname.replace(/\/[0-9a-f-]{16,}/gi, '/{id}').replace('/backend-api/', '').slice(0, 48) };
    } catch { return null; }
  }

  /* ---------------- 记录 ---------------- */

  function startTurn(body, api) {
    const b = typeof body === 'string' ? parse(body) : body;
    if (!b || typeof b !== 'object') { note('请求体不可读，本次未建立记录'); return null; }
    const t = {
      n: ++serial,
      time: Date.now(),
      api,
      conversation: id(b.conversation_id),
      exchange: '',
      turnId: '',
      userIds: (Array.isArray(b.messages) ? b.messages : [])
        .filter((m) => m?.author?.role === 'user').map((m) => id(m.id)).filter(Boolean),
      ui: uiLabel(),
      requested: id(b.model),
      effort: id(b.thinking_effort) || id(b.reasoning_effort),
      exec: [],      // server_ste_metadata.model_slug —— 实际执行
      echo: [],      // message.metadata.model_slug —— 流内回显
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
    const s = text(name).slice(0, 40);
    if (s && !t.events.includes(s)) { t.events.push(s); while (t.events.length > 20) t.events.shift(); }
  }

  function record(t, slug, path, transport, approx, isSte) {
    if (!t || !slug) return;
    const bucket = isSte ? t.exec : t.echo;
    if (!bucket.includes(slug)) bucket.push(slug);
    if (!t.paths.includes(path)) { t.paths.push(path); while (t.paths.length > 12) t.paths.shift(); }
    mark(t, transport);
    // 只有 STE 到了才算拿到执行证据；回显不改变状态。
    if (isSte) t.state = '已确认执行模型';
    else if (t.state === '已发送') t.state = '流中，等 STE';
    if (approx) t.approx = true;
    flush();
  }

  // 显式关联优先；找不到唯一归属时才退回“同会话最新一次发送”，并标记为推断。
  function ownerFor(meta, ctx) {
    const exchange = id(meta.turn_exchange_id);
    const turnId = id(meta.working_turn_id) || ctx.turnId;
    const parent = id(meta.parent_id);
    const live = turns.filter((t) => !ctx.conversation || !t.conversation || t.conversation === ctx.conversation);

    let hit = exchange ? live.find((t) => t.exchange && t.exchange === exchange) : null;
    if (!hit && turnId) hit = live.find((t) => t.turnId && t.turnId === turnId);
    if (!hit && parent) hit = live.find((t) => t.userIds.includes(parent)) || msgOwner.get(parent);
    if (hit) return { turn: hit, approx: false };
    if (ctx.turn) return { turn: ctx.turn, approx: false };
    const last = live[live.length - 1];
    return last ? { turn: last, approx: true } : { turn: null, approx: false };
  }

  /* ---------------- SSE ---------------- */

  // event: 行必须保留 —— STE 可能只靠事件名标识自己。
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
        if (buffer.length > MAX_TEXT) { buffer = ''; note('单个事件过大，已跳过'); }
        if (last) { if (buffer) frames(buffer + '\n\n', onValue); buffer = ''; }
      }
    };
  }

  // Work 的 WebSocket 帧把 SSE 装在 encoded_item 里，可能是明文也可能是 base64。
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

  /* ---------------- 遍历 ---------------- */

  // 三重识别：外层键名、事件名或 type 值、STE 自己的特征字段。任一命中即算执行证据。
  function isSteNode(node, path, ctx) {
    if (STE_NAME.test(path)) return true;
    if (STE_NAME.test(String(ctx.event || ''))) return true;
    if (STE_NAME.test(String(node.type || ''))) return true;
    return STE_HINTS.some((h) => h in node);
  }

  function walk(node, ctx, depth, path) {
    if (paused || depth > MAX_DEPTH || !node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node.slice(0, 200)) walk(item, ctx, depth + 1, path + '[]');
      return;
    }

    let next = ctx;
    if (id(node.conversation_id) || id(node.turn_id)) {
      next = {
        ...ctx,
        conversation: id(node.conversation_id) || ctx.conversation,
        turnId: id(node.turn_id) || ctx.turnId
      };
    }

    if (depth === 0) seenEvent(next.turn, next.event || String(node.type || ''));

    // Work 把任务移交后台，之后的内容走 ws.chatgpt.com，用 turn_exchange_id 对上号。
    if (node.type === 'stream_handoff' && ctx.turn) {
      ctx.turn.exchange = id(node.turn_exchange_id) || ctx.turn.exchange;
      ctx.turn.conversation = ctx.turn.conversation || id(node.conversation_id);
      if (ctx.turn.state === '已发送') ctx.turn.state = '已移交后台，等 STE';
      mark(ctx.turn, ctx.transport);
      flush();
    }

    // message 对象：先定归属，再把归属带进 metadata 的子遍历。
    if (node.author && node.metadata && typeof node.metadata === 'object') {
      const mid = id(node.id);
      const found = ownerFor(node.metadata, next);
      if (found.turn) {
        if (mid) {
          msgOwner.set(mid, found.turn);
          if (msgOwner.size > 600) msgOwner.delete(msgOwner.keys().next().value);
        }
        if (!found.approx) {
          found.turn.exchange = found.turn.exchange || id(node.metadata.turn_exchange_id);
          found.turn.turnId = found.turn.turnId || id(node.metadata.working_turn_id) || next.turnId;
        }
        if (node.end_turn === true) found.turn.closed = true;
        next = { ...next, turn: found.turn, approx: found.approx, role: node.author?.role };
      }
    }

    const ste = next.ste || isSteNode(node, path, next);
    if (ste) {
      // STE 事件可能独立于 message 出现（尤其在 WebSocket 帧里），没有上下文就按最近一轮认。
      if (!next.turn) {
        const found = ownerFor({}, next);
        if (found.turn) next = { ...next, turn: found.turn, approx: found.approx };
      }
      next = { ...next, ste: true };
      if (next.turn) {
        for (const key of STE_FLAGS) {
          if (key in node && (typeof node[key] !== 'object' || node[key] === null)) {
            next.turn.flags[key] = typeof node[key] === 'string' ? text(node[key]) : node[key];
          }
        }
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (SKIP.has(key)) continue;
      const here = path ? path + '.' + key : key;

      if (key === 'encoded_item' && typeof value === 'string') {
        makeStream((v, name) => walk(v, { ...next, event: name || next.event }, depth + 1, 'encoded_item'))
          .feed(decodeItem(value), true);
        continue;
      }

      if (SLUG_KEYS.has(key)) {
        const slug = id(value);
        if (slug && next.role !== 'user') {
          record(next.turn, slug, here, next.transport, next.approx, ste && key === 'model_slug');
        }
        continue;
      }

      // delta 编码的增量补丁：{"p":"/message/metadata/model_slug","o":"replace","v":"..."}
      // 这种形态里 model_slug 出现在 p 的字符串值中，不是键名，按键名找会整个漏掉。
      if (key === 'p' && typeof value === 'string' && value.includes('model_slug') && typeof node.v === 'string') {
        const slug = id(node.v);
        if (slug) {
          record(next.turn, slug, 'patch ' + value.slice(0, 60), next.transport, next.approx,
            ste || STE_NAME.test(value));
        }
        continue;
      }

      if (typeof value === 'object' && value !== null) walk(value, next, depth + 1, here);
    }

    if (node.type === 'done' || node.type === 'conversation_turn_done') {
      if (next.turn) { next.turn.closed = true; flush(); }
    }
  }

  const consume = (value, ctx) => walk(value, ctx, 0, '');

  // 流真正结束时才好判断「STE 到底出没出现」。
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
      // 只有真正的发送接口才建记录。兜底通道纯读流，绝不建记录 ——
      // 否则遥测上报、prepare、心跳这些带 body 的 POST 会把当前这一轮挤掉。
      if (ep.kind === 'send') {
        if (typeof init?.body === 'string') {
          turn = startTurn(init.body, ep.api);
        } else if (input instanceof Request && !init?.body) {
          // 必须在原生 fetch 消费 body 之前克隆。
          try {
            bodyRead = input.clone().text().then((t) => { turn = startTurn(t, ep.api); }).catch(() => {});
          } catch { note('请求体已被消费，本次未记录发送模型'); }
        }
      }

      const promise = Reflect.apply(target, self, args);
      promise.then((response) => {
        const stream = /text\/event-stream/.test(response.headers.get('content-type') || '');
        // 先判断再克隆：clone 会缓冲整个响应体，不能对每个同源请求都做。
        // 兜底通道只看流式响应，普通 JSON 接口（额度、设置、遥测）一律不碰。
        if (ep.kind === 'sniff' && !stream) return;
        let clone;
        try { clone = response.clone(); } catch { note('响应不可复制'); return; }
        void (async () => {
          await bodyRead;
          if (!clone.body) return;
          const ctx = {
            turn,
            conversation: turn?.conversation || ep.conversation || '',
            turnId: '',
            transport: ep.kind === 'resume' ? ep.api : (stream ? 'HTTP SSE' : 'HTTP JSON')
          };
          const reader = clone.body.getReader();
          const decoder = new TextDecoder();
          const parser = stream
            ? makeStream((v, name) => consume(v, { ...ctx, event: name }))
            : null;
          let total = 0, buffer = '', handedOff = false;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (paused || total > MAX_STREAM) { void reader.cancel(); break; }
              const s = decoder.decode(value, { stream: true });
              if (parser) parser.feed(s, false);
              else { buffer += s; if (buffer.length > MAX_TEXT) { void reader.cancel(); return; } }
            }
            if (parser) parser.feed(decoder.decode(), true);
            else { const v = parse(buffer + decoder.decode()); if (v) consume(v, ctx); }
            // 移交后台的轮次要等 WebSocket，HTTP 流结束不代表这一轮结束。
            handedOff = !!turn?.exchange;
            if (ep.kind === 'send' && !handedOff) closeStream(turn);
          } finally { try { reader.releaseLock(); } catch {} }
        })().catch(() => note('响应采集失败，页面请求不受影响'));
      }, () => { if (turn) { turn.state = '请求失败'; turn.closed = true; flush(); } });
      return promise;
    }
  });
  try {
    Object.defineProperty(window.fetch, 'name', { value: 'fetch' });
    window.fetch.toString = nativeFetch.toString.bind(nativeFetch);
  } catch {}

  /* ---------------- WebSocket（移交后台的轮次） ---------------- */

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
            if (paused || !raw) return;
            const v = parse(raw);
            if (v) consume(v, { turn: null, conversation: '', turnId: '', transport: 'WebSocket' });
          }).catch(() => {});
        });
      }
      return ws;
    }
  });

  /* ---------------- XHR 兜底 ---------------- */

  const xp = XMLHttpRequest.prototype;
  const nativeOpen = xp.open;
  const nativeSend = xp.send;
  const xhrMeta = new WeakMap();

  xp.open = function (method, url, ...rest) {
    xhrMeta.set(this, { ep: endpoint(url) });
    return nativeOpen.call(this, method, url, ...rest);
  };
  xp.send = function (body) {
    const meta = xhrMeta.get(this);
    if (!paused && meta?.ep?.kind === 'send') {
      const turn = startTurn(body, meta.ep.api);
      this.addEventListener('loadend', () => {
        if (paused) return;
        try {
          const ctx = { turn, conversation: turn?.conversation || '', turnId: '', transport: 'XHR' };
          if (/text\/event-stream/.test(this.getResponseHeader('content-type') || '')) {
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

  /* ---------------- 控制 ---------------- */

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== IN) return;
    if (data.type === 'YY_MUM_REQUEST') flush();
    if (data.type === 'YY_MUM_CLEAR') { turns.length = 0; notes.length = 0; msgOwner.clear(); serial = 0; flush(); }
    if (data.type === 'YY_MUM_PAUSE') { paused = !!data.paused; flush(); }
  });

  flush();
})();
