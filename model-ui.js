(() => {
  'use strict';

  // ISOLATED world。往额度挂件上追加一块「模型」区，不修改 widget.js。
  if (window.__YY_MUM_UI__) return;
  window.__YY_MUM_UI__ = true;

  const HOST_ID = 'yy-codex-usage-meter';
  const OUT = 'yy-mum-widget';
  const IN = 'yy-mum-model';
  const PREF_KEY = 'yyModelMeterPrefs';
  const DISPLAY_SETTINGS_KEY = 'yyCodexUsageMeterSettings';

  let block = null;
  let snapshot = null;
  let prefs = { open: false, paths: false };
  let showModelRoute = null;
  let languageSetting = 'auto';

  const el = (tag, cls, txt) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (txt != null) node.textContent = txt;
    return node;
  };

  const send = (type, extra) => window.postMessage({ source: OUT, type, ...extra }, '*');


  const I18N = {
    zh: {
      waitingSend: '等待发送', noMessages: '这个标签页还没发出过消息', notCaptured: '未捕获',
      approx: '\n（这条是按最近一次发送推断关联的，不是精确对上号）', noSte: '没抓到 STE',
      noSteHelp: '这一轮结束了，但没抓到 server_ste_metadata 事件，所以拿不到 STE 模型标识。\n展开点「显示字段路径」，看看这一轮都出现过哪些事件名。',
      waitingSte: '等 STE 中…', waitingSteHelp: '已经发出去了，在等流末尾的 server_ste_metadata 事件。\n它在整轮结束时才发，work 的长任务要等几分钟。',
      mismatch: '请求的 model 与 STE 报告的 model_slug 不一致', match: '请求的 model 与 STE 报告的 model_slug 一致',
      surface: '产品线', requestTier: '请求档位', autoReasoning: '自动转推理', autoSwitcher: '自动切换器',
      switchRace: '切换竞速', search: '联网搜索', cluster: '集群', useCase: '用途', toolInvoked: '调用工具',
      toolName: '工具名', plan: '套餐', latency: '首字延迟', none: '无', yes: '是', no: '否',
      ui: '界面', effort: '强度', messageLabel: '消息层标识', requestMismatch: '（与请求不符）', notSeen: '未出现',
      api: '接口', status: '状态', approxInline: '（按最近一次发送推断关联）', fields: '字段', events: '事件',
      noSlug: '一个 model_slug 都没命中', noEvent: '未捕获事件名', requestTitle: '请求体里的 model —— 网页发出去时要的那个',
      runTitle: 'STE 报告的 model_slug —— 服务端发送给前端的执行侧模型标识', surfaceTitle: 'STE 报告的产品线，不是按接口猜的',
      empty: '发一条消息，这里会显示请求的 model 和 STE 报告的 model_slug。', thisTurn: '这一轮', hidePaths: '隐藏字段路径', showPaths: '显示字段路径',
      stateSent: '已发送', stateStreaming: '流中，等 STE', stateHandoff: '已移交后台，等 STE', stateConfirmed: '已收到 STE 模型标识',
      stateNoSte: '流已结束，没有 STE 事件', stateFailed: '请求失败'
    },
    en: {
      waitingSend: 'Waiting', noMessages: 'No message has been sent in this tab yet', notCaptured: 'Not captured',
      approx: '\n(Associated with the most recent send; not an exact turn match)', noSte: 'No STE found',
      noSteHelp: 'The turn ended without a server_ste_metadata event, so no STE model identifier is available.\nOpen “Show field paths” to inspect the event names seen in this turn.',
      waitingSte: 'Waiting for STE…', waitingSteHelp: 'Request sent; waiting for server_ste_metadata at the end of the stream.\nLong Work tasks may take several minutes.',
      mismatch: 'Requested model and STE-reported model_slug do not match', match: 'Requested model matches the STE-reported model_slug',
      surface: 'Surface', requestTier: 'Request tier', autoReasoning: 'Auto reasoning', autoSwitcher: 'Auto switcher',
      switchRace: 'Switch race', search: 'Web search', cluster: 'Cluster', useCase: 'Use case', toolInvoked: 'Tool invoked',
      toolName: 'Tool name', plan: 'Plan', latency: 'First-token latency', none: 'None', yes: 'Yes', no: 'No',
      ui: 'UI', effort: 'Effort', messageLabel: 'Message-layer ID', requestMismatch: ' (differs from request)', notSeen: 'Not seen',
      api: 'API', status: 'Status', approxInline: ' (associated with latest send)', fields: 'Fields', events: 'Events',
      noSlug: 'No model_slug matched', noEvent: 'No event names captured', requestTitle: 'model from the outgoing request body',
      runTitle: 'model_slug reported to the client in server STE metadata', surfaceTitle: 'Product surface reported by STE metadata',
      empty: 'Send a message to see the requested model and STE-reported model_slug.', thisTurn: 'this turn', hidePaths: 'Hide field paths', showPaths: 'Show field paths',
      stateSent: 'Sent', stateStreaming: 'Streaming; waiting for STE', stateHandoff: 'Handed off; waiting for STE', stateConfirmed: 'STE model identifier received',
      stateNoSte: 'Stream ended without STE', stateFailed: 'Request failed'
    }
  };

  function resolvedLanguage() {
    if (languageSetting === 'zh' || languageSetting === 'en') return languageSetting;
    return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  function t(key) {
    const lang = resolvedLanguage();
    return I18N[lang][key] ?? I18N.en[key] ?? key;
  }

  const STATE_KEYS = {
    '已发送': 'stateSent',
    '流中，等 STE': 'stateStreaming',
    '已移交后台，等 STE': 'stateHandoff',
    '已确认执行模型': 'stateConfirmed',
    '流已结束，没有 STE 事件': 'stateNoSte',
    '请求失败': 'stateFailed'
  };

  const NOTE_EN = {
    '请求体不可读，本次未建立记录': 'Request body was unreadable; no turn record was created',
    '单个事件过大，已跳过': 'Oversized event skipped',
    '请求体已被消费，本次未记录发送模型': 'Request body was already consumed; requested model was not recorded',
    '响应不可复制': 'Response could not be cloned',
    '响应采集失败，页面请求不受影响': 'Response capture failed; page request was unaffected',
    'XHR 响应不可读': 'XHR response was unreadable'
  };

  function localizeNote(note) {
    return resolvedLanguage() === 'en' ? (NOTE_EN[note] || note) : note;
  }

  function savePrefs() {
    try { chrome.storage.sync.set({ [PREF_KEY]: prefs }); } catch {}
  }

  async function loadPrefs() {
    try {
      const got = await chrome.storage.sync.get(PREF_KEY);
      if (got?.[PREF_KEY] && typeof got[PREF_KEY] === 'object') prefs = { ...prefs, ...got[PREF_KEY] };
    } catch {}
    render();
  }

  async function loadRouteSetting() {
    try {
      const got = await chrome.storage.sync.get(DISPLAY_SETTINGS_KEY);
      const display = got?.[DISPLAY_SETTINGS_KEY] || {};
      showModelRoute = display.showModelRoute !== false;
      languageSetting = display.language || 'auto';
    } catch {
      showModelRoute = true;
      languageSetting = 'auto';
    }
    applyRouteSetting();
  }

  function applyRouteSetting() {
    const visible = showModelRoute !== false;
    send('YY_MUM_PAUSE', { paused: !visible });

    if (!visible) {
      if (block) {
        block.remove();
        block = null;
      }
      return;
    }

    attach();
    render();
  }

  /* ---------------- 判定 ---------------- */

  // 执行侧证据只认流末尾 server_ste_metadata 事件里的 model_slug。
  // 流中间 message 事件带的 model_slug 是请求回显，全程不变，不能当执行证据。
  function verdict(turn) {
    if (!turn) {
      return { code: 'idle', chip: '--', req: '--', run: t('waitingSend'), help: t('noMessages') };
    }

    const exec = [...new Set(turn.exec)];
    const req = turn.requested || t('notCaptured');
    const approxNote = turn.approx ? t('approx') : '';

    if (!exec.length) {
      if (turn.closed) {
        return {
          code: 'unknown',
          chip: '?',
          req,
          run: t('noSte'),
          help: t('noSteHelp')
        };
      }
      return {
        code: 'waiting',
        chip: '···',
        req,
        run: t('waitingSte'),
        help: t('waitingSteHelp')
      };
    }

    const run = exec.join(' / ');
    if (!turn.requested || exec.length > 1 || exec[0] !== turn.requested) {
      return {
        code: 'diff',
        chip: turn.approx ? '≈' : '≠',
        req,
        run,
        help: t('mismatch') + approxNote
      };
    }

    return {
      code: 'match',
      chip: turn.approx ? '≈' : '✓',
      req,
      run,
      help: t('match') + approxNote
    };
  }

  /* ---------------- 渲染 ---------------- */

  function flagLabels() {
    return {
      product_experience: t('surface'),
      requested_model_experience: t('requestTier'),
      did_auto_switch_to_reasoning: t('autoReasoning'),
      is_autoswitcher_enabled: t('autoSwitcher'),
      auto_switcher_race_winner: t('switchRace'),
      is_search: t('search'),
      cluster_region: t('cluster'),
      turn_use_case: t('useCase'),
      tool_invoked: t('toolInvoked'),
      tool_name: t('toolName'),
      plan_type: t('plan'),
      server_ttfvt_ms: t('latency')
    };
  }

  const flagText = (key, value) => {
    if (value === null) return t('none');
    if (typeof value === 'boolean') return value ? t('yes') : t('no');
    if (key === 'server_ttfvt_ms') return value + ' ms';
    return String(value);
  };

  function detailLines(turn) {
    const lines = [[t('ui'), turn.ui || t('notCaptured')]];
    if (turn.effort) lines.push([t('effort'), turn.effort]);

    // 回显是请求的回声，正常情况下跟「请求」一模一样，没有信息量。
    // 只有它跟请求对不上时才值得看 —— 那说明服务端在消息层改写了标识。
    const echoOdd = turn.echo.length && (turn.echo.length > 1 || turn.echo[0] !== turn.requested);
    if (echoOdd) lines.push([t('messageLabel'), turn.echo.join(' / ') + t('requestMismatch')]);
    else if (prefs.paths) lines.push([t('messageLabel'), turn.echo.join(' / ') || t('notSeen')]);

    for (const [key, label] of Object.entries(flagLabels())) {
      if (key in turn.flags) lines.push([label, flagText(key, turn.flags[key])]);
    }

    lines.push([t('api'), [turn.api, ...turn.transports].filter(Boolean).join(' · ') || '--']);
    const stateText = STATE_KEYS[turn.state] ? t(STATE_KEYS[turn.state]) : turn.state;
    lines.push([t('status'), stateText + (turn.approx ? t('approxInline') : '')]);

    if (prefs.paths) {
      lines.push([t('fields'), turn.paths.join('\n') || t('noSlug')]);
      lines.push([t('events'), turn.events.join('\n') || t('noEvent')]);
    }
    return lines;
  }

  // 只显示当前这一轮。不留历史，聊几百轮也不会堆东西。
  function render() {
    if (!block) return;

    const turn = (snapshot?.turns || [])[0] || null;
    const v = verdict(turn);

    const reqVal = block.querySelector('.yy-mum-reqval');
    reqVal.textContent = v.req;
    reqVal.title = t('requestTitle');

    const runVal = block.querySelector('.yy-mum-runval');
    runVal.textContent = v.run;
    runVal.dataset.code = v.code;
    runVal.title = t('runTitle');

    const tag = block.querySelector('.yy-mum-surface');
    const surface = turn && turn.flags ? turn.flags.product_experience : '';
    tag.textContent = surface || '';
    tag.hidden = !surface;
    tag.title = t('surfaceTitle');

    const chip = block.querySelector('.yy-mum-chip');
    chip.textContent = v.chip;
    chip.dataset.code = v.code;
    chip.title = v.help;

    const body = block.querySelector('.yy-mum-body');
    body.hidden = !prefs.open;
    block.querySelector('.yy-mum-caret').textContent = prefs.open ? '▾' : '▸';
    if (!prefs.open) return;

    body.replaceChildren();

    if (!turn) {
      body.append(el('div', 'yy-mum-empty', t('empty')));
    } else {
      body.append(el('div', 'yy-mum-time', new Date(turn.t).toLocaleTimeString(resolvedLanguage() === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }) + ' ' + t('thisTurn')));
      const dl = el('dl', 'yy-mum-dl');
      for (const [k, val] of detailLines(turn)) dl.append(el('dt', null, k), el('dd', null, val));
      body.append(dl);
    }

    if (snapshot?.notes?.length) body.append(el('div', 'yy-mum-note', snapshot.notes.map(localizeNote).join(resolvedLanguage() === 'zh' ? '；' : '; ')));

    const actions = el('div', 'yy-mum-actions');
    const paths = el('button', null, prefs.paths ? t('hidePaths') : t('showPaths'));
    paths.type = 'button';
    paths.addEventListener('click', (e) => {
      e.stopPropagation();
      prefs.paths = !prefs.paths;
      savePrefs();
      render();
    });
    actions.append(paths);
    body.append(actions);
  }

  /* ---------------- 挂载 ---------------- */

  function styles() {
    if (document.getElementById('yy-mum-style')) return;
    const style = el('style');
    style.id = 'yy-mum-style';
    style.textContent = `
      #${HOST_ID} .yy-mum-block {
        margin-top: 6px;
        padding-top: 7px;
        border-top: 1px solid color-mix(in srgb, currentColor 13%, transparent);
      }

      @supports not (background: color-mix(in srgb, black 10%, transparent)) {
        #${HOST_ID} .yy-mum-block { border-top-color: rgba(127,127,127,.2); }
      }

      #${HOST_ID} .yy-mum-rows {
        display: grid;
        grid-template-columns: 26px 1fr auto auto auto;
        align-items: center;
        gap: 1px 7px;
        /* 挂件根的 line-height 是 1.15，配上 overflow:hidden 会把 g/p 的下沿切掉。 */
        line-height: 1.55;
        cursor: pointer;
      }

      #${HOST_ID} .yy-mum-key {
        font-weight: 700;
        letter-spacing: .02em;
        opacity: .82;
      }

      #${HOST_ID} .yy-mum-main {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      #${HOST_ID} .yy-mum-reqval { opacity: .72; }
      #${HOST_ID} .yy-mum-runval { opacity: .95; }

      /* 请求标识与 STE 标识不一致时，让 run 行直接突出显示。 */
      #${HOST_ID} .yy-mum-runval[data-code="diff"] { color: #c47a1c; font-weight: 700; opacity: 1; }
      #${HOST_ID}[data-theme="dark"] .yy-mum-runval[data-code="diff"] { color: #efa845; }
      #${HOST_ID} .yy-mum-runval[data-code="waiting"],
      #${HOST_ID} .yy-mum-runval[data-code="unknown"],
      #${HOST_ID} .yy-mum-runval[data-code="idle"] { opacity: .55; }

      #${HOST_ID} .yy-mum-surface {
        font-size: .82em;
        padding: 1px 5px;
        border-radius: 5px;
        background: color-mix(in srgb, currentColor 12%, transparent);
        opacity: .7;
      }

      #${HOST_ID} .yy-mum-surface[hidden] { display: none; }

      #${HOST_ID} .yy-mum-chip {
        display: inline-grid;
        place-items: center;
        min-width: 17px;
        height: 17px;
        padding: 0 3px;
        border-radius: 5px;
        font-size: .86em;
        font-weight: 700;
        opacity: .9;
      }

      #${HOST_ID} .yy-mum-chip[data-code="match"] { background: rgba(52,168,110,.2); color: #2f9c65; }
      #${HOST_ID} .yy-mum-chip[data-code="diff"] { background: rgba(216,132,36,.22); color: #c47a1c; }
      #${HOST_ID} .yy-mum-chip[data-code="unknown"] { background: rgba(150,150,150,.22); opacity: .8; }

      #${HOST_ID} .yy-mum-chip[data-code="waiting"],
      #${HOST_ID} .yy-mum-chip[data-code="idle"] { background: color-mix(in srgb, currentColor 12%, transparent); opacity: .55; }

      #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="match"] { color: #58c894; }
      #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="diff"] { color: #efa845; }

      #${HOST_ID} .yy-mum-caret { opacity: .5; font-size: .8em; }

      #${HOST_ID} .yy-mum-body {
        margin-top: 4px;
        font-size: .9em;
        line-height: 1.45;
      }

      #${HOST_ID} .yy-mum-body[hidden] { display: none; }

      #${HOST_ID} .yy-mum-empty { opacity: .62; }

      #${HOST_ID} .yy-mum-time { opacity: .5; margin-bottom: 3px; }

      #${HOST_ID} .yy-mum-dl {
        display: grid;
        grid-template-columns: 58px 1fr;
        gap: 2px 8px;
        margin: 0;
      }

      #${HOST_ID} .yy-mum-dl dt { opacity: .6; }

      #${HOST_ID} .yy-mum-dl dd {
        margin: 0;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
        font-variant-numeric: tabular-nums;
      }

      #${HOST_ID} .yy-mum-note { margin-top: 5px; opacity: .62; }

      #${HOST_ID} .yy-mum-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 7px;
      }

      #${HOST_ID} .yy-mum-actions button {
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
        border-radius: 7px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: .95em;
        cursor: pointer;
        opacity: .8;
      }

      #${HOST_ID} .yy-mum-actions button:hover { background: rgba(127,127,127,.14); opacity: 1; }
    `;
    document.documentElement.appendChild(style);
  }

  function build(host) {
    styles();

    block = el('div', 'yy-mum-block');

    // 两行放在同一个 grid 里，req / run 的列才严格对齐。
    const rows = el('div', 'yy-mum-rows');
    rows.append(
      el('span', 'yy-mum-key', 'req'),
      el('span', 'yy-mum-main yy-mum-reqval', '--'),
      el('span'), el('span'), el('span'),
      el('span', 'yy-mum-key', 'run'),
      el('span', 'yy-mum-main yy-mum-runval', t('waitingSend')),
      el('span', 'yy-mum-surface'),
      el('span', 'yy-mum-chip', '--'),
      el('span', 'yy-mum-caret', '▸')
    );

    const body = el('div', 'yy-mum-body');
    body.hidden = true;

    // 挂件本身点一下会刷新额度，这块不参与。
    block.addEventListener('click', (e) => e.stopPropagation());
    rows.addEventListener('click', () => {
      prefs.open = !prefs.open;
      savePrefs();
      render();
      if (prefs.open) send('YY_MUM_REQUEST');
    });

    block.append(rows, body);

    const panel = host.querySelector('.yy-cum-settings-panel');
    if (panel) host.insertBefore(block, panel);
    else host.appendChild(block);

    render();
    loadPrefs();
    send('YY_MUM_REQUEST');
  }

  function attach() {
    if (showModelRoute !== true) return false;
    if (block?.isConnected) return true;
    const host = document.getElementById(HOST_ID);
    if (!host) return false;
    build(host);
    return true;
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== IN) return;
    if (data.type === 'YY_MUM_DATA' && data.snapshot?.v === 2) {
      snapshot = data.snapshot;
      attach();
      render();
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !(DISPLAY_SETTINGS_KEY in changes)) return;
      const saved = changes[DISPLAY_SETTINGS_KEY].newValue || {};
      showModelRoute = saved.showModelRoute !== false;
      languageSetting = saved.language || 'auto';
      applyRouteSetting();
    });
  } catch {}

  const observer = new MutationObserver(() => { attach(); });
  observer.observe(document.documentElement, { subtree: true, childList: true });
  setInterval(attach, 2_000);
  loadRouteSetting();
})();
