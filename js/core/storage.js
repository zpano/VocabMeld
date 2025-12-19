/**
 * Sapling 存储服务模块
 * 封装 Chrome Storage API，提供统一的存储接口
 */

import { DEFAULT_CONFIG } from './config.js';

/**
 * 存储服务类
 */
class StorageService {
  constructor() {
    this.cache = null;
    this.listeners = new Map();
  }

  /**
   * 获取配置值
   * @param {string|string[]|null} keys - 要获取的键，null 则获取所有
   * @returns {Promise<object>}
   */
  async get(keys = null) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, (result) => {
        if (keys === null) {
          resolve({ ...DEFAULT_CONFIG, ...result });
        } else if (typeof keys === 'string') {
          resolve({ [keys]: result[keys] ?? DEFAULT_CONFIG[keys] });
        } else {
          const merged = {};
          keys.forEach(key => {
            merged[key] = result[key] ?? DEFAULT_CONFIG[key];
          });
          resolve(merged);
        }
      });
    });
  }

  /**
   * 设置配置值
   * @param {object} items - 要设置的键值对
   * @returns {Promise<void>}
   */
  async set(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 从本地存储获取数据（用于大量数据如缓存）
   * @param {string|string[]|null} keys
   * @returns {Promise<object>}
   */
  async getLocal(keys = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result);
      });
    });
  }

  /**
   * 设置本地存储数据
   * @param {object} items
   * @returns {Promise<void>}
   */
  async setLocal(items) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 清除本地存储
   * @param {string|string[]} keys
   * @returns {Promise<void>}
   */
  async removeLocal(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  /**
   * 获取完整配置
   * @returns {Promise<object>}
   */
  async getConfig() {
    return this.get(null);
  }

  /**
   * 更新统计数据
   * @param {object} stats - 统计数据更新
   * @returns {Promise<void>}
   */
  async updateStats(stats) {
    const current = await this.get(['totalWords', 'todayWords', 'lastResetDate', 'cacheHits', 'cacheMisses']);
    const today = new Date().toISOString().split('T')[0];
    
    // 检查是否需要重置今日统计
    if (current.lastResetDate !== today) {
      current.todayWords = 0;
      current.lastResetDate = today;
    }

    const updated = {
      totalWords: current.totalWords + (stats.newWords || 0),
      todayWords: current.todayWords + (stats.newWords || 0),
      lastResetDate: today,
      cacheHits: current.cacheHits + (stats.cacheHits || 0),
      cacheMisses: current.cacheMisses + (stats.cacheMisses || 0)
    };

    await this.set(updated);
    return updated;
  }

  /**
   * 获取白名单（已学会词汇）
   * @returns {Promise<Array>}
   */
  async getWhitelist() {
    const result = await this.get('learnedWords');
    return result.learnedWords || [];
  }

  /**
   * 添加词汇到白名单
   * @param {object} word - { original, word, addedAt }
   * @returns {Promise<void>}
   */
  async addToWhitelist(word) {
    const whitelist = await this.getWhitelist();
    const exists = whitelist.some(w => w.original === word.original || w.word === word.word);
    if (!exists) {
      whitelist.push({
        original: word.original,
        word: word.word,
        addedAt: Date.now()
      });
      await this.set({ learnedWords: whitelist });
    }
  }

  /**
   * 从白名单移除词汇
   * @param {string} word - 词汇
   * @returns {Promise<void>}
   */
  async removeFromWhitelist(word) {
    const whitelist = await this.getWhitelist();
    const filtered = whitelist.filter(w => w.original !== word && w.word !== word);
    await this.set({ learnedWords: filtered });
  }

  /**
   * 获取需记忆列表
   * @returns {Promise<Array>}
   */
  async getMemorizeList() {
    const result = await this.get('memorizeList');
    return result.memorizeList || [];
  }

  /**
   * 添加词汇到需记忆列表
   * @param {string} word - 词汇
   * @returns {Promise<void>}
   */
  async addToMemorizeList(word) {
    const list = await this.getMemorizeList();
    const exists = list.some(w => w.word === word);
    if (!exists) {
      list.push({
        word: word,
        addedAt: Date.now()
      });
      await this.set({ memorizeList: list });
    }
  }

  /**
   * 从需记忆列表移除词汇
   * @param {string} word - 词汇
   * @returns {Promise<void>}
   */
  async removeFromMemorizeList(word) {
    const list = await this.getMemorizeList();
    const filtered = list.filter(w => w.word !== word);
    await this.set({ memorizeList: filtered });
  }

  /**
   * 检查站点是否在黑名单
   * @param {string} hostname - 站点域名
   * @returns {Promise<boolean>}
   */
  async isBlacklisted(hostname) {
    const { blacklist } = await this.get('blacklist');
    return (blacklist || []).some(domain => hostname.includes(domain));
  }

  /**
   * 检查站点是否在白名单
   * @param {string} hostname - 站点域名
   * @returns {Promise<boolean>}
   */
  async isWhitelisted(hostname) {
    const { whitelist } = await this.get('whitelist');
    return (whitelist || []).some(domain => hostname.includes(domain));
  }

  /**
   * 添加存储变化监听器
   * @param {function} callback - 回调函数
   * @returns {function} - 取消监听的函数
   */
  addChangeListener(callback) {
    const listener = (changes, areaName) => {
      if (areaName === 'sync' || areaName === 'local') {
        callback(changes, areaName);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}

// 导出单例
export const storage = new StorageService();
export default storage;

