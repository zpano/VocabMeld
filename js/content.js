import { CEFR_LEVELS, INTENSITY_CONFIG, SKIP_TAGS, SKIP_CLASSES } from './config/constants.js';
import { CACHE_CONFIG, DEFAULT_THEME, normalizeCacheMaxSize, normalizeConcurrencyLimit, normalizeMaxBatchSize } from './core/config.js';
import { storage } from './core/storage/StorageService.js';
import { initLanguageDetector, detectLanguage } from './utils/language-detector.js';
import { isDifficultyCompatible, isCodeText, isNonLearningWord } from './utils/word-filters.js';
import { isInAllowedContentEditableRegion } from './utils/dom-utils.js';
import { applyThemeVariables } from './utils/color-utils.js';
import { TooltipManager } from './ui/tooltip.js';
import { showToast } from './ui/toast.js';
import { apiService } from './services/api-service.js';
import { contentSegmenter } from './services/content-segmenter.js';
import { textReplacer } from './services/text-replacer.js';

// ============ 状态管理 ============
let config = null;
let isProcessing = false;
let isPageActivated = false;  // 跟踪页面是否已被激活处理（手动或自动）
const WORD_CACHE_STORAGE_KEY = 'Sapling_word_cache';
let wordCache = new Map();
const tooltipManager = new TooltipManager();
let processingGeneration = 0;
let restoreGeneration = 0;  // 仅在 restoreAll() 时递增，用于区分「还原」和「滚动」

// ============ 语言队列批量处理 ============
const DEFAULT_LANG_BATCH_SIZE = 3;  // 默认批量大小
const LANG_DEBOUNCE_DELAY = 2000;   // 2秒 debounce

// 全局语言队列 Map<langKey, { segments: [], timer: null }>
const langBatchQueue = new Map();

// 队列处理函数引用（在 processPage 中设置）
let queueProcessBatchFn = null;
let queueWhitelistWords = null;
let queueRunGeneration = 0;

function normalizeDomainEntry(entry) {
  if (!entry) return '';
  const trimmed = String(entry).trim().toLowerCase();
  if (!trimmed) return '';
  // 尝试用 URL 解析（支持用户粘贴完整链接）
  try {
    const url = new URL(trimmed);
    return url.hostname;
  } catch (_) {}
  // 去掉常见前缀
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function normalizeBlacklist(list) {
  const items = Array.isArray(list) ? list : [];
  return items
    .map(normalizeDomainEntry)
    .filter(Boolean);
}

function isHostnameBlacklisted(hostname, blacklistList) {
  const normalizedHost = String(hostname || '').toLowerCase();
  const normalizedList = normalizeBlacklist(blacklistList);
  return normalizedList.some(domain => normalizedHost === domain || normalizedHost.endsWith('.' + domain));
}

// ============ 配置加载 ============

async function loadConfig() {
  return new Promise((resolve) => {
    const applyConfig = (result = {}) => {
      console.log('[Sapling] Applying config:', result);
      const safeResult = result || {};
      const apiProfiles = Array.isArray(safeResult.apiProfiles) ? safeResult.apiProfiles : [];
      const activeApiProfileId = typeof safeResult.activeApiProfileId === 'string'
        ? safeResult.activeApiProfileId
        : null;
      const activeApiProfile = activeApiProfileId
        ? apiProfiles.find(profile => profile?.id === activeApiProfileId)
        : null;

      config = {
        apiEndpoint: activeApiProfile?.apiEndpoint || safeResult.apiEndpoint || 'https://api.deepseek.com/chat/completions',
        apiKey: activeApiProfile?.apiKey || safeResult.apiKey || '',
        modelName: activeApiProfile?.modelName || safeResult.modelName || 'deepseek-chat',
        nativeLanguage: safeResult.nativeLanguage || 'zh-CN',
        targetLanguage: safeResult.targetLanguage || 'en',
        difficultyLevel: safeResult.difficultyLevel || 'B1',
        intensity: safeResult.intensity || 'medium',
        autoProcess: safeResult.autoProcess ?? false,
        showPhonetic: safeResult.showPhonetic ?? true,
        allowLeftClickPronunciation: safeResult.allowLeftClickPronunciation ?? true,
        restoreAllSameWordsOnLearned: safeResult.restoreAllSameWordsOnLearned ?? true,
        pronunciationProvider: safeResult.pronunciationProvider || 'wiktionary',
        youdaoPronunciationType: Number(safeResult.youdaoPronunciationType) === 1 ? 1 : 2,
        translationStyle: safeResult.translationStyle || 'original-translation',
        cacheMaxSize: normalizeCacheMaxSize(safeResult.cacheMaxSize, CACHE_CONFIG.maxSize),
        concurrencyLimit: normalizeConcurrencyLimit(safeResult.concurrencyLimit),
        maxBatchSize: normalizeMaxBatchSize(safeResult.maxBatchSize),
        theme: { ...DEFAULT_THEME, ...(safeResult.theme || {}) },
        enabled: safeResult.enabled ?? true,
        blacklist: safeResult.blacklist || [],
        blacklistNormalized: normalizeBlacklist(safeResult.blacklist),
        whitelist: safeResult.whitelist || [],
        learnedWords: safeResult.learnedWords || [],
        memorizeList: safeResult.memorizeList || [],
        processFullPage: safeResult.processFullPage ?? false
      };

      // 测试模式：URL 参数 ?sapling-mock=1 时自动切换到本地 Mock 服务器
      if (window.location.search.includes('sapling-mock=1')) {
        config.apiEndpoint = 'http://localhost:3000/chat/completions';
        console.log('[Sapling] 测试模式: API 端点已切换到', config.apiEndpoint);
      }

      applyThemeVariables(config.theme, DEFAULT_THEME, true); // contentScriptMode = true，避免污染网页
      tooltipManager.setConfig(config);
      textReplacer.setConfig(config);
      resolve(config);
    };

    if (!globalThis.chrome?.storage?.sync?.get) {
      applyConfig({});
      return;
    }

    try {
      // 从 sync 获取配置
      storage.remote.get(null, (syncResult) => {
        const syncError = chrome?.runtime?.lastError;
        if (syncError) {
          if (!isContextInvalidated(syncError)) {
            console.warn('[Sapling] Config read failed:', syncError);
          }
          return applyConfig(config || {});
        }

        // 从 local 获取词汇列表（避免 sync 配额限制）
        storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
          const localError = chrome?.runtime?.lastError;
          if (localError && !isContextInvalidated(localError)) {
            console.warn('[Sapling] Local storage read failed:', localError);
          }

          // 合并配置和词汇列表
          const mergedResult = {
            ...syncResult,
            learnedWords: localResult?.learnedWords || [],
            memorizeList: localResult?.memorizeList || []
          };
          applyConfig(mergedResult);
        });
      });
    } catch (error) {
      if (!isContextInvalidated(error)) {
        console.warn('[Sapling] Config read threw:', error);
      }
      applyConfig(config || {});
    }
  });
}

