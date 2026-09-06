(() => {
  'use strict';

  if (window.__YY_CODEX_USAGE_WIDGET__) return;
  window.__YY_CODEX_USAGE_WIDGET__ = true;

  const MESSAGE_DATA = 'YY_CODEX_USAGE_DATA';
  const MESSAGE_ERROR = 'YY_CODEX_USAGE_ERROR';
  const MESSAGE_REQUEST = 'YY_CODEX_USAGE_REQUEST';
  const WIDGET_ID = 'yy-codex-usage-meter';
  const SETTINGS_KEY = 'yyCodexUsageMeterSettings';

  const DEFAULT_SETTINGS = {
    fontFamily: 'system',
    fontSize: 13,
    textColor: null,
    cardColor: null,
    cardOpacity: 92,
    showModelRoute: true,
    defaultHidden: false
  };

  const FONT_FAMILIES = {
    system: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  };

  let payload = null;
  let lastError = '';
  let widget = null;
  let fiveHourValue = null;
  let weeklyValue = null;
  let settingsPanel = null;
  let settingsButton = null;
  let autoHideCloseTimer = 0;
  let currentSettings = { ...DEFAULT_SETTINGS };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
    if (!Number.isFinite(used) || !Number.isFinite(total) || !Number.isFinite(remaining)) return false;

    // 5h 窗口未触发时，Web API 会给出 used=0，reset_after≈完整 18000 秒。
    return used === 0 && total > 0 && remaining >= total - 5;
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
      <span class="yy-cum-reset">--</span>
    `;
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

  function themeDefaults() {
    const dark = widget?.dataset.theme === 'dark' || bodyLooksDark();
    return dark
      ? { textColor: '#f5f5f5', cardColor: '#232323' }
      : { textColor: '#141414', cardColor: '#fafafa' };
  }

  function effectiveColors() {
    const defaults = themeDefaults();
    return {
      textColor: currentSettings.textColor || defaults.textColor,
      cardColor: currentSettings.cardColor || defaults.cardColor
    };
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

    if (settingsPanel) syncSettingsControls();
  }

  function syncSettingsControls() {
    if (!settingsPanel) return;
    const colors = effectiveColors();
    const fontSelect = settingsPanel.querySelector('[data-setting="fontFamily"]');
    const fontSize = settingsPanel.querySelector('[data-setting="fontSize"]');
    const fontSizeValue = settingsPanel.querySelector('[data-role="fontSizeValue"]');
    const textColor = settingsPanel.querySelector('[data-setting="textColor"]');
    const cardColor = settingsPanel.querySelector('[data-setting="cardColor"]');
    const cardOpacity = settingsPanel.querySelector('[data-setting="cardOpacity"]');
    const cardOpacityValue = settingsPanel.querySelector('[data-role="cardOpacityValue"]');
    const showModelRoute = settingsPanel.querySelector('[data-setting="showModelRoute"]');
    const defaultHidden = settingsPanel.querySelector('[data-setting="defaultHidden"]');

    if (fontSelect) fontSelect.value = currentSettings.fontFamily;
    if (fontSize) fontSize.value = String(currentSettings.fontSize);
    if (fontSizeValue) fontSizeValue.textContent = `${currentSettings.fontSize}px`;
    if (textColor) textColor.value = colors.textColor;
    if (cardColor) cardColor.value = colors.cardColor;
    if (cardOpacity) cardOpacity.value = String(currentSettings.cardOpacity);
    if (cardOpacityValue) cardOpacityValue.textContent = `${currentSettings.cardOpacity}%`;
    if (showModelRoute) showModelRoute.checked = currentSettings.showModelRoute !== false;
    if (defaultHidden) defaultHidden.checked = Boolean(currentSettings.defaultHidden);
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(SETTINGS_KEY);
      const saved = result?.[SETTINGS_KEY];
      if (saved && typeof saved === 'object') {
        currentSettings = { ...DEFAULT_SETTINGS, ...saved };
      }
    } catch {}
    applySettings();
  }

  function saveSettings() {
    try {
      chrome.storage.sync.set({ [SETTINGS_KEY]: currentSettings });
    } catch {}
  }

  function buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'yy-cum-settings-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="yy-cum-settings-title">显示设置</div>

      <label class="yy-cum-setting-line yy-cum-setting-toggle-line">
        <span>显示模型路由</span>
        <input data-setting="showModelRoute" type="checkbox">
      </label>

      <label class="yy-cum-setting-line yy-cum-setting-toggle-line">
        <span>默认隐藏</span>
        <input data-setting="defaultHidden" type="checkbox">
      </label>

      <label class="yy-cum-setting-line">
        <span>字体</span>
        <select data-setting="fontFamily">
          <option value="system">系统无衬线</option>
          <option value="serif">衬线</option>
          <option value="mono">等宽</option>
        </select>
      </label>

      <label class="yy-cum-setting-line yy-cum-setting-range-line">
        <span>字号</span>
        <input data-setting="fontSize" type="range" min="11" max="18" step="1">
        <span class="yy-cum-setting-value" data-role="fontSizeValue"></span>
      </label>

      <label class="yy-cum-setting-line">
        <span>文字颜色</span>
        <input data-setting="textColor" type="color">
      </label>

      <label class="yy-cum-setting-line">
        <span>卡片颜色</span>
        <input data-setting="cardColor" type="color">
      </label>

      <label class="yy-cum-setting-line yy-cum-setting-range-line">
        <span>透明度</span>
        <input data-setting="cardOpacity" type="range" min="20" max="100" step="1">
        <span class="yy-cum-setting-value" data-role="cardOpacityValue"></span>
      </label>

      <div class="yy-cum-settings-actions">
        <button type="button" data-action="theme-default">跟随主题</button>
        <button type="button" data-action="reset-all">恢复默认</button>
      </div>
    `;

    panel.addEventListener('click', (event) => event.stopPropagation());
    panel.addEventListener('pointerdown', (event) => event.stopPropagation());

    const fontSelect = panel.querySelector('[data-setting="fontFamily"]');
    const fontSize = panel.querySelector('[data-setting="fontSize"]');
    const textColor = panel.querySelector('[data-setting="textColor"]');
    const cardColor = panel.querySelector('[data-setting="cardColor"]');
    const cardOpacity = panel.querySelector('[data-setting="cardOpacity"]');
    const showModelRoute = panel.querySelector('[data-setting="showModelRoute"]');
    const defaultHidden = panel.querySelector('[data-setting="defaultHidden"]');

    showModelRoute.addEventListener('change', () => {
      currentSettings.showModelRoute = showModelRoute.checked;
      applySettings();
      saveSettings();
    });

    defaultHidden.addEventListener('change', () => {
      currentSettings.defaultHidden = defaultHidden.checked;
      applySettings();
      saveSettings();
    });

    fontSelect.addEventListener('change', () => {
      currentSettings.fontFamily = fontSelect.value;
      applySettings();
      saveSettings();
    });

    fontSize.addEventListener('input', () => {
      currentSettings.fontSize = Number(fontSize.value);
      applySettings();
      saveSettings();
    });

    textColor.addEventListener('input', () => {
      currentSettings.textColor = textColor.value;
      applySettings();
      saveSettings();
    });

    cardColor.addEventListener('input', () => {
      currentSettings.cardColor = cardColor.value;
      applySettings();
      saveSettings();
    });

    cardOpacity.addEventListener('input', () => {
      currentSettings.cardOpacity = Number(cardOpacity.value);
      applySettings();
      saveSettings();
    });

    panel.querySelector('[data-action="theme-default"]').addEventListener('click', () => {
      currentSettings.textColor = null;
      currentSettings.cardColor = null;
      applySettings();
      saveSettings();
    });

    panel.querySelector('[data-action="reset-all"]').addEventListener('click', () => {
      currentSettings = { ...DEFAULT_SETTINGS };
      applySettings();
      saveSettings();
    });

    syncSettingsControls();
    return panel;
  }

  function buildWidget() {
    if (document.getElementById(WIDGET_ID)) return document.getElementById(WIDGET_ID);

    const style = document.createElement('style');
    style.id = `${WIDGET_ID}-style`;
    style.textContent = `
      #${WIDGET_ID} {
        --yy-card-bg: rgba(250,250,250,.92);
        --yy-text-color: #141414;
        --yy-font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --yy-font-size: 13px;
        position: fixed;
        top: 10px;
        left: 232px;
        width: 304px;
        box-sizing: border-box;
        z-index: 2147483000;
        padding: 10px 12px 11px;
        border: 1px solid rgba(0,0,0,.11);
        border-radius: 12px;
        background: var(--yy-card-bg);
        color: var(--yy-text-color);
        box-shadow: 0 2px 8px rgba(0,0,0,.08);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-family: var(--yy-font-family);
        font-size: var(--yy-font-size);
        line-height: 1.15;
        user-select: none;
        transition: left 120ms ease, width 140ms ease, padding 140ms ease,
          opacity 120ms ease, background-color 120ms ease, color 120ms ease;
      }

      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open) {
        width: 112px;
        padding: 7px 10px;
      }

      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open) .yy-cum-header {
        min-height: 24px;
        margin-bottom: 0;
      }

      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open) > .yy-cum-row,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open) > .yy-mum-block,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open) .yy-cum-settings-button,
      #${WIDGET_ID}[data-auto-hide="true"]:not(:hover):not(.yy-cum-settings-open) > .yy-cum-settings-panel {
        display: none !important;
      }

      #${WIDGET_ID}[data-theme="dark"] {
        border-color: rgba(255,255,255,.14);
        box-shadow: 0 2px 10px rgba(0,0,0,.32);
      }

      #${WIDGET_ID}.yy-cum-loading { opacity: .76; }
      #${WIDGET_ID}.yy-cum-error { opacity: .82; }

      #${WIDGET_ID} .yy-cum-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 24px;
        margin-bottom: 3px;
      }

      #${WIDGET_ID} .yy-cum-title {
        font-weight: 700;
        letter-spacing: .01em;
        opacity: .88;
      }

      #${WIDGET_ID} .yy-cum-settings-button {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        margin: -3px -3px -3px 0;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: .66;
        font: inherit;
      }

      #${WIDGET_ID} .yy-cum-settings-button:hover,
      #${WIDGET_ID} .yy-cum-settings-button[aria-expanded="true"] {
        background: rgba(127,127,127,.12);
        opacity: .98;
      }

      #${WIDGET_ID} .yy-cum-settings-button svg {
        width: 17px;
        height: 17px;
        display: block;
      }

      #${WIDGET_ID} .yy-cum-row {
        display: grid;
        grid-template-columns: 26px minmax(98px, 1fr) 48px 84px;
        align-items: center;
        gap: 8px;
        height: 30px;
        white-space: nowrap;
      }

      #${WIDGET_ID} .yy-cum-label {
        font-weight: 700;
        letter-spacing: .02em;
        opacity: .82;
      }

      #${WIDGET_ID} .yy-cum-track {
        display: block;
        position: relative;
        height: 9px;
        overflow: hidden;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 14%, transparent);
      }

      @supports not (background: color-mix(in srgb, black 10%, transparent)) {
        #${WIDGET_ID} .yy-cum-track { background: rgba(90,90,90,.16); }
      }

      #${WIDGET_ID} .yy-cum-fill {
        display: block;
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: currentColor;
        opacity: .72;
        transition: width 220ms ease;
      }

      #${WIDGET_ID} .yy-cum-percent {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
        opacity: .92;
      }

      #${WIDGET_ID} .yy-cum-reset {
        text-align: right;
        font-variant-numeric: tabular-nums;
        font-weight: 520;
        opacity: .68;
      }

      #${WIDGET_ID} .yy-cum-reset.yy-cum-inactive {
        text-align: center;
      }

      #${WIDGET_ID} .yy-cum-settings-panel {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        width: 304px;
        box-sizing: border-box;
        padding: 12px;
        border: 1px solid rgba(0,0,0,.12);
        border-radius: 12px;
        background: rgba(250,250,250,.98);
        color: #181818;
        box-shadow: 0 8px 24px rgba(0,0,0,.16);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        line-height: 1.2;
      }

      /* 面板和主卡片之间保留 8px 视觉间距，但用透明命中区桥起来，
         避免鼠标穿过缝隙时触发 auto-hide。 */
      #${WIDGET_ID} .yy-cum-settings-panel::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        top: -9px;
        height: 9px;
        pointer-events: auto;
      }

      #${WIDGET_ID}[data-theme="dark"] .yy-cum-settings-panel {
        border-color: rgba(255,255,255,.14);
        background: rgba(36,36,36,.98);
        color: #f2f2f2;
        box-shadow: 0 8px 28px rgba(0,0,0,.42);
      }

      #${WIDGET_ID} .yy-cum-settings-panel[hidden] { display: none; }

      #${WIDGET_ID} .yy-cum-settings-title {
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 9px;
      }

      #${WIDGET_ID} .yy-cum-setting-line {
        display: grid;
        grid-template-columns: 72px 1fr;
        align-items: center;
        gap: 8px;
        min-height: 32px;
      }

      #${WIDGET_ID} .yy-cum-setting-range-line {
        grid-template-columns: 72px 1fr 42px;
      }

      #${WIDGET_ID} .yy-cum-setting-toggle-line {
        grid-template-columns: 1fr auto;
      }

      #${WIDGET_ID} .yy-cum-setting-toggle-line input[type="checkbox"] {
        width: 16px;
        height: 16px;
        margin: 0;
        cursor: pointer;
      }

      #${WIDGET_ID} .yy-cum-setting-line select,
      #${WIDGET_ID} .yy-cum-setting-line input[type="range"] {
        width: 100%;
      }

      #${WIDGET_ID} .yy-cum-setting-line select {
        height: 27px;
        border: 1px solid rgba(127,127,127,.25);
        border-radius: 7px;
        padding: 0 7px;
        background: rgba(127,127,127,.08);
        color: inherit;
        font: inherit;
      }

      #${WIDGET_ID} .yy-cum-setting-line input[type="color"] {
        width: 44px;
        height: 27px;
        padding: 1px;
        border: 1px solid rgba(127,127,127,.25);
        border-radius: 7px;
        background: transparent;
        cursor: pointer;
      }

      #${WIDGET_ID} .yy-cum-setting-value {
        text-align: right;
        font-variant-numeric: tabular-nums;
        opacity: .7;
      }

      #${WIDGET_ID} .yy-cum-settings-actions {
        display: flex;
        justify-content: flex-end;
        gap: 7px;
        margin-top: 9px;
        padding-top: 9px;
        border-top: 1px solid rgba(127,127,127,.18);
      }

      #${WIDGET_ID} .yy-cum-settings-actions button {
        min-height: 28px;
        border: 1px solid rgba(127,127,127,.24);
        border-radius: 8px;
        padding: 0 9px;
        background: rgba(127,127,127,.08);
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      #${WIDGET_ID} .yy-cum-settings-actions button:hover {
        background: rgba(127,127,127,.15);
      }
    `;
    document.documentElement.appendChild(style);

    const root = document.createElement('div');
    root.id = WIDGET_ID;
    root.className = 'yy-cum-loading';
    root.title = 'Work / Codex 剩余额度。点击卡片立即刷新。';

    const header = document.createElement('div');
    header.className = 'yy-cum-header';
    header.innerHTML = `
      <span class="yy-cum-title">Work / Codex</span>
      <button class="yy-cum-settings-button" type="button" aria-label="显示设置" aria-expanded="false" title="显示设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.15"></circle>
          <path d="M10.32 5.26L10.49 2.98A9.15 9.15 0 0 1 13.51 2.98L13.68 5.26A6.95 6.95 0 0 1 15.58 6.04L17.31 4.55A9.15 9.15 0 0 1 19.45 6.69L17.96 8.42A6.95 6.95 0 0 1 18.74 10.32L21.02 10.49A9.15 9.15 0 0 1 21.02 13.51L18.74 13.68A6.95 6.95 0 0 1 17.96 15.58L19.45 17.31A9.15 9.15 0 0 1 17.31 19.45L15.58 17.96A6.95 6.95 0 0 1 13.68 18.74L13.51 21.02A9.15 9.15 0 0 1 10.49 21.02L10.32 18.74A6.95 6.95 0 0 1 8.42 17.96L6.69 19.45A9.15 9.15 0 0 1 4.55 17.31L6.04 15.58A6.95 6.95 0 0 1 5.26 13.68L2.98 13.51A9.15 9.15 0 0 1 2.98 10.49L5.26 10.32A6.95 6.95 0 0 1 6.04 8.42L4.55 6.69A9.15 9.15 0 0 1 6.69 4.55L8.42 6.04A6.95 6.95 0 0 1 10.32 5.26Z"></path>
        </svg>
      </button>
    `;
    root.appendChild(header);
    root.appendChild(row('5h'));
    root.appendChild(row('7d'));

    settingsPanel = buildSettingsPanel();
    root.appendChild(settingsPanel);
    settingsButton = header.querySelector('.yy-cum-settings-button');

    settingsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const nextOpen = settingsPanel.hidden;
      settingsPanel.hidden = !nextOpen;
      settingsButton.setAttribute('aria-expanded', String(nextOpen));
      root.classList.toggle('yy-cum-settings-open', nextOpen);
      if (nextOpen) syncSettingsControls();
    });

    root.addEventListener('click', (event) => {
      if (event.target.closest('.yy-cum-settings-button, .yy-cum-settings-panel')) return;
      root.classList.add('yy-cum-loading');
      requestUsage(true);
    });

    const cancelAutoHideClose = () => {
      if (!autoHideCloseTimer) return;
      clearTimeout(autoHideCloseTimer);
      autoHideCloseTimer = 0;
    };

    const scheduleAutoHideClose = () => {
      if (!currentSettings.defaultHidden || !settingsPanel || settingsPanel.hidden) return;
      cancelAutoHideClose();
      autoHideCloseTimer = setTimeout(() => {
        autoHideCloseTimer = 0;
        // 给鼠标穿过主卡片和设置面板之间的视觉缝隙留一点容错。
        if (root.matches(':hover') || settingsPanel.matches(':hover')) return;
        settingsPanel.hidden = true;
        settingsButton?.setAttribute('aria-expanded', 'false');
        root.classList.remove('yy-cum-settings-open');
      }, 180);
    };

    root.addEventListener('mouseleave', scheduleAutoHideClose);
    root.addEventListener('mouseenter', cancelAutoHideClose);
    settingsPanel.addEventListener('mouseenter', cancelAutoHideClose);
    settingsPanel.addEventListener('mouseleave', scheduleAutoHideClose);

    (document.body || document.documentElement).appendChild(root);
    widget = root;
    fiveHourValue = root.querySelectorAll('.yy-cum-row')[0];
    weeklyValue = root.querySelectorAll('.yy-cum-row')[1];

    updateTheme();
    applySettings();
    updatePosition();
    render();
    loadSettings();
    return root;
  }

  function setRow(rowEl, windowData, primary = false) {
    const fill = rowEl.querySelector('.yy-cum-fill');
    const percent = rowEl.querySelector('.yy-cum-percent');
    const reset = rowEl.querySelector('.yy-cum-reset');
    const remaining = remainingPercent(windowData);
    const inactive = primary && isPrimaryInactive(windowData);

    reset.classList.toggle('yy-cum-inactive', inactive);

    if (remaining == null) {
      fill.style.width = '0%';
      percent.textContent = '--';
      reset.textContent = '--';
      return;
    }

    fill.style.width = `${remaining}%`;
    percent.textContent = `${Number.isInteger(remaining) ? remaining : remaining.toFixed(1)}%`;
    reset.textContent = formatCountdown(windowData, primary);
  }

  function classifyRateLimitWindows(rateLimit) {
    const windows = [rateLimit?.primary_window, rateLimit?.secondary_window].filter(Boolean);
    let fiveHour = null;
    let weekly = null;

    for (const windowData of windows) {
      const seconds = Number(windowData?.limit_window_seconds);
      if (seconds === 18_000) fiveHour = windowData;
      else if (seconds === 604_800) weekly = windowData;
    }

    // Older responses historically used primary=5h and secondary=7d.
    // Only fall back to slot order when duration metadata is absent altogether.
    const hasDurationMetadata = windows.some((w) => Number.isFinite(Number(w?.limit_window_seconds)));
    if (!hasDurationMetadata) {
      fiveHour = rateLimit?.primary_window || null;
      weekly = rateLimit?.secondary_window || null;
    }

    return { fiveHour, weekly };
  }

  function render() {
    if (!widget || !fiveHourValue || !weeklyValue) return;

    const rateLimit = payload?.rate_limit;
    const { fiveHour, weekly } = classifyRateLimitWindows(rateLimit);
    setRow(fiveHourValue, fiveHour, true);
    setRow(weeklyValue, weekly, false);

    widget.classList.toggle('yy-cum-error', Boolean(lastError && !payload));
    if (payload) {
      widget.classList.remove('yy-cum-loading');
      const plan = payload.plan_type ? ` · ${payload.plan_type}` : '';
      widget.title = `Work / Codex 剩余额度${plan}。点击卡片立即刷新。`;
    } else if (lastError) {
      widget.title = `暂时读取不到额度：${lastError}\n点击卡片重试。`;
    }
  }

  function bodyLooksDark() {
    const target = document.body || document.documentElement;
    const color = getComputedStyle(target).backgroundColor;
    const match = color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
    if (!match) return matchMedia('(prefers-color-scheme: dark)').matches;
    const r = Number(match[1]), g = Number(match[2]), b = Number(match[3]);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }

  function updateTheme() {
    if (!widget) return;
    const next = bodyLooksDark() ? 'dark' : 'light';
    if (widget.dataset.theme !== next) {
      widget.dataset.theme = next;
      applySettings();
    }
  }

  function plausibleSidebarRect(rect) {
    return rect &&
      rect.left <= 5 &&
      rect.right > 0 &&
      rect.width >= 40 &&
      rect.width <= Math.min(430, window.innerWidth * 0.45) &&
      rect.height >= window.innerHeight * 0.55;
  }

  function elementLooksVisible(el, rect) {
    if (!el || !rect || !plausibleSidebarRect(rect)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number.parseFloat(style.opacity || '1') <= 0.01) return false;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
    return true;
  }

  function ownsVisibleRightEdge(el, rect) {
    // ChatGPT 收起侧栏时，DOM 中可能仍保留一个“展开态”的宽侧栏节点。
    // 只接受真正占据屏幕像素的候选，避免挂件继续停在旧的展开位置。
    const x = clamp(Math.floor(rect.right - 2), 1, Math.max(1, window.innerWidth - 2));
    const ys = [0.25, 0.5, 0.75].map((ratio) =>
      clamp(Math.floor(rect.top + rect.height * ratio), 1, Math.max(1, window.innerHeight - 2))
    );

    let owned = 0;
    for (const y of ys) {
      try {
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) owned += 1;
      } catch {}
    }
    return owned >= 1;
  }

  function collectSidebarCandidate(el, candidates) {
    if (!el || el === widget || widget?.contains(el)) return;
    const rect = el.getBoundingClientRect?.();
    if (!elementLooksVisible(el, rect)) return;
    if (!ownsVisibleRightEdge(el, rect)) return;
    candidates.push({ el, rect });
  }

  function getSidebarRight() {
    const candidates = [];
    const selectors = [
      '[data-testid="sidebar"]',
      '[data-testid*="sidebar"]',
      'aside',
      'nav'
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => collectSidebarCandidate(el, candidates));
    }

    // 再从屏幕最左侧实际命中的元素向上爬祖先，兼容 ChatGPT 改 class / data-testid。
    for (const y of [96, Math.floor(window.innerHeight / 2), Math.max(96, window.innerHeight - 96)]) {
      try {
        let node = document.elementFromPoint(8, y);
        while (node && node !== document.documentElement) {
          collectSidebarCandidate(node, candidates);
          node = node.parentElement;
        }
      } catch {}
    }

    if (!candidates.length) return 0;

    // 相同布局可能被多个祖先重复命中。取最右的“真实可见边界”。
    return Math.max(...candidates.map(({ rect }) => rect.right));
  }

  function updatePosition() {
    if (!widget) return;
    const sidebarRight = getSidebarRight();
    const left = Math.round(Math.max(0, sidebarRight) + 12);
    widget.style.left = `${left}px`;
  }

  function requestUsage(force = false) {
    window.postMessage({
      source: 'yy-codex-usage-widget',
      type: MESSAGE_REQUEST,
      force
    }, '*');
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'yy-codex-usage-meter') return;

    if (data.type === MESSAGE_DATA && data.payload) {
      payload = data.payload;
      lastError = '';
      buildWidget();
      render();
    }

    if (data.type === MESSAGE_ERROR) {
      lastError = data.message || 'unknown error';
      buildWidget();
      render();
    }
  });

  function closeSettingsIfOutside(event) {
    if (!settingsPanel || settingsPanel.hidden || !widget) return;
    if (widget.contains(event.target)) return;
    settingsPanel.hidden = true;
    settingsButton?.setAttribute('aria-expanded', 'false');
    widget.classList.remove('yy-cum-settings-open');
  }

  function init() {
    buildWidget();
    requestUsage(false);

    window.addEventListener('resize', updatePosition, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        updatePosition();
        updateTheme();
        requestUsage(false);
      }
    });

    document.addEventListener('pointerdown', closeSettingsIfOutside, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && settingsPanel && !settingsPanel.hidden) {
        settingsPanel.hidden = true;
        settingsButton?.setAttribute('aria-expanded', 'false');
        widget?.classList.remove('yy-cum-settings-open');
      }
    });

    // ChatGPT 是 SPA。侧栏展开/收起时监听 DOM/class 变化，下一帧立即贴到新边界；
    // 另外保留低频兜底校正，应对布局动画或未来 DOM 调整。
    let positionRaf = 0;
    const schedulePositionUpdate = () => {
      if (positionRaf) return;
      positionRaf = requestAnimationFrame(() => {
        positionRaf = 0;
        updatePosition();
      });
    };

    const layoutObserver = new MutationObserver(schedulePositionUpdate);
    layoutObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-state', 'aria-expanded']
    });

    setInterval(updatePosition, 2_000);
    setInterval(updateTheme, 3_000);

    // reset 倒计时只在本地按分钟推进，不增加服务器请求。
    setInterval(render, 30_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
