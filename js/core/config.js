/**
 * Sapling 配置管理模块
 * 管理所有配置项和默认值
 */

// CEFR 难度等级
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// 替换强度配置
export const INTENSITY_CONFIG = {
  low: { maxPerParagraph: 4, label: '较少' },
  medium: { maxPerParagraph: 8, label: '适中' },
  high: { maxPerParagraph: 14, label: '较多' }
};

// 支持的语言
export const SUPPORTED_LANGUAGES = {
  native: [
    { code: 'zh-CN', name: '简体中文' },
    { code: 'zh-TW', name: '繁体中文' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' }
  ],
  target: [
    { code: 'en', name: 'English' },
    { code: 'zh-CN', name: '简体中文' },
    { code: 'zh-TW', name: '繁体中文' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' }
  ]
};

// API 预设配置
export const API_PRESETS = {
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini'
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat'
  },
  moonshot: {
    name: 'Moonshot',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k'
  },
  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-8b-instant'
  },
  ollama: {
    name: 'Ollama (本地)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:7b'
  }
};

export const DEFAULT_THEME = {
  brand: '#81C784',
  background: '#1B1612',
  card: '#26201A',
  highlight: '#A5D6A7',
  underline: '#4E342E',
  text: '#D7CCC8'
};

// 默认配置
export const DEFAULT_CONFIG = {
  // API 配置
  apiEndpoint: API_PRESETS.deepseek.endpoint,
  apiKey: '',
  modelName: API_PRESETS.deepseek.model,
  
  // 学习偏好
  nativeLanguage: 'zh-CN',
  targetLanguage: 'en',
  difficultyLevel: 'B1',
  intensity: 'medium',
  
  // 行为设置
  autoProcess: false,
  showPhonetic: true,
  allowLeftClickPronunciation: true,
  restoreAllSameWordsOnLearned: true,
  pronunciationProvider: 'wiktionary',
  youdaoPronunciationType: 2,
  enabled: true,
  
  // 站点规则
  blacklist: [],
  whitelist: [],
  
  // 统计数据
  totalWords: 0,
  todayWords: 0,
  lastResetDate: new Date().toISOString().split('T')[0],
  
  // 缓存设置
  cacheMaxSize: 2048,

  // 高级设置
  concurrencyLimit: 5,
  maxBatchSize: 3,
  processFullPage: false,

  // 主题配色
  theme: { ...DEFAULT_THEME },

  // 缓存统计
  cacheHits: 0,
  cacheMisses: 0
};

// 缓存配置
export const CACHE_CONFIG = {
  maxSize: 2048,
  maxSizeMax: 8192,
  storageKey: 'Sapling_word_cache'
};

export const CACHE_SIZE_LIMITS = {
  min: 2048,
  max: 8192
};

export const CACHE_SIZE_STEP = 1024;

export const ADVANCED_LIMITS = {
  concurrencyLimit: { min: 1, max: 20 },
  maxBatchSize: { min: 1, max: 10 }
};

/**
 * 规范化用户配置的缓存容量上限
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeCacheMaxSize(value, fallback = CACHE_CONFIG.maxSize) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(CACHE_SIZE_LIMITS.max, Math.max(CACHE_SIZE_LIMITS.min, parsed));
  const snapped = Math.round(clamped / CACHE_SIZE_STEP) * CACHE_SIZE_STEP;
  return Math.min(CACHE_SIZE_LIMITS.max, Math.max(CACHE_SIZE_LIMITS.min, snapped));
}

function normalizeIntInRange(value, fallback, { min, max }) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeConcurrencyLimit(value, fallback = DEFAULT_CONFIG.concurrencyLimit) {
  return normalizeIntInRange(value, fallback, ADVANCED_LIMITS.concurrencyLimit);
}

export function normalizeMaxBatchSize(value, fallback = DEFAULT_CONFIG.maxBatchSize) {
  return normalizeIntInRange(value, fallback, ADVANCED_LIMITS.maxBatchSize);
}

// 需要跳过的标签
export const SKIP_TAGS = [
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
  'CANVAS', 'SVG', 'VIDEO', 'AUDIO', 'CODE', 'PRE', 'KBD',
  'SAMP', 'VAR', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON'
];

// 需要跳过的类名
export const SKIP_CLASSES = [
  'Sapling-translated',
  'Sapling-tooltip',
  'highlight-mengshen',
  'code',
  'syntax',
  'hljs'
];

/**
 * 判断词汇难度是否符合用户设置
 * @param {string} wordDifficulty - 词汇难度 (A1-C2)
 * @param {string} userDifficulty - 用户设置难度 (A1-C2)
 * @returns {boolean}
 */
export function isDifficultyCompatible(wordDifficulty, userDifficulty) {
  const wordIdx = CEFR_LEVELS.indexOf(wordDifficulty);
  const userIdx = CEFR_LEVELS.indexOf(userDifficulty);
  // 边界处理：无效值默认使用 B1（索引 2）
  const safeUserIdx = userIdx >= 0 ? userIdx : 2;
  const safeWordIdx = wordIdx >= 0 ? wordIdx : 2;
  // 只显示大于等于用户选择难度的词汇
  return safeWordIdx >= safeUserIdx;
}

/**
 * 获取语言显示名称
 * @param {string} code - 语言代码
 * @returns {string}
 */
export function getLanguageName(code) {
  const all = [...SUPPORTED_LANGUAGES.native, ...SUPPORTED_LANGUAGES.target];
  const lang = all.find(l => l.code === code);
  return lang ? lang.name : code;
}