async function loadWordCache() {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local?.get) {
      return resolve(wordCache);
    }

    try {
      storage.local.get(WORD_CACHE_STORAGE_KEY, (result) => {
        const lastError = chrome?.runtime?.lastError;
        if (lastError) {
          if (!isContextInvalidated(lastError)) {
            console.warn('[Sapling] Cache read failed:', lastError);
            console.warn('[Sapling] Cache read failed:', lastError);
          }
          return resolve(wordCache);
        }

        const cached = result?.[WORD_CACHE_STORAGE_KEY];
        if (cached && Array.isArray(cached)) {
          cached.forEach(item => {
            wordCache.set(item.key, {
              translation: item.translation,
              phonetic: item.phonetic,
              difficulty: item.difficulty,
              partOfSpeech: item.partOfSpeech || '',
              shortDefinition: item.shortDefinition || '',
              example: item.example || ''
            });
          });
        }
        resolve(wordCache);
      });
    } catch (error) {
      if (!isContextInvalidated(error)) {
        console.warn('[Sapling] Cache read threw:', error);
        console.warn('[Sapling] Cache read threw:', error);
      }
      resolve(wordCache);
    }
  });
}

async function saveWordCache() {
  const data = [];
  for (const [key, value] of wordCache) {
    data.push({ key, ...value });
  }
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.storage?.local?.set) return resolve();

    try {
      storage.local.set({ [WORD_CACHE_STORAGE_KEY]: data }, () => {
        const lastError = chrome?.runtime?.lastError;
        if (lastError) {
          if (isContextInvalidated(lastError)) {
            return resolve();
          }
          console.error('[Sapling] Failed to save cache:', lastError);
          console.error('[Sapling] Failed to save cache:', lastError);
          return reject(lastError);
        }
        resolve();
      });
    } catch (error) {
      if (isContextInvalidated(error)) {
        return resolve();
      }
      console.error('[Sapling] Failed to save cache (threw):', error);
      console.error('[Sapling] Failed to save cache (threw):', error);
      reject(error);
    }
  });
}

// Debounced cache persistence: avoid writing the full cache for every paragraph/API response.
let wordCacheSaveRequested = false;
let wordCacheSaveTimer = null;
let wordCacheSaveInFlight = Promise.resolve();
let wordCacheClearInFlight = null;

function removeWordCacheFromStorage() {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local?.remove) return resolve();
    try {
      storage.local.remove(WORD_CACHE_STORAGE_KEY, () => resolve());
    } catch (error) {
      if (!isContextInvalidated(error)) {
        console.warn('[Sapling] Cache remove threw:', error);
        console.warn('[Sapling] Cache remove threw:', error);
      }
      resolve();
    }
  });
}

async function clearWordCache({ removeStorage = true } = {}) {
  if (wordCacheClearInFlight) return wordCacheClearInFlight;

  wordCacheClearInFlight = (async () => {
    wordCacheSaveRequested = false;
    if (wordCacheSaveTimer) {
      clearTimeout(wordCacheSaveTimer);
      wordCacheSaveTimer = null;
    }

    const pending = wordCacheSaveInFlight.catch(() => {});
    wordCache.clear();
    await pending;

    if (removeStorage) {
      await removeWordCacheFromStorage();
    }
  })().finally(() => {
    wordCacheClearInFlight = null;
  });

  return wordCacheClearInFlight;
}

async function runWordCacheSaveLoop() {
  while (wordCacheSaveRequested) {
    wordCacheSaveRequested = false;
    wordCacheSaveInFlight = wordCacheSaveInFlight
      .catch(() => {})
      .then(() => saveWordCache());
    await wordCacheSaveInFlight;
  }
}

function scheduleWordCacheSave(delay = 800) {
  wordCacheSaveRequested = true;
  if (wordCacheSaveTimer) return;

  wordCacheSaveTimer = setTimeout(() => {
    wordCacheSaveTimer = null;
    void runWordCacheSaveLoop();
  }, delay);
}

async function flushWordCacheSave() {
  wordCacheSaveRequested = true;
  if (wordCacheSaveTimer) {
    clearTimeout(wordCacheSaveTimer);
    wordCacheSaveTimer = null;
  }
  await runWordCacheSaveLoop();
}

