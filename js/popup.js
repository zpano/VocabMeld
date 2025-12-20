/**
 * Sapling Popup 脚本
 */

document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_THEME = {
    brand: '#81C784',
    background: '#1B1612',
    card: '#26201A',
    highlight: '#A5D6A7',
    underline: '#4E342E',
    text: '#D7CCC8'
  };

  function normalizeHexColor(value) {
    if (!value) return null;
    const trimmed = String(value).trim().toUpperCase();
    if (!trimmed.startsWith('#')) return null;
    if (!/^#[0-9A-F]{6}$/.test(trimmed)) return null;
    return trimmed;
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const r = Number.parseInt(normalized.slice(1, 3), 16);
    const g = Number.parseInt(normalized.slice(3, 5), 16);
    const b = Number.parseInt(normalized.slice(5, 7), 16);
    return { r, g, b };
  }

  function rgbToHex({ r, g, b }) {
    const toHex = (value) => value.toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function shadeHex(hex, percent) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const adjust = (channel) => {
      const delta = percent < 0
        ? channel * (percent / 100)
        : (255 - channel) * (percent / 100);
      return Math.min(255, Math.max(0, Math.round(channel + delta)));
    };
    return rgbToHex({
      r: adjust(rgb.r),
      g: adjust(rgb.g),
      b: adjust(rgb.b)
    });
  }

  function applyThemeVariables(theme) {
    const root = document.documentElement;
    if (!root) return;
    const safeTheme = { ...DEFAULT_THEME, ...(theme || {}) };
    const brand = normalizeHexColor(safeTheme.brand) || DEFAULT_THEME.brand;
    const background = normalizeHexColor(safeTheme.background) || DEFAULT_THEME.background;
    const card = normalizeHexColor(safeTheme.card) || DEFAULT_THEME.card;
    const highlight = normalizeHexColor(safeTheme.highlight) || DEFAULT_THEME.highlight;
    const underline = normalizeHexColor(safeTheme.underline) || DEFAULT_THEME.underline;
    const text = normalizeHexColor(safeTheme.text) || DEFAULT_THEME.text;

    const brandRgb = hexToRgb(brand);
    const highlightRgb = hexToRgb(highlight);
    const textRgb = hexToRgb(text);
    const cardRgb = hexToRgb(card);
    const underlineRgb = hexToRgb(underline);

    root.style.setProperty('--sapling-sprout', brand);
    root.style.setProperty('--sapling-deep-earth', background);
    root.style.setProperty('--sapling-card', card);
    root.style.setProperty('--sapling-highlight', highlight);
    root.style.setProperty('--sapling-underline', underline);
    root.style.setProperty('--sapling-mist', text);

    if (brandRgb) root.style.setProperty('--sapling-sprout-rgb', `${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}`);
    if (highlightRgb) root.style.setProperty('--sapling-highlight-rgb', `${highlightRgb.r}, ${highlightRgb.g}, ${highlightRgb.b}`);
    if (textRgb) root.style.setProperty('--sapling-mist-rgb', `${textRgb.r}, ${textRgb.g}, ${textRgb.b}`);
    if (cardRgb) root.style.setProperty('--sapling-card-rgb', `${cardRgb.r}, ${cardRgb.g}, ${cardRgb.b}`);
    if (underlineRgb) root.style.setProperty('--sapling-underline-rgb', `${underlineRgb.r}, ${underlineRgb.g}, ${underlineRgb.b}`);

    if (brandRgb) {
      root.style.setProperty('--primary', brand);
      root.style.setProperty('--primary-light', highlight);
      root.style.setProperty('--primary-dark', shadeHex(brand, -12));
      root.style.setProperty('--primary-tint', `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.18)`);
      root.style.setProperty('--primary-border', `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.32)`);
      root.style.setProperty('--primary-focus', `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.24)`);
      root.style.setProperty('--primary-shadow', `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.32)`);
      root.style.setProperty('--primary-shadow-strong', `rgba(${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}, 0.45)`);
    }

    if (highlightRgb) {
      root.style.setProperty('--primary-tint-strong', `rgba(${highlightRgb.r}, ${highlightRgb.g}, ${highlightRgb.b}, 0.12)`);
    }

    if (textRgb) {
      root.style.setProperty('--text-primary', text);
      root.style.setProperty('--text-secondary', `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.72)`);
      root.style.setProperty('--text-muted', `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.55)`);
    }

    if (underlineRgb) {
      root.style.setProperty('--border', `rgba(${underlineRgb.r}, ${underlineRgb.g}, ${underlineRgb.b}, 0.7)`);
      root.style.setProperty('--border-light', `rgba(${underlineRgb.r}, ${underlineRgb.g}, ${underlineRgb.b}, 0.85)`);
    }

    root.style.setProperty('--bg-primary', background);
    root.style.setProperty('--bg-secondary', card);
    root.style.setProperty('--bg-tertiary', shadeHex(card, 8));

    if (cardRgb) {
      root.style.setProperty('--surface-elevated', `rgba(${cardRgb.r}, ${cardRgb.g}, ${cardRgb.b}, 0.95)`);
    }
  }

  function applyThemeFromStorage() {
    chrome.storage.sync.get('theme', (result) => {
      const theme = { ...DEFAULT_THEME, ...(result?.theme || {}) };
      applyThemeVariables(theme);
    });
  }

  applyThemeFromStorage();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.theme) return;
    const theme = { ...DEFAULT_THEME, ...(changes.theme.newValue || {}) };
    applyThemeVariables(theme);
  });

  // DOM 元素
  const enableToggle = document.getElementById('enableToggle');
  const toggleLabel = document.getElementById('toggleLabel');
  const totalWords = document.getElementById('totalWords');
  const todayWords = document.getElementById('todayWords');
  const learnedCount = document.getElementById('learnedCount');
  const memorizeCount = document.getElementById('memorizeCount');
  const cacheSize = document.getElementById('cacheSize');
  const hitRate = document.getElementById('hitRate');
  const processBtn = document.getElementById('processBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const shortcutModKey = document.getElementById('shortcutModKey');

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return resolve({ success: false, message: chrome.runtime.lastError.message });
        resolve(response);
      });
    });
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] || null;
  }

  function isPageProcessed(status) {
    if (!status) return false;
    return Boolean(
      status.hasTranslations ||
      status.hasProcessedMarkers ||
      (Number(status.processed) || 0) > 0
    );
  }

  function renderProcessButton(processed, busy = false) {
    const text = processed ? '还原当前页面' : '处理当前页面';
    const busyText = processed ? '还原中...' : '处理中...';
    const label = busy ? busyText : text;
    const icon = busy
      ? `<svg class="spinning" viewBox="0 0 24 24" width="18" height="18">
          <path fill="currentColor" d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
        </svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
        </svg>`;

    processBtn.innerHTML = `${icon}\n        ${label}\n      `;
  }

  async function syncPageActionUi() {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    const status = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }).catch(() => null);
    renderProcessButton(isPageProcessed(status), false);
    await sendRuntimeMessage({ action: 'refreshTogglePageMenuTitle', tabId: tab.id });
  }

  if (shortcutModKey) {
    chrome.runtime.getPlatformInfo((info) => {
      shortcutModKey.textContent = info?.os === 'mac' ? 'Option' : 'Alt';
    });
  }

  // 加载配置和统计
  async function loadData() {
    // 加载启用状态
    chrome.storage.sync.get('enabled', (result) => {
      const enabled = result.enabled !== false;
      enableToggle.checked = enabled;
      toggleLabel.textContent = enabled ? '已启用' : '已禁用';
      toggleLabel.className = `toggle-label ${enabled ? 'enabled' : 'disabled'}`;
    });

    // 加载统计数据
    chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
      if (response) {
        totalWords.textContent = formatNumber(response.totalWords);
        todayWords.textContent = formatNumber(response.todayWords);
        learnedCount.textContent = formatNumber(response.learnedCount);
        memorizeCount.textContent = formatNumber(response.memorizeCount);

        const total = response.cacheHits + response.cacheMisses;
        const rate = total > 0 ? Math.round((response.cacheHits / total) * 100) : 0;
        hitRate.textContent = rate + '%';
      }
    });

    // 加载缓存统计
    chrome.runtime.sendMessage({ action: 'getCacheStats' }, (response) => {
      if (response) {
        cacheSize.textContent = `${response.size}/${response.maxSize}`;
      }
    });
  }

  // 格式化数字
  function formatNumber(num) {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  }

  // 切换启用状态
  enableToggle.addEventListener('change', () => {
    const enabled = enableToggle.checked;
    chrome.storage.sync.set({ enabled }, () => {
      toggleLabel.textContent = enabled ? '已启用' : '已禁用';
      toggleLabel.className = `toggle-label ${enabled ? 'enabled' : 'disabled'}`;
      
      // 通知内容脚本
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        const url = tab?.url || '';
        if (!tab?.id || (!url.startsWith('http') && !url.startsWith('file:'))) {
          return;
        }

        // `chrome.tabs.sendMessage` returns a Promise in MV3; catch to avoid
        // "Uncaught (in promise) ... Receiving end does not exist" on pages
        // where content scripts cannot run (e.g. chrome://, Web Store).
        chrome.tabs.sendMessage(tab.id, {
          action: enabled ? 'processPage' : 'restorePage'
        }).catch(() => {});

        sendRuntimeMessage({ action: 'refreshTogglePageMenuTitle', tabId: tab.id });
      });
    });
  });

  // 处理页面按钮
  processBtn.addEventListener('click', async () => {
    processBtn.disabled = true;
    const tab = await getActiveTab();
    if (!tab?.id) {
      processBtn.disabled = false;
      return;
    }

    const status = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }).catch(() => null);
    const processedBefore = isPageProcessed(status);
    renderProcessButton(processedBefore, true);

    try {
      await sendRuntimeMessage({ action: 'togglePageProcessing', tabId: tab.id });
    } catch (e) {
      console.error('Error processing page:', e);
    }

    setTimeout(() => {
      processBtn.disabled = false;
      syncPageActionUi();
      loadData();
    }, 400);
  });

  // 设置按钮
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 初始加载
  loadData();
  syncPageActionUi();

  // 定期刷新
  setInterval(() => {
    loadData();
    syncPageActionUi();
  }, 5000);
});
