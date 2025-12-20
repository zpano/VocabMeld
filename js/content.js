import { CEFR_LEVELS, INTENSITY_CONFIG, SKIP_TAGS, SKIP_CLASSES } from './config/constants.js';
import { CACHE_CONFIG, DEFAULT_THEME, normalizeCacheMaxSize, normalizeConcurrencyLimit } from './core/config.js';
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
const WORD_CACHE_STORAGE_KEY = 'Sapling_word_cache';
let wordCache = new Map();
const tooltipManager = new TooltipManager();
let processingGeneration = 0;

// ============ 配置加载 ============
async function loadConfig() {
  return new Promise((resolve) => {
    const applyConfig = (result = {}) => {
      const safeResult = result || {};
      config = {
        apiEndpoint: safeResult.apiEndpoint || 'https://api.deepseek.com/chat/completions',
        apiKey: safeResult.apiKey || '',
        modelName: safeResult.modelName || 'deepseek-chat',
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
        theme: { ...DEFAULT_THEME, ...(safeResult.theme || {}) },
        enabled: safeResult.enabled ?? true,
        blacklist: safeResult.blacklist || [],
        whitelist: safeResult.whitelist || [],
        learnedWords: safeResult.learnedWords || [],
        memorizeList: safeResult.memorizeList || []
      };
      applyThemeVariables(config.theme, DEFAULT_THEME);
      tooltipManager.setConfig(config);
      textReplacer.setConfig(config);
      resolve(config);
    };

    if (!globalThis.chrome?.storage?.sync?.get) {
      applyConfig({});
      return;
    }

    try {
      chrome.storage.sync.get(null, (result) => {
        const lastError = chrome?.runtime?.lastError;
        if (lastError) {
          if (!isContextInvalidated(lastError)) {
            console.warn('[Sapling] Config read failed:', lastError);
          }
          return applyConfig(config || {});
        }
        applyConfig(result);
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
      chrome.storage.local.get(WORD_CACHE_STORAGE_KEY, (result) => {
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
      chrome.storage.local.set({ [WORD_CACHE_STORAGE_KEY]: data }, () => {
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
      chrome.storage.local.remove(WORD_CACHE_STORAGE_KEY, () => resolve());
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
      chrome.storage.sync.get(['totalWords', 'todayWords', 'lastResetDate', 'cacheHits', 'cacheMisses'], (current) => {
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
          chrome.storage.sync.set(updated, () => {
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
      if (!globalThis.chrome?.storage?.sync?.set) return resolve();
      try {
        chrome.storage.sync.set({ learnedWords: whitelist }, () => resolve());
      } catch (error) {
        if (!isContextInvalidated(error)) {
          console.warn('[Sapling] Whitelist save threw:', error);
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
      if (!globalThis.chrome?.storage?.sync?.set) return resolve();
      try {
        chrome.storage.sync.set({ memorizeList: list }, () => resolve());
      } catch (error) {
        if (!isContextInvalidated(error)) {
          console.warn('[Sapling] Memorize list save threw:', error);
          console.warn('[Sapling] Memorize list save threw:', error);
        }
        resolve();
      }
    });

    if (!config) {
      await loadConfig();
    }

    if (!config.enabled) {
      showToast(`"${trimmedWord}" 已添加到记忆列表`);
      return;
    }

    try {
      const count = await processSpecificWords([trimmedWord]);

      if (count > 0) {
        showToast(`"${trimmedWord}" 已添加到记忆列表并翻译`);
      } else {
        try {
          await translateSpecificWords([trimmedWord]);
          showToast(`"${trimmedWord}" 已添加到记忆列表`);
        } catch (error) {
          console.error('[Sapling] Error translating word:', trimmedWord, error);
          console.error('[Sapling] Error translating word:', trimmedWord, error);
          showToast(`"${trimmedWord}" 已添加到记忆列表`);
        }
      }
    } catch (error) {
      console.error('[Sapling] Error processing word:', trimmedWord, error);
      console.error('[Sapling] Error processing word:', trimmedWord, error);
      showToast(`"${trimmedWord}" 已添加到记忆列表`);
    }
  } else {
    showToast(`"${trimmedWord}" 已在记忆列表中`);
  }
}

// ============ DOM 处理（使用 content-segmenter 服务） ============

function getPageSegments(viewportOnly = false, margin = 300) {
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

function restoreAll() {
  processingGeneration++;
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
  const translations = await translateSpecificWords(targetWords);

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
  if (config.blacklist?.some(domain => hostname.includes(domain))) {
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
        errors++;
      }
    }

    const segments = getPageSegments(viewportOnly);
    const whitelistWords = new Set((config.learnedWords || []).map(w => w.original.toLowerCase()));

    // 预处理：过滤有效的 segments
    const validSegments = [];
    for (const segment of segments) {
      let text = segment.text;
      for (const word of whitelistWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        text = text.replace(regex, '');
      }
      if (text.trim().length >= 30) {
        validSegments.push({ ...segment, filteredText: text });
      }
    }

    const limitedSegments = validSegments;

    // 并行处理单个 segment
    const MAX_CONCURRENT = normalizeConcurrencyLimit(config.concurrencyLimit);

    async function processSegment(segment) {
      const el = segment.element;
      try {
        const result = await translateText(segment.filteredText);

        if (runGeneration !== processingGeneration) {
          el.classList.remove('Sapling-processing');
          return { count: 0, error: false, aborted: true };
        }

        // 先应用缓存结果（立即显示）
        let immediateCount = 0;
        if (result.immediate?.length) {
          const filtered = result.immediate.filter(r => !whitelistWords.has(r.original.toLowerCase()));
          immediateCount = applyReplacements(el, filtered, { scope: segment.scope });
          contentSegmenter.markProcessed(segment.fingerprint);
        }

        // 如果有异步结果，等待并更新
        if (result.async) {
          // 只有在没有立即替换结果时，才显示“处理中”高亮，避免缓存命中时出现长时间绿色背景。
          if (immediateCount === 0) {
            el.classList.add('Sapling-processing');
          } else {
            el.classList.remove('Sapling-processing');
          }

          result.async.then(async (asyncReplacements) => {
            try {
              if (runGeneration !== processingGeneration) return;
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
                  contentSegmenter.markProcessed(segment.fingerprint);
                }
              }
            } finally {
              el.classList.remove('Sapling-processing');
            }
          }).catch(error => {
            console.error('[Sapling] Async translation error:', error);
            el.classList.remove('Sapling-processing');
          });
        } else {
          el.classList.remove('Sapling-processing');
        }

        return { count: immediateCount, error: false };
      } catch (e) {
        console.error('[Sapling] Segment error:', e);
        el.classList.remove('Sapling-processing');
        return { count: 0, error: true };
      }
    }

    // 分批并行处理
    for (let i = 0; i < limitedSegments.length; i += MAX_CONCURRENT) {
      if (runGeneration !== processingGeneration) break;
      const batch = limitedSegments.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.all(batch.map(processSegment));

      for (const result of results) {
        processed += result.count;
        if (result.error) errors++;
      }
    }

    return { processed, errors };
  } finally {
    isProcessing = false;
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

    const actionBtn = e.target.closest('.Sapling-action-btn');
    const currentElement = tooltipManager.getCurrentElement();

    if (actionBtn && currentElement) {
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
          showToast(`"${original}" 已添加到记忆列表`);
          break;
        case 'learned':
          await addToWhitelist(original, translation, difficulty);
          if (config?.restoreAllSameWordsOnLearned ?? true) {
            restoreAllMatchingOriginal(original);
          } else {
            restoreOriginal(currentElement);
          }
          tooltipManager.hide(true);
          showToast(`"${original}" 已标记为已学会`);
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
    if (config?.autoProcess && config?.enabled) {
      processPage(true);
    }
  }, 500);
  window.addEventListener('scroll', handleScroll, { passive: true });

  // 监听配置变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      loadConfig().then(async () => {
        if (changes.enabled?.newValue === false) {
          restoreAll();
        }
        if (changes.difficultyLevel || changes.intensity || changes.translationStyle) {
          restoreAll();
          if (config.enabled) {
            processPage();
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
      processPage().then(sendResponse);
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
        .catch((error) => sendResponse({ success: false, message: error?.message || String(error) }));
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
  await loadWordCache();
  await initLanguageDetector();

  tooltipManager.createTooltip();
  setupEventListeners();

  // Best-effort flush pending cache writes when leaving the page.
  window.addEventListener('beforeunload', () => {
    void flushWordCacheSave();
  }, { capture: true });

  if (config.autoProcess && config.enabled && config.apiKey) {
    setTimeout(() => processPage(), 1000);
  }

  console.log('[Sapling] 初始化完成 (模块化重构版)');
  console.log('[Sapling] 初始化完成 (模块化重构版)');
}

// 启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
