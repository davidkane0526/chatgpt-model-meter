(() => {
  'use strict';

  if (window.__YY_CODEX_USAGE_WIDGET__) return;
  window.__YY_CODEX_USAGE_WIDGET__ = true;

  const MESSAGE_DATA = 'YY_CODEX_USAGE_DATA';
  const MESSAGE_ERROR = 'YY_CODEX_USAGE_ERROR';
  const MESSAGE_REQUEST = 'YY_CODEX_USAGE_REQUEST';
  const WIDGET_ID = 'yy-codex-usage-meter';
  const SETTINGS_KEY = 'yyCodexUsageMeterSettings';
  const LAYOUT_KEY = 'yyCodexUsageMeterLayoutV2';

  const DEFAULT_SETTINGS = {
    fontFamily: 'system',
    fontSize: 13,
    textColor: null,
    cardColor: null,
    cardOpacity: 92,
    showModelRoute: true,
    defaultHidden: false,
    language: 'auto'
  };
  const DEFAULT_LAYOUT = { position: null, minimized: false };

  const FONT_FAMILIES = {
    system: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  };

  const I18N = {
    zh: {
      settingsTitle: '显示设置', language: '界面语言', modelRouting: '显示模型路由', autoHide: '默认隐藏',
      font: '字体', system: '系统无衬线', serif: '衬线', mono: '等宽', size: '字号',
      textColor: '文字颜色', cardColor: '卡片颜色', opacity: '透明度',
      followTheme: '跟随主题', resetPosition: '恢复默认位置', reset: '恢复全部默认', settings: '显示设置',
      minimize: '缩小为信息图标', restore: '恢复面板', drag: '拖动面板', miniRemaining: '剩余额度',
      usageTitle: 'Work / Codex 剩余额度', clickRefresh: '点击卡片立即刷新。',
      readError: '暂时读取不到额度', retry: '点击卡片重试。'
    },
    en: {
      settingsTitle: 'Display settings', language: 'Language', modelRouting: 'Model routing', autoHide: 'Auto-hide',
      font: 'Font', system: 'System sans', serif: 'Serif', mono: 'Monospace', size: 'Font size',
      textColor: 'Text color', cardColor: 'Card color', opacity: 'Opacity',
      followTheme: 'Follow theme', resetPosition: 'Reset position', reset: 'Reset all', settings: 'Display settings',
      minimize: 'Minimize to status icon', restore: 'Restore panel', drag: 'Drag panel', miniRemaining: 'remaining',
      usageTitle: 'Work / Codex remaining quota', clickRefresh: 'Click the card to refresh.',
      readError: 'Unable to read quota right now', retry: 'Click the card to retry.'
    }
  };

  let payload = null;
  let lastError = '';
  let widget = null;
  let fiveHourValue = null;
  let weeklyValue = null;
  let settingsPanel = null;
  let settingsButton = null;
  let minimizeButton = null;
  let miniButton = null;
  let miniFiveHour = null;
  let miniWeekly = null;
  let miniGauge = null;
  let currentSettings = { ...DEFAULT_SETTINGS };
  let currentLayout = { ...DEFAULT_LAYOUT };
  let autoHideCloseTimer = 0;
  let lastPointerX = null;
  let lastPointerY = null;
  let drag = null;
  let suppressClick = false;
  const AUTO_HIDE_MARGIN = 5;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function resolvedLanguage() {
    if (currentSettings.language === 'zh' || currentSettings.language === 'en') return currentSettings.language;
    return String(navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  function t(key) {
    const lang = resolvedLanguage();
    return I18N[lang][key] ?? I18N.en[key] ?? key;
  }

  function remainingPercent(windowData) {
    if (!windowData || typeof windowData.used_percent !== 'number') return null;
    return clamp(Math.round((100 - windowData.used_percent) * 10) / 10, 0, 100);
  }

  function isPrimaryInactive(windowData) {
    if (!windowData) return false;
    const used = Number(windowData.used_percent);
    const total = Number(windowData.limit_window_seconds);
    const remaining = Number(windowData.reset_after_seconds);
    return Number.isFinite(used) && Number.isFinite(total) && Number.isFinite(remaining) &&
      used === 0 && total > 0 && remaining >= total - 5;
  }

  function formatCountdown(windowData, primary = false) {
    if (!windowData) return '--';
    if (primary && isPrimaryInactive(windowData)) return '-';
    const resetAt = Number(windowData.reset_at);
    if (!Number.isFinite(resetAt) || resetAt <= 0) return '--';
    let totalMinutes = Math.max(0, Math.ceil((resetAt * 1000 - Date.now()) / 60_000));
    if (totalMinutes <= 0) return '0m';
    const days = Math.floor(totalMinutes / 1440);
    totalMinutes %= 1440;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function row(label) {
    const el = document.createElement('div');
    el.className = 'yy-cum-row';
    el.innerHTML = `
      <span class="yy-cum-label">${label}</span>
      <span class="yy-cum-track"><span class="yy-cum-fill"></span></span>
      <span class="yy-cum-percent">--</span>
      <span class="yy-cum-reset">--</span>`;
    return el;
  }

  function hexToRgb(hex) {
    const normalized = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
    return {
      r: parseInt(normalized.slice(0, 2), 16),
      g: parseInt(normalized.slice(2, 4), 16),
      b: parseInt(normalized.slice(4, 6), 16)
    };
  }

  function bodyLooksDark() {
    const target = document.body || document.documentElement;
    const color = getComputedStyle(target).backgroundColor;
    const match = color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
    if (!match) return matchMedia('(prefers-color-scheme: dark)').matches;
    const r = Number(match[1]), g = Number(match[2]), b = Number(match[3]);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }

  function themeDefaults() {
    const dark = widget?.dataset.theme === 'dark' || bodyLooksDark();
    return dark ? { textColor: '#f5f5f5', cardColor: '#232323' } : { textColor: '#141414', cardColor: '#fafafa' };
  }

  function effectiveColors() {
    const defaults = themeDefaults();
    return {
      textColor: currentSettings.textColor || defaults.textColor,
      cardColor: currentSettings.cardColor || defaults.cardColor
    };
  }

  async function loadSettings() {
    try {
      const [sync, local] = await Promise.all([
        chrome.storage.sync.get(SETTINGS_KEY), chrome.storage.local.get(LAYOUT_KEY)
      ]);
      if (sync?.[SETTINGS_KEY] && typeof sync[SETTINGS_KEY] === 'object') {
        currentSettings = { ...DEFAULT_SETTINGS, ...sync[SETTINGS_KEY] };
      }
      if (local?.[LAYOUT_KEY] && typeof local[LAYOUT_KEY] === 'object') {
        currentLayout = { ...DEFAULT_LAYOUT, ...local[LAYOUT_KEY] };
      }
    } catch {}
    applySettings();
    applyLayout();
  }

  function saveSettings() {
    try { chrome.storage.sync.set({ [SETTINGS_KEY]: currentSettings }); } catch {}
  }
  function saveLayout() {
    try { chrome.storage.local.set({ [LAYOUT_KEY]: currentLayout }); } catch {}
  }

  function applySettings() {
    if (!widget) return;
    const colors = effectiveColors();
    const rgb = hexToRgb(colors.cardColor) || { r: 250, g: 250, b: 250 };
    const alpha = clamp(Number(currentSettings.cardOpacity) / 100, 0.2, 1);
    const fontFamily = FONT_FAMILIES[currentSettings.fontFamily] || FONT_FAMILIES.system;
    const fontSize = clamp(Number(currentSettings.fontSize) || DEFAULT_SETTINGS.fontSize, 11, 18);

    widget.style.setProperty('--yy-card-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
    widget.style.setProperty('--yy-text-color', colors.textColor);
    widget.style.setProperty('--yy-font-family', fontFamily);
    widget.style.setProperty('--yy-font-size', `${fontSize}px`);
    widget.dataset.autoHide = currentSettings.defaultHidden ? 'true' : 'false';
    applyLanguage();
    if (settingsPanel) syncSettingsControls();
  }

  function applyLanguage() {
    if (!widget) return;
    settingsPanel?.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    if (settingsButton) { settingsButton.title = t('settings'); settingsButton.setAttribute('aria-label', t('settings')); }
    if (minimizeButton) { minimizeButton.title = t('minimize'); minimizeButton.setAttribute('aria-label', t('minimize')); }
    if (miniButton && !payload) { miniButton.title = t('restore'); miniButton.setAttribute('aria-label', t('restore')); }
    render();
  }

  function validPosition(pos) {
    return pos && Number.isFinite(Number(pos.left)) && Number.isFinite(Number(pos.top));
  }

  function clampPosition(left, top) {
    const rect = widget?.getBoundingClientRect();
    const width = rect?.width || (currentLayout.minimized ? 98 : 304);
    const height = rect?.height || (currentLayout.minimized ? 48 : 110);
    const margin = 6;
    return {
      left: clamp(Math.round(left), margin, Math.max(margin, window.innerWidth - width - margin)),
      top: clamp(Math.round(top), margin, Math.max(margin, window.innerHeight - height - margin))
    };
  }

  function applyLayout() {
    if (!widget) return;
    widget.dataset.minimized = currentLayout.minimized ? 'true' : 'false';
    if (currentLayout.minimized) closeSettings();
    updatePosition();
    positionSettingsPanel();
  }

  function syncSettingsControls() {
    if (!settingsPanel) return;
    const colors = effectiveColors();
    const set = (sel, value, prop = 'value') => {
      const node = settingsPanel.querySelector(sel);
      if (node) node[prop] = value;
    };
    set('[data-setting="fontFamily"]', currentSettings.fontFamily);
    set('[data-setting="fontSize"]', String(currentSettings.fontSize));
    set('[data-role="fontSizeValue"]', `${currentSettings.fontSize}px`, 'textContent');
    set('[data-setting="textColor"]', colors.textColor);
    set('[data-setting="cardColor"]', colors.cardColor);
    set('[data-setting="cardOpacity"]', String(currentSettings.cardOpacity));
    set('[data-role="cardOpacityValue"]', `${currentSettings.cardOpacity}%`, 'textContent');
    set('[data-setting="showModelRoute"]', currentSettings.showModelRoute !== false, 'checked');
    set('[data-setting="defaultHidden"]', Boolean(currentSettings.defaultHidden), 'checked');
    set('[data-setting="language"]', currentSettings.language || 'auto');
  }

  function buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'yy-cum-settings-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="yy-cum-settings-title" data-i18n="settingsTitle"></div>
      <label class="yy-cum-setting-line"><span data-i18n="language"></span><select data-setting="language"><option value="auto">Auto</option><option value="zh">中文</option><option value="en">English</option></select></label>
      <label class="yy-cum-setting-line yy-cum-setting-toggle-line"><span data-i18n="modelRouting"></span><input data-setting="showModelRoute" type="checkbox"></label>
      <label class="yy-cum-setting-line yy-cum-setting-toggle-line"><span data-i18n="autoHide"></span><input data-setting="defaultHidden" type="checkbox"></label>
      <label class="yy-cum-setting-line"><span data-i18n="font"></span><select data-setting="fontFamily"><option value="system" data-i18n="system"></option><option value="serif" data-i18n="serif"></option><option value="mono" data-i18n="mono"></option></select></label>
      <label class="yy-cum-setting-line yy-cum-setting-range-line"><span data-i18n="size"></span><input data-setting="fontSize" type="range" min="11" max="18" step="1"><span class="yy-cum-setting-value" data-role="fontSizeValue"></span></label>
      <label class="yy-cum-setting-line"><span data-i18n="textColor"></span><input data-setting="textColor" type="color"></label>
      <label class="yy-cum-setting-line"><span data-i18n="cardColor"></span><input data-setting="cardColor" type="color"></label>
      <label class="yy-cum-setting-line yy-cum-setting-range-line"><span data-i18n="opacity"></span><input data-setting="cardOpacity" type="range" min="20" max="100" step="1"><span class="yy-cum-setting-value" data-role="cardOpacityValue"></span></label>
      <div class="yy-cum-settings-actions">
        <button type="button" data-action="theme-default" data-i18n="followTheme"></button>
        <button type="button" data-action="reset-position" data-i18n="resetPosition"></button>
        <button type="button" data-action="reset-all" data-i18n="reset"></button>
      </div>`;

    panel.addEventListener('click', (e) => e.stopPropagation());
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());

    const bind = (key, event, read) => {
      const node = panel.querySelector(`[data-setting="${key}"]`);
      node?.addEventListener(event, () => {
        currentSettings[key] = read(node);
        applySettings();
        saveSettings();
      });
    };
    bind('language', 'change', (n) => n.value);
    bind('showModelRoute', 'change', (n) => n.checked);
    bind('defaultHidden', 'change', (n) => n.checked);
    bind('fontFamily', 'change', (n) => n.value);
    bind('fontSize', 'input', (n) => Number(n.value));
    bind('textColor', 'input', (n) => n.value);
    bind('cardColor', 'input', (n) => n.value);
    bind('cardOpacity', 'input', (n) => Number(n.value));

    panel.querySelector('[data-action="theme-default"]')?.addEventListener('click', () => {
      currentSettings.textColor = null;
      currentSettings.cardColor = null;
      applySettings(); saveSettings();
    });
    panel.querySelector('[data-action="reset-position"]')?.addEventListener('click', () => {
      currentLayout.position = null;
      saveLayout(); updatePosition(); positionSettingsPanel();
    });
    panel.querySelector('[data-action="reset-all"]')?.addEventListener('click', () => {
      currentSettings = { ...DEFAULT_SETTINGS };
      currentLayout = { ...DEFAULT_LAYOUT };
      applySettings(); applyLayout(); saveSettings(); saveLayout();
    });

    return panel;
  }

  function installStyles() {
    if (document.getElementById(`${WIDGET_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${WIDGET_ID}-style`;
    style.textContent = `
      #${WIDGET_ID}{--yy-card-bg:rgba(250,250,250,.92);--yy-text-color:#141414;--yy-font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--yy-font-size:13px;position:fixed;top:10px;left:232px;width:304px;box-sizing:border-box;z-index:2147483000;padding:10px 12px 11px;border:1px solid rgba(0,0,0,.11);border-radius:12px;background:var(--yy-card-bg);color:var(--yy-text-color);box-shadow:0 2px 8px rgba(0,0,0,.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:var(--yy-font-family);font-size:var(--yy-font-size);line-height:1.15;user-select:none;transition:width 140ms ease,padding 140ms ease,opacity 120ms ease,background-color 120ms ease,color 120ms ease,border-radius 140ms ease}
      #${WIDGET_ID}.yy-cum-dragging{transition:none!important;cursor:grabbing!important}
      #${WIDGET_ID}[data-theme="dark"]{border-color:rgba(255,255,255,.14);box-shadow:0 2px 10px rgba(0,0,0,.32)}
      #${WIDGET_ID}.yy-cum-loading{opacity:.76} #${WIDGET_ID}.yy-cum-error{opacity:.82}
      #${WIDGET_ID} .yy-cum-header{display:flex;align-items:center;justify-content:space-between;min-height:24px;margin-bottom:3px;cursor:grab;touch-action:none}
      #${WIDGET_ID} .yy-cum-title{font-weight:700;letter-spacing:.01em;opacity:.88;flex:1}
      #${WIDGET_ID} .yy-cum-header-actions{display:flex;align-items:center;gap:1px}
      #${WIDGET_ID} .yy-cum-icon-button,#${WIDGET_ID} .yy-cum-mini-button{display:inline-grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;opacity:.68;font:inherit}
      #${WIDGET_ID} .yy-cum-icon-button:hover,#${WIDGET_ID} .yy-cum-icon-button[aria-expanded="true"]{background:rgba(127,127,127,.12);opacity:.98}
      #${WIDGET_ID} .yy-cum-icon-button svg{width:17px;height:17px;display:block}
      #${WIDGET_ID} .yy-cum-row{display:grid;grid-template-columns:26px minmax(98px,1fr) 48px 84px;align-items:center;gap:8px;height:30px;white-space:nowrap}
      #${WIDGET_ID} .yy-cum-label{font-weight:700;letter-spacing:.02em;opacity:.82}
      #${WIDGET_ID} .yy-cum-track{display:block;position:relative;height:9px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,currentColor 14%,transparent)}
      #${WIDGET_ID} .yy-cum-fill{display:block;width:0;height:100%;border-radius:inherit;background:currentColor;opacity:.72;transition:width 220ms ease}
      #${WIDGET_ID} .yy-cum-percent,#${WIDGET_ID} .yy-cum-reset{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;opacity:.92}
      #${WIDGET_ID} .yy-cum-reset{font-weight:520;opacity:.68} #${WIDGET_ID} .yy-cum-reset.yy-cum-inactive{text-align:center}
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer):not([data-minimized="true"]){width:112px;padding:7px 10px}
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer):not([data-minimized="true"]) .yy-cum-header{min-height:24px;margin-bottom:0}
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer):not([data-minimized="true"])>.yy-cum-row,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer):not([data-minimized="true"])>.yy-mum-block,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open):not(.yy-cum-hover-buffer):not([data-minimized="true"]) .yy-cum-header-actions{display:none!important}
      #${WIDGET_ID} .yy-cum-mini-button{display:none;width:100%;height:100%;border:0;padding:4px 7px 4px 6px;border-radius:inherit;background:transparent;color:inherit;touch-action:none;cursor:grab;font:inherit;box-sizing:border-box;grid-template-columns:28px 1fr;align-items:center;gap:6px;text-align:left}
      #${WIDGET_ID} .yy-cum-mini-gauge{--yy-mini-pct:0%;position:relative;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(currentColor var(--yy-mini-pct),color-mix(in srgb,currentColor 13%,transparent) 0);opacity:.88}
      #${WIDGET_ID} .yy-cum-mini-gauge::after{content:"";position:absolute;inset:4px;border-radius:50%;background:var(--yy-card-bg)}
      #${WIDGET_ID} .yy-cum-mini-gauge-dot{position:relative;z-index:1;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.86}
      #${WIDGET_ID} .yy-cum-mini-copy{min-width:0;display:grid;gap:1px;line-height:1.05;font-variant-numeric:tabular-nums}
      #${WIDGET_ID} .yy-cum-mini-line{display:flex;align-items:baseline;justify-content:space-between;gap:5px;white-space:nowrap}
      #${WIDGET_ID} .yy-cum-mini-label{font-size:10px;font-weight:700;opacity:.62;letter-spacing:.01em}
      #${WIDGET_ID} .yy-cum-mini-value{font-size:11px;font-weight:760;opacity:.96}
      #${WIDGET_ID} .yy-cum-mini-line.secondary .yy-cum-mini-label,#${WIDGET_ID} .yy-cum-mini-line.secondary .yy-cum-mini-value{font-size:9px;opacity:.55}
      #${WIDGET_ID}[data-minimized="true"]{width:98px;height:48px;padding:0;border-radius:14px}
      #${WIDGET_ID}[data-minimized="true"]>.yy-cum-header,#${WIDGET_ID}[data-minimized="true"]>.yy-cum-row,#${WIDGET_ID}[data-minimized="true"]>.yy-mum-block,#${WIDGET_ID}[data-minimized="true"]>.yy-cum-settings-panel{display:none!important}
      #${WIDGET_ID}[data-minimized="true"]>.yy-cum-mini-button{display:grid}
      #${WIDGET_ID} .yy-cum-settings-panel{position:absolute;top:calc(100% + 8px);left:0;width:304px;box-sizing:border-box;padding:12px;border:1px solid rgba(0,0,0,.12);border-radius:12px;background:rgba(250,250,250,.98);color:#181818;box-shadow:0 8px 24px rgba(0,0,0,.16);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;line-height:1.2}
      #${WIDGET_ID}[data-theme="dark"] .yy-cum-settings-panel{border-color:rgba(255,255,255,.14);background:rgba(36,36,36,.98);color:#f2f2f2;box-shadow:0 8px 28px rgba(0,0,0,.42)}
      #${WIDGET_ID} .yy-cum-settings-panel[hidden]{display:none} #${WIDGET_ID} .yy-cum-settings-title{font-size:13px;font-weight:700;margin-bottom:9px}
      #${WIDGET_ID} .yy-cum-setting-line{display:grid;grid-template-columns:88px 1fr;align-items:center;gap:8px;min-height:32px} #${WIDGET_ID} .yy-cum-setting-range-line{grid-template-columns:88px 1fr 42px} #${WIDGET_ID} .yy-cum-setting-toggle-line{grid-template-columns:1fr auto}
      #${WIDGET_ID} .yy-cum-setting-toggle-line input{width:16px;height:16px;margin:0;cursor:pointer} #${WIDGET_ID} .yy-cum-setting-line select,#${WIDGET_ID} .yy-cum-setting-line input[type="range"]{width:100%}
      #${WIDGET_ID} .yy-cum-setting-line select{height:27px;border:1px solid rgba(127,127,127,.25);border-radius:7px;padding:0 7px;background:rgba(127,127,127,.08);color:inherit;font:inherit}
      #${WIDGET_ID} .yy-cum-setting-line input[type="color"]{width:44px;height:27px;padding:1px;border:1px solid rgba(127,127,127,.25);border-radius:7px;background:transparent;cursor:pointer}
      #${WIDGET_ID} .yy-cum-setting-value{text-align:right;font-variant-numeric:tabular-nums;opacity:.7}
      #${WIDGET_ID} .yy-cum-settings-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(127,127,127,.18)}
      #${WIDGET_ID} .yy-cum-settings-actions button{min-height:28px;border:1px solid rgba(127,127,127,.24);border-radius:8px;padding:0 9px;background:rgba(127,127,127,.08);color:inherit;font:inherit;cursor:pointer} #${WIDGET_ID} .yy-cum-settings-actions button:hover{background:rgba(127,127,127,.15)}
    `;
    document.documentElement.appendChild(style);
  }

  function buildWidget() {
    if (document.getElementById(WIDGET_ID)) return document.getElementById(WIDGET_ID);
    installStyles();

    const root = document.createElement('div');
    root.id = WIDGET_ID;
    root.className = 'yy-cum-loading';

    const header = document.createElement('div');
    header.className = 'yy-cum-header';
    header.innerHTML = `
      <span class="yy-cum-title">Work / Codex</span>
      <span class="yy-cum-header-actions">
        <button class="yy-cum-icon-button yy-cum-minimize-button" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 12h12"/></svg></button>
        <button class="yy-cum-icon-button yy-cum-settings-button" type="button" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.15"></circle><path d="M10.32 5.26L10.49 2.98A9.15 9.15 0 0 1 13.51 2.98L13.68 5.26A6.95 6.95 0 0 1 15.58 6.04L17.31 4.55A9.15 9.15 0 0 1 19.45 6.69L17.96 8.42A6.95 6.95 0 0 1 18.74 10.32L21.02 10.49A9.15 9.15 0 0 1 21.02 13.51L18.74 13.68A6.95 6.95 0 0 1 17.96 15.58L19.45 17.31A9.15 9.15 0 0 1 17.31 19.45L15.58 17.96A6.95 6.95 0 0 1 13.68 18.74L13.51 21.02A9.15 9.15 0 0 1 10.49 21.02L10.32 18.74A6.95 6.95 0 0 1 8.42 17.96L6.69 19.45A9.15 9.15 0 0 1 4.55 17.31L6.04 15.58A6.95 6.95 0 0 1 5.26 13.68L2.98 13.51A9.15 9.15 0 0 1 2.98 10.49L5.26 10.32A6.95 6.95 0 0 1 6.04 8.42L4.55 6.69A9.15 9.15 0 0 1 6.69 4.55L8.42 6.04A6.95 6.95 0 0 1 10.32 5.26Z"></path></svg></button>
      </span>`;
    root.appendChild(header);
    root.appendChild(row('5h'));
    root.appendChild(row('7d'));

    const mini = document.createElement('button');
    mini.type = 'button';
    mini.className = 'yy-cum-mini-button';
    mini.innerHTML = `
      <span class="yy-cum-mini-gauge" aria-hidden="true"><span class="yy-cum-mini-gauge-dot"></span></span>
      <span class="yy-cum-mini-copy">
        <span class="yy-cum-mini-line"><span class="yy-cum-mini-label">5h</span><span class="yy-cum-mini-value yy-cum-mini-five">--</span></span>
        <span class="yy-cum-mini-line secondary"><span class="yy-cum-mini-label">7d</span><span class="yy-cum-mini-value yy-cum-mini-seven">--</span></span>
      </span>`;
    root.appendChild(mini);

    settingsPanel = buildSettingsPanel();
    root.appendChild(settingsPanel);
    settingsButton = header.querySelector('.yy-cum-settings-button');
    minimizeButton = header.querySelector('.yy-cum-minimize-button');
    miniButton = mini;
    miniFiveHour = mini.querySelector('.yy-cum-mini-five');
    miniWeekly = mini.querySelector('.yy-cum-mini-seven');
    miniGauge = mini.querySelector('.yy-cum-mini-gauge');

    settingsButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = settingsPanel.hidden;
      settingsPanel.hidden = !open;
      settingsButton.setAttribute('aria-expanded', String(open));
      root.classList.toggle('yy-cum-settings-open', open);
      if (open) { syncSettingsControls(); requestAnimationFrame(positionSettingsPanel); }
    });
    minimizeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      currentLayout.minimized = true;
      saveLayout(); applyLayout();
    });
    const restoreFromMini = () => {
      if (!currentLayout.minimized) return;
      currentLayout.minimized = false;
      saveLayout();
      applyLayout();
    };
    miniButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (suppressClick) return;
      restoreFromMini();
    });

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      beginDrag(e, false);
    });
    miniButton.addEventListener('pointerdown', (e) => beginDrag(e, true));

    root.addEventListener('click', (e) => {
      if (suppressClick || currentLayout.minimized) return;
      if (e.target.closest('.yy-cum-settings-panel,.yy-cum-icon-button,.yy-cum-mini-button')) return;
      root.classList.add('yy-cum-loading');
      requestUsage(true);
    });

    setupAutoHide(root);
    (document.body || document.documentElement).appendChild(root);
    widget = root;
    fiveHourValue = root.querySelectorAll('.yy-cum-row')[0];
    weeklyValue = root.querySelectorAll('.yy-cum-row')[1];
    updateTheme(); applySettings(); applyLayout(); render(); loadSettings();
    return root;
  }

  function beginDrag(event, fromMini = false) {
    if (!widget || event.button !== 0) return;
    const rect = widget.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
      fromMini: Boolean(fromMini)
    };
    widget.classList.add('yy-cum-dragging');
    try { widget.setPointerCapture(event.pointerId); } catch {}
    // 缩小态必须保留“轻点恢复”的语义。pointerup 会自行区分 tap / drag，
    // 因此不再依赖 Chromium 是否继续派发 click。
    if (!fromMini) event.preventDefault();
  }

  document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId || !widget) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    const pos = clampPosition(drag.left + dx, drag.top + dy);
    currentLayout.position = pos;
    widget.style.left = `${pos.left}px`;
    widget.style.top = `${pos.top}px`;
    positionSettingsPanel();
    event.preventDefault();
  }, { passive: false });

  function endDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId || !widget) return;
    const moved = drag.moved;
    const fromMini = drag.fromMini;
    try { widget.releasePointerCapture(event.pointerId); } catch {}
    drag = null;
    widget.classList.remove('yy-cum-dragging');

    if (cancelled) return;

    // 缩小态：移动超过阈值就是拖动；没有移动就是恢复。
    // 直接在 pointerup 完成恢复，彻底规避 click 被 pointer capture 吃掉的问题。
    if (fromMini && !moved) {
      currentLayout.minimized = false;
      saveLayout();
      applyLayout();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 120);
      return;
    }

    if (moved) {
      saveLayout();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 120);
    }
  }
  document.addEventListener('pointerup', (event) => endDrag(event, false), true);
  document.addEventListener('pointercancel', (event) => endDrag(event, true), true);

  function setupAutoHide(root) {
    const cancel = () => { if (autoHideCloseTimer) clearTimeout(autoHideCloseTimer); autoHideCloseTimer = 0; };
    const near = (rect, x, y, margin = AUTO_HIDE_MARGIN) => Number.isFinite(x) && Number.isFinite(y) && x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;
    const pointerNear = () => {
      if (!Number.isFinite(lastPointerX) || !Number.isFinite(lastPointerY)) return false;
      if (near(root.getBoundingClientRect(), lastPointerX, lastPointerY)) return true;
      return settingsPanel && !settingsPanel.hidden && near(settingsPanel.getBoundingClientRect(), lastPointerX, lastPointerY);
    };
    const schedule = () => {
      if (!currentSettings.defaultHidden || !settingsPanel || settingsPanel.hidden) return;
      cancel();
      autoHideCloseTimer = setTimeout(() => {
        autoHideCloseTimer = 0;
        if (root.matches(':hover') || settingsPanel.matches(':hover') || pointerNear()) return;
        closeSettings(); root.classList.remove('yy-cum-hover-buffer');
      }, 180);
    };

    root.addEventListener('mouseleave', () => {
      if (!currentSettings.defaultHidden || currentLayout.minimized) return;
      root.classList.add('yy-cum-hover-buffer');
      if (!settingsPanel.hidden) schedule();
    });
    root.addEventListener('mouseenter', () => { cancel(); root.classList.remove('yy-cum-hover-buffer'); });
    settingsPanel.addEventListener('mouseenter', cancel);
    settingsPanel.addEventListener('mouseleave', schedule);

    document.addEventListener('pointermove', (event) => {
      lastPointerX = event.clientX; lastPointerY = event.clientY;
      if (!currentSettings.defaultHidden || currentLayout.minimized) { root.classList.remove('yy-cum-hover-buffer'); return; }
      if (root.matches(':hover') || settingsPanel.matches(':hover') || pointerNear()) { cancel(); return; }
      root.classList.remove('yy-cum-hover-buffer');
      if (!settingsPanel.hidden && !autoHideCloseTimer) schedule();
    }, { passive: true });
  }

  function setRow(rowEl, windowData, primary = false) {
    if (!rowEl) return;
    const fill = rowEl.querySelector('.yy-cum-fill');
    const percent = rowEl.querySelector('.yy-cum-percent');
    const reset = rowEl.querySelector('.yy-cum-reset');
    const remaining = remainingPercent(windowData);
    const inactive = primary && isPrimaryInactive(windowData);
    reset.classList.toggle('yy-cum-inactive', inactive);
    if (remaining == null) { fill.style.width = '0%'; percent.textContent = '--'; reset.textContent = '--'; return; }
    fill.style.width = `${remaining}%`;
    percent.textContent = `${Number.isInteger(remaining) ? remaining : remaining.toFixed(1)}%`;
    reset.textContent = formatCountdown(windowData, primary);
  }

  function classifyRateLimitWindows(rateLimit) {
    const windows = [rateLimit?.primary_window, rateLimit?.secondary_window].filter(Boolean);
    let fiveHour = null, weekly = null;
    for (const w of windows) {
      const seconds = Number(w?.limit_window_seconds);
      if (seconds === 18_000) fiveHour = w;
      else if (seconds === 604_800) weekly = w;
    }
    const hasDurationMetadata = windows.some((w) => Number.isFinite(Number(w?.limit_window_seconds)));
    if (!hasDurationMetadata) { fiveHour = rateLimit?.primary_window || null; weekly = rateLimit?.secondary_window || null; }
    return { fiveHour, weekly };
  }

  function formatMiniPercent(windowData) {
    const remaining = remainingPercent(windowData);
    if (remaining == null) return '--';
    return `${Math.round(remaining)}%`;
  }

  function renderMiniSummary(fiveHour, weekly) {
    if (!miniButton) return;
    const fiveText = formatMiniPercent(fiveHour);
    const weekText = formatMiniPercent(weekly);
    if (miniFiveHour) miniFiveHour.textContent = fiveText;
    if (miniWeekly) miniWeekly.textContent = weekText;

    const fiveRemaining = remainingPercent(fiveHour);
    if (miniGauge) miniGauge.style.setProperty('--yy-mini-pct', `${fiveRemaining == null ? 0 : fiveRemaining}%`);

    const details = [`5h ${fiveText}`, `7d ${weekText}`].join(' · ');
    miniButton.title = `${details} ${t('miniRemaining')} · ${t('restore')}`;
    miniButton.setAttribute('aria-label', `${details} ${t('miniRemaining')}. ${t('restore')}`);
  }

  function render() {
    if (!widget || !fiveHourValue || !weeklyValue) return;
    const { fiveHour, weekly } = classifyRateLimitWindows(payload?.rate_limit);
    renderMiniSummary(fiveHour, weekly);
    setRow(fiveHourValue, fiveHour, true);
    setRow(weeklyValue, weekly, false);
    widget.classList.toggle('yy-cum-error', Boolean(lastError && !payload));
    if (payload) {
      widget.classList.remove('yy-cum-loading');
      const plan = payload.plan_type ? ` · ${payload.plan_type}` : '';
      widget.title = `${t('usageTitle')}${plan}. ${t('clickRefresh')}`;
    } else if (lastError) widget.title = `${t('readError')}: ${lastError}\n${t('retry')}`;
  }

  function updateTheme() {
    if (!widget) return;
    const next = bodyLooksDark() ? 'dark' : 'light';
    if (widget.dataset.theme !== next) { widget.dataset.theme = next; applySettings(); }
  }

  function plausibleSidebarRect(rect) {
    return rect && rect.left <= 5 && rect.right > 0 && rect.width >= 40 && rect.width <= Math.min(430, window.innerWidth * .45) && rect.height >= window.innerHeight * .55;
  }
  function elementLooksVisible(el, rect) {
    if (!el || !rect || !plausibleSidebarRect(rect)) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > .01 && rect.bottom > 0 && rect.top < window.innerHeight;
  }
  function ownsVisibleRightEdge(el, rect) {
    const x = clamp(Math.floor(rect.right - 2), 1, Math.max(1, window.innerWidth - 2));
    for (const ratio of [.25, .5, .75]) {
      const y = clamp(Math.floor(rect.top + rect.height * ratio), 1, Math.max(1, window.innerHeight - 2));
      try { const hit = document.elementFromPoint(x, y); if (hit && (hit === el || el.contains(hit))) return true; } catch {}
    }
    return false;
  }
  function getSidebarRight() {
    const candidates = [];
    const collect = (el) => {
      if (!el || el === widget || widget?.contains(el)) return;
      const rect = el.getBoundingClientRect?.();
      if (elementLooksVisible(el, rect) && ownsVisibleRightEdge(el, rect)) candidates.push(rect.right);
    };
    ['[data-testid="sidebar"]','[data-testid*="sidebar"]','aside','nav'].forEach((sel) => document.querySelectorAll(sel).forEach(collect));
    for (const y of [96, Math.floor(window.innerHeight / 2), Math.max(96, window.innerHeight - 96)]) {
      try { let n = document.elementFromPoint(8, y); while (n && n !== document.documentElement) { collect(n); n = n.parentElement; } } catch {}
    }
    return candidates.length ? Math.max(...candidates) : 0;
  }

  function updatePosition() {
    if (!widget || drag) return;
    if (validPosition(currentLayout.position)) {
      const pos = clampPosition(Number(currentLayout.position.left), Number(currentLayout.position.top));
      currentLayout.position = pos;
      widget.style.left = `${pos.left}px`; widget.style.top = `${pos.top}px`;
      return;
    }
    const left = Math.round(Math.max(0, getSidebarRight()) + 12);
    widget.style.left = `${clamp(left, 6, Math.max(6, window.innerWidth - widget.offsetWidth - 6))}px`;
    widget.style.top = '10px';
  }

  function positionSettingsPanel() {
    if (!widget || !settingsPanel || settingsPanel.hidden) return;
    settingsPanel.style.top = 'calc(100% + 8px)'; settingsPanel.style.bottom = 'auto';
    requestAnimationFrame(() => {
      if (!widget || settingsPanel.hidden) return;
      const card = widget.getBoundingClientRect();
      const panel = settingsPanel.getBoundingClientRect();
      if (panel.bottom > window.innerHeight - 6 && card.top > panel.height + 14) {
        settingsPanel.style.top = 'auto'; settingsPanel.style.bottom = 'calc(100% + 8px)';
      }
    });
  }

  function requestUsage(force = false) {
    window.postMessage({ source: 'yy-codex-usage-widget', type: MESSAGE_REQUEST, force }, '*');
  }

  function closeSettings() {
    if (!settingsPanel || settingsPanel.hidden) return;
    settingsPanel.hidden = true;
    settingsButton?.setAttribute('aria-expanded', 'false');
    widget?.classList.remove('yy-cum-settings-open');
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'yy-codex-usage-meter') return;
    if (data.type === MESSAGE_DATA && data.payload) { payload = data.payload; lastError = ''; buildWidget(); render(); }
    if (data.type === MESSAGE_ERROR) { lastError = data.message || 'unknown error'; buildWidget(); render(); }
  });

  function init() {
    buildWidget(); requestUsage(false);
    window.addEventListener('resize', () => { updatePosition(); positionSettingsPanel(); }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { updatePosition(); updateTheme(); requestUsage(false); }
    });
    document.addEventListener('pointerdown', (event) => { if (settingsPanel && !settingsPanel.hidden && widget && !widget.contains(event.target)) closeSettings(); }, true);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSettings(); });

    let raf = 0;
    const schedulePositionUpdate = () => {
      if (raf || validPosition(currentLayout.position)) return;
      raf = requestAnimationFrame(() => { raf = 0; updatePosition(); });
    };
    new MutationObserver(schedulePositionUpdate).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'data-state', 'aria-expanded']
    });
    setInterval(updatePosition, 2_000);
    setInterval(updateTheme, 3_000);
    setInterval(render, 30_000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
