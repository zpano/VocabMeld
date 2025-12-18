/**
 * VocabMeld API 服务模块（重构版）
 * 处理与 LLM API 的通信，统一管理翻译逻辑
 */

import { INTENSITY_CONFIG, isDifficultyCompatible, CACHE_CONFIG, normalizeCacheMaxSize, normalizeConcurrencyLimit } from '../core/config.js';
import { cacheService } from './cache-service.js';
import { buildVocabularySelectionPrompt, buildSpecificWordsPrompt } from '../prompts/ai-prompts.js';
import { detectLanguage } from '../utils/language-detector.js';
import { isNonLearningWord } from '../utils/word-filters.js';
import { segmentText, reconstructTextWithWords, filterWords } from '../utils/text-processor.js';

/**
 * API 服务类
 */
class ApiService {
  constructor() {
    this.config = null;
    // Limit in-flight network requests to avoid browser-level queuing bursts.
    this._maxConcurrentRequests = 5;
    this._activeRequestCount = 0;
    this._requestQueue = [];
  }

  _pumpRequestQueue() {
    while (this._activeRequestCount < this._maxConcurrentRequests && this._requestQueue.length > 0) {
      const { task, resolve, reject } = this._requestQueue.shift();
      this._activeRequestCount++;

      (async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        } finally {
          this._activeRequestCount--;
          this._pumpRequestQueue();
        }
      })();
    }
  }

  _runLimited(task) {
    return new Promise((resolve, reject) => {
      this._requestQueue.push({ task, resolve, reject });
      this._pumpRequestQueue();
    });
  }

  /**
   * 设置配置
   * @param {object} config - 配置对象
   */
  setConfig(config) {
    this.config = config;
    this._maxConcurrentRequests = normalizeConcurrencyLimit(config?.concurrencyLimit, this._maxConcurrentRequests);
  }

  /**
   * 解析 API 响应（统一 JSON 解析逻辑）
   * @param {string} content - API 返回内容
   * @returns {Array}
   */
  parseApiResponse(content) {
    try {
      let parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;

      if (parsed.results && Array.isArray(parsed.results)) {
        return parsed.results;
      }
      if (parsed.words && Array.isArray(parsed.words)) {
        return parsed.words;
      }

      return [];
    } catch (e) {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e2) {
          console.error('[VocabMeld] Failed to parse API response:', e2);
        }
      }
      return [];
    }
  }

  /**
   * 更新缓存（统一 LRU 管理）
   * @param {Array} results - AI 返回的结果
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   */
  async updateCache(results, sourceLang, targetLang) {
    const cacheItems = [];

    for (const item of results) {
      const word = item.original || '';
      if (isNonLearningWord(word)) continue;

      const isChinese = /[\u4e00-\u9fff]/.test(word);
      if (isChinese && word.length < 2) continue;

      const isEnglish = /^[a-zA-Z]+$/.test(word);
      if (isEnglish && word.length < 5) continue;

      cacheItems.push({
        word,
        sourceLang,
        targetLang,
        translation: item.translation,
        phonetic: item.phonetic || '',
        difficulty: item.difficulty || 'B1',
        partOfSpeech: item.partOfSpeech || '',
        shortDefinition: item.shortDefinition || '',
        example: item.example || ''
      });
    }

    if (cacheItems.length > 0) {
      await cacheService.setMany(cacheItems);
    }
  }

  /**
   * 翻译文本（支持立即返回缓存 + 异步 API）
   * @param {string} text - 要翻译的文本
   * @param {object} config - 配置对象
   * @param {object} cacheMap - 外部传入的缓存 Map（content.js 的 wordCache）
   * @param {function} updateStatsCallback - 更新统计的回调函数
   * @param {function} saveCacheCallback - 保存缓存的回调函数
   * @returns {Promise<{immediate: Array, async: Promise|null}>}
   */
  async translateText(text, config, cacheMap, updateStatsCallback, saveCacheCallback) {
    this._maxConcurrentRequests = normalizeConcurrencyLimit(config?.concurrencyLimit, this._maxConcurrentRequests);

    if (!config.apiKey || !config.apiEndpoint) {
      throw new Error('API 未配置');
    }

    const sourceLang = await detectLanguage(text);
    const targetLang = sourceLang === config.nativeLanguage ? config.targetLanguage : config.nativeLanguage;
    const maxReplacements = INTENSITY_CONFIG[config.intensity]?.maxPerParagraph || 8;
    const maxCacheSize = normalizeCacheMaxSize(config?.cacheMaxSize, CACHE_CONFIG.maxSize);

    // 分词
    const segmentedWords = segmentText(text, sourceLang);
    const allWords = filterWords(segmentedWords).filter(word => !isNonLearningWord(word));

    // 检查缓存
    const cached = [];
    const uncached = [];
    const cachedWordsSet = new Set();

    for (const word of allWords) {
      const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
      if (cacheMap.has(key)) {
        const lowerWord = word.toLowerCase();
        if (!cachedWordsSet.has(lowerWord)) {
          cached.push({ word, ...cacheMap.get(key) });
          cachedWordsSet.add(lowerWord);
        }
      } else {
        uncached.push(word);
      }
    }

    // 额外检查：检查文本中是否包含已缓存的中文词汇
    const lowerText = text.toLowerCase();
    for (const [key, value] of cacheMap) {
      const [cachedWord, cachedSourceLang, cachedTargetLang] = key.split(':');
      if (cachedSourceLang === sourceLang &&
          cachedTargetLang === targetLang &&
          /[\u4e00-\u9fff]/.test(cachedWord) &&
          cachedWord.length >= 2) {
        const lowerCachedWord = cachedWord.toLowerCase();
        if (!cachedWordsSet.has(lowerCachedWord)) {
          if (lowerText.includes(lowerCachedWord)) {
            const idx = text.toLowerCase().indexOf(lowerCachedWord);
            if (idx >= 0) {
              cached.push({
                word: text.substring(idx, idx + cachedWord.length),
                ...value
              });
              cachedWordsSet.add(lowerCachedWord);
            }
          }
        }
      }
    }

    // 过滤缓存结果（按难度）
    const filteredCached = cached
      .filter(c => isDifficultyCompatible(c.difficulty || 'B1', config.difficultyLevel))
      .map(c => {
        const idx = text.toLowerCase().indexOf(c.word.toLowerCase());
        return {
          original: c.word,
          translation: c.translation,
          phonetic: c.phonetic,
          difficulty: c.difficulty,
          partOfSpeech: c.partOfSpeech || '',
          shortDefinition: c.shortDefinition || '',
          example: c.example || '',
          position: idx >= 0 ? idx : 0,
          fromCache: true,
          sourceLang
        };
      });

    // 立即返回缓存结果
    const immediateResults = filteredCached.slice(0, maxReplacements);

    if (immediateResults.length > 0) {
      updateStatsCallback({ cacheHits: immediateResults.length, cacheMisses: 0 });
    }

    // 如果没有未缓存的词汇，直接返回
    if (uncached.length === 0) {
      return { immediate: immediateResults, async: null };
    }

    // 构建只包含未缓存词汇的文本
    const filteredText = reconstructTextWithWords(text, uncached);

    const textTooShort = filteredText.trim().length < 50;

    // 缓存已经满足本段落的替换数量时，不再发起异步 API 请求（避免“已缓存仍长时间高亮处理中”）。
    const remainingSlots = maxReplacements - immediateResults.length;
    if (remainingSlots <= 0) {
      return { immediate: immediateResults, async: null };
    }

    if (textTooShort) {
      return { immediate: immediateResults, async: null };
    }

    const maxAsyncReplacements = remainingSlots;

    if (maxAsyncReplacements <= 0) {
      return { immediate: immediateResults, async: null };
    }

    const aiTargetCount = Math.max(maxAsyncReplacements, Math.ceil(maxReplacements * 1.5));
    const aiMaxCount = maxReplacements * 2;

    // 异步调用 API（受限并发，避免大量段落同时 fetch 导致排队/突发）
    const asyncPromise = this._runLimited(async () => {
      try {
        const systemPrompt = buildVocabularySelectionPrompt({
          sourceLang,
          targetLang,
          nativeLanguage: config.nativeLanguage,
          learningLanguage: config.targetLanguage,
          aiTargetCount,
          aiMaxCount
        });

        const userPrompt = `${filteredText}`;

        const response = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0,
            max_tokens: 4096
          })
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error?.message || `API Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '[]';

        let allResults = this.parseApiResponse(content);

        // 缓存所有结果
        for (const item of allResults) {
          const word = item.original || '';
          if (isNonLearningWord(word)) continue;

          const isChinese = /[\u4e00-\u9fff]/.test(word);
          if (isChinese && word.length < 2) continue;

          const isEnglish = /^[a-zA-Z]+$/.test(word);
          if (isEnglish && word.length < 5) continue;

          const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;

          // LRU: 如果已存在，先删除
          if (cacheMap.has(key)) {
            cacheMap.delete(key);
          }

          // 如果达到上限，删除最早的项
          while (cacheMap.size >= maxCacheSize) {
            const firstKey = cacheMap.keys().next().value;
            cacheMap.delete(firstKey);
          }

          // 添加新项
          cacheMap.set(key, {
            translation: item.translation,
            phonetic: item.phonetic || '',
            difficulty: item.difficulty || 'B1',
            partOfSpeech: item.partOfSpeech || '',
            shortDefinition: item.shortDefinition || '',
            example: item.example || ''
          });
        }

        // 保存缓存：best-effort，避免阻塞后续段落/请求调度
        try {
          void saveCacheCallback();
        } catch {
          // ignore
        }

        // 本地过滤：只保留符合用户难度设置的词汇
        const filteredResults = allResults.filter(item => {
          const word = item.original || '';
          if (isNonLearningWord(word)) return false;
          if (!isDifficultyCompatible(item.difficulty || 'B1', config.difficultyLevel)) return false;

          const isEnglish = /^[a-zA-Z]+$/.test(word);
          if (isEnglish && word.length < 5) return false;

          return true;
        });

        // 更新统计
        updateStatsCallback({ newWords: filteredResults.length, cacheHits: cached.length, cacheMisses: 1 });

        // 修正 AI 返回结果的位置
        const correctedResults = filteredResults.map(result => {
          const originalIndex = text.toLowerCase().indexOf(result.original.toLowerCase());
          return {
            ...result,
            position: originalIndex >= 0 ? originalIndex : result.position,
            sourceLang
          };
        });

        // 合并缓存结果（去重）
        const immediateWords = new Set(immediateResults.map(r => r.original.toLowerCase()));
        const cachedResults = cached
          .filter(c =>
            !immediateWords.has(c.word.toLowerCase()) &&
            !correctedResults.some(r => r.original.toLowerCase() === c.word.toLowerCase()) &&
            isDifficultyCompatible(c.difficulty || 'B1', config.difficultyLevel) &&
            !isNonLearningWord(c.word)
          )
          .map(c => {
            const idx = text.toLowerCase().indexOf(c.word.toLowerCase());
            return {
              original: c.word,
              translation: c.translation,
              phonetic: c.phonetic,
              difficulty: c.difficulty,
              partOfSpeech: c.partOfSpeech || '',
              shortDefinition: c.shortDefinition || '',
              example: c.example || '',
              position: idx,
              fromCache: true,
              sourceLang
            };
          });

        const mergedResults = [...cachedResults, ...correctedResults];
        return mergedResults.slice(0, maxAsyncReplacements);

      } catch (error) {
        console.error('[VocabMeld] Async translation error:', error);
        return [];
      }
    });

    return { immediate: immediateResults, async: asyncPromise };
  }

  /**
   * 翻译特定单词（用于记忆列表）
   * @param {string[]} targetWords - 要翻译的单词数组
   * @param {object} config - 配置对象
   * @param {object} cacheMap - 外部传入的缓存 Map
   * @param {function} updateStatsCallback - 更新统计的回调函数
   * @param {function} saveCacheCallback - 保存缓存的回调函数
   * @returns {Promise<Array>} 翻译结果
   */
  async translateSpecificWords(targetWords, config, cacheMap, updateStatsCallback, saveCacheCallback) {
    this._maxConcurrentRequests = normalizeConcurrencyLimit(config?.concurrencyLimit, this._maxConcurrentRequests);

    if (!config.apiKey || !config.apiEndpoint || !targetWords?.length) {
      return [];
    }

    const sourceLang = await detectLanguage(targetWords.join(' '));
    const targetLang = sourceLang === config.nativeLanguage ? config.targetLanguage : config.nativeLanguage;
    const maxCacheSize = normalizeCacheMaxSize(config?.cacheMaxSize, CACHE_CONFIG.maxSize);

    const uncached = [];
    const cached = [];

    // 检查缓存
    for (const word of targetWords) {
      const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
      if (cacheMap.has(key)) {
        // LRU: 访问时移到末尾
        const cachedItem = cacheMap.get(key);
        cacheMap.delete(key);
        cacheMap.set(key, cachedItem);
        cached.push({ word, ...cachedItem });
      } else {
        uncached.push(word);
      }
    }

    let allResults = cached.map(c => ({
      original: c.word,
      translation: c.translation,
      phonetic: c.phonetic,
      difficulty: c.difficulty,
      partOfSpeech: c.partOfSpeech || '',
      shortDefinition: c.shortDefinition || '',
      example: c.example || '',
      sourceLang
    }));

    // 如果有未缓存的单词，调用 API
    if (uncached.length > 0) {
      try {
        const systemPrompt = buildSpecificWordsPrompt({
          sourceLang,
          targetLang,
          nativeLanguage: config.nativeLanguage,
          learningLanguage: config.targetLanguage
        });

        // 用户消息只包含要翻译的单词列表（逗号分隔）
        const userPrompt = uncached.join(', ');

        const apiResults = await this._runLimited(async () => {
          const response = await fetch(config.apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
              model: config.modelName,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: 0,
              max_tokens: 4096
            })
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `API Error: ${response.status}`);
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '[]';
          return this.parseApiResponse(content);
        });

        // 缓存结果
        for (const item of apiResults) {
          const word = item.original || '';
          if (isNonLearningWord(word)) continue;

          const isChinese = /[\u4e00-\u9fff]/.test(word);
          if (isChinese && word.length < 2) continue;

          const isEnglish = /^[a-zA-Z]+$/.test(word);
          if (isEnglish && word.length < 5) continue;

          const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;

          // LRU 管理
          if (cacheMap.has(key)) {
            cacheMap.delete(key);
          }

          while (cacheMap.size >= maxCacheSize) {
            const firstKey = cacheMap.keys().next().value;
            cacheMap.delete(firstKey);
          }

          cacheMap.set(key, {
            translation: item.translation,
            phonetic: item.phonetic || '',
            difficulty: item.difficulty || 'B1',
            partOfSpeech: item.partOfSpeech || '',
            shortDefinition: item.shortDefinition || '',
            example: item.example || ''
          });
        }

        // 保存缓存：best-effort，避免阻塞后续段落/请求调度
        try {
          void saveCacheCallback();
        } catch {
          // ignore
        }

        // 为 API 结果添加 sourceLang
        const apiResultsWithLang = apiResults.map(item => ({
          ...item,
          sourceLang
        }));

        allResults = [...allResults, ...apiResultsWithLang];

        // 更新统计
        updateStatsCallback({ newWords: apiResults.length, cacheHits: cached.length, cacheMisses: 1 });

      } catch (error) {
        console.error('[VocabMeld] translateSpecificWords error:', error);
      }
    }

    return allResults.filter(item =>
      targetWords.some(w => w.toLowerCase() === item.original.toLowerCase()) &&
      !isNonLearningWord(item.original)
    );
  }
}

// 导出单例
export const apiService = new ApiService();
export default apiService;