function isContextInvalidated(error) {
  const message = (error && error.message) || String(error || '');
  return message.includes('Extension context invalidated');
}

async function updateStats(stats) {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.sync?.get || !globalThis.chrome?.storage?.sync?.set) {
      return resolve(null);
    }

    try {
      storage.remote.get(['totalWords', 'todayWords', 'lastResetDate', 'cacheHits', 'cacheMisses'], (current) => {
        const readError = chrome?.runtime?.lastError;
        if (readError) {
          if (!isContextInvalidated(readError)) {
            console.warn('[Sapling] Stats read failed:', readError);
            console.warn('[Sapling] Stats read failed:', readError);
          }
          return resolve(null);
        }

        const today = new Date().toISOString().split('T')[0];
        if (current.lastResetDate !== today) {
          current.todayWords = 0;
          current.lastResetDate = today;
        }
        const updated = {
          totalWords: (current.totalWords || 0) + (stats.newWords || 0),
          todayWords: (current.todayWords || 0) + (stats.newWords || 0),
          lastResetDate: today,
          cacheHits: (current.cacheHits || 0) + (stats.cacheHits || 0),
          cacheMisses: (current.cacheMisses || 0) + (stats.cacheMisses || 0)
        };

        try {
          storage.remote.set(updated, () => {
            const writeError = chrome?.runtime?.lastError;
            if (writeError) {
              if (!isContextInvalidated(writeError)) {
                console.warn('[Sapling] Stats write failed:', writeError);
                console.warn('[Sapling] Stats write failed:', writeError);
              }
              return resolve(null);
            }
            resolve(updated);
          });
        } catch (error) {
          if (!isContextInvalidated(error)) {
            console.warn('[Sapling] Stats write threw:', error);
            console.warn('[Sapling] Stats write threw:', error);
          }
          resolve(null);
        }
      });
    } catch (error) {
      if (!isContextInvalidated(error)) {
        console.warn('[Sapling] Stats read threw:', error);
        console.warn('[Sapling] Stats read threw:', error);
      }
      resolve(null);
    }
  });
}

async function addToWhitelist(original, translation, difficulty) {
  const whitelist = config.learnedWords || [];
  const exists = whitelist.some(w => w.original === original || w.word === translation);
  if (!exists) {
    whitelist.push({
      original,
      word: translation,
      addedAt: Date.now(),
      difficulty: difficulty || 'B1'
    });
    config.learnedWords = whitelist;
    await new Promise((resolve) => {
      // 使用 local 存储避免 sync 配额限制
      if (!globalThis.chrome?.storage?.local?.set) return resolve();
      try {
        storage.local.set({ learnedWords: whitelist }, () => resolve());
      } catch (error) {
        if (!isContextInvalidated(error)) {
          console.warn('[Sapling] Whitelist save threw:', error);
        }
        resolve();
      }
    });
  }
}

async function addToMemorizeList(word) {
  if (!word || !word.trim()) {
    console.warn('[Sapling] Invalid word for memorize list:', word);
    return;
  }

  const trimmedWord = word.trim();
  const list = config.memorizeList || [];
  const exists = list.some(w => w.word === trimmedWord);

  if (!exists) {
    list.push({ word: trimmedWord, addedAt: Date.now() });
    config.memorizeList = list;
    await new Promise((resolve) => {
      // 使用 local 存储避免 sync 配额限制
      if (!globalThis.chrome?.storage?.local?.set) return resolve();
      try {
        storage.local.set({ memorizeList: list }, () => resolve());
      } catch (error) {
        if (!isContextInvalidated(error)) {
          console.warn('[Sapling] Memorize list save threw:', error);
        }
        resolve();
      }
    });

    if (!config) {
      await loadConfig();
    }

    if (!config.enabled) {
      showToast(`Sapling: "${trimmedWord}" 已添加到记忆列表`);
      return;
    }

    try {
      const count = await processSpecificWords([trimmedWord]);

      if (count > 0) {
        showToast(`Sapling: "${trimmedWord}" 已添加到记忆列表并翻译`);
      } else {
        try {
          await translateSpecificWords([trimmedWord]);
          showToast(`Sapling: "${trimmedWord}" 已添加到记忆列表`);
        } catch (error) {
          console.error('[Sapling] Error translating word:', trimmedWord, error);
          console.error('[Sapling] Error translating word:', trimmedWord, error);
          
          // 如果是 API 相关错误，显示详细的错误信息
          const isApiError = ['API_NOT_CONFIGURED', 'API_REQUEST_FAILED', 'NETWORK_ERROR', 
                             'INVALID_API_KEY', 'FORBIDDEN', 'RATE_LIMIT', 'SERVER_ERROR'].includes(error.code);
          
          if (isApiError) {
            showToast(`Sapling: ${error.message}`, { type: 'error', duration: 3000 });
          } else {
            showToast(`Sapling: "${trimmedWord}" 已添加到记忆列表（翻译失败）`);
          }
        }
      }
    } catch (error) {
      console.error('[Sapling] Error processing word:', trimmedWord, error);
      console.error('[Sapling] Error processing word:', trimmedWord, error);
      
      // 如果是 API 相关错误，显示详细的错误信息
      const isApiError = ['API_NOT_CONFIGURED', 'API_REQUEST_FAILED', 'NETWORK_ERROR', 
                         'INVALID_API_KEY', 'FORBIDDEN', 'RATE_LIMIT', 'SERVER_ERROR'].includes(error.code);
      
      if (isApiError) {
        showToast(`Sapling: ${error.message}`, { type: 'error', duration: 3000 });
      } else {
        showToast(`Sapling: "${trimmedWord}" 添加失败`);
      }
    }
  } else {
    showToast(`Sapling: "${trimmedWord}" 已在记忆列表中`);
  }
}

