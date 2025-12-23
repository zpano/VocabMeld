/**
 * Sapling Options 脚本 - 自动保存版本
 */

import { normalizeHexColor, applyThemeVariables } from './utils/color-utils.js';

document.addEventListener('DOMContentLoaded', async () => {
  // API 预设
  const API_PRESETS = {
    openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
    moonshot: { endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
    groq: { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant' },
    ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'qwen2.5:7b' }
  };

  const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const CACHE_MAX_SIZE_STEP = 1024;
  const DEFAULT_CACHE_MAX_SIZE = 2048;
  const CACHE_MAX_SIZE_LIMIT = 8192;
  const CACHE_MIN_SIZE_LIMIT = 2048;
  const DEFAULT_CONCURRENCY_LIMIT = 5;
  const CONCURRENCY_LIMIT_MAX = 20;
  const DEFAULT_MAX_BATCH_SIZE = 3;
  const MAX_BATCH_SIZE_MAX = 10;
  const DEFAULT_THEME = {
    brand: '#81C784',
    background: '#1B1612',
    card: '#26201A',
    highlight: '#A5D6A7',
    underline: '#4E342E',
    text: '#D7CCC8'
  };

  function normalizeCacheMaxSize(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_CACHE_MAX_SIZE;
    const clamped = Math.min(CACHE_MAX_SIZE_LIMIT, Math.max(CACHE_MIN_SIZE_LIMIT, parsed));
    const snapped = Math.round(clamped / CACHE_MAX_SIZE_STEP) * CACHE_MAX_SIZE_STEP;
    return Math.min(CACHE_MAX_SIZE_LIMIT, Math.max(CACHE_MIN_SIZE_LIMIT, snapped));
  }

  function normalizePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeConcurrencyLimit(value) {
    return normalizePositiveInt(value, DEFAULT_CONCURRENCY_LIMIT, { min: 1, max: CONCURRENCY_LIMIT_MAX });
  }

  function normalizeMaxBatchSize(value) {
    return normalizePositiveInt(value, DEFAULT_MAX_BATCH_SIZE, { min: 1, max: MAX_BATCH_SIZE_MAX });
  }

  // 防抖保存函数
  let saveTimeout;
  function debouncedSave(delay = 500) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => queueSave({ source: 'auto' }), delay);
  }

  // DOM 元素
  const elements = {
    // 导航
    navItems: document.querySelectorAll('.nav-item'),
    sections: document.querySelectorAll('.settings-section'),

    // API 配置
    presetBtns: document.querySelectorAll('.preset-btn'),
    apiEndpoint: document.getElementById('apiEndpoint'),
    apiKey: document.getElementById('apiKey'),
    modelName: document.getElementById('modelName'),
    toggleApiKey: document.getElementById('toggleApiKey'),
    testConnectionBtn: document.getElementById('testConnectionBtn'),
    testResult: document.getElementById('testResult'),

    // 学习偏好
    nativeLanguage: document.getElementById('nativeLanguage'),
    targetLanguage: document.getElementById('targetLanguage'),
    difficultyLevel: document.getElementById('difficultyLevel'),
    selectedDifficulty: document.getElementById('selectedDifficulty'),
    intensityRadios: document.querySelectorAll('input[name="intensity"]'),
    retestVocabBtn: document.getElementById('retestVocabBtn'),

    // 行为设置
    autoProcess: document.getElementById('autoProcess'),
    showPhonetic: document.getElementById('showPhonetic'),
    allowLeftClickPronunciation: document.getElementById('allowLeftClickPronunciation'),
    restoreAllSameWordsOnLearned: document.getElementById('restoreAllSameWordsOnLearned'),
    pronunciationProvider: document.getElementById('pronunciationProvider'),
    youdaoPronunciationType: document.getElementById('youdaoPronunciationType'),
    youdaoPronunciationSettings: document.getElementById('youdaoPronunciationSettings'),
    translationStyleRadios: document.querySelectorAll('input[name="translationStyle"]'),

    // 主题设置
    themeBrand: document.getElementById('themeBrand'),
    themeBrandText: document.getElementById('themeBrandText'),
    themeBackground: document.getElementById('themeBackground'),
    themeBackgroundText: document.getElementById('themeBackgroundText'),
    themeCard: document.getElementById('themeCard'),
    themeCardText: document.getElementById('themeCardText'),
    themeHighlight: document.getElementById('themeHighlight'),
    themeHighlightText: document.getElementById('themeHighlightText'),
    themeUnderline: document.getElementById('themeUnderline'),
    themeUnderlineText: document.getElementById('themeUnderlineText'),
    themeText: document.getElementById('themeText'),
    themeTextText: document.getElementById('themeTextText'),
    themeResetBtn: document.getElementById('themeResetBtn'),

    // 高级设置
    concurrencyLimit: document.getElementById('concurrencyLimit'),
    maxBatchSize: document.getElementById('maxBatchSize'),
    processFullPage: document.getElementById('processFullPage'),

    // 站点规则
    blacklistInput: document.getElementById('blacklistInput'),
    whitelistInput: document.getElementById('whitelistInput'),

    // 词汇管理
    wordTabs: document.querySelectorAll('.word-tab'),
    learnedList: document.getElementById('learnedList'),
    memorizeList: document.getElementById('memorizeList'),
    cachedList: document.getElementById('cachedList'),
    learnedTabCount: document.getElementById('learnedTabCount'),
    memorizeTabCount: document.getElementById('memorizeTabCount'),
    cachedTabCount: document.getElementById('cachedTabCount'),
    clearLearnedBtn: document.getElementById('clearLearnedBtn'),
    clearMemorizeBtn: document.getElementById('clearMemorizeBtn'),
    clearCacheBtn: document.getElementById('clearCacheBtn'),
    learnedFilters: document.getElementById('learnedFilters'),
    memorizeFilters: document.getElementById('memorizeFilters'),
    cachedFilters: document.getElementById('cachedFilters'),
    learnedSearchInput: document.getElementById('learnedSearchInput'),
    memorizeSearchInput: document.getElementById('memorizeSearchInput'),
    cachedSearchInput: document.getElementById('cachedSearchInput'),
    difficultyFilterBtns: document.querySelectorAll('.difficulty-filter-btn'),

    // 统计
    statTotalWords: document.getElementById('statTotalWords'),
    statTodayWords: document.getElementById('statTodayWords'),
    statLearnedWords: document.getElementById('statLearnedWords'),
    statMemorizeWords: document.getElementById('statMemorizeWords'),
    statCacheSize: document.getElementById('statCacheSize'),
    statCacheMaxSize: document.getElementById('statCacheMaxSize'),
    statHitRate: document.getElementById('statHitRate'),
    cacheProgress: document.getElementById('cacheProgress'),
    cacheMaxSize: document.getElementById('cacheMaxSize'),
    cacheMaxSizeInput: document.getElementById('cacheMaxSizeInput'),
    cacheMaxSizeValue: document.getElementById('cacheMaxSizeValue'),
    resetTodayBtn: document.getElementById('resetTodayBtn'),
    resetAllBtn: document.getElementById('resetAllBtn'),

    // 固定位置操作
    manualSaveBtn: document.getElementById('manualSaveBtn'),
    optionsToastContainer: document.getElementById('optionsToastContainer')
  };

  let lastCacheMaxSize = DEFAULT_CACHE_MAX_SIZE;
  let lastKnownCacheSize = 0;
  let lastSavedSettingsJson = null;
  let saveQueue = Promise.resolve();
  let lastAutoSaveToastAt = 0;
  let lastAutoSaveErrorToastAt = 0;

  function showOptionsToast(message, { type = 'success', durationMs = 2200 } = {}) {
    const container = elements.optionsToastContainer;
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `options-toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    const remove = () => toast.remove();
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(remove, 220);
    }, durationMs);
  }

  function shouldShowAutoSaveToast() {
    const now = Date.now();
    if (now - lastAutoSaveToastAt < 1600) return false;
    lastAutoSaveToastAt = now;
    return true;
  }

  function shouldShowAutoSaveErrorToast() {
    const now = Date.now();
    if (now - lastAutoSaveErrorToastAt < 2500) return false;
    lastAutoSaveErrorToastAt = now;
    return true;
  }

  function queueSave({ source = 'auto' } = {}) {
    saveQueue = saveQueue
      .then(() => saveSettings({ source }))
      .catch(() => {});
    return saveQueue;
  }

  function setCacheMaxSizeUI(value, { preserveInputText = false } = {}) {
    const normalized = normalizeCacheMaxSize(value);
    if (elements.cacheMaxSize) elements.cacheMaxSize.value = String(normalized);
    if (elements.cacheMaxSizeInput && !preserveInputText) elements.cacheMaxSizeInput.value = String(normalized);
    updateCacheMaxSizeLabel(normalized);
    renderCacheStatus(lastKnownCacheSize, normalized);
  }

  function updateCacheMaxSizeLabel(value) {
    const normalized = normalizeCacheMaxSize(value);
    if (elements.cacheMaxSizeValue) elements.cacheMaxSizeValue.textContent = String(normalized);
  }

  function renderCacheStatus(cacheSize, cacheMaxSize) {
    const normalizedMaxSize = normalizeCacheMaxSize(cacheMaxSize);
    if (elements.statCacheSize) elements.statCacheSize.textContent = String(cacheSize);
    if (elements.statCacheMaxSize) elements.statCacheMaxSize.textContent = String(normalizedMaxSize);
    if (elements.cacheProgress) {
      const percent = normalizedMaxSize > 0 ? Math.min(100, (cacheSize / normalizedMaxSize) * 100) : 0;
      elements.cacheProgress.style.width = percent + '%';
    }
  }

  function getThemePairs() {
    return [
      { key: 'brand', color: elements.themeBrand, text: elements.themeBrandText },
      { key: 'background', color: elements.themeBackground, text: elements.themeBackgroundText },
      { key: 'card', color: elements.themeCard, text: elements.themeCardText },
      { key: 'highlight', color: elements.themeHighlight, text: elements.themeHighlightText },
      { key: 'underline', color: elements.themeUnderline, text: elements.themeUnderlineText },
      { key: 'text', color: elements.themeText, text: elements.themeTextText }
    ];
  }

  function getThemeFromUI() {
    const theme = { ...DEFAULT_THEME };
    getThemePairs().forEach(({ key, color, text }) => {
      const value = normalizeHexColor(text?.value || color?.value);
      theme[key] = value || DEFAULT_THEME[key];
    });
    return theme;
  }

  function setThemeInputs(theme) {
    const safeTheme = { ...DEFAULT_THEME, ...(theme || {}) };
    getThemePairs().forEach(({ key, color, text }) => {
      const value = normalizeHexColor(safeTheme[key]) || DEFAULT_THEME[key];
      if (color) color.value = value;
      if (text) text.value = value;
    });
  }

  function syncThemePair({ key, color, text }) {
    if (!color || !text) return;

    const syncValue = (value, { save = true } = {}) => {
      const normalized = normalizeHexColor(value);
      if (!normalized) return false;
      color.value = normalized;
      text.value = normalized;
      applyThemeVariables(getThemeFromUI(), DEFAULT_THEME);
      if (save) debouncedSave(200);
      return true;
    };

    color.addEventListener('input', () => {
      syncValue(color.value);
    });

    text.addEventListener('input', () => {
      syncValue(text.value, { save: false });
    });

    text.addEventListener('change', () => {
      if (!syncValue(text.value)) {
        syncValue(DEFAULT_THEME[key]);
      }
    });

    text.addEventListener('blur', () => {
      if (!syncValue(text.value)) {
        syncValue(DEFAULT_THEME[key]);
      }
    });
  }

  // 加载配置
  async function loadSettings() {
    chrome.storage.sync.get(null, (result) => {
      // API 配置
      elements.apiEndpoint.value = result.apiEndpoint || API_PRESETS.deepseek.endpoint;
      elements.apiKey.value = result.apiKey || '';
      elements.modelName.value = result.modelName || API_PRESETS.deepseek.model;
      
      // 学习偏好
      elements.nativeLanguage.value = result.nativeLanguage || 'zh-CN';
      elements.targetLanguage.value = result.targetLanguage || 'en';
      
      const diffIdx = CEFR_LEVELS.indexOf(result.difficultyLevel || 'B1');
      elements.difficultyLevel.value = diffIdx >= 0 ? diffIdx : 2;
      updateDifficultyLabel();
      
      const intensity = result.intensity || 'medium';
      elements.intensityRadios.forEach(radio => {
        radio.checked = radio.value === intensity;
      });
      
      // 行为设置
      elements.autoProcess.checked = result.autoProcess ?? false;
      elements.showPhonetic.checked = result.showPhonetic ?? true;
      elements.allowLeftClickPronunciation.checked = result.allowLeftClickPronunciation ?? true;
      elements.restoreAllSameWordsOnLearned.checked = result.restoreAllSameWordsOnLearned ?? true;
      elements.pronunciationProvider.value = result.pronunciationProvider || 'wiktionary';
      elements.youdaoPronunciationType.value = String(result.youdaoPronunciationType ?? 2);
      updatePronunciationSettingsVisibility();
      
      const translationStyle = result.translationStyle || 'original-translation';
      elements.translationStyleRadios.forEach(radio => {
        radio.checked = radio.value === translationStyle;
      });

      // 主题设置
      const theme = { ...DEFAULT_THEME, ...(result.theme || {}) };
      setThemeInputs(theme);
      applyThemeVariables(theme, DEFAULT_THEME);
      
      // 站点规则
      elements.blacklistInput.value = (result.blacklist || []).join('\n');
      elements.whitelistInput.value = (result.whitelist || []).join('\n');

      // 高级设置
      if (elements.concurrencyLimit) elements.concurrencyLimit.value = String(normalizeConcurrencyLimit(result.concurrencyLimit));
      if (elements.maxBatchSize) elements.maxBatchSize.value = String(normalizeMaxBatchSize(result.maxBatchSize));
      if (elements.processFullPage) elements.processFullPage.checked = result.processFullPage ?? false;

      // 缓存容量
      const cacheMaxSize = normalizeCacheMaxSize(result.cacheMaxSize);
      lastCacheMaxSize = cacheMaxSize;
      setCacheMaxSizeUI(cacheMaxSize);

      // 加载词汇列表
      loadWordLists(result);
      
      // 加载统计
      loadStats(result);

      lastSavedSettingsJson = JSON.stringify(collectSettingsFromUI());
    });
  }

  function updatePronunciationSettingsVisibility() {
    const provider = elements.pronunciationProvider?.value || 'wiktionary';
    const targetLanguage = elements.targetLanguage?.value || 'en';
    const useYoudao = provider === 'youdao' && targetLanguage === 'en';

    if (elements.youdaoPronunciationSettings) elements.youdaoPronunciationSettings.hidden = !useYoudao;
    if (elements.youdaoPronunciationType) elements.youdaoPronunciationType.disabled = !useYoudao;
  }

  // 存储原始数据（用于搜索和筛选）
  let allLearnedWords = [];
  let allMemorizeWords = [];
  let allCachedWords = [];

  // 加载词汇列表
  function loadWordLists(result) {
    const learnedWords = result.learnedWords || [];
    const memorizeList = result.memorizeList || [];
    
    // 保存原始数据（包含难度信息）
    allLearnedWords = learnedWords.map(w => ({
      original: w.original,
      word: w.word,
      addedAt: w.addedAt,
      difficulty: w.difficulty || 'B1' // 如果已学会词汇有难度信息则使用，否则默认B1
    }));
    
    allMemorizeWords = memorizeList.map(w => ({
      original: w.word,
      word: '',
      addedAt: w.addedAt,
      difficulty: w.difficulty || 'B1' // 如果需记忆词汇有难度信息则使用，否则默认B1
    }));
    
    // 更新计数
    elements.learnedTabCount.textContent = learnedWords.length;
    elements.memorizeTabCount.textContent = memorizeList.length;
    
    // 应用搜索和筛选
    filterLearnedWords();
    filterMemorizeWords();
    
    // 加载缓存
    chrome.storage.local.get('Sapling_word_cache', (data) => {
      const cache = data.Sapling_word_cache || [];
      lastKnownCacheSize = Array.isArray(cache) ? cache.length : 0;
      elements.cachedTabCount.textContent = cache.length;
      
      const cacheWords = cache.map(item => {
        const [word] = item.key.split(':');
        return { 
          original: word, 
          word: item.translation, 
          addedAt: item.timestamp,
          difficulty: item.difficulty || 'B1',
          phonetic: item.phonetic || ''
        };
      });
      
      // 保存原始数据
      allCachedWords = cacheWords;
      
      // 应用搜索和筛选
      filterCachedWords();
    });
  }

  // 渲染词汇列表
  function renderWordList(container, words, type) {
    if (words.length === 0) {
      container.innerHTML = '<div class="empty-list">暂无词汇</div>';
      return;
    }

    container.innerHTML = words.map(w => `
      <div class="word-item">
        <span class="word-original">${w.original}</span>
        ${w.word ? `<span class="word-translation">${w.word}</span>` : ''}
        ${w.difficulty ? `<span class="word-difficulty difficulty-${w.difficulty.toLowerCase()}">${w.difficulty}</span>` : ''}
        <span class="word-date">${formatDate(w.addedAt)}</span>
        ${type !== 'cached' ? `<button class="word-remove" data-word="${w.original}" data-type="${type}">&times;</button>` : ''}
      </div>
    `).join('');

    // 绑定删除事件
    container.querySelectorAll('.word-remove').forEach(btn => {
      btn.addEventListener('click', () => removeWord(btn.dataset.word, btn.dataset.type));
    });
  }

  // 搜索和筛选已学会词汇
  function filterLearnedWords() {
    const searchTerm = (elements.learnedSearchInput?.value || '').toLowerCase().trim();
    const selectedDifficulty = document.querySelector('.difficulty-filter-btn.active[data-tab="learned"]')?.dataset.difficulty || 'all';
    
    let filtered = allLearnedWords;
    
    // 应用搜索
    if (searchTerm) {
      filtered = filtered.filter(w => 
        w.original.toLowerCase().includes(searchTerm) || 
        (w.word && w.word.toLowerCase().includes(searchTerm))
      );
    }
    
    // 应用难度筛选
    if (selectedDifficulty !== 'all') {
      filtered = filtered.filter(w => w.difficulty === selectedDifficulty);
    }
    
    // 更新计数
    elements.learnedTabCount.textContent = `${filtered.length} / ${allLearnedWords.length}`;
    
    // 渲染筛选后的列表
    renderWordList(elements.learnedList, filtered, 'learned');
  }

  // 搜索和筛选需记忆词汇
  function filterMemorizeWords() {
    const searchTerm = (elements.memorizeSearchInput?.value || '').toLowerCase().trim();
    const selectedDifficulty = document.querySelector('.difficulty-filter-btn.active[data-tab="memorize"]')?.dataset.difficulty || 'all';
    
    let filtered = allMemorizeWords;
    
    // 应用搜索
    if (searchTerm) {
      filtered = filtered.filter(w => 
        w.original.toLowerCase().includes(searchTerm) || 
        (w.word && w.word.toLowerCase().includes(searchTerm))
      );
    }
    
    // 应用难度筛选
    if (selectedDifficulty !== 'all') {
      filtered = filtered.filter(w => w.difficulty === selectedDifficulty);
    }
    
    // 更新计数
    elements.memorizeTabCount.textContent = `${filtered.length} / ${allMemorizeWords.length}`;
    
    // 渲染筛选后的列表
    renderWordList(elements.memorizeList, filtered, 'memorize');
  }

  // 搜索和筛选缓存词汇
  function filterCachedWords() {
    const searchTerm = (elements.cachedSearchInput?.value || '').toLowerCase().trim();
    const selectedDifficulty = document.querySelector('.difficulty-filter-btn.active[data-tab="cached"]')?.dataset.difficulty || 'all';
    
    let filtered = allCachedWords;
    
    // 应用搜索
    if (searchTerm) {
      filtered = filtered.filter(w => 
        w.original.toLowerCase().includes(searchTerm) || 
        (w.word && w.word.toLowerCase().includes(searchTerm))
      );
    }
    
    // 应用难度筛选
    if (selectedDifficulty !== 'all') {
      filtered = filtered.filter(w => w.difficulty === selectedDifficulty);
    }
    
    // 更新计数
    elements.cachedTabCount.textContent = `${filtered.length} / ${allCachedWords.length}`;
    
    // 渲染筛选后的列表
    renderWordList(elements.cachedList, filtered, 'cached');
  }

  // 格式化日期
  function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  // 删除词汇
  async function removeWord(word, type) {
    if (type === 'learned') {
      chrome.storage.sync.get('learnedWords', (result) => {
        const list = (result.learnedWords || []).filter(w => w.original !== word);
        chrome.storage.sync.set({ learnedWords: list }, loadSettings);
      });
    } else if (type === 'memorize') {
      chrome.storage.sync.get('memorizeList', (result) => {
        const list = (result.memorizeList || []).filter(w => w.word !== word);
        chrome.storage.sync.set({ memorizeList: list }, loadSettings);
      });
    }
  }

  async function trimLocalCacheToMaxSize(maxSize) {
    const normalized = normalizeCacheMaxSize(maxSize);
    return new Promise((resolve) => {
      chrome.storage.local.get('Sapling_word_cache', (data) => {
        const cache = data.Sapling_word_cache || [];
        if (!Array.isArray(cache) || cache.length <= normalized) return resolve(false);
        const trimmed = cache.slice(-normalized);
        chrome.storage.local.set({ Sapling_word_cache: trimmed }, () => resolve(true));
      });
    });
  }

  // 加载统计数据
  function loadStats(result) {
    const cacheMaxSize = normalizeCacheMaxSize(result.cacheMaxSize);
    if (elements.statCacheMaxSize) elements.statCacheMaxSize.textContent = String(cacheMaxSize);

    elements.statTotalWords.textContent = result.totalWords || 0;
    elements.statTodayWords.textContent = result.todayWords || 0;
    elements.statLearnedWords.textContent = (result.learnedWords || []).length;
    elements.statMemorizeWords.textContent = (result.memorizeList || []).length;
    
    const hits = result.cacheHits || 0;
    const misses = result.cacheMisses || 0;
    const total = hits + misses;
    const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
    elements.statHitRate.textContent = hitRate + '%';
    
    chrome.storage.local.get('Sapling_word_cache', (data) => {
      const cacheSize = (data.Sapling_word_cache || []).length;
      lastKnownCacheSize = cacheSize;
      renderCacheStatus(cacheSize, cacheMaxSize);
    });
  }

  function collectSettingsFromUI() {
    const normalizedCacheMaxSize = normalizeCacheMaxSize(
      elements.cacheMaxSize?.value ?? elements.cacheMaxSizeInput?.value
    );
    setCacheMaxSizeUI(normalizedCacheMaxSize);

    const normalizedConcurrencyLimit = normalizeConcurrencyLimit(elements.concurrencyLimit?.value);
    if (elements.concurrencyLimit) elements.concurrencyLimit.value = String(normalizedConcurrencyLimit);

    const normalizedMaxBatchSize = normalizeMaxBatchSize(elements.maxBatchSize?.value);
    if (elements.maxBatchSize) elements.maxBatchSize.value = String(normalizedMaxBatchSize);

    return {
      apiEndpoint: elements.apiEndpoint.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      modelName: elements.modelName.value.trim(),
      nativeLanguage: elements.nativeLanguage.value,
      targetLanguage: elements.targetLanguage.value,
      difficultyLevel: CEFR_LEVELS[elements.difficultyLevel.value],
      intensity: document.querySelector('input[name="intensity"]:checked')?.value || 'medium',
      autoProcess: elements.autoProcess.checked,
      showPhonetic: elements.showPhonetic.checked,
      allowLeftClickPronunciation: elements.allowLeftClickPronunciation.checked,
      restoreAllSameWordsOnLearned: elements.restoreAllSameWordsOnLearned.checked,
      pronunciationProvider: elements.pronunciationProvider.value,
      youdaoPronunciationType: Number.parseInt(elements.youdaoPronunciationType.value, 10) === 1 ? 1 : 2,
      translationStyle: document.querySelector('input[name="translationStyle"]:checked')?.value || 'original-translation',
      theme: getThemeFromUI(),
      blacklist: elements.blacklistInput.value.split('\n').map(s => s.trim()).filter(s => s),
      whitelist: elements.whitelistInput.value.split('\n').map(s => s.trim()).filter(s => s),
      cacheMaxSize: normalizedCacheMaxSize,
      concurrencyLimit: normalizedConcurrencyLimit,
      maxBatchSize: normalizedMaxBatchSize,
      processFullPage: elements.processFullPage?.checked ?? false
    };
  }

  // 保存设置（自动/手动）
  async function saveSettings({ source = 'auto' } = {}) {
    const isManual = source === 'manual';
    const manualSaveBtn = elements.manualSaveBtn;
    const defaultBtnText = manualSaveBtn?.dataset?.defaultText || manualSaveBtn?.textContent || '手动保存';
    if (isManual && manualSaveBtn) {
      manualSaveBtn.dataset.defaultText = defaultBtnText.trim();
      manualSaveBtn.disabled = true;
      manualSaveBtn.textContent = '保存中...';
    }

    const settings = collectSettingsFromUI();
    const normalizedCacheMaxSize = settings.cacheMaxSize;
    const settingsJson = JSON.stringify(settings);

    if (!isManual && lastSavedSettingsJson === settingsJson) {
      return;
    }

    if (isManual && lastSavedSettingsJson === settingsJson) {
      showOptionsToast('没有需要保存的更改', { type: 'success', durationMs: 1600 });
      if (manualSaveBtn) {
        manualSaveBtn.disabled = false;
        manualSaveBtn.textContent = manualSaveBtn.dataset.defaultText || '手动保存';
      }
      return;
    }

    try {
      await chrome.storage.sync.set(settings);
      console.log(`[Sapling] Settings saved (${source})`);
      lastSavedSettingsJson = settingsJson;

      if (isManual) {
        showOptionsToast('保存成功', { type: 'success' });
      } else if (shouldShowAutoSaveToast()) {
        showOptionsToast('自动保存成功', { type: 'success' });
      }

      if (normalizedCacheMaxSize !== lastCacheMaxSize) {
        lastCacheMaxSize = normalizedCacheMaxSize;
        const trimmed = await trimLocalCacheToMaxSize(normalizedCacheMaxSize);
        if (trimmed) {
          lastKnownCacheSize = Math.min(lastKnownCacheSize, normalizedCacheMaxSize);
          renderCacheStatus(lastKnownCacheSize, normalizedCacheMaxSize);
          loadSettings();
        }
      }
    } catch (error) {
      console.error('[Sapling] Failed to save settings:', error);
      if (isManual) {
        showOptionsToast('保存失败，请稍后重试', { type: 'error', durationMs: 3600 });
      } else if (shouldShowAutoSaveErrorToast()) {
        showOptionsToast('自动保存失败，请检查控制台日志', { type: 'error', durationMs: 4200 });
      }
    } finally {
      if (isManual && manualSaveBtn) {
        manualSaveBtn.disabled = false;
        manualSaveBtn.textContent = manualSaveBtn.dataset.defaultText || '手动保存';
      }
    }
  }

  // 添加自动保存事件监听器
  function addAutoSaveListeners() {
    // 文本输入框 - 失焦时保存
    const textInputs = [
      elements.apiEndpoint,
      elements.apiKey,
      elements.modelName,
      elements.blacklistInput,
      elements.whitelistInput
    ];

    textInputs.forEach(input => {
      input.addEventListener('blur', () => debouncedSave());
      input.addEventListener('change', () => debouncedSave());
    });

    // 下拉框 - 改变时保存
    const selects = [
      elements.nativeLanguage,
      elements.targetLanguage,
      elements.pronunciationProvider,
      elements.youdaoPronunciationType
    ];

    selects.forEach(select => {
      select.addEventListener('change', () => {
        if (select === elements.targetLanguage || select === elements.pronunciationProvider) {
          updatePronunciationSettingsVisibility();
        }
        debouncedSave(200);
      });
    });

    const numberInputs = [
      elements.concurrencyLimit,
      elements.maxBatchSize
    ].filter(Boolean);

    numberInputs.forEach(input => {
      input.addEventListener('blur', () => debouncedSave(200));
      input.addEventListener('change', () => debouncedSave(200));
      input.addEventListener('input', () => debouncedSave(200));
    });

    // 滑块 - 改变时保存
    elements.difficultyLevel.addEventListener('input', () => debouncedSave(200));
    elements.difficultyLevel.addEventListener('change', () => debouncedSave(200));

    // 单选按钮 - 改变时保存
    elements.intensityRadios.forEach(radio => {
      radio.addEventListener('change', () => debouncedSave(200));
    });

    elements.translationStyleRadios.forEach(radio => {
      radio.addEventListener('change', () => debouncedSave(200));
    });

    // 开关 - 改变时保存
    const checkboxes = [
      elements.autoProcess,
      elements.showPhonetic,
      elements.allowLeftClickPronunciation,
      elements.restoreAllSameWordsOnLearned,
      elements.processFullPage
    ];

    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', () => debouncedSave(200));
    });

    if (elements.cacheMaxSize) {
      elements.cacheMaxSize.addEventListener('input', () => {
        const normalized = normalizeCacheMaxSize(elements.cacheMaxSize.value);
        setCacheMaxSizeUI(normalized);
        debouncedSave(200);
      });
      elements.cacheMaxSize.addEventListener('change', () => {
        const normalized = normalizeCacheMaxSize(elements.cacheMaxSize.value);
        setCacheMaxSizeUI(normalized);
        debouncedSave(200);
      });
    }

    if (elements.cacheMaxSizeInput) {
      elements.cacheMaxSizeInput.addEventListener('input', () => {
        const parsed = Number.parseInt(String(elements.cacheMaxSizeInput.value), 10);
        if (!Number.isFinite(parsed)) return;
        setCacheMaxSizeUI(parsed, { preserveInputText: true });
      });
      elements.cacheMaxSizeInput.addEventListener('change', () => {
        const normalized = normalizeCacheMaxSize(elements.cacheMaxSizeInput.value);
        setCacheMaxSizeUI(normalized);
        debouncedSave(200);
      });
      elements.cacheMaxSizeInput.addEventListener('blur', () => {
        const normalized = normalizeCacheMaxSize(elements.cacheMaxSizeInput.value);
        setCacheMaxSizeUI(normalized);
        debouncedSave(200);
      });
    }

    getThemePairs().forEach(syncThemePair);
  }

  // 更新难度标签
  function updateDifficultyLabel() {
    const level = CEFR_LEVELS[elements.difficultyLevel.value];
    elements.selectedDifficulty.textContent = level;
  }

  // 事件绑定
  function bindEvents() {
    if (elements.manualSaveBtn) {
      elements.manualSaveBtn.dataset.defaultText = elements.manualSaveBtn.textContent.trim();
      elements.manualSaveBtn.addEventListener('click', () => queueSave({ source: 'manual' }));
    }

    // 导航切换
    elements.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;

        elements.navItems.forEach(n => n.classList.remove('active'));
        elements.sections.forEach(s => s.classList.remove('active'));

        item.classList.add('active');
        document.getElementById(section).classList.add('active');
      });
    });

    // 预设按钮
    elements.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = API_PRESETS[btn.dataset.preset];
        if (preset) {
          elements.apiEndpoint.value = preset.endpoint;
          elements.modelName.value = preset.model;

          elements.presetBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          // 预设按钮改变时立即保存
          debouncedSave(200);
        }
      });
    });

    // 切换 API 密钥可见性
    elements.toggleApiKey.addEventListener('click', () => {
      const type = elements.apiKey.type === 'password' ? 'text' : 'password';
      elements.apiKey.type = type;
    });

    // 测试连接
    elements.testConnectionBtn.addEventListener('click', async () => {
      elements.testConnectionBtn.disabled = true;
      elements.testResult.textContent = '测试中...';
      elements.testResult.className = 'test-result';

      chrome.runtime.sendMessage({
        action: 'testApi',
        endpoint: elements.apiEndpoint.value,
        apiKey: elements.apiKey.value,
        model: elements.modelName.value
      }, (response) => {
        elements.testConnectionBtn.disabled = false;
        if (response?.success) {
          elements.testResult.textContent = '✓ 连接成功';
          elements.testResult.className = 'test-result success';
        } else {
          elements.testResult.textContent = '✗ ' + (response?.message || '连接失败');
          elements.testResult.className = 'test-result error';
        }
      });
    });

    // 重新测试词汇量
    if (elements.retestVocabBtn) {
      elements.retestVocabBtn.addEventListener('click', () => {
        // 清除测试完成标记，允许重新测试
        chrome.storage.sync.set({ vocabTestCompleted: false }, () => {
          // 打开词汇量测试页面
          chrome.tabs.create({
            url: chrome.runtime.getURL('vocab-test.html')
          });
        });
      });
    }

    if (elements.themeResetBtn) {
      elements.themeResetBtn.addEventListener('click', () => {
        setThemeInputs(DEFAULT_THEME);
        applyThemeVariables(DEFAULT_THEME, DEFAULT_THEME);
        debouncedSave(200);
      });
    }

    // 难度滑块
    elements.difficultyLevel.addEventListener('input', updateDifficultyLabel);

    // 词汇标签切换
    elements.wordTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        elements.wordTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.word-list').forEach(list => {
          list.classList.toggle('hidden', list.dataset.tab !== tabName);
        });
        
        // 显示/隐藏搜索和筛选器
        document.querySelectorAll('.word-filters').forEach(filter => {
          filter.classList.toggle('hidden', filter.dataset.tab !== tabName);
        });
      });
    });

    // 初始化时检查当前激活的标签
    const activeTab = document.querySelector('.word-tab.active');
    if (activeTab) {
      const tabName = activeTab.dataset.tab;
      document.querySelectorAll('.word-filters').forEach(filter => {
        filter.classList.toggle('hidden', filter.dataset.tab !== tabName);
      });
    }

    // 搜索输入事件
    if (elements.learnedSearchInput) {
      elements.learnedSearchInput.addEventListener('input', () => {
        filterLearnedWords();
      });
    }

    if (elements.memorizeSearchInput) {
      elements.memorizeSearchInput.addEventListener('input', () => {
        filterMemorizeWords();
      });
    }

    if (elements.cachedSearchInput) {
      elements.cachedSearchInput.addEventListener('input', () => {
        filterCachedWords();
      });
    }

    // 难度筛选按钮事件
    elements.difficultyFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        // 只激活同一tab的按钮
        document.querySelectorAll(`.difficulty-filter-btn[data-tab="${tab}"]`).forEach(b => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        
        // 根据tab调用对应的筛选函数
        if (tab === 'learned') {
          filterLearnedWords();
        } else if (tab === 'memorize') {
          filterMemorizeWords();
        } else if (tab === 'cached') {
          filterCachedWords();
        }
      });
    });

    // 清空按钮
    elements.clearLearnedBtn.addEventListener('click', () => {
      if (confirm('确定要清空所有已学会词汇吗？')) {
        chrome.runtime.sendMessage({ action: 'clearLearnedWords' }, () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    elements.clearMemorizeBtn.addEventListener('click', () => {
      if (confirm('确定要清空需记忆列表吗？')) {
        chrome.runtime.sendMessage({ action: 'clearMemorizeList' }, () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    elements.clearCacheBtn.addEventListener('click', () => {
      if (confirm('确定要清空词汇缓存吗？')) {
        chrome.runtime.sendMessage({ action: 'clearCache' }, () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    // 统计重置
    elements.resetTodayBtn.addEventListener('click', () => {
      chrome.storage.sync.set({ todayWords: 0 }, () => {
        loadSettings();
        debouncedSave(200);
      });
    });

    elements.resetAllBtn.addEventListener('click', () => {
      if (confirm('确定要重置所有数据吗？这将清空所有统计和词汇列表。')) {
        chrome.storage.sync.set({
          totalWords: 0,
          todayWords: 0,
          cacheHits: 0,
          cacheMisses: 0,
          learnedWords: [],
          memorizeList: []
        });
        chrome.storage.local.remove('Sapling_word_cache', () => {
          loadSettings();
          debouncedSave(200);
        });
      }
    });

    // 添加自动保存事件监听器
    addAutoSaveListeners();
  }

  // 初始化
  bindEvents();
  loadSettings();
});
