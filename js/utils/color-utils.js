/**
 * 颜色工具函数
 * 用于主题颜色的处理和转换
 */

/**
 * 规范化十六进制颜色值
 * @param {string} value - 颜色值
 * @returns {string|null} 规范化后的颜色值或null
 */
export function normalizeHexColor(value) {
  if (!value) return null;
  const trimmed = String(value).trim().toUpperCase();
  if (!trimmed.startsWith('#')) return null;
  if (!/^#[0-9A-F]{6}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * 将十六进制颜色转换为RGB对象
 * @param {string} hex - 十六进制颜色值
 * @returns {{r: number, g: number, b: number}|null} RGB对象或null
 */
export function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

/**
 * 将RGB对象转换为十六进制颜色
 * @param {{r: number, g: number, b: number}} rgb - RGB对象
 * @returns {string} 十六进制颜色值
 */
export function rgbToHex({ r, g, b }) {
  const toHex = (value) => value.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 调整颜色明暗度
 * @param {string} hex - 十六进制颜色值
 * @param {number} percent - 调整百分比（负数变暗，正数变亮）
 * @returns {string} 调整后的颜色值
 */
export function shadeHex(hex, percent) {
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

/**
 * 应用主题变量到DOM根元素
 * @param {object} theme - 主题配置对象
 * @param {object} DEFAULT_THEME - 默认主题配置
 * @param {boolean} contentScriptMode - 内容脚本模式：true 时只设置 --sapling-* 变量，避免污染网页；false 时设置所有变量（用于 options/popup 页面）
 */
export function applyThemeVariables(theme, DEFAULT_THEME, contentScriptMode = false) {
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

  // 设置基础 Sapling 变量（始终设置，不会与网页冲突）
  root.style.setProperty('--sapling-sprout', brand);
  root.style.setProperty('--sapling-deep-earth', background);
  root.style.setProperty('--sapling-card', card);
  root.style.setProperty('--sapling-highlight', highlight);
  root.style.setProperty('--sapling-underline', underline);
  root.style.setProperty('--sapling-mist', text);

  // 设置 RGB 变量
  if (brandRgb) root.style.setProperty('--sapling-sprout-rgb', `${brandRgb.r}, ${brandRgb.g}, ${brandRgb.b}`);
  if (highlightRgb) root.style.setProperty('--sapling-highlight-rgb', `${highlightRgb.r}, ${highlightRgb.g}, ${highlightRgb.b}`);
  if (textRgb) root.style.setProperty('--sapling-mist-rgb', `${textRgb.r}, ${textRgb.g}, ${textRgb.b}`);
  if (cardRgb) root.style.setProperty('--sapling-card-rgb', `${cardRgb.r}, ${cardRgb.g}, ${cardRgb.b}`);
  if (underlineRgb) root.style.setProperty('--sapling-underline-rgb', `${underlineRgb.r}, ${underlineRgb.g}, ${underlineRgb.b}`);

  // 仅在非内容脚本模式下设置通用变量（避免污染网页）
  if (contentScriptMode) {
    return; // 内容脚本模式：只设置 --sapling-* 变量，避免与网站 CSS 变量冲突
  }

  // 以下变量仅用于 options.html 和 popup.html，不应在内容脚本中设置

  // 设置派生的品牌色变量（用于选项页等）
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

  // 设置文本颜色变量
  if (textRgb) {
    root.style.setProperty('--text-primary', text);
    root.style.setProperty('--text-secondary', `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.72)`);
    root.style.setProperty('--text-muted', `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.55)`);
  }

  // 设置边框颜色变量
  if (underlineRgb) {
    root.style.setProperty('--border', `rgba(${underlineRgb.r}, ${underlineRgb.g}, ${underlineRgb.b}, 0.7)`);
    root.style.setProperty('--border-light', `rgba(${underlineRgb.r}, ${underlineRgb.g}, ${underlineRgb.b}, 0.85)`);
  }

  // 设置背景颜色变量
  root.style.setProperty('--bg-primary', background);
  root.style.setProperty('--bg-secondary', card);
  root.style.setProperty('--bg-tertiary', shadeHex(card, 8));
  root.style.setProperty('--bg-card', card);

  if (cardRgb) {
    root.style.setProperty('--surface-elevated', `rgba(${cardRgb.r}, ${cardRgb.g}, ${cardRgb.b}, 0.95)`);
  }
}