// ============ DOM 处理（使用 content-segmenter 服务） ============

function getPageSegments(viewportOnly = false) {
  // margin 为视口高度的 30%，确保预加载足够的后续内容
  const margin = Math.max(300, Math.round(window.innerHeight * 0.3));
  return contentSegmenter.getPageSegments(document.body, { viewportOnly, margin });
}

function getTextContent(element) {
  return contentSegmenter.getTextContent(element);
}

function getElementPath(element) {
  return contentSegmenter.getElementPath(element);
}

function generateFingerprint(text, path = '') {
  return contentSegmenter.generateFingerprint(text, path);
}

// ============ 文本替换（使用 text-replacer 服务） ============

function applyReplacements(element, replacements, options) {
  return textReplacer.applyReplacements(element, replacements, options);
}

function restoreOriginal(element) {
  return textReplacer.restoreOriginal(element);
}

function restoreAllMatchingOriginal(original) {
  const normalized = String(original || '').trim().toLowerCase();
  if (!normalized) return 0;

  let restored = 0;
  document.querySelectorAll('.Sapling-translated').forEach((el) => {
    const dataOriginal = el.getAttribute('data-original') || '';
    if (dataOriginal.trim().toLowerCase() !== normalized) return;
    restoreOriginal(el);
    restored += 1;
  });

  return restored;
}

// ============ 语言队列管理 ============

/**
 * 将段落加入语言队列
 * @returns {Promise|null} 如果触发了批量发送，返回 Promise
 */
function enqueueSegment(segment, langKey) {
  // 首先检查是否已被处理或正在处理中
  if (contentSegmenter.isProcessedOrPending(segment.fingerprint)) {
    return null;
  }

  if (!langBatchQueue.has(langKey)) {
    langBatchQueue.set(langKey, { segments: [], timer: null });
  }

  const queue = langBatchQueue.get(langKey);

  // 检查队列中是否已存在（通过 fingerprint 去重）
  if (queue.segments.some(s => s.fingerprint === segment.fingerprint)) {
    return null;
  }

  queue.segments.push(segment);

  // 清除旧的 debounce 定时器
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }

  // 检查是否达到批量阈值
  const batchSize = config?.maxBatchSize || DEFAULT_LANG_BATCH_SIZE;
  if (queue.segments.length >= batchSize) {
    return flushLangQueue(langKey);
  } else {
    // 设置 debounce 定时器
    queue.timer = setTimeout(() => {
      flushLangQueue(langKey);
    }, LANG_DEBOUNCE_DELAY);
    return null;
  }
}

/**
 * 发送指定语言队列中的所有段落
 */
async function flushLangQueue(langKey) {
  const queue = langBatchQueue.get(langKey);
  if (!queue || queue.segments.length === 0) return { count: 0, error: false };

  // 取出所有段落并清空队列
  const segments = queue.segments.splice(0);
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }

  // 检查处理函数是否存在
  if (!queueProcessBatchFn) {
    return { count: 0, error: true };
  }

  // 检查 generation
  if (queueRunGeneration !== processingGeneration) {
    return { count: 0, error: false, aborted: true };
  }

  // 调用批量处理
  const result = await queueProcessBatchFn(segments);
  return result;
}

/**
 * 发送所有语言队列（页面处理结束时调用）
 */
async function flushAllLangQueues() {
  const promises = [];
  for (const [langKey] of langBatchQueue) {
    promises.push(flushLangQueue(langKey));
  }
  return Promise.all(promises);
}

/**
 * 清空所有语言队列（页面重置时调用）
 */
function clearAllLangQueues() {
  for (const [, queue] of langBatchQueue) {
    if (queue.timer) {
      clearTimeout(queue.timer);
    }
  }
  langBatchQueue.clear();
}

function restoreAll() {
  processingGeneration++;
  restoreGeneration++;  // 标记这是一次「还原」操作
  isPageActivated = false;  // 重置激活状态
  clearAllLangQueues();  // 清空语言队列
  document.querySelectorAll('.Sapling-processing').forEach(el => {
    el.classList.remove('Sapling-processing');
  });
  textReplacer.restoreAll();
  contentSegmenter.clearProcessed();
}

// ============ 翻译逻辑（调用 api-service） ============
async function translateText(text) {
  if (wordCache.size === 0) {
    await loadWordCache();
  }

  return await apiService.translateText(text, config, wordCache, updateStats, scheduleWordCacheSave);
}

async function translateTexts(texts) {
  if (wordCache.size === 0) {
    await loadWordCache();
  }

  return await apiService.translateTexts(texts, config, wordCache, updateStats, scheduleWordCacheSave);
}

async function translateSpecificWords(targetWords) {
  if (wordCache.size === 0) {
    await loadWordCache();
  }

  return await apiService.translateSpecificWords(targetWords, config, wordCache, updateStats, scheduleWordCacheSave);
}

