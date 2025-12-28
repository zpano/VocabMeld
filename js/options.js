/**
 * Sapling Options 脚本 - 自动保存版本
 */

import { normalizeHexColor, applyThemeVariables } from './utils/color-utils.js';
import { storage } from './core/storage/StorageService.js';
import { getModalController } from './ui/modal.js';
import { initCustomSelects } from './ui/custom-select.js';

document.addEventListener('DOMContentLoaded', async () => {
  // API 预设
  const API_PRESETS = {
    openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
    moonshot: { endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
    groq: { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant' },
    ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'qwen2.5:7b' }
  };

  function generateApiProfileId() {
    return `api_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function sanitizeApiProfiles(value) {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    const sanitized = [];

    for (const raw of list) {
      const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      sanitized.push({
        id,
        name: name || '未命名配置',
        apiEndpoint: typeof raw?.apiEndpoint === 'string' ? raw.apiEndpoint : '',
        apiKey: typeof raw?.apiKey === 'string' ? raw.apiKey : '',
        modelName: typeof raw?.modelName === 'string' ? raw.modelName : ''
      });
    }

    return sanitized;
  }

  function suggestNextApiProfileName(profiles) {
    const base = '自定义配置';
    const existing = new Set((profiles || []).map(p => String(p?.name || '').trim()));
    if (!existing.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base} ${i}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base} ${Date.now()}`;
  }

  const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const CACHE_MAX_SIZE_STEP = 1024;
  const DEFAULT_CACHE_MAX_SIZE = 2048;
  const CACHE_MAX_SIZE_LIMIT = 8192;
  const CACHE_MIN_SIZE_LIMIT = 2048;
  const DEFAULT_CONCURRENCY_LIMIT = 5;
  const CONCURRENCY_LIMIT_MAX = 20;
  const DEFAULT_MAX_BATCH_SIZE = 3;
  const MAX_BATCH_SIZE_MAX = 10;
  const DEFAULT_MAX_TOKENS = 16384;
  const MAX_TOKENS_MIN = 4096;
  const MAX_TOKENS_MAX = 200000;
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

  function normalizeMaxTokens(value) {
    return normalizePositiveInt(value, DEFAULT_MAX_TOKENS, { min: MAX_TOKENS_MIN, max: MAX_TOKENS_MAX });
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
    presetBtns: document.querySelectorAll('.preset-buttons .preset-btn[data-preset]'),
    addApiProfileBtn: document.getElementById('addApiProfileBtn'),
    apiProfileButtons: document.getElementById('apiProfileButtons'),
    renameApiProfileBtn: document.getElementById('renameApiProfileBtn'),
    deleteApiProfileBtn: document.getElementById('deleteApiProfileBtn'),
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
    maxTokens: document.getElementById('maxTokens'),
    outputFormat: document.getElementById('outputFormat'),
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

  let apiProfiles = [];
  let activeApiProfileId = null;

  const modal = getModalController();
  const customSelects = initCustomSelects(
    [elements.nativeLanguage, elements.targetLanguage, elements.pronunciationProvider, elements.youdaoPronunciationType],
    { onOpen: () => modal.close() }
  );

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
    // 从 sync 获取配置，从 local 获取词汇列表
    storage.remote.get(null, (syncResult) => {
      apiProfiles = sanitizeApiProfiles(syncResult.apiProfiles);
      activeApiProfileId = typeof syncResult.activeApiProfileId === 'string'
        ? syncResult.activeApiProfileId
        : null;
      if (!apiProfiles.some(profile => profile.id === activeApiProfileId)) {
        activeApiProfileId = null;
      }

      const activeProfile = activeApiProfileId
        ? apiProfiles.find(profile => profile.id === activeApiProfileId)
        : null;

      // API 配置
      elements.apiEndpoint.value = activeProfile?.apiEndpoint || syncResult.apiEndpoint || API_PRESETS.deepseek.endpoint;
      elements.apiKey.value = activeProfile?.apiKey || syncResult.apiKey || '';
      elements.modelName.value = activeProfile?.modelName || syncResult.modelName || API_PRESETS.deepseek.model;
      renderApiProfiles();

      // 学习偏好
      elements.nativeLanguage.value = syncResult.nativeLanguage || 'zh-CN';
      elements.targetLanguage.value = syncResult.targetLanguage || 'en';

      const diffIdx = CEFR_LEVELS.indexOf(syncResult.difficultyLevel || 'B1');
      elements.difficultyLevel.value = diffIdx >= 0 ? diffIdx : 2;
      updateDifficultyLabel();

      const intensity = syncResult.intensity || 'medium';
      elements.intensityRadios.forEach(radio => {
        radio.checked = radio.value === intensity;
      });

      // 行为设置
      elements.autoProcess.checked = syncResult.autoProcess ?? false;
      elements.showPhonetic.checked = syncResult.showPhonetic ?? true;
      elements.allowLeftClickPronunciation.checked = syncResult.allowLeftClickPronunciation ?? true;
      elements.restoreAllSameWordsOnLearned.checked = syncResult.restoreAllSameWordsOnLearned ?? true;
      elements.pronunciationProvider.value = syncResult.pronunciationProvider || 'wiktionary';
      elements.youdaoPronunciationType.value = String(syncResult.youdaoPronunciationType ?? 2);
      updatePronunciationSettingsVisibility();
      customSelects.syncAll();

      const translationStyle = syncResult.translationStyle || 'original-translation';
      elements.translationStyleRadios.forEach(radio => {
        radio.checked = radio.value === translationStyle;
      });

      // 主题设置
      const theme = { ...DEFAULT_THEME, ...(syncResult.theme || {}) };
      setThemeInputs(theme);
      applyThemeVariables(theme, DEFAULT_THEME);

      // 站点规则
      elements.blacklistInput.value = (syncResult.blacklist || []).join('\n');
      elements.whitelistInput.value = (syncResult.whitelist || []).join('\n');

      // 高级设置
      if (elements.concurrencyLimit) elements.concurrencyLimit.value = String(normalizeConcurrencyLimit(syncResult.concurrencyLimit));
      if (elements.maxBatchSize) elements.maxBatchSize.value = String(normalizeMaxBatchSize(syncResult.maxBatchSize));
      if (elements.maxTokens) elements.maxTokens.value = String(normalizeMaxTokens(syncResult.maxTokens));
      if (elements.outputFormat) elements.outputFormat.value = syncResult.outputFormat ?? 'standard';
      if (elements.processFullPage) elements.processFullPage.checked = syncResult.processFullPage ?? false;

      // 缓存容量
      const cacheMaxSize = normalizeCacheMaxSize(syncResult.cacheMaxSize);
      lastCacheMaxSize = cacheMaxSize;
      setCacheMaxSizeUI(cacheMaxSize);

      // 从 local 获取词汇列表（避免 sync 配额限制）
      storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
        // 合并 sync 和 local 数据供后续使用
        const mergedResult = {
          ...syncResult,
          learnedWords: localResult.learnedWords || [],
          memorizeList: localResult.memorizeList || []
        };

        // 加载词汇列表
        loadWordLists(mergedResult);

        // 加载统计
        loadStats(mergedResult);

        lastSavedSettingsJson = JSON.stringify(collectSettingsFromUI());
      });
    });
  }

  function updateActiveApiProfileFromUI() {
    if (!activeApiProfileId) return;
    const idx = apiProfiles.findIndex(profile => profile.id === activeApiProfileId);
    if (idx < 0) return;

    apiProfiles[idx] = {
      ...apiProfiles[idx],
      apiEndpoint: elements.apiEndpoint.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      modelName: elements.modelName.value.trim()
    };
  }

  function setActiveApiProfileId(nextId) {
    activeApiProfileId = nextId && apiProfiles.some(profile => profile.id === nextId) ? nextId : null;
  }

  function updateApiProfileActions() {
    const hasActive = Boolean(activeApiProfileId && apiProfiles.some(profile => profile.id === activeApiProfileId));
    if (elements.renameApiProfileBtn) elements.renameApiProfileBtn.disabled = !hasActive;
    if (elements.deleteApiProfileBtn) elements.deleteApiProfileBtn.disabled = !hasActive;
  }

  function renderApiProfiles() {
    const container = elements.apiProfileButtons;
    if (!container) return;
    container.innerHTML = '';

    if (!apiProfiles.length) {
      const empty = document.createElement('span');
      empty.className = 'text-muted';
      empty.textContent = '暂无自定义配置';
      container.appendChild(empty);
      updateApiProfileActions();
      return;
    }

    apiProfiles.forEach((profile) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `preset-btn api-profile-btn${profile.id === activeApiProfileId ? ' active' : ''}`;
      btn.textContent = profile.name;
      btn.dataset.profileId = profile.id;

      btn.addEventListener('click', () => activateApiProfile(profile.id));
      btn.addEventListener('dblclick', () => renameApiProfile(profile.id));

      container.appendChild(btn);
    });

    updateApiProfileActions();
  }

  function activateApiProfile(profileId) {
    updateActiveApiProfileFromUI();

    const profile = apiProfiles.find(p => p.id === profileId);
    if (!profile) return;

    setActiveApiProfileId(profile.id);
    elements.apiEndpoint.value = profile.apiEndpoint || '';
    elements.apiKey.value = profile.apiKey || '';
    elements.modelName.value = profile.modelName || '';

    elements.presetBtns.forEach(b => b.classList.remove('active'));
    renderApiProfiles();
    debouncedSave(200);
  }

  async function addApiProfile() {
    updateActiveApiProfileFromUI();

    const suggestedName = suggestNextApiProfileName(apiProfiles);
    const rawName = await modal.prompt('新配置名称：', { title: '新增自定义配置', defaultValue: suggestedName, placeholder: suggestedName });
    if (rawName === null) return;

    const name = String(rawName).trim() || suggestedName;
    const profile = {
      id: generateApiProfileId(),
      name,
      apiEndpoint: elements.apiEndpoint.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      modelName: elements.modelName.value.trim()
    };

    apiProfiles = [...apiProfiles, profile];
    setActiveApiProfileId(profile.id);
    renderApiProfiles();
    debouncedSave(0);
    showOptionsToast('已新增自定义配置', { type: 'success', durationMs: 1600 });
  }

  async function renameApiProfile(profileId = activeApiProfileId) {
    const profile = apiProfiles.find(p => p.id === profileId);
    if (!profile) return;

    const rawName = await modal.prompt('重命名配置：', { title: '重命名', defaultValue: profile.name, placeholder: profile.name });
    if (rawName === null) return;

    const nextName = String(rawName).trim();
    if (!nextName) return;

    apiProfiles = apiProfiles.map(p => (p.id === profile.id ? { ...p, name: nextName } : p));
    renderApiProfiles();
    debouncedSave(0);
    showOptionsToast('已重命名', { type: 'success', durationMs: 1400 });
  }

  async function deleteApiProfile(profileId = activeApiProfileId) {
    const profile = apiProfiles.find(p => p.id === profileId);
    if (!profile) return;

    const ok = await modal.confirm(`确定删除「${profile.name}」吗？`, { title: '删除配置', confirmText: '删除', danger: true });
    if (!ok) return;

    apiProfiles = apiProfiles.filter(p => p.id !== profileId);
    if (activeApiProfileId === profileId) {
      activeApiProfileId = apiProfiles[0]?.id || null;
    }

    if (activeApiProfileId) {
      const nextActive = apiProfiles.find(p => p.id === activeApiProfileId);
      if (nextActive) {
        elements.apiEndpoint.value = nextActive.apiEndpoint || '';
        elements.apiKey.value = nextActive.apiKey || '';
        elements.modelName.value = nextActive.modelName || '';
      }
    }

    elements.presetBtns.forEach(b => b.classList.remove('active'));
    renderApiProfiles();
    debouncedSave(0);
    showOptionsToast('已删除', { type: 'success', durationMs: 1400 });
  }

  function updatePronunciationSettingsVisibility() {
    const provider = elements.pronunciationProvider?.value || 'wiktionary';
    const targetLanguage = elements.targetLanguage?.value || 'en';
    const useYoudao = provider === 'youdao' && targetLanguage === 'en';

    if (elements.youdaoPronunciationSettings) elements.youdaoPronunciationSettings.hidden = !useYoudao;
    if (elements.youdaoPronunciationType) elements.youdaoPronunciationType.disabled = !useYoudao;
    customSelects.sync(elements.youdaoPronunciationType);
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
	      word: w.translation || '',
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
	    storage.local.get('Sapling_word_cache', (data) => {
	      const cache = data.Sapling_word_cache || [];
	      lastKnownCacheSize = Array.isArray(cache) ? cache.length : 0;
	      elements.cachedTabCount.textContent = cache.length;

	      const nativeLanguage = elements.nativeLanguage?.value || result.nativeLanguage || 'zh-CN';
	      const memorizeTranslationIndex = new Map();
	      if (Array.isArray(cache)) {
	        for (const item of cache) {
	          const key = typeof item?.key === 'string' ? item.key : '';
	          const [rawWord, , targetLang] = key.split(':');
	          const translation = typeof item?.translation === 'string' ? item.translation : '';
	          if (!rawWord || !targetLang || !translation) continue;

	          const wordLower = rawWord.toLowerCase();
	          const timestamp = Number(item?.timestamp) || 0;
	          const prefersNative = targetLang === nativeLanguage;

	          const existing = memorizeTranslationIndex.get(wordLower);
	          if (!existing) {
	            memorizeTranslationIndex.set(wordLower, { translation, timestamp, prefersNative });
	            continue;
	          }

	          if (prefersNative && !existing.prefersNative) {
	            memorizeTranslationIndex.set(wordLower, { translation, timestamp, prefersNative });
	            continue;
	          }

	          if (prefersNative === existing.prefersNative && timestamp > existing.timestamp) {
	            memorizeTranslationIndex.set(wordLower, { translation, timestamp, prefersNative });
	          }
	        }
	      }
	      
	      const cacheWords = cache.map(item => {
	        const [word] = item.key.split(':');
	        return { 
	          key: item.key,
	          original: word, 
	          word: item.translation, 
	          addedAt: item.timestamp,
	          difficulty: item.difficulty || 'B1',
	          phonetic: item.phonetic || ''
	        };
	      });
	      
	      // 保存原始数据
	      allCachedWords = cacheWords;

	      // 用缓存为「需记忆」补全翻译（如果本地条目没有 translation 字段）
	      allMemorizeWords = allMemorizeWords.map((w) => {
	        if (w.word) return w;
	        const hit = memorizeTranslationIndex.get(String(w.original || '').trim().toLowerCase());
	        if (!hit?.translation) return w;
	        return { ...w, word: hit.translation };
	      });
	      filterMemorizeWords();
	      
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
	        ${w.word || type === 'memorize'
	          ? `<span class="word-translation${type === 'memorize' ? ' memorize-translation memorize-translation--masked' : ''}" data-type="${type}" title="${type === 'memorize' ? '悬停/点击显示翻译' : ''}">${w.word || '（暂无翻译）'}</span>`
	          : ''}
	        ${w.difficulty ? `<span class="word-difficulty difficulty-${w.difficulty.toLowerCase()}">${w.difficulty}</span>` : ''}
	        <span class="word-date">${formatDate(w.addedAt)}</span>
	        ${type === 'memorize' ? `<button type="button" class="word-mark-learned" data-word="${w.original}" title="标记为已学会" aria-label="标记为已学会">✓</button>` : ''}
	        ${type === 'learned' ? `<button type="button" class="word-mark-memorize" data-word="${w.original}" title="移到需记忆" aria-label="移到需记忆">M</button>` : ''}
	        ${type === 'cached'
	          ? `<button type="button" class="word-remove" data-type="cached" data-key="${w.key || ''}" title="删除缓存" aria-label="删除缓存">&times;</button>`
	          : `<button type="button" class="word-remove" data-word="${w.original}" data-type="${type}" title="删除" aria-label="删除">&times;</button>`}
	      </div>
	    `).join('');

	    container.querySelectorAll('.word-mark-learned').forEach(btn => {
	      btn.addEventListener('click', () => markMemorizeWordAsLearned(btn.dataset.word));
	    });

	    container.querySelectorAll('.word-mark-memorize').forEach(btn => {
	      btn.addEventListener('click', () => markLearnedWordAsMemorize(btn.dataset.word));
	    });

	    container.querySelectorAll('.word-remove').forEach(btn => {
	      btn.addEventListener('click', () => {
	        const type = btn.dataset.type;
	        if (type === 'cached') {
	          removeCachedEntry(btn.dataset.key);
	          return;
	        }
	        removeWord(btn.dataset.word, type);
	      });
	    });

	    if (type === 'memorize') {
	      container.querySelectorAll('.memorize-translation').forEach((span) => {
	        span.addEventListener('click', (e) => {
	          if (e.button !== 0) return;
	          e.preventDefault();
	          e.stopPropagation();

	          if (span.classList.contains('memorize-translation--revealed')) return;
	          span.classList.remove('memorize-translation--masked');
	          span.classList.add('memorize-translation--revealed');
	        });
	      });
	    }
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

	  // 删除词汇（使用 local 存储）
	  async function removeWord(word, type) {
	    if (type === 'learned') {
	      storage.local.get('learnedWords', (result) => {
	        const list = (result.learnedWords || []).filter(w => w.original !== word);
	        storage.local.set({ learnedWords: list }, loadSettings);
	      });
	    } else if (type === 'memorize') {
	      storage.local.get('memorizeList', (result) => {
	        const list = (result.memorizeList || []).filter(w => w.word !== word);
	        storage.local.set({ memorizeList: list }, loadSettings);
	      });
	    }
	  }

	  function removeCachedEntry(cacheKey) {
	    if (!cacheKey) return;
	    storage.local.get('Sapling_word_cache', (data) => {
	      const cache = data.Sapling_word_cache || [];
	      const next = Array.isArray(cache) ? cache.filter(item => item?.key !== cacheKey) : [];
	      storage.local.set({ Sapling_word_cache: next }, () => {
	        showOptionsToast('已删除缓存', { type: 'success', durationMs: 1400 });
	        loadSettings();
	      });
	    });
	  }

	  async function markMemorizeWordAsLearned(word) {
	    if (!word) return;
	    const trimmed = word.trim();
	    if (!trimmed) return;
	    const wordLower = trimmed.toLowerCase();

	    try {
	      const result = await storage.getLocal(['learnedWords', 'memorizeList', 'Sapling_word_cache']);
	      const learnedWords = Array.isArray(result.learnedWords) ? result.learnedWords : [];
	      const memorizeList = Array.isArray(result.memorizeList) ? result.memorizeList : [];
	      const cache = Array.isArray(result.Sapling_word_cache) ? result.Sapling_word_cache : [];

	      const memorizeItem = memorizeList.find(w => (w?.word || '').toLowerCase() === wordLower);
	      const nextMemorize = memorizeList.filter(w => (w?.word || '').toLowerCase() !== wordLower);

	      const cachedMatch = cache
	        .filter(item => typeof item?.key === 'string' && item.key.startsWith(`${wordLower}:`))
	        .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0))[0];

	      const difficulty = memorizeItem?.difficulty || cachedMatch?.difficulty || 'B1';
	      const translation = memorizeItem?.translation || cachedMatch?.translation || '';

	      const alreadyLearned = learnedWords.some(w => (w?.original || '').toLowerCase() === wordLower);
	      const nextLearned = alreadyLearned ? learnedWords : learnedWords.concat([{
	        original: trimmed,
	        word: translation,
	        addedAt: Date.now(),
	        difficulty
	      }]);

	      await storage.setLocal({ learnedWords: nextLearned, memorizeList: nextMemorize });

	      // 立即更新 UI，避免依赖异步 reload 的时序
	      allMemorizeWords = allMemorizeWords.filter(w => (w?.original || '').toLowerCase() !== wordLower);
	      if (!alreadyLearned) {
	        allLearnedWords = allLearnedWords.concat([{
	          original: trimmed,
	          word: translation,
	          addedAt: Date.now(),
	          difficulty
	        }]);
	      }
	      filterMemorizeWords();
	      filterLearnedWords();

	      showOptionsToast(alreadyLearned ? '已从需记忆移除' : '已标记为已学会', { type: 'success', durationMs: 1400 });
	      loadSettings();
	    } catch (error) {
	      console.error('[Sapling] Failed to move memorize word to learned:', error);
	      showOptionsToast(`操作失败：${error?.message || String(error)}`, { type: 'error', durationMs: 2600 });
	    }
	  }

	  async function markLearnedWordAsMemorize(word) {
	    if (!word) return;
	    const trimmed = word.trim();
	    if (!trimmed) return;
	    const wordLower = trimmed.toLowerCase();

	    try {
	      const result = await storage.getLocal(['learnedWords', 'memorizeList']);
	      const learnedWords = Array.isArray(result.learnedWords) ? result.learnedWords : [];
	      const memorizeList = Array.isArray(result.memorizeList) ? result.memorizeList : [];

	      const learnedItem = learnedWords.find(w => (w?.original || '').toLowerCase() === wordLower);
	      const nextLearned = learnedWords.filter(w => (w?.original || '').toLowerCase() !== wordLower);

	      const alreadyInMemorize = memorizeList.some(w => (w?.word || '').toLowerCase() === wordLower);
	      const nextMemorize = alreadyInMemorize ? memorizeList : memorizeList.concat([{
	        word: trimmed,
	        addedAt: Date.now(),
	        difficulty: learnedItem?.difficulty || 'B1',
	        translation: learnedItem?.word || ''
	      }]);

	      await storage.setLocal({ learnedWords: nextLearned, memorizeList: nextMemorize });

	      allLearnedWords = allLearnedWords.filter(w => (w?.original || '').toLowerCase() !== wordLower);
	      if (!alreadyInMemorize) {
	        allMemorizeWords = allMemorizeWords.concat([{
	          original: trimmed,
	          word: learnedItem?.word || '',
	          addedAt: Date.now(),
	          difficulty: learnedItem?.difficulty || 'B1'
	        }]);
	      }
	      filterLearnedWords();
	      filterMemorizeWords();

	      showOptionsToast(alreadyInMemorize ? '已在需记忆（已从已学会移除）' : '已移到需记忆', { type: 'success', durationMs: 1400 });
	      loadSettings();
	    } catch (error) {
	      console.error('[Sapling] Failed to move learned word to memorize:', error);
	      showOptionsToast(`操作失败：${error?.message || String(error)}`, { type: 'error', durationMs: 2600 });
	    }
	  }

	  async function trimLocalCacheToMaxSize(maxSize) {
	    const normalized = normalizeCacheMaxSize(maxSize);
	    return new Promise((resolve) => {
	      storage.local.get('Sapling_word_cache', (data) => {
	        const cache = data.Sapling_word_cache || [];
	        if (!Array.isArray(cache) || cache.length <= normalized) return resolve(false);
	        const trimmed = cache.slice(-normalized);
	        storage.local.set({ Sapling_word_cache: trimmed }, () => resolve(true));
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

    storage.local.get('Sapling_word_cache', (data) => {
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

    const normalizedMaxTokens = normalizeMaxTokens(elements.maxTokens?.value);
    if (elements.maxTokens) elements.maxTokens.value = String(normalizedMaxTokens);

    updateActiveApiProfileFromUI();

    return {
      apiEndpoint: elements.apiEndpoint.value.trim(),
      apiKey: elements.apiKey.value.trim(),
      modelName: elements.modelName.value.trim(),
      apiProfiles,
      activeApiProfileId,
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
      maxTokens: normalizedMaxTokens,
      outputFormat: elements.outputFormat?.value ?? 'standard',
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
      await storage.remote.setAsync(settings);
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
      elements.maxBatchSize,
      elements.maxTokens
    ].filter(Boolean);

    numberInputs.forEach(input => {
      input.addEventListener('blur', () => debouncedSave(200));
      input.addEventListener('change', () => debouncedSave(200));
      input.addEventListener('input', () => debouncedSave(200));
    });

    // 下拉选择框 - 改变时保存
    if (elements.outputFormat) {
      elements.outputFormat.addEventListener('change', () => debouncedSave(200));
    }

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

    if (elements.addApiProfileBtn) {
      elements.addApiProfileBtn.addEventListener('click', () => addApiProfile());
    }
    if (elements.renameApiProfileBtn) {
      elements.renameApiProfileBtn.addEventListener('click', () => renameApiProfile());
    }
    if (elements.deleteApiProfileBtn) {
      elements.deleteApiProfileBtn.addEventListener('click', () => deleteApiProfile());
    }

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
        storage.remote.set({ vocabTestCompleted: false }, () => {
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
    elements.clearLearnedBtn.addEventListener('click', async () => {
      const ok = await modal.confirm('确定要清空所有已学会词汇吗？', { title: '清空已学会词汇', confirmText: '清空', danger: true });
      if (!ok) return;
      chrome.runtime.sendMessage({ action: 'clearLearnedWords' }, () => {
        loadSettings();
        debouncedSave(200);
      });
    });

    elements.clearMemorizeBtn.addEventListener('click', async () => {
      const ok = await modal.confirm('确定要清空需记忆列表吗？', { title: '清空需记忆列表', confirmText: '清空', danger: true });
      if (!ok) return;
      chrome.runtime.sendMessage({ action: 'clearMemorizeList' }, () => {
        loadSettings();
        debouncedSave(200);
      });
    });

    elements.clearCacheBtn.addEventListener('click', async () => {
      const ok = await modal.confirm('确定要清空词汇缓存吗？', { title: '清空缓存', confirmText: '清空', danger: true });
      if (!ok) return;
      chrome.runtime.sendMessage({ action: 'clearCache' }, () => {
        loadSettings();
        debouncedSave(200);
      });
    });

    // 统计重置
    elements.resetTodayBtn.addEventListener('click', () => {
      storage.remote.set({ todayWords: 0 }, () => {
        loadSettings();
        debouncedSave(200);
      });
    });

    elements.resetAllBtn.addEventListener('click', async () => {
      const ok = await modal.confirm('确定要重置所有数据吗？这将清空所有统计和词汇列表。', { title: '重置所有数据', confirmText: '重置', danger: true });
      if (!ok) return;
      storage.remote.set({
        totalWords: 0,
        todayWords: 0,
        cacheHits: 0,
        cacheMisses: 0,
        learnedWords: [],
        memorizeList: []
      }, () => {});
      storage.local.remove('Sapling_word_cache', () => {
        loadSettings();
        debouncedSave(200);
      });
    });

    // 添加自动保存事件监听器
    addAutoSaveListeners();
  }

  // 初始化
  bindEvents();
  loadSettings();
});
