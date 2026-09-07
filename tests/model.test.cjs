/* Synthetic regression tests for model.js. No network. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'model.js');
const posted = [];
const listeners = {};

globalThis.window = globalThis;
window.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
window.postMessage = (data) => {
  posted.push(data);
  (listeners.message || []).forEach((fn) => fn({ source: window, data }));
};
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  documentElement: {}
};
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

const sleep = (ms = 160) => new Promise((r) => setTimeout(r, ms));
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
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok ? '' : `\n  expected ${e}\n  actual   ${a}`));
}

const send = (api, body) => window.fetch('/backend-api/' + api, { method: 'POST', body: JSON.stringify(body) });
const ask = (conv, model = 'gpt-5-6-thinking') => send('conversation', {
  model, conversation_id: conv, messages: [{ id: 'user-' + conv, author: { role: 'user' } }]
});
const message = (conv, metadata) => sse({
  conversation_id: conv,
  message: {
    id: 'asst-' + conv,
    author: { role: 'assistant' },
    content: { content_type: 'text', parts: ['body'] },
    metadata: { parent_id: 'user-' + conv, ...metadata }
  }
});

(async () => {
  console.log('[1] explicit server_ste_metadata');
  nextBody = message('c1', { model_slug: 'gpt-5-6-thinking' }) +
    sse({ type: 'server_ste_metadata', metadata: {
      model_slug: 'gpt-5-5-mini', requested_model_experience: 'thinking',
      did_auto_switch_to_reasoning: true, is_autoswitcher_enabled: true, turn_use_case: 'text'
    } }) + DONE;
  await ask('c1'); await sleep();
  check('requested', cur().requested, 'gpt-5-6-thinking');
  check('explicit STE wins', cur().exec, ['gpt-5-5-mini']);
  check('message slug remains echo', cur().echo, ['gpt-5-6-thinking']);
  check('source', cur().execEvidence[0].source, 'STE');
  check('priority', cur().execEvidence[0].priority, 100);

  console.log('[2] event-name-only STE');
  nextBody = message('c2', { model_slug: 'gpt-5-6-thinking' }) +
    named('server_ste_metadata', { model_slug: 'gpt-5-6-instant' }) + DONE;
  await ask('c2'); await sleep();
  check('event name recognized', cur().exec, ['gpt-5-6-instant']);

  console.log('[3] nested legacy STE');
  nextBody = sse({ conversation_id: 'c3', message: {
    id: 'asst-c3', author: { role: 'assistant' }, metadata: {
      parent_id: 'user-c3', model_slug: 'gpt-5-6-thinking',
      server_ste_metadata: { model_slug: 'gpt-5-6-sol' }
    }
  } }) + DONE;
  await ask('c3'); await sleep();
  check('nested exec', cur().exec, ['gpt-5-6-sol']);
  check('nested echo', cur().echo, ['gpt-5-6-thinking']);

  console.log('[4] ordinary message metadata must NOT become STE');
  nextBody = message('c4', {
    model_slug: 'gpt-5-6-thinking',
    resolved_model_slug: 'gpt-5-6-thinking',
    requested_model_experience: 'thinking',
    turn_use_case: 'text',
    tool_invoked: false,
    cluster_region: 'westus3',
    is_autoswitcher_enabled: false
  }) + DONE;
  await ask('c4'); await sleep();
  check('no false exec from message metadata', cur().exec, []);
  check('echo retained', cur().echo, ['gpt-5-6-thinking']);
  check('closed without STE', cur().state, '流已结束，没有 STE 事件');

  console.log('[5] strong unnamed STE fallback');
  nextBody = message('c5', { model_slug: 'gpt-5-6-thinking' }) + sse({
    model_slug: 'gpt-5-6-instant',
    requested_model_experience: 'thinking',
    did_auto_switch_to_reasoning: true,
    is_autoswitcher_enabled: true,
    server_ttfvt_ms: 900,
    cluster_region: 'eastus2'
  }) + DONE;
  await ask('c5'); await sleep();
  check('fallback exec', cur().exec, ['gpt-5-6-instant']);
  check('fallback source', cur().execEvidence[0].source, 'strong-STE-fallback');
  check('fallback marked approximate', cur().approx, true);

  console.log('[6] explicit evidence overrides lower-confidence fallback');
  nextBody = sse({
    model_slug: 'gpt-5-5-mini', requested_model_experience: 'thinking',
    did_auto_switch_to_reasoning: true, is_autoswitcher_enabled: true, server_ttfvt_ms: 600
  }) + sse({ type: 'server_ste_metadata', metadata: { model_slug: 'gpt-5-6-thinking' } }) + DONE;
  await ask('c6'); await sleep();
  check('high priority replaces fallback', cur().exec, ['gpt-5-6-thinking']);
  check('only top evidence remains', cur().execEvidence.map((e) => e.priority), [100]);

  console.log('[7] resolved_model_slug allowed only inside explicit STE');
  nextBody = sse({ type: 'server_ste_metadata', metadata: { resolved_model_slug: 'gpt-5-6-sol' } }) + DONE;
  await ask('c7'); await sleep();
  check('resolved fallback inside STE', cur().exec, ['gpt-5-6-sol']);
  check('resolved priority below model_slug', cur().execEvidence[0].priority, 94);

  console.log('[8] Work handoff + WebSocket association');
  nextBody = sse({ type: 'stream_handoff', conversation_id: 'c8', turn_exchange_id: 'tex-8' });
  await send('f/conversation', {
    model: 'gpt-6-astra-wm', conversation_id: 'c8', thinking_effort: 'high',
    messages: [{ id: 'user-c8', author: { role: 'user' } }]
  });
  await sleep();
  check('handoff state', cur().state, '已移交后台，等 STE');
  const ws = new window.WebSocket('wss://ws.chatgpt.com/v1/stream');
  const inner = message('c8', { turn_exchange_id: 'tex-8', working_turn_id: 'turn-8', model_slug: 'gpt-6-astra-wm' }) +
    named('server_ste_metadata', { conversation_id: 'c8', model_slug: 'gpt-5-6-instant' });
  ws.emit(JSON.stringify({ type: 'conversation-turn-stream', data: { encoded_item: Buffer.from(inner).toString('base64') } }));
  await sleep();
  check('WS exec', cur().exec, ['gpt-5-6-instant']);
  check('WS transport', cur().transports.includes('WebSocket'), true);

  console.log('[9] patch model slug stays echo unless patch path is STE');
  nextBody = message('c9', { model_slug: 'gpt-5-6-thinking' }) +
    sse({ p: '/message/metadata/model_slug', o: 'replace', v: 'gpt-5-6-instant' }) + DONE;
  await ask('c9'); await sleep();
  check('patch echo values', cur().echo, ['gpt-5-6-thinking', 'gpt-5-6-instant']);
  check('patch not exec', cur().exec, []);

  console.log('[10] noise endpoints do not create turns');
  nextType = 'application/json'; nextBody = '{"ok":true}';
  const before = cur().n;
  await window.fetch('/backend-api/f/conversation/prepare', { method: 'POST', body: '{"model":"noise"}' });
  await window.fetch('/backend-api/models');
  await sleep();
  check('turn unchanged', cur().n, before);

  console.log(failed ? `\n${failed} failed` : '\nAll tests passed');
  process.exit(failed ? 1 : 0);
})();