async function processSpecificWords(targetWords) {
  if (!config?.enabled || !targetWords?.length) {
    return 0;
  }

  const targetWordSet = new Set(targetWords.map(w => w.toLowerCase()));
  let processed = 0;

  // 检查已翻译的元素
  const alreadyTranslated = [];
  document.querySelectorAll('.Sapling-translated').forEach(el => {
    const original = el.getAttribute('data-original');
    if (original && targetWordSet.has(original.toLowerCase())) {
      alreadyTranslated.push(original.toLowerCase());
    }
  });

  // 查找包含目标单词的文本节点
  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;

      // 跳过典型 UI 区域（导航/菜单/工具栏等），避免记忆词处理污染站点 UI
      try {
        if (parent.closest?.(
          'header,nav,aside,footer,' +
          '[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"],' +
          '[role="menu"],[role="menubar"],[role="tablist"],[role="tab"],[role="toolbar"],[role="button"],' +
          'button,select,option,' +
          '.nav,.navbar,.nav-bar,.navigation,.menu,.menubar,.tabs,.tab,.tabbar,.dropdown,.filter,.breadcrumb,.pagination'
        )) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.tagName === 'LI' && parent.closest?.('nav,[role="navigation"],.nav,.navbar,.menu,.menubar,.tabs,.tabbar')) {
          return NodeFilter.FILTER_REJECT;
        }
        const cls = parent.className || '';
        if (typeof cls === 'string') {
          const lower = cls.toLowerCase();
          if (['nav', 'menu', 'tab', 'dropdown', 'filter', 'breadcrumb', 'pagination', 'toolbar', 'header'].some(sub => lower.includes(sub))) {
            return NodeFilter.FILTER_REJECT;
          }
        }
      } catch (e) {}

      if (SKIP_TAGS.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

      const classList = parent.classList;
      if (classList && SKIP_CLASSES.some(cls => cls !== 'Sapling-translated' && classList.contains(cls))) {
        return NodeFilter.FILTER_REJECT;
      }

      try {
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      } catch (e) {}

      if (parent.isContentEditable && !isInAllowedContentEditableRegion(parent)) {
        return NodeFilter.FILTER_REJECT;
      }

      const text = node.textContent.trim();
      if (text.length === 0) return NodeFilter.FILTER_REJECT;

      if (isCodeText(text)) return NodeFilter.FILTER_REJECT;

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent;
    const words = text.match(/\b[a-zA-Z]{5,}\b/g) || [];
    const chineseWords = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
    const allWords = [...words, ...chineseWords];

    const containsTarget = allWords.some(word => {
      const lowerWord = word.toLowerCase();
      return targetWordSet.has(lowerWord) && !alreadyTranslated.includes(lowerWord);
    });

    if (containsTarget) {
      textNodes.push(node);
    }
  }

  if (textNodes.length === 0) {
    return 0;
  }

  // 构造包含目标单词的文本段落
  const segments = [];
  for (const textNode of textNodes) {
    const container = textNode.parentElement;
    if (!container) continue;

    const containerText = getTextContent(container);

    let contextText = containerText;
    if (contextText.length < 30) {
      const grandParent = container.parentElement;
      if (grandParent) {
        contextText = getTextContent(grandParent);
      }
    }

    if (contextText.length >= 10) {
      const path = getElementPath(container);
      const fingerprint = generateFingerprint(contextText, path);

      const isProcessed = container.hasAttribute('data-Sapling-processed') ||
                         container.closest('[data-Sapling-processed]');

      segments.push({
        element: container,
        text: contextText,
        fingerprint: fingerprint,
        isProcessed: !!isProcessed
      });
    }
  }

  // 去重
  const uniqueSegments = segments.filter((segment, index, self) =>
    index === self.findIndex(s => s.fingerprint === segment.fingerprint)
  );

  // 获取目标单词的翻译
  let translations;
  try {
    translations = await translateSpecificWords(targetWords);
  } catch (e) {
    console.error('[Sapling] Error translating specific words:', e);
    
    // 如果是 API 相关错误，显示友好的提示
    const isApiError = ['API_NOT_CONFIGURED', 'API_REQUEST_FAILED', 'NETWORK_ERROR', 
                       'INVALID_API_KEY', 'FORBIDDEN', 'RATE_LIMIT', 'SERVER_ERROR'].includes(e.code);
    
    if (isApiError) {
      showToast(`Sapling: ${e.message}`, { type: 'error', duration: 3000 });
    }
    
    return 0;
  }

  if (translations.length === 0) {
    return 0;
  }

  // 应用到每个段落
  for (const segment of uniqueSegments) {
    const replacements = translations.map(translation => {
      const position = segment.text.toLowerCase().indexOf(translation.original.toLowerCase());
      return {
        original: translation.original,
        translation: translation.translation,
        phonetic: translation.phonetic,
        difficulty: translation.difficulty,
        partOfSpeech: translation.partOfSpeech || '',
        shortDefinition: translation.shortDefinition || '',
        position: position >= 0 ? position : 0
      };
    }).filter(r => r.position >= 0 || segment.text.toLowerCase().includes(r.original.toLowerCase()));

    if (replacements.length === 0) continue;

    const count = applyReplacements(segment.element, replacements);
    processed += count;
  }

  return processed;
}

