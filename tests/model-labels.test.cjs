const labels = require('../model-labels.js');

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n  expected: ${expected}\n  actual:   ${actual}`}`);
}

const turn = (plan, extra = {}) => ({ flags: { plan_type: plan, ...(extra.flags || {}) }, ui: extra.ui || '', api: extra.api || 'conversation', effort: extra.effort || '' });

check('Plus standard Chat thinking -> Sol', labels.friendlyModelName('gpt-5-6-thinking', turn('plus')), 'GPT-5.6 Sol · Thinking');
check('Plus standard Chat high effort -> Sol High', labels.friendlyModelName('gpt-5-6-thinking', turn('plus', { effort: 'high' })), 'GPT-5.6 Sol · High');
check('Free standard Chat thinking -> Luna', labels.friendlyModelName('gpt-5-6-thinking', turn('free')), 'GPT-5.6 Luna · Thinking');
check('Go instant -> Luna', labels.friendlyModelName('gpt-5-6-instant', turn('go')), 'GPT-5.6 Luna · Instant');
check('Work generic family remains unresolved', labels.friendlyModelName('gpt-5-6-thinking', turn('plus', { flags: { product_experience: 'work' } })), 'GPT-5.6 · Thinking');
check('Explicit Sol wins in Work', labels.friendlyModelName('gpt-5-6-sol', turn('plus', { flags: { product_experience: 'work' } })), 'GPT-5.6 Sol');
check('Explicit Terra wins in Work', labels.friendlyModelName('gpt-5-6-terra', turn('plus', { flags: { product_experience: 'work' } })), 'GPT-5.6 Terra');
check('UI label can identify Luna', labels.friendlyModelName('gpt-5-6-thinking', turn('plus', { ui: 'GPT-5.6 Luna' })), 'GPT-5.6 Luna · Thinking');
check('GPT-5.5 mini readable', labels.friendlyModelName('gpt-5-5-mini', turn('plus')), 'GPT-5.5 · Mini');
check('GPT-6 Astra Work readable', labels.friendlyModelName('gpt-6-astra-wm', turn('plus')), 'GPT-6 Astra · Work');

console.log(failed ? `\n${failed} failed` : '\nAll model-label tests passed');
process.exit(failed ? 1 : 0);
