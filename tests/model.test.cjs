/* 用合成数据跑 model.js，不联网。重点：执行模型只认 server_ste_metadata。 */
const fs = require('fs');
const vm = require('vm');

const SRC = require('path').join(__dirname, '..', 'model.js');

const posted = [];
const listeners = {};

globalThis.window = globalThis;
window.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
window.postMessage = (data) => {
  posted.push(data);
  (listeners.message || []).forEach((fn) => fn({ source: window, data }));
};
globalThis.document = { getElementById: () => null, querySelectorAll: () => [], documentElement: {} };
globalThis.location = { href: 'https://chatgpt.com/', origin: 'https://chatgpt.com' };

let nextBody = '';
let nextType = 'text/event-stream';
window.fetch = async () => new Response(nextBody, { headers: { 'content-type': nextType } });

class FakeSocket {
  constructor(url) { this.url = url; this.handlers = []; }
  addEventListener(type, fn) { if (type === 'message') this.handlers.push(fn); }
  emit(text) { this.handlers.forEach((fn) => fn({ data: text })); }
}
window.WebSocket = FakeSocket;
globalThis.XMLHttpRequest = class { open() {} send() {} addEventListener() {} };
window.XMLHttpRequest = globalThis.XMLHttpRequest;

vm.runInThisContext(fs.readFileSync(SRC, 'utf8'), { filename: SRC });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const latest = () => {
  for (let i = posted.length - 1; i >= 0; i--) if (posted[i].snapshot) return posted[i].snapshot;
  return null;
};
const cur = () => latest().turns[0];
const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';
const named = (name, obj) => 'event: ' + name + '\ndata: ' + JSON.stringify(obj) + '\n\n';
const DONE = 'data: [DONE]\n\n';

let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + (ok ? '' : '\n         期望 ' + e + '\n         实际 ' + a));
}

const send = (api, body) => window.fetch('/backend-api/' + api, { method: 'POST', body: JSON.stringify(body) });
const askThinking = (conv) => send('conversation', {
  model: 'gpt-5-6-thinking',
  conversation_id: conv,
  messages: [{ id: 'user-' + conv, author: { role: 'user' } }]
});

// 流中间的 message 事件：带的是请求回显
const echoFrame = (conv, slug) => sse({
  conversation_id: conv,
  message: {
    id: 'asst-' + conv,
    author: { role: 'assistant' },
    content: { content_type: 'text', parts: ['正文'] },
    metadata: { parent_id: 'user-' + conv, model_slug: slug }
  }
});

