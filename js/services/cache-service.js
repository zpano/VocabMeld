/**
 * Sapling 缓存服务模块
 * 实现热词缓存系统，支持 LRU 淘汰策略
 */

import { CACHE_CONFIG, normalizeCacheMaxSize } from '../core/config.js';
import { storage } from '../core/storage.js';

/**
 * 词汇缓存服务类
 */
class CacheService {
  constructor() {
    this.cache = new Map();
    this.maxSize = CACHE_CONFIG.maxSize;
    this.initialized = false;
    this.initPromise = null;

    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (!changes.cacheMaxSize) return;
        this.setMaxSize(changes.cacheMaxSize.newValue);
        void this.persist();
      });
    } catch (e) {
      // ignore
    }
  }

  setMaxSize(maxSize) {
    this.maxSize = normalizeCacheMaxSize(maxSize, CACHE_CONFIG.maxSize);
    this.trimToMaxSize();
  }

  trimToMaxSize() {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * 初始化缓存（从存储加载）
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const { cacheMaxSize } = await storage.get('cacheMaxSize');
        this.maxSize = normalizeCacheMaxSize(cacheMaxSize, CACHE_CONFIG.maxSize);

        const data = await storage.getLocal(CACHE_CONFIG.storageKey);
        const cached = data[CACHE_CONFIG.storageKey];
        
        if (cached && Array.isArray(cached)) {
          // 恢复缓存，按添加顺序
          cached.forEach(item => {
            this.cache.set(item.key, {
              translation: item.translation,
              phonetic: item.phonetic,
              difficulty: item.difficulty,
              partOfSpeech: item.partOfSpeech || '',
              shortDefinition: item.shortDefinition || '',
              example: item.example || '',
              timestamp: item.timestamp
            });
          });
        }

        const beforeTrim = this.cache.size;
        this.trimToMaxSize();
        if (this.cache.size !== beforeTrim) {
          await this.persist();
        }
        
        this.initialized = true;
        console.log(`[Sapling] Cache initialized with ${this.cache.size} items (max ${this.maxSize})`);
      } catch (error) {
        console.error('[Sapling] Failed to initialize cache:', error);
        this.initialized = true;
      }
    })();

    return this.initPromise;
  }

  /**
   * 生成缓存键
   * @param {string} word - 原词
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @returns {string}
   */
  generateKey(word, sourceLang, targetLang) {
    return `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
  }

  /**
   * 获取缓存项
   * @param {string} word - 原词
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @returns {object|null}
   */
  get(word, sourceLang, targetLang) {
    const key = this.generateKey(word, sourceLang, targetLang);
    const item = this.cache.get(key);
    
    if (item) {
      // LRU: 将访问的项移到末尾
      this.cache.delete(key);
      this.cache.set(key, item);
      return item;
    }
    
    return null;
  }

  /**
   * 设置缓存项
   * @param {string} word - 原词
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @param {object} data - { translation, phonetic, difficulty }
   * @returns {Promise<void>}
   */
  async set(word, sourceLang, targetLang, data) {
    const key = this.generateKey(word, sourceLang, targetLang);
    
    // 如果已存在，先删除（LRU）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // 如果达到上限，删除最早的项
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    // 添加新项
    this.cache.set(key, {
      translation: data.translation,
      phonetic: data.phonetic || '',
      difficulty: data.difficulty || 'B1',
      partOfSpeech: data.partOfSpeech || '',
      shortDefinition: data.shortDefinition || '',
      example: data.example || '',
      timestamp: Date.now()
    });
    
    // 异步持久化
    this.persist();
  }

  /**
   * 批量设置缓存
   * @param {Array} items - [{ word, sourceLang, targetLang, translation, phonetic, difficulty }]
   * @returns {Promise<void>}
   */
  async setMany(items) {
    for (const item of items) {
      const key = this.generateKey(item.word, item.sourceLang, item.targetLang);
      
      if (this.cache.has(key)) {
        this.cache.delete(key);
      }
      
      while (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      
      this.cache.set(key, {
        translation: item.translation,
        phonetic: item.phonetic || '',
        difficulty: item.difficulty || 'B1',
        partOfSpeech: item.partOfSpeech || '',
        shortDefinition: item.shortDefinition || '',
        example: item.example || '',
        timestamp: Date.now()
      });
    }
    
    await this.persist();
  }

  /**
   * 检查缓存中的词汇
   * @param {string[]} words - 词汇列表
   * @param {string} sourceLang - 源语言
   * @param {string} targetLang - 目标语言
   * @returns {{ cached: Map, uncached: string[] }}
   */
  checkWords(words, sourceLang, targetLang) {
    const cached = new Map();
    const uncached = [];
    
    for (const word of words) {
      const item = this.get(word, sourceLang, targetLang);
      if (item) {
        cached.set(word, item);
      } else {
        uncached.push(word);
      }
    }
    
    return { cached, uncached };
  }

  /**
   * 持久化缓存到存储
   * @returns {Promise<void>}
   */
  async persist() {
    try {
      const data = [];
      for (const [key, value] of this.cache) {
        data.push({
          key,
          ...value
        });
      }
      
      await storage.setLocal({
        [CACHE_CONFIG.storageKey]: data
      });
    } catch (error) {
      console.error('[Sapling] Failed to persist cache:', error);
    }
  }

  /**
   * 清空缓存
   * @returns {Promise<void>}
   */
  async clear() {
    this.cache.clear();
    await storage.removeLocal(CACHE_CONFIG.storageKey);
    console.log('[Sapling] Cache cleared');
  }

  /**
   * 获取缓存统计
   * @returns {object}
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  /**
   * 获取所有缓存词汇
   * @returns {Array}
   */
  getAllWords() {
    const words = [];
    for (const [key, value] of this.cache) {
      const [word, sourceLang, targetLang] = key.split(':');
      words.push({
        original: word,
        translation: value.translation,
        phonetic: value.phonetic,
        difficulty: value.difficulty,
        example: value.example || '',
        sourceLang,
        targetLang
      });
    }
    return words;
  }
}

// 导出单例
export const cacheService = new CacheService();
export default cacheService;
