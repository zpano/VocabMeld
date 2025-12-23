/**
 * Sapling API 服务模块（重构版）
 * 处理与 LLM API 的通信，统一管理翻译逻辑
 */

import { INTENSITY_CONFIG, isDifficultyCompatible, CACHE_CONFIG, normalizeCacheMaxSize, normalizeConcurrencyLimit } from '../core/config.js';
import { cacheService } from './cache-service.js';
import { buildVocabularySelectionPrompt, buildBatchVocabularySelectionPrompt, buildSpecificWordsPrompt } from '../prompts/ai-prompts.js';
import { detectLanguage } from '../utils/language-detector.js';
import { isNonLearningWord, normalizeCefrLevel } from '../utils/word-filters.js';
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
          console.error('[Sapling] Failed to parse API response:', e2);
        }
      }
      return [];
    }
  }

  /**
   * 解析批量 API 响应（多段落格式）
   * @param {string} content - API 返回内容
   * @returns {Array<{paragraphIndex: number, words: Array}>}
   */
  parseBatchApiResponse(content) {
    try {
      let parsed = JSON.parse(content);

      // 检查是否为新的批量格式
      if (Array.isArray(parsed)) {
        // 检查第一项是否有 paragraphIndex（新批量格式）
        if (parsed.length > 0 && parsed[0].paragraphIndex !== undefined) {
          return parsed.map(item => ({
            paragraphIndex: item.paragraphIndex,
            words: Array.isArray(item.words) ? item.words : []
          }));
        }

        // 兼容旧格式：单个词汇数组，包装为段落 0
        return [{ paragraphIndex: 0, words: parsed }];
      }

      // 处理包装格式
      if (parsed.results && Array.isArray(parsed.results)) {
        return this.parseBatchApiResponse(JSON.stringify(parsed.results));
      }
      if (parsed.paragraphs && Array.isArray(parsed.paragraphs)) {
        return parsed.paragraphs.map(item => ({
          paragraphIndex: item.paragraphIndex ?? item.index ?? 0,
          words: Array.isArray(item.words) ? item.words : []
        }));
      }

      return [];
    } catch (e) {
      // 尝试从内容中提取 JSON 数组
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return this.parseBatchApiResponse(jsonMatch[0]);
        } catch (e2) {
          console.error('[Sapling] Failed to parse batch API response:', e2);
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
   * 批量翻译多个文本（支持立即返回缓存 + 异步 API）
   * @param {Array<{text: string, paragraphIndex: number}>} texts - 文本数组，每项包含文本和段落索引
   * @param {object} config - 配置对象
   * @param {object} cacheMap - 外部传入的缓存 Map（content.js 的 wordCache）
   * @param {function} updateStatsCallback - 更新统计的回调函数
   * @param {function} saveCacheCallback - 保存缓存的回调函数
   * @returns {Promise<{results: Array<{paragraphIndex: number, immediate: Array, async: Promise|null}>}>}
   */
  async translateTexts(texts, config, cacheMap, updateStatsCallback, saveCacheCallback) {
    this._maxConcurrentRequests = normalizeConcurrencyLimit(config?.concurrencyLimit, this._maxConcurrentRequests);

    // 检查 API 配置
    if (!config.apiKey || !config.apiEndpoint) {
      const errorDetails = {
        apiKey: config.apiKey ? '已配置' : '未配置',
        apiEndpoint: config.apiEndpoint || '未配置',
        timestamp: new Date().toISOString()
      };

      console.error('[Sapling API Error] API 配置不完整，无法进行翻译');
      console.error('[Sapling API Error] 详细信息:', errorDetails);

      const error = new Error(!config.apiKey ? 'API Key 未配置，请前往设置页面配置' : 'API 端点未配置，请前往设置页面配置');
      error.code = 'API_NOT_CONFIGURED';
      error.details = errorDetails;
      throw error;
    }

    const maxReplacements = INTENSITY_CONFIG[config.intensity]?.maxPerParagraph || 8;
    const maxCacheSize = normalizeCacheMaxSize(config?.cacheMaxSize, CACHE_CONFIG.maxSize);

    // 为每个段落收集信息
    const paragraphDataList = [];

    for (const { text, paragraphIndex } of texts) {
      const sourceLang = await detectLanguage(text);
      const targetLang = sourceLang === config.nativeLanguage ? config.targetLanguage : config.nativeLanguage;

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
        .filter(c => {
          const word = c.word || '';
          if (isNonLearningWord(word)) return false;

          const isChinese = /[\u4e00-\u9fff]/.test(word);
          if (isChinese && word.length < 2) return false;

          const isEnglish = /^[a-zA-Z]+$/.test(word);
          if (isEnglish && word.length < 5) return false;

          const difficulty = normalizeCefrLevel(c.difficulty) || 'A1';
          return isDifficultyCompatible(difficulty, config.difficultyLevel);
        })
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

      // 构建只包含未缓存词汇的文本
      const filteredText = reconstructTextWithWords(text, uncached);

      paragraphDataList.push({
        paragraphIndex,
        originalText: text,
        sourceLang,
        targetLang,
        cached: filteredCached,
        uncached,
        filteredText,
        langKey: `${sourceLang}:${targetLang}`
      });
    }

    // 为每个段落构建立即结果
    const results = paragraphDataList.map(para => {
      const immediateResults = para.cached.slice(0, maxReplacements);

      if (immediateResults.length > 0) {
        updateStatsCallback({ cacheHits: immediateResults.length, cacheMisses: 0 });
      }

      return {
        paragraphIndex: para.paragraphIndex,
        immediate: immediateResults,
        async: null,
        _data: para  // 临时保存数据用于后续处理
      };
    });

    // 按语言对分组，准备批量 API 请求
    const langGroups = new Map();
    for (const result of results) {
      const para = result._data;
      const remainingSlots = maxReplacements - result.immediate.length;

      // 跳过不需要 API 调用的段落
      if (remainingSlots <= 0 || para.filteredText.trim().length < 50) {
        continue;
      }

      if (!langGroups.has(para.langKey)) {
        langGroups.set(para.langKey, []);
      }
      langGroups.get(para.langKey).push({
        ...para,
        remainingSlots
      });
    }

    // 如果没有需要 API 调用的段落，直接返回
    if (langGroups.size === 0) {
      return {
        results: results.map(r => ({
          paragraphIndex: r.paragraphIndex,
          immediate: r.immediate,
          async: null
        }))
      };
    }

    // 为每个语言组创建批量 API 请求
    const asyncPromises = new Map();

    for (const [langKey, paragraphs] of langGroups) {
      const [sourceLang, targetLang] = langKey.split(':');
      const aiTargetCount = Math.max(maxReplacements, Math.ceil(maxReplacements * 1.5));
      const aiMaxCount = maxReplacements * 2;

      const asyncPromise = this._runLimited(async () => {
        try {
          // 构建批量提示词
          const { systemPrompt, userPrompt } = buildBatchVocabularySelectionPrompt({
            paragraphs: paragraphs.map(p => ({
              index: p.paragraphIndex,
              text: p.filteredText,
              sourceLang: p.sourceLang,
              targetLang: p.targetLang
            })),
            nativeLanguage: config.nativeLanguage,
            learningLanguage: config.targetLanguage,
            aiTargetCount,
            aiMaxCount,
            userDifficultyLevel: config.difficultyLevel
          });

          let response;
          try {
            response = await fetch(config.apiEndpoint, {
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
                max_tokens: 8192  // 批量请求需要更多 token
              })
            });
          } catch (fetchError) {
            console.error('[Sapling API Error] 网络连接失败（批量翻译）');
            console.error('[Sapling API Error] 错误详情:', fetchError.message);
            const error = new Error('网络连接失败，请检查网络连接或 API 端点配置');
            error.code = 'NETWORK_ERROR';
            throw error;
          }

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            let errorMessage;
            let errorCode;

            if (response.status === 401) {
              errorMessage = 'API Key 无效或已过期';
              errorCode = 'INVALID_API_KEY';
            } else if (response.status === 429) {
              errorMessage = 'API 请求频率超限，请稍后重试';
              errorCode = 'RATE_LIMIT';
            } else if (response.status >= 500) {
              errorMessage = 'API 服务器错误，请稍后重试';
              errorCode = 'SERVER_ERROR';
            } else {
              errorMessage = errorData.error?.message || `API 请求失败 (HTTP ${response.status})`;
              errorCode = 'API_REQUEST_FAILED';
            }

            console.error('[Sapling API Error] 批量翻译失败:', errorMessage);
            const error = new Error(errorMessage);
            error.code = errorCode;
            error.status = response.status;
            throw error;
          }

          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '[]';

          // 解析批量响应
          const batchResults = this.parseBatchApiResponse(content);

          // 缓存所有结果并过滤
          const processedResults = [];

          for (const { paragraphIndex, words } of batchResults) {
            const para = paragraphs.find(p => p.paragraphIndex === paragraphIndex);
            if (!para) continue;

            // 缓存词汇
            for (const item of words) {
              const word = item.original || '';
              if (isNonLearningWord(word)) continue;

              const isChinese = /[\u4e00-\u9fff]/.test(word);
              if (isChinese && word.length < 2) continue;

              const isEnglish = /^[a-zA-Z]+$/.test(word);
              if (isEnglish && word.length < 5) continue;

              const key = `${word.toLowerCase()}:${para.sourceLang}:${para.targetLang}`;

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
                difficulty: normalizeCefrLevel(item.difficulty) || 'A1',
                partOfSpeech: item.partOfSpeech || '',
                shortDefinition: item.shortDefinition || '',
                example: item.example || ''
              });
            }

            // 过滤词汇
            const filteredWords = words.filter(item => {
              const word = item.original || '';
              if (isNonLearningWord(word)) return false;

              const difficulty = normalizeCefrLevel(item.difficulty) || 'A1';
              if (!isDifficultyCompatible(difficulty, config.difficultyLevel)) return false;

              const isEnglish = /^[a-zA-Z]+$/.test(word);
              if (isEnglish && word.length < 5) return false;

              return true;
            });

            // 计算位置并格式化
            const formattedWords = filteredWords.map(result => {
              const originalIndex = para.originalText.toLowerCase().indexOf(result.original.toLowerCase());
              return {
                ...result,
                position: originalIndex >= 0 ? originalIndex : (result.position || 0),
                sourceLang: para.sourceLang
              };
            });

            processedResults.push({
              paragraphIndex,
              words: formattedWords.slice(0, para.remainingSlots)
            });

            // 更新统计
            try {
              updateStatsCallback({
                newWords: formattedWords.length,
                cacheHits: para.cached.length,
                cacheMisses: 1
              });
            } catch (statsError) {
              console.warn('[Sapling] Failed to update stats:', statsError);
            }
          }

          // 保存缓存
          try {
            void saveCacheCallback();
          } catch {
            // ignore
          }

          return processedResults;

        } catch (error) {
          console.error('[Sapling] Batch translation error:', error);
          return paragraphs.map(p => ({ paragraphIndex: p.paragraphIndex, words: [] }));
        }
      });

      asyncPromises.set(langKey, asyncPromise);
    }

    // 为每个段落关联对应的 async Promise
    const finalResults = results.map(r => {
      const para = r._data;
      delete r._data;

      const langKey = para.langKey;
      if (!asyncPromises.has(langKey)) {
        return {
          paragraphIndex: r.paragraphIndex,
          immediate: r.immediate,
          async: null
        };
      }

      // 过滤出当前段落的结果
      const asyncPromise = asyncPromises.get(langKey).then(batchResults => {
        const paraResult = batchResults.find(br => br.paragraphIndex === r.paragraphIndex);
        if (!paraResult && batchResults.length > 0) {
          console.warn(`[Sapling] No results for paragraph ${r.paragraphIndex} in batch response`);
        }
        return paraResult ? paraResult.words : [];
      });

      return {
        paragraphIndex: r.paragraphIndex,
        immediate: r.immediate,
        async: asyncPromise
      };
    });

    return { results: finalResults };
  }

  /**
   * 翻译单个文本（委托给 translateTexts 批量方法）
   * @param {string} text - 要翻译的文本
   * @param {object} config - 配置对象
   * @param {object} cacheMap - 外部传入的缓存 Map（content.js 的 wordCache）
   * @param {function} updateStatsCallback - 更新统计的回调函数
   * @param {function} saveCacheCallback - 保存缓存的回调函数
   * @returns {Promise<{immediate: Array, async: Promise|null}>}
   */
  async translateText(text, config, cacheMap, updateStatsCallback, saveCacheCallback) {
    const result = await this.translateTexts(
      [{ text, paragraphIndex: 0 }],
      config,
      cacheMap,
      updateStatsCallback,
      saveCacheCallback
    );

    const paragraphResult = result.results[0];
    return {
      immediate: paragraphResult.immediate,
      async: paragraphResult.async
    };
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

    if (!targetWords?.length) {
      return [];
    }

    // 检查 API 配置
    if (!config.apiKey || !config.apiEndpoint) {
      const errorDetails = {
        apiKey: config.apiKey ? '已配置' : '未配置',
        apiEndpoint: config.apiEndpoint || '未配置',
        targetWords: targetWords,
        timestamp: new Date().toISOString()
      };
      
      console.error('[Sapling API Error] API 配置不完整，无法翻译特定单词');
      console.error('[Sapling API Error] 详细信息:', errorDetails);
      console.error('[Sapling API Error] 请前往插件设置页面配置 API Key 和 API 端点');
      
      const error = new Error(!config.apiKey ? 'API Key 未配置，请前往设置页面配置' : 'API 端点未配置，请前往设置页面配置');
      error.code = 'API_NOT_CONFIGURED';
      error.details = errorDetails;
      throw error;
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
          let response;
          try {
            response = await fetch(config.apiEndpoint, {
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
          } catch (fetchError) {
            // 网络错误
            console.error('[Sapling API Error] 网络连接失败（翻译特定单词）');
            console.error('[Sapling API Error] 错误详情:', fetchError.message);
            console.error('[Sapling API Error] API 端点:', config.apiEndpoint);
            console.error('[Sapling API Error] 目标单词:', targetWords);
            
            const error = new Error('网络连接失败，请检查网络连接或 API 端点配置');
            error.code = 'NETWORK_ERROR';
            error.details = { originalError: fetchError.message };
            throw error;
          }

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            
            // 根据 HTTP 状态码生成更具体的错误信息
            let errorMessage;
            let errorCode;
            
            if (response.status === 401) {
              errorMessage = 'API Key 无效或已过期，请检查 API Key 配置';
              errorCode = 'INVALID_API_KEY';
              console.error('[Sapling API Error] API Key 认证失败（翻译特定单词）');
            } else if (response.status === 403) {
              errorMessage = '没有权限访问该 API，请检查 API Key 权限';
              errorCode = 'FORBIDDEN';
              console.error('[Sapling API Error] API 访问被拒绝（翻译特定单词）');
            } else if (response.status === 429) {
              errorMessage = 'API 请求频率超限，请稍后重试';
              errorCode = 'RATE_LIMIT';
              console.error('[Sapling API Error] API 请求频率超限（翻译特定单词）');
            } else if (response.status === 500 || response.status === 502 || response.status === 503) {
              errorMessage = 'API 服务器错误，请稍后重试';
              errorCode = 'SERVER_ERROR';
              console.error('[Sapling API Error] API 服务器错误（翻译特定单词）');
            } else {
              errorMessage = errorData.error?.message || `API 请求失败 (HTTP ${response.status})`;
              errorCode = 'API_REQUEST_FAILED';
              console.error('[Sapling API Error] API 请求失败（翻译特定单词）');
            }
            
            console.error('[Sapling API Error] 状态码:', response.status);
            console.error('[Sapling API Error] 错误详情:', errorData);
            console.error('[Sapling API Error] API 端点:', config.apiEndpoint);
            console.error('[Sapling API Error] 模型名称:', config.modelName);
            console.error('[Sapling API Error] 目标单词:', targetWords);
            
            const error = new Error(errorMessage);
            error.code = errorCode;
            error.status = response.status;
            error.details = errorData;
            throw error;
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
            difficulty: normalizeCefrLevel(item.difficulty) || 'A1',
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
        console.error('[Sapling] translateSpecificWords error:', error);
        // 重新抛出错误，让调用方处理并显示提示
        throw error;
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