async function processPage(viewportOnly = false) {
  if (isProcessing) return { processed: 0, skipped: true };
  if (!config?.enabled) return { processed: 0, disabled: true };

  const hostname = window.location.hostname;
  if (isHostnameBlacklisted(hostname, config.blacklistNormalized || config.blacklist)) {
    // 保险：如果进入这里且已被替换过，先还原
    restoreAll();
    return { processed: 0, blacklisted: true };
  }

  if (wordCache.size === 0) {
    await loadWordCache();
  }

  const runGeneration = ++processingGeneration;
  isProcessing = true;
  let processed = 0, errors = 0;

  try {
    // 首先处理记忆列表中的单词
    const memorizeWords = (config.memorizeList || []).map(w => w.word).filter(w => w && w.trim());
    if (memorizeWords.length > 0 && !viewportOnly) {
      try {
        const memorizeCount = await processSpecificWords(memorizeWords);
        processed += memorizeCount;
      } catch (e) {
        console.error('[Sapling] Error processing memorize list:', e);
        console.error('[Sapling] Error processing memorize list:', e);
        
        // 显示错误提示
        const isApiError = ['API_NOT_CONFIGURED', 'API_REQUEST_FAILED', 'NETWORK_ERROR', 
                           'INVALID_API_KEY', 'FORBIDDEN', 'RATE_LIMIT', 'SERVER_ERROR'].includes(e.code);
        
        if (isApiError) {
          showToast(`Sapling: ${e.message}`, { type: 'error', duration: 3000 });
        } else {
          showToast(`Sapling: 处理记忆列表时出错`, { type: 'error', duration: 3000 });
        }
        
        errors++;
      }
    }

    const segments = getPageSegments(viewportOnly);
    const whitelistWords = new Set((config.learnedWords || []).map(w => w.original.toLowerCase()));

    // 预处理：过滤有效的 segments 并检测语言
    const validSegments = [];
    for (const segment of segments) {
      let text = segment.text;
      for (const word of whitelistWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        text = text.replace(regex, '');
      }
      if (text.trim().length >= 30) {
        // 检测语言并计算 langKey
        const sourceLang = await detectLanguage(text);
        const langKey = `${sourceLang}:${config.nativeLanguage}`;
        validSegments.push({ ...segment, filteredText: text, sourceLang, langKey });
      }
    }

    // 批量处理参数
    const MAX_CONCURRENT_BATCHES = normalizeConcurrencyLimit(config.concurrencyLimit);

    // 批量处理函数
    async function processBatch(batchSegments) {
      // 捕获当前的 restoreGeneration，用于区分「还原」和「滚动」
      const runRestoreGen = restoreGeneration;

      // 标记所有段落为正在处理中
      batchSegments.forEach(seg => contentSegmenter.markPending(seg.fingerprint));

      const batchInput = batchSegments.map((segment, idx) => ({
        text: segment.filteredText,
        paragraphIndex: idx
      }));

      try {
        const batchResult = await translateTexts(batchInput);

        if (runGeneration !== processingGeneration) {
          // 处理被中止，取消 pending 状态，允许重新处理
          batchSegments.forEach(seg => {
            contentSegmenter.unmarkPending(seg.fingerprint);
            seg.element.classList.remove('Sapling-processing');
          });
          return { count: 0, error: false, aborted: true };
        }

        let totalCount = 0;

        // 处理每个段落的结果
        for (const { paragraphIndex, immediate, async: asyncPromise } of batchResult.results) {
          const segment = batchSegments[paragraphIndex];
          if (!segment) continue;

          const el = segment.element;

          // 先应用缓存结果（立即显示）
          let immediateCount = 0;
          if (immediate?.length) {
            const filtered = immediate.filter(r => !whitelistWords.has(r.original.toLowerCase()));
            immediateCount = applyReplacements(el, filtered, { scope: segment.scope });
          }

          totalCount += immediateCount;

          // 如果有异步结果，等待并更新
          if (asyncPromise) {
            // 只有在没有立即替换结果时，才显示"处理中"高亮
            if (immediateCount === 0) {
              el.classList.add('Sapling-processing');
            } else {
              el.classList.remove('Sapling-processing');
            }

            asyncPromise.then(async (asyncReplacements) => {
              try {
                // 如果元素已被移除，标记为已处理
                if (!el.isConnected) {
                  contentSegmenter.markProcessed(segment.fingerprint);
                  return;
                }

                // 如果是「还原」操作，丢弃结果并标记为已处理
                if (runRestoreGen !== restoreGeneration) {
                  contentSegmenter.markProcessed(segment.fingerprint);
                  return;
                }

                if (asyncReplacements?.length) {
                  // 获取已替换的词汇，避免重复
                  const alreadyReplaced = new Set();
                  el.querySelectorAll('.Sapling-translated').forEach(transEl => {
                    const original = transEl.getAttribute('data-original');
                    if (original) {
                      alreadyReplaced.add(original.toLowerCase());
                    }
                  });

                  const filtered = asyncReplacements.filter(r =>
                    !whitelistWords.has(r.original.toLowerCase()) &&
                    !alreadyReplaced.has(r.original.toLowerCase())
                  );

                  if (filtered.length > 0) {
                    applyReplacements(el, filtered, { scope: segment.scope });
                  }
                }

                // 处理完成：无论 generation 是否变化，工作已完成，标记为已处理
                contentSegmenter.markProcessed(segment.fingerprint);
              } finally {
                el.classList.remove('Sapling-processing');
              }
            }).catch(error => {
              // 出错时也标记为已处理，避免重复尝试
              contentSegmenter.markProcessed(segment.fingerprint);
              console.error('[Sapling] Async translation error:', error);
              el.classList.remove('Sapling-processing');

              // 显示错误提示
              const isApiError = ['API_NOT_CONFIGURED', 'API_REQUEST_FAILED', 'NETWORK_ERROR',
                                 'INVALID_API_KEY', 'FORBIDDEN', 'RATE_LIMIT', 'SERVER_ERROR'].includes(error.code);

              if (isApiError && !window.__saplingApiErrorShown) {
                window.__saplingApiErrorShown = true;
                showToast(`Sapling: ${error.message}`, { type: 'error', duration: 3000 });
                setTimeout(() => {
                  window.__saplingApiErrorShown = false;
                }, 5000);
              }
            });
          } else {
            // 没有异步结果（只有缓存或无结果），立即标记为已处理
            contentSegmenter.markProcessed(segment.fingerprint);
            el.classList.remove('Sapling-processing');
          }
        }

        return { count: totalCount, error: false };
      } catch (e) {
        console.error('[Sapling] Batch error:', e);
        // 出错时也标记所有段落为已处理，避免重复尝试
        batchSegments.forEach(seg => {
          contentSegmenter.markProcessed(seg.fingerprint);
          seg.element.classList.remove('Sapling-processing');
        });

        // 如果是 API 相关错误，显示友好的提示
        const isApiError = ['API_NOT_CONFIGURED', 'API_REQUEST_FAILED', 'NETWORK_ERROR',
                           'INVALID_API_KEY', 'FORBIDDEN', 'RATE_LIMIT', 'SERVER_ERROR'].includes(e.code);

        if (isApiError && !window.__saplingApiErrorShown) {
          window.__saplingApiErrorShown = true;
          showToast(`Sapling: ${e.message}`, { type: 'error', duration: 3000 });
          setTimeout(() => {
            window.__saplingApiErrorShown = false;
          }, 5000);
        }

        return { count: 0, error: true };
      }
    }

    // 设置队列处理函数引用
    queueProcessBatchFn = processBatch;
    queueWhitelistWords = whitelistWords;
    queueRunGeneration = runGeneration;

    // 使用语言队列批量处理
    const batchPromises = [];

    for (const segment of validSegments) {
      if (runGeneration !== processingGeneration) break;

      // 将段落加入语言队列
      const promise = enqueueSegment(segment, segment.langKey);
      if (promise) {
        batchPromises.push(promise);
      }

      // 控制并发：当累积的 Promise 达到并发上限时，等待它们完成
      if (batchPromises.length >= MAX_CONCURRENT_BATCHES) {
        const results = await Promise.all(batchPromises.splice(0));
        for (const result of results) {
          processed += result.count;
          if (result.error) errors++;
        }
      }
    }

    // 发送所有剩余队列（无论 viewportOnly 与否，都统一 flush）
    const finalResults = await flushAllLangQueues();
    for (const result of finalResults) {
      processed += result.count;
      if (result.error) errors++;
    }

    // 等待剩余的 Promise
    if (batchPromises.length > 0) {
      const results = await Promise.all(batchPromises);
      for (const result of results) {
        processed += result.count;
        if (result.error) errors++;
      }
    }

    return { processed, errors };
  } finally {
    isProcessing = false;
    clearAllLangQueues();  // 清理所有队列和定时器，防止跨调用污染
  }
}

