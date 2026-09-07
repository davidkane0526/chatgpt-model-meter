(() => {
  'use strict';

  if (window.__YY_MUM_UI__) return;
  window.__YY_MUM_UI__ = true;

  const HOST_ID = 'yy-codex-usage-meter';
  const OUT = 'yy-mum-widget';
  const IN = 'yy-mum-model';
  const PREF_KEY = 'yyModelMeterPrefs';
  const DISPLAY_SETTINGS_KEY = 'yyCodexUsageMeterSettings';
  const MODEL_LABELS = window.__YY_MODEL_LABELS__ || {
    friendlyModelName: (slug) => String(slug || ''),
    friendlyModelList: (slugs) => (Array.isArray(slugs) ? slugs : [slugs]).filter(Boolean).join(' / ')
  };

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
      noSte: '没抓到 STE', waitingSte: '等 STE 中…',
      noSteHelp: '这一轮结束了，但没有捕获到可信的 server_ste_metadata 执行模型证据。',
      waitingSteHelp: '请求已发送，正在等待流末尾的 server_ste_metadata。Work 长任务可能更晚到达。',
      mismatch: '请求模型与 STE 执行标识不一致', match: '请求模型与 STE 执行标识一致',
      routed: 'Auto/选择器请求已由服务端路由到该执行标识', heuristic: '执行标识来自强 STE 指纹兜底，置信度低于明确 STE 事件',
      surface: '产品线', requestTier: '请求档位', autoReasoning: '自动转推理', autoSwitcher: '自动切换器',
      switchRace: '切换竞速', search: '联网搜索', cluster: '集群', useCase: '用途', toolInvoked: '调用工具', toolName: '工具名',
      plan: '套餐', latency: '首字延迟', none: '无', yes: '是', no: '否', ui: '界面', effort: '强度',
      messageLabel: '消息层标识', requestMismatch: '（与请求不符）', notSeen: '未出现', api: '接口', status: '状态',
      evidence: '执行证据', fields: '字段', events: '事件', noSlug: '一个模型标识都没命中', noEvent: '未捕获事件名',
      requestTitle: '网页请求体中的 model；悬停可查看原始 slug', runTitle: '服务端 STE 遥测中的执行侧模型标识；悬停可查看原始 slug', surfaceTitle: 'STE 报告的产品线',
      rawRequest: '原始请求 slug', rawRun: '原始执行 slug',
      empty: '发一条消息后，这里会显示请求模型与 STE 执行标识。', thisTurn: '这一轮', hidePaths: '隐藏字段路径', showPaths: '显示字段路径',
      stateSent: '已发送', stateStreaming: '流中，等 STE', stateHandoff: '已移交后台，等 STE', stateConfirmed: '已收到执行模型证据',
      stateNoSte: '流已结束，没有可信 STE 执行模型证据', stateFailed: '请求失败', approximate: '（轮次关联为近似）'
    },
    en: {
      waitingSend: 'Waiting', noMessages: 'No message has been sent in this tab yet', notCaptured: 'Not captured',
      noSte: 'No STE found', waitingSte: 'Waiting for STE…',
      noSteHelp: 'The turn ended without trustworthy server_ste_metadata execution-model evidence.',
      waitingSteHelp: 'Request sent; waiting for server_ste_metadata near the end of the stream. Long Work tasks may arrive later.',
      mismatch: 'Requested model differs from the STE execution identifier', match: 'Requested model matches the STE execution identifier',
      routed: 'An Auto/selector request was routed by the service to this execution identifier', heuristic: 'Execution identifier came from a strong STE-signature fallback, not an explicit STE event',
      surface: 'Surface', requestTier: 'Request tier', autoReasoning: 'Auto reasoning', autoSwitcher: 'Auto switcher',
      switchRace: 'Switch race', search: 'Web search', cluster: 'Cluster', useCase: 'Use case', toolInvoked: 'Tool invoked', toolName: 'Tool name',
      plan: 'Plan', latency: 'First-token latency', none: 'None', yes: 'Yes', no: 'No', ui: 'UI', effort: 'Effort',
      messageLabel: 'Message-layer ID', requestMismatch: ' (differs from request)', notSeen: 'Not seen', api: 'API', status: 'Status',
      evidence: 'Evidence', fields: 'Fields', events: 'Events', noSlug: 'No model identifier matched', noEvent: 'No event names captured',
      requestTitle: 'model from the outgoing request body; hover to see the raw slug', runTitle: 'execution-side model identifier from server STE telemetry; hover to see the raw slug', surfaceTitle: 'Product surface reported by STE metadata',
      rawRequest: 'Raw request slug', rawRun: 'Raw execution slug',
      empty: 'Send a message to see the requested model and STE execution identifier.', thisTurn: 'this turn', hidePaths: 'Hide field paths', showPaths: 'Show field paths',
      stateSent: 'Sent', stateStreaming: 'Streaming; waiting for STE', stateHandoff: 'Handed off; waiting for STE', stateConfirmed: 'Execution-model evidence received',
      stateNoSte: 'Stream ended without trustworthy STE execution evidence', stateFailed: 'Request failed', approximate: ' (turn association is approximate)'
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
      block?.remove();
      block = null;
      return;
    }
    attach(); render();
  }

  const isAutoRequest = (slug) => /^(?:auto|auto[-_:].*|.*[-_:]auto)$/i.test(String(slug || ''));

  function bestEvidence(turn) {
    const evidence = Array.isArray(turn?.execEvidence) ? turn.execEvidence : [];
    if (!evidence.length) return null;
    return [...evidence].sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  }

  function verdict(turn) {
    if (!turn) return { code: 'idle', chip: '--', req: '--', run: t('waitingSend'), help: t('noMessages') };
    const exec = [...new Set(turn.exec || [])];
    const req = turn.requested || t('notCaptured');
    const evidence = bestEvidence(turn);
    const heuristic = evidence && evidence.source !== 'STE';
    const approxNote = turn.approx ? t('approximate') : '';

    if (!exec.length) {
      if (turn.closed) return { code: 'unknown', chip: '?', req, run: t('noSte'), help: t('noSteHelp') };
      return { code: 'waiting', chip: '···', req, run: t('waitingSte'), help: t('waitingSteHelp') };
    }

    const run = exec.join(' / ');
    if (heuristic) return { code: 'heuristic', chip: '≈', req, run, help: t('heuristic') + approxNote };
    if (isAutoRequest(turn.requested)) return { code: 'routed', chip: '→', req, run, help: t('routed') + approxNote };
    if (!turn.requested || exec.length > 1 || exec[0] !== turn.requested) {
      return { code: 'diff', chip: turn.approx ? '≈' : '≠', req, run, help: t('mismatch') + approxNote };
    }
    return { code: 'match', chip: turn.approx ? '≈' : '✓', req, run, help: t('match') + approxNote };
  }

  function flagLabels() {
    return {
      product_experience: t('surface'), requested_model_experience: t('requestTier'),
      did_auto_switch_to_reasoning: t('autoReasoning'), is_autoswitcher_enabled: t('autoSwitcher'),
      auto_switcher_race_winner: t('switchRace'), is_search: t('search'), cluster_region: t('cluster'),
      turn_use_case: t('useCase'), tool_invoked: t('toolInvoked'), tool_name: t('toolName'), plan_type: t('plan'), server_ttfvt_ms: t('latency')
    };
  }
  function flagText(key, value) {
    if (value === null) return t('none');
    if (typeof value === 'boolean') return value ? t('yes') : t('no');
    if (key === 'server_ttfvt_ms') return `${value} ms`;
    return String(value);
  }

  function detailLines(turn) {
    const lines = [[t('ui'), turn.ui || t('notCaptured')]];
    if (turn.effort) lines.push([t('effort'), turn.effort]);
    if (turn.requested) lines.push([t('rawRequest'), turn.requested]);
    if (Array.isArray(turn.exec) && turn.exec.length) lines.push([t('rawRun'), turn.exec.join(' / ')]);

    const echo = Array.isArray(turn.echo) ? turn.echo : [];
    const echoOdd = echo.length && (echo.length > 1 || echo[0] !== turn.requested);
    if (echoOdd) lines.push([t('messageLabel'), echo.join(' / ') + t('requestMismatch')]);
    else if (prefs.paths) lines.push([t('messageLabel'), echo.join(' / ') || t('notSeen')]);

    const evidence = bestEvidence(turn);
    if (evidence) lines.push([t('evidence'), `${evidence.source} · ${evidence.priority}`]);

    for (const [key, label] of Object.entries(flagLabels())) {
      if (turn.flags && key in turn.flags) lines.push([label, flagText(key, turn.flags[key])]);
    }

    lines.push([t('api'), [turn.api, ...(turn.transports || [])].filter(Boolean).join(' · ') || '--']);
    const stateText = STATE_KEYS[turn.state] ? t(STATE_KEYS[turn.state]) : turn.state;
    lines.push([t('status'), stateText + (turn.approx ? t('approximate') : '')]);

    if (prefs.paths) {
      lines.push([t('fields'), (turn.paths || []).join('\n') || t('noSlug')]);
      lines.push([t('events'), (turn.events || []).join('\n') || t('noEvent')]);
    }
    return lines;
  }

  function render() {
    if (!block) return;
    const turn = (snapshot?.turns || [])[0] || null;
    const v = verdict(turn);

    const req = block.querySelector('.yy-mum-reqval');
    const reqRaw = turn?.requested || '';
    req.textContent = reqRaw ? MODEL_LABELS.friendlyModelName(reqRaw, turn) : v.req;
    req.title = reqRaw ? `${t('requestTitle')}\n${reqRaw}` : t('requestTitle');
    const run = block.querySelector('.yy-mum-runval');
    const runRaw = Array.isArray(turn?.exec) ? turn.exec : [];
    run.textContent = runRaw.length ? MODEL_LABELS.friendlyModelList(runRaw, turn) : v.run;
    run.dataset.code = v.code;
    run.title = runRaw.length ? `${t('runTitle')}\n${runRaw.join(' / ')}` : t('runTitle');

    const surface = turn?.flags?.product_experience || '';
    const tag = block.querySelector('.yy-mum-surface');
    tag.textContent = surface; tag.hidden = !surface; tag.title = t('surfaceTitle');

    const chip = block.querySelector('.yy-mum-chip');
    chip.textContent = v.chip; chip.dataset.code = v.code; chip.title = v.help;

    const body = block.querySelector('.yy-mum-body');
    body.hidden = !prefs.open;
    block.querySelector('.yy-mum-caret').textContent = prefs.open ? '▾' : '▸';
    if (!prefs.open) return;

    body.replaceChildren();
    if (!turn) body.append(el('div', 'yy-mum-empty', t('empty')));
    else {
      body.append(el('div', 'yy-mum-time', new Date(turn.t).toLocaleTimeString(resolvedLanguage() === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }) + ' ' + t('thisTurn')));
      const dl = el('dl', 'yy-mum-dl');
      for (const [k, val] of detailLines(turn)) dl.append(el('dt', null, k), el('dd', null, val));
      body.append(dl);
    }

    if (snapshot?.notes?.length) body.append(el('div', 'yy-mum-note', snapshot.notes.join(resolvedLanguage() === 'zh' ? '；' : '; ')));
    const actions = el('div', 'yy-mum-actions');
    const paths = el('button', null, prefs.paths ? t('hidePaths') : t('showPaths'));
    paths.type = 'button';
    paths.addEventListener('click', (e) => {
      e.stopPropagation(); prefs.paths = !prefs.paths; savePrefs(); render();
    });
    actions.append(paths); body.append(actions);
  }

  function styles() {
    if (document.getElementById('yy-mum-style')) return;
    const style = el('style');
    style.id = 'yy-mum-style';
    style.textContent = `
      #${HOST_ID} .yy-mum-block{margin-top:6px;padding-top:7px;border-top:1px solid color-mix(in srgb,currentColor 13%,transparent)}
      #${HOST_ID} .yy-mum-rows{display:grid;grid-template-columns:26px 1fr auto auto auto;align-items:center;gap:1px 7px;line-height:1.55;cursor:pointer}
      #${HOST_ID} .yy-mum-key{font-weight:700;letter-spacing:.02em;opacity:.82} #${HOST_ID} .yy-mum-main{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
      #${HOST_ID} .yy-mum-reqval{opacity:.72} #${HOST_ID} .yy-mum-runval{opacity:.95}
      #${HOST_ID} .yy-mum-runval[data-code="diff"]{color:#c47a1c;font-weight:700;opacity:1} #${HOST_ID}[data-theme="dark"] .yy-mum-runval[data-code="diff"]{color:#efa845}
      #${HOST_ID} .yy-mum-runval[data-code="heuristic"]{color:#7b6bb0;font-weight:650} #${HOST_ID}[data-theme="dark"] .yy-mum-runval[data-code="heuristic"]{color:#b3a5e8}
      #${HOST_ID} .yy-mum-runval[data-code="waiting"],#${HOST_ID} .yy-mum-runval[data-code="unknown"],#${HOST_ID} .yy-mum-runval[data-code="idle"]{opacity:.55}
      #${HOST_ID} .yy-mum-surface{font-size:.82em;padding:1px 5px;border-radius:5px;background:color-mix(in srgb,currentColor 12%,transparent);opacity:.7} #${HOST_ID} .yy-mum-surface[hidden]{display:none}
      #${HOST_ID} .yy-mum-chip{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 3px;border-radius:5px;font-size:.86em;font-weight:700;opacity:.9}
      #${HOST_ID} .yy-mum-chip[data-code="match"]{background:rgba(52,168,110,.2);color:#2f9c65} #${HOST_ID} .yy-mum-chip[data-code="diff"]{background:rgba(216,132,36,.22);color:#c47a1c}
      #${HOST_ID} .yy-mum-chip[data-code="routed"]{background:rgba(60,130,210,.18);color:#347ec4} #${HOST_ID} .yy-mum-chip[data-code="heuristic"]{background:rgba(120,100,180,.18);color:#7462aa}
      #${HOST_ID} .yy-mum-chip[data-code="unknown"]{background:rgba(150,150,150,.22);opacity:.8} #${HOST_ID} .yy-mum-chip[data-code="waiting"],#${HOST_ID} .yy-mum-chip[data-code="idle"]{background:color-mix(in srgb,currentColor 12%,transparent);opacity:.55}
      #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="match"]{color:#58c894} #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="diff"]{color:#efa845} #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="routed"]{color:#6cacdf} #${HOST_ID}[data-theme="dark"] .yy-mum-chip[data-code="heuristic"]{color:#b3a5e8}
      #${HOST_ID} .yy-mum-caret{opacity:.5;font-size:.8em} #${HOST_ID} .yy-mum-body{margin-top:4px;font-size:.9em;line-height:1.45} #${HOST_ID} .yy-mum-body[hidden]{display:none}
      #${HOST_ID} .yy-mum-empty{opacity:.62} #${HOST_ID} .yy-mum-time{opacity:.5;margin-bottom:3px} #${HOST_ID} .yy-mum-dl{display:grid;grid-template-columns:64px 1fr;gap:2px 8px;margin:0}
      #${HOST_ID} .yy-mum-dl dt{opacity:.6} #${HOST_ID} .yy-mum-dl dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap;font-variant-numeric:tabular-nums} #${HOST_ID} .yy-mum-note{margin-top:5px;opacity:.62}
      #${HOST_ID} .yy-mum-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:7px} #${HOST_ID} .yy-mum-actions button{min-height:24px;padding:0 8px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:.95em;cursor:pointer;opacity:.8} #${HOST_ID} .yy-mum-actions button:hover{background:rgba(127,127,127,.14);opacity:1}
    `;
    document.documentElement.appendChild(style);
  }

  function build(host) {
    styles();
    block = el('div', 'yy-mum-block');
    const rows = el('div', 'yy-mum-rows');
    rows.append(
      el('span', 'yy-mum-key', 'req'), el('span', 'yy-mum-main yy-mum-reqval', '--'), el('span'), el('span'), el('span'),
      el('span', 'yy-mum-key', 'run'), el('span', 'yy-mum-main yy-mum-runval', t('waitingSend')),
      el('span', 'yy-mum-surface'), el('span', 'yy-mum-chip', '--'), el('span', 'yy-mum-caret', '▸')
    );
    const body = el('div', 'yy-mum-body'); body.hidden = true;
    block.addEventListener('click', (e) => e.stopPropagation());
    rows.addEventListener('click', () => {
      prefs.open = !prefs.open; savePrefs(); render(); if (prefs.open) send('YY_MUM_REQUEST');
    });
    block.append(rows, body);
    const panel = host.querySelector('.yy-cum-settings-panel');
    if (panel) host.insertBefore(block, panel); else host.appendChild(block);
    render(); loadPrefs(); send('YY_MUM_REQUEST');
  }

  function attach() {
    if (showModelRoute !== true) return false;
    if (block?.isConnected) return true;
    const host = document.getElementById(HOST_ID);
    if (!host) return false;
    build(host); return true;
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== IN) return;
    if (data.type === 'YY_MUM_DATA' && data.snapshot && Number(data.snapshot.v) >= 2) {
      snapshot = data.snapshot; attach(); render();
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

  new MutationObserver(() => attach()).observe(document.documentElement, { subtree: true, childList: true });
  setInterval(attach, 2_000);
  loadRouteSetting();
})();
