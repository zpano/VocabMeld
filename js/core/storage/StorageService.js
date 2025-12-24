/**
 * Sapling Storage Service
 * 高级存储门面，提供领域特定方法
 */

import { DEFAULT_CONFIG } from '../config.js';
import { ChromeStorageAdapter } from './ChromeStorageAdapter.js';
import { StorageNamespace } from './StorageNamespace.js';

/**
 * 存储服务类
 */
class StorageService {
  constructor() {
    // 创建存储命名空间
    const remoteAdapter = new ChromeStorageAdapter('sync');
    const localAdapter = new ChromeStorageAdapter('local');

    this.remote = new StorageNamespace(remoteAdapter, true, DEFAULT_CONFIG);
    this.local = new StorageNamespace(localAdapter, false, null);
  }

  /**
   * 获取配置值（向后兼容）
   * @param {string|string[]|null} keys - 要获取的键
   * @returns {Promise<object>}
   */
  async get(keys = null) {
    return this.remote.getAsync(keys);
  }

  /**
   * 设置配置值（向后兼容）
   * @param {object} items - 键值对
   * @returns {Promise<void>}
   */
  async set(items) {
    return this.remote.setAsync(items);
  }

  /**
   * 从本地存储获取数据（向后兼容）
   * @param {string|string[]|null} keys - 要获取的键
   * @returns {Promise<object>}
   */
  async getLocal(keys = null) {
    return this.local.getAsync(keys);
  }

  /**
   * 设置本地存储数据（向后兼容）
   * @param {object} items - 键值对
   * @returns {Promise<void>}
   */
  async setLocal(items) {
    return this.local.setAsync(items);
  }

  /**
   * 从本地存储删除数据（向后兼容）
   * @param {string|string[]} keys - 要删除的键
   * @returns {Promise<void>}
   */
  async removeLocal(keys) {
    return this.local.removeAsync(keys);
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
   * @returns {Promise<object>}
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
    const result = await this.getLocal('learnedWords');
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
      await this.setLocal({ learnedWords: whitelist });
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
    await this.setLocal({ learnedWords: filtered });
  }

  /**
   * 获取需记忆列表
   * @returns {Promise<Array>}
   */
  async getMemorizeList() {
    const result = await this.getLocal('memorizeList');
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
      await this.setLocal({ memorizeList: list });
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
    await this.setLocal({ memorizeList: filtered });
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
   * 添加存储变化监听器（向后兼容）
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