// ============ 事件处理 ============
function setupEventListeners() {
  // 悬停显示提示
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.Sapling-translated');
    if (target) {
      tooltipManager.show(target);
    }
    if (e.target.closest('.Sapling-tooltip')) {
      tooltipManager.cancelHide();
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('.Sapling-translated');
    const relatedTarget = e.relatedTarget;

    if (target &&
        !relatedTarget?.closest('.Sapling-translated') &&
        !relatedTarget?.closest('.Sapling-tooltip')) {
      tooltipManager.hide();
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.Sapling-tooltip') &&
        !e.relatedTarget?.closest('.Sapling-tooltip') &&
        !e.relatedTarget?.closest('.Sapling-translated')) {
      tooltipManager.hide();
    }
  });

  // 处理 tooltip 按钮点击事件
  document.addEventListener('click', async (e) => {
    if (e.button !== 0) return;

    const actionBtn = e.target.closest('button[data-action]');
    const currentElement = tooltipManager.getCurrentElement();

    if (actionBtn && currentElement && actionBtn.closest('.Sapling-tooltip')) {
      e.preventDefault();
      e.stopPropagation();

      const action = actionBtn.getAttribute('data-action');
      const original = currentElement.getAttribute('data-original');
      const translation = currentElement.getAttribute('data-translation');
      const difficulty = currentElement.getAttribute('data-difficulty') || 'B1';

      switch (action) {
        case 'speak':
          await tooltipManager.playAudio(currentElement);
          break;
        case 'memorize':
          await addToMemorizeList(original);
          showToast(`Sapling: "${original}" 已添加到记忆列表`);
          break;
        case 'learned':
          await addToWhitelist(original, translation, difficulty);
          if (config?.restoreAllSameWordsOnLearned ?? true) {
            restoreAllMatchingOriginal(original);
          } else {
            restoreOriginal(currentElement);
          }
          tooltipManager.hide(true);
          showToast(`Sapling: "${original}" 已标记为已学会`);
          break;
      }

      return;
    }

    // 左键点击被替换的单词：直接发音（无需点击 tooltip 的发音按钮）
    if (config?.allowLeftClickPronunciation === false) return;
    const clickedWord = e.target.closest('.Sapling-translated');
    if (!clickedWord) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    // 避免干扰页面交互元素（链接/表单控件等）
    if (clickedWord.closest('a[href], button, input, textarea, select, label, summary')) return;

    await tooltipManager.playAudio(clickedWord);
  });

  // 滚动处理
  const handleScroll = debounce(() => {
    if (isHostnameBlacklisted(window.location.hostname, config.blacklistNormalized || config.blacklist)) return;
    // 当页面已激活（手动触发过）或开启了自动处理时，滚动继续处理
    if ((isPageActivated || config?.autoProcess) && config?.enabled) {
      const viewportOnly = !config.processFullPage;
      processPage(viewportOnly);
    }
  }, 500);
  window.addEventListener('scroll', handleScroll, { passive: true });

  // 监听配置变化
  storage.addChangeListener((changes, areaName) => {
    if (areaName === 'sync') {
      loadConfig().then(async () => {
        // 检查是否在黑名单中（动态变更）
        const hostname = window.location.hostname;
        if (isHostnameBlacklisted(hostname, config.blacklistNormalized || config.blacklist)) {
          console.log('[Sapling] Site added to blacklist, restoring original content.');
          restoreAll();
          return;
        }

        if (changes.enabled?.newValue === false) {
          restoreAll();
        }
        if (changes.difficultyLevel || changes.intensity || changes.translationStyle || changes.processFullPage) {
          restoreAll();
          if (config.enabled) {
            const viewportOnly = !config.processFullPage;
            processPage(viewportOnly);
          }
        }
        if (changes.cacheMaxSize) {
          const maxSize = normalizeCacheMaxSize(changes.cacheMaxSize.newValue, CACHE_CONFIG.maxSize);
          if (wordCache.size === 0) await loadWordCache();
          while (wordCache.size > maxSize) {
            const firstKey = wordCache.keys().next().value;
            wordCache.delete(firstKey);
          }
          await saveWordCache();
        }
        if (changes.memorizeList) {
          const oldList = changes.memorizeList.oldValue || [];
          const newList = changes.memorizeList.newValue || [];
          const oldWords = new Set(oldList.map(w => w.word.toLowerCase()));
          const newWords = newList
            .filter(w => !oldWords.has(w.word.toLowerCase()))
            .map(w => w.word);

          if (newWords.length > 0 && config.enabled) {
            setTimeout(() => {
              processSpecificWords(newWords);
            }, 200);
          }
        }
      });
    }

    // 本地缓存变化（例如：从 options 页清空缓存/重置所有数据）
    if (areaName === 'local') {
      if (wordCacheClearInFlight) return;
      const cacheChange = changes?.[WORD_CACHE_STORAGE_KEY];
      if (!cacheChange) return;

      const next = cacheChange.newValue;
      if (next == null || (Array.isArray(next) && next.length === 0)) {
        void clearWordCache({ removeStorage: true });
      }
    }
  });

  // 监听来自 popup/background 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'processPage') {
      if (isHostnameBlacklisted(window.location.hostname, config.blacklistNormalized || config.blacklist)) {
         console.log('[Sapling] Ignoring processPage request for blacklisted site');
         sendResponse({ processed: 0, blacklisted: true });
         return true;
      }
      isPageActivated = true;  // 激活页面处理，滚动时继续处理
      const viewportOnly = !config.processFullPage;
      processPage(viewportOnly).then(sendResponse);
      return true;
    }
    if (message.action === 'restorePage') {
      restoreAll();
      sendResponse({ success: true });
    }
    if (message.action === 'processSpecificWords') {
      const words = message.words || [];
      if (words.length > 0) {
        processSpecificWords(words).then(count => {
          sendResponse({ success: true, count });
        }).catch(error => {
          console.error('[Sapling] Error processing specific words:', error);
          console.error('[Sapling] Error processing specific words:', error);
          
          // 显示错误提示
          const isApiError = ['API_NOT_CONFIGURED', 'API_REQUEST_FAILED', 'NETWORK_ERROR', 
                             'INVALID_API_KEY', 'FORBIDDEN', 'RATE_LIMIT', 'SERVER_ERROR'].includes(error.code);
          
          if (isApiError) {
            showToast(`Sapling: ${error.message}`, { type: 'error', duration: 3000 });
          } else {
            showToast(`Sapling: 处理单词时出错 - ${error.message}`, { type: 'error', duration: 3000 });
          }
          
          sendResponse({ success: false, error: error.message });
        });
        return true;
      } else {
        sendResponse({ success: false, error: 'No words provided' });
      }
    }
    if (message.action === 'getStatus') {
      const hasTranslations = !!document.querySelector('.Sapling-translated');
      const hasProcessedMarkers = !!document.querySelector('[data-Sapling-processed]');
      sendResponse({
        processed: contentSegmenter.getProcessedCount(),
        hasTranslations,
        hasProcessedMarkers,
        isProcessing,
        enabled: config?.enabled
      });
    }
    if (message.action === 'clearCache' || message.action === 'resetAllData') {
      clearWordCache({ removeStorage: true })
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          console.error('[Sapling] Error clearing cache:', error);
          showToast(`Sapling: 清空缓存失败 - ${error?.message || String(error)}`, { type: 'error', duration: 3000 });
          sendResponse({ success: false, message: error?.message || String(error) });
        });
      return true;
    }
  });
}

