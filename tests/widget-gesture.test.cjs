/* Regression test for minimized-widget tap/drag behavior and compact quota summary. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'widget.js');
let src = fs.readFileSync(srcPath, 'utf8');

const injected = `
  const __assert = (label, cond, actual) => {
    if (!cond) throw new Error(label + ': ' + JSON.stringify(actual));
    console.log('PASS ' + label);
  };

  // Minimal host state: no DOM mount/init, only exercise the production gesture functions.
  widget = {
    dataset: { minimized: 'true' },
    style: {},
    offsetWidth: 98,
    classList: { add() {}, remove() {}, toggle() {} },
    getBoundingClientRect() { return { left: 20, top: 20, width: currentLayout.minimized ? 98 : 304, height: currentLayout.minimized ? 48 : 110 }; },
    releasePointerCapture() {}
  };
  currentLayout = { position: { left: 20, top: 20 }, minimized: true };

  drag = { pointerId: 1, moved: false, fromMini: true };
  endDrag({ pointerId: 1 }, false);
  __assert('mini tap restores panel on pointerup', currentLayout.minimized === false, currentLayout);

  currentLayout.minimized = true;
  drag = { pointerId: 2, moved: true, fromMini: true };
  endDrag({ pointerId: 2 }, false);
  __assert('mini drag stays minimized', currentLayout.minimized === true, currentLayout);

  currentLayout.minimized = true;
  drag = { pointerId: 3, moved: false, fromMini: true };
  endDrag({ pointerId: 3 }, true);
  __assert('pointer cancel does not restore', currentLayout.minimized === true, currentLayout);

  __assert('5h compact summary uses remaining percent', formatMiniPercent({ used_percent: 25 }) === '75%', formatMiniPercent({ used_percent: 25 }));
  __assert('7d compact summary supports normal percentage', formatMiniPercent({ used_percent: 40 }) === '60%', formatMiniPercent({ used_percent: 40 }));
`;

const pos = src.lastIndexOf('})();');
if (pos < 0) throw new Error('Unable to locate widget IIFE end');
src = src.slice(0, pos) + injected + '\n' + src.slice(pos);

const noop = () => {};
globalThis.window = globalThis;
window.__YY_CODEX_USAGE_WIDGET__ = false;
window.innerWidth = 1280;
window.innerHeight = 800;
window.addEventListener = noop;
window.postMessage = noop;
globalThis.navigator = { language: 'zh-CN' };
globalThis.document = {
  readyState: 'loading',
  addEventListener: noop,
  documentElement: {},
  body: null
};
globalThis.chrome = { storage: { local: { set: noop }, sync: { set: noop } } };
globalThis.MutationObserver = class { observe() {} };
globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
globalThis.getComputedStyle = () => ({ backgroundColor: 'rgb(255,255,255)' });
globalThis.matchMedia = () => ({ matches: false });

vm.runInThisContext(src, { filename: srcPath });
console.log('All widget gesture tests passed');