(async () => {
  /* ---------- 1. 重路由：请求 thinking，STE 报 mini ---------- */
  console.log('\n[1] 重路由，STE 顶层平铺');
  nextBody =
    'event: delta_encoding\ndata: "v1"\n\n' +
    echoFrame('c1', 'gpt-5-6-thinking') +
    sse({
      type: 'server_ste_metadata',
      model_slug: 'gpt-5-5-mini',
      requested_model_experience: 'thinking',
      plan_type: 'plus',
      tool_invoked: false,
      turn_use_case: 'text',
      did_auto_switch_to_reasoning: false,
      is_autoswitcher_enabled: true,
      server_ttfvt_ms: 842
    }) + DONE;
  await askThinking('c1');
  await sleep(300);

  let t = cur();
  check('请求', t.requested, 'gpt-5-6-thinking');
  check('执行（STE）', t.exec, ['gpt-5-5-mini']);
  check('回显（message）不混进执行', t.echo, ['gpt-5-6-thinking']);
  check('状态', t.state, '已确认执行模型');
  check('STE 附加字段', t.flags, {
    requested_model_experience: 'thinking',
    did_auto_switch_to_reasoning: false,
    is_autoswitcher_enabled: true,
    tool_invoked: false,
    turn_use_case: 'text',
    plan_type: 'plus',
    server_ttfvt_ms: 842
  });

  /* ---------- 2. STE 只靠 event: 名标识 ---------- */
  console.log('\n[2] STE 只有 event: 名');
  nextBody = echoFrame('c2', 'gpt-5-6-thinking')
    + named('server_ste_metadata', { model_slug: 'gpt-5-6-instant' }) + DONE;
  await askThinking('c2');
  await sleep(300);
  t = cur();
  check('靠事件名认出 STE', t.exec, ['gpt-5-6-instant']);
  check('回显仍归回显', t.echo, ['gpt-5-6-thinking']);

  /* ---------- 3. 老形态：嵌在 message.metadata.server_ste_metadata 里 ---------- */
  console.log('\n[3] 嵌套形态');
  nextBody = sse({
    conversation_id: 'c3',
    message: {
      id: 'asst-c3',
      author: { role: 'assistant' },
      metadata: {
        parent_id: 'user-c3',
        model_slug: 'gpt-5-6-thinking',
        server_ste_metadata: { model_slug: 'gpt-5-6-thinking' }
      }
    }
  }) + DONE;
  await askThinking('c3');
  await sleep(300);
  t = cur();
  check('嵌套 STE 进执行桶', t.exec, ['gpt-5-6-thinking']);
  check('同一帧的回显进回显桶', t.echo, ['gpt-5-6-thinking']);

  /* ---------- 4. 整条流都没有 STE ---------- */
  console.log('\n[4] 没有 STE 事件');
  nextBody = echoFrame('c4', 'gpt-5-6-thinking') + DONE;
  await askThinking('c4');
  await sleep(300);
  t = cur();
  check('执行桶为空', t.exec, []);
  check('回显有值', t.echo, ['gpt-5-6-thinking']);
  check('流已结束', t.closed, true);
  check('状态说清楚', t.state, '流已结束，没有 STE 事件');

  /* ---------- 5. work：handoff + WebSocket 末尾的 STE ---------- */
  console.log('\n[5] work 后台任务');
  nextBody = sse({ type: 'stream_handoff', conversation_id: 'c5', turn_exchange_id: 'tex-5' });
  await send('f/conversation', {
    model: 'gpt-6-astra-wm',
    conversation_id: 'c5',
    thinking_effort: 'high',
    messages: [{ id: 'user-c5', author: { role: 'user' } }]
  });
  await sleep(300);
  t = cur();
  check('移交后不算结束', t.closed, false);
  check('状态', t.state, '已移交后台，等 STE');

  const ws = new window.WebSocket('wss://ws.chatgpt.com/v1/stream');
  const inner = sse({
    conversation_id: 'c5',
    message: {
      id: 'asst-c5',
      author: { role: 'assistant' },
      content: { content_type: 'text', parts: ['回复'] },
      metadata: { turn_exchange_id: 'tex-5', working_turn_id: 'turn-5', model_slug: 'gpt-6-astra-wm' }
    }
  }) + named('server_ste_metadata', {
    model_slug: 'gpt-5-6-instant',
    requested_model_experience: 'agentic',
    did_auto_switch_to_reasoning: true
  });
  ws.emit(JSON.stringify({
    type: 'conversation-turn-stream',
    data: { encoded_item: Buffer.from(inner, 'utf8').toString('base64') }
  }));
  await sleep(300);
  t = cur();
  check('WebSocket 里的 STE 也抓到', t.exec, ['gpt-5-6-instant']);
  check('回显是请求值', t.echo, ['gpt-6-astra-wm']);
  check('自动转推理标志', t.flags.did_auto_switch_to_reasoning, true);
  check('通道', t.transports, ['HTTP SSE', 'WebSocket']);

  /* ---------- 6. 噪声隔离 ---------- */
  console.log('\n[6] 噪声隔离');
  nextBody = sse({
    conversation_id: 'c6',
    message: {
      id: 'asst-c6',
      author: { role: 'assistant' },
      content: { content_type: 'text', parts: ['{"model_slug":"gpt-4o"} 这是正文里的字符串'] },
      metadata: { parent_id: 'user-c6', model_slug: 'gpt-5-6-thinking' }
    }
  }) + named('server_ste_metadata', { model_slug: 'gpt-5-6-thinking' }) + DONE;
  await askThinking('c6');
  await sleep(300);
  t = cur();
  check('正文没污染执行桶', t.exec, ['gpt-5-6-thinking']);
  check('正文没污染回显桶', t.echo, ['gpt-5-6-thinking']);

  nextType = 'application/json';
  nextBody = JSON.stringify({ models: [{ slug: 'gpt-5-2', title: 'x' }] });
  const before = cur().n;
  await window.fetch('/backend-api/models');
  await sleep(200);
  check('/backend-api/models 不建记录', cur().n, before);

  /* ---------- 7. 真实抓到的形态（chat 窗口实测） ---------- */
  console.log('\n[7] 真实形态：type=server_ste_metadata + metadata.model_slug');
  nextType = 'text/event-stream';
  nextBody =
    'event: delta_encoding\ndata: "v1"\n\n' +
    sse({ v: { conversation_id: 'r1', message: {
      id: 'asst-r1', author: { role: 'assistant' },
      content: { content_type: 'text', parts: ['正文'] },
      metadata: {
        parent_id: 'user-r1',
        model_slug: 'gpt-5-6-thinking',
        resolved_model_slug: 'gpt-5-6-thinking',
        default_model_slug: 'gpt-5-6-thinking',
        model_switcher_deny: {}
      } } } }) +
    sse({ type: 'server_ste_metadata', metadata: {
      model_slug: 'gpt-5-6-thinking',
      requested_model_experience: 'thinking',
      did_auto_switch_to_reasoning: false,
      is_autoswitcher_enabled: false,
      auto_switcher_race_winner: null,
      cluster_region: 'westus3'
    } }) +
    sse({ type: 'message_stream_complete', conversation_id: 'r1' }) + DONE;
  await send('f/conversation', {
    model: 'gpt-5-6-thinking',
    conversation_id: 'r1',
    messages: [{ id: 'user-r1', author: { role: 'user' } }]
  });
  await sleep(300);
  t = cur();
  check('执行 = STE 的 metadata.model_slug', t.exec, ['gpt-5-6-thinking']);
  check('回显收 message 侧的 slug', t.echo, ['gpt-5-6-thinking']);
  check('STE 字段', t.flags, {
    requested_model_experience: 'thinking',
    did_auto_switch_to_reasoning: false,
    is_autoswitcher_enabled: false,
    auto_switcher_race_winner: null,
    cluster_region: 'westus3'
  });
  check('状态', t.state, '已确认执行模型');
  console.log('         事件名 ' + JSON.stringify(t.events));

  /* ---------- 8. 真实形态下的重路由 ---------- */
  console.log('\n[8] 真实形态 + 被重路由');
  nextBody =
    sse({ v: { conversation_id: 'r2', message: {
      id: 'asst-r2', author: { role: 'assistant' },
      metadata: { parent_id: 'user-r2', model_slug: 'gpt-5-6-thinking' } } } }) +
    sse({ type: 'server_ste_metadata', metadata: {
      model_slug: 'gpt-5-6-instant',
      requested_model_experience: 'thinking',
      did_auto_switch_to_reasoning: true,
      is_autoswitcher_enabled: true,
      auto_switcher_race_winner: 'instant'
    } }) + DONE;
  await send('f/conversation', {
    model: 'gpt-5-6-thinking',
    conversation_id: 'r2',
    messages: [{ id: 'user-r2', author: { role: 'user' } }]
  });
  await sleep(300);
  t = cur();
  check('执行 ≠ 请求，抓到了重路由', t.exec, ['gpt-5-6-instant']);
  check('回显还是请求值（正是它骗人的地方）', t.echo, ['gpt-5-6-thinking']);
  check('竞速胜出方', t.flags.auto_switcher_race_winner, 'instant');

  /* ---------- 9. delta patch 改写 model_slug ---------- */
  console.log('\n[9] patch 形态：model_slug 在 p 的值里而不是键名');
  nextBody =
    sse({ v: { conversation_id: 'r3', message: {
      id: 'asst-r3', author: { role: 'assistant' },
      metadata: { parent_id: 'user-r3', model_slug: 'gpt-5-6-thinking' } } } }) +
    sse({ p: '/message/metadata/model_slug', o: 'replace', v: 'gpt-5-6-instant' }) + DONE;
  await send('f/conversation', {
    model: 'gpt-5-6-thinking',
    conversation_id: 'r3',
    messages: [{ id: 'user-r3', author: { role: 'user' } }]
  });
  await sleep(300);
  t = cur();
  check('按键名找会漏掉的 patch 值也收到了', t.echo, ['gpt-5-6-thinking', 'gpt-5-6-instant']);


  /* ---------- 11. 兜底通道绝不建记录（v0.5.0 的回归） ---------- */
  console.log('');
  console.log('[11] 噪声请求不能挤掉当前轮');
  nextType = 'text/event-stream';
  nextBody = sse({ type: 'server_ste_metadata', metadata: { model_slug: 'gpt-5-6-thinking' } }) + DONE;
  await send('f/conversation', {
    model: 'gpt-5-6-thinking',
    conversation_id: 'z1',
    messages: [{ id: 'user-z1', author: { role: 'user' } }]
  });
  await sleep(300);
  const nBefore = cur().n;
  const execBefore = cur().exec.slice();

  nextType = 'application/json';
  nextBody = '{"ok":true}';
  // prepare 带 model 字段，最容易被误当成一次发送
  await window.fetch('/backend-api/f/conversation/prepare', { method: 'POST', body: JSON.stringify({ model: 'gpt-5-5-instant' }) });
  await window.fetch('/ces/v1/m', { method: 'POST', body: JSON.stringify({ model: 'noise' }) });
  await window.fetch('/backend-api/sentinel/ping', { method: 'POST', body: '{}' });
  await window.fetch('/backend-api/settings/user');
  await sleep(300);
  check('噪声请求没建新记录', cur().n, nBefore);
  check('当前轮的执行模型没被冲掉', cur().exec, execBefore);
  check('请求模型还在', cur().requested, 'gpt-5-6-thinking');

  /* ---------- 10. 只带当前一轮 ---------- */
  console.log('\n[10] 不堆历史');
  nextBody = DONE;
  for (let i = 0; i < 12; i++) await askThinking('x' + i);
  await sleep(300);
  check('快照只带一轮', latest().turns.length, 1);

  console.log(failed ? '\n' + failed + ' 项未通过\n' : '\n全部通过\n');
  process.exit(failed ? 1 : 0);
})();