function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ============ 初始化 ============
async function init() {
  await loadConfig();

  const hostname = window.location.hostname;
  console.log('[Sapling] Checking blacklist for:', hostname, 'Blacklist:', config.blacklist);
  if (isHostnameBlacklisted(hostname, config.blacklistNormalized || config.blacklist)) {
    // 如果之前已经被替换过，确保还原
    restoreAll();
    console.log('[Sapling] Current site is blacklisted, stopping initialization.');
    return;
  }

  await loadWordCache();
  await initLanguageDetector();

  tooltipManager.createTooltip();
  setupEventListeners();

  // Best-effort flush pending cache writes when leaving the page.
  window.addEventListener('beforeunload', () => {
    void flushWordCacheSave();
  }, { capture: true });

  if (config.autoProcess && config.enabled && config.apiKey) {
    isPageActivated = true;  // 自动处理时也激活状态
    const viewportOnly = !config.processFullPage;
    setTimeout(() => processPage(viewportOnly), 1000);
  }

  console.log('[Sapling] 初始化完成 (模块化重构版)');
}

// 启动
console.log('[Sapling] Content script loaded, readyState:', document.readyState);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Sapling] DOMContentLoaded fired, calling init()');
    init();
  });
} else {
  console.log('[Sapling] Document ready, calling init() directly');
  init();
}
