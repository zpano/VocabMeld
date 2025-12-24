/**
 * Storage Namespace
 * 提供低级存储 API，支持回调和 Promise 风格
 */
export class StorageNamespace {
  /**
   * @param {import('./IStorageAdapter.js').IStorageAdapter} adapter - 存储适配器
   * @param {boolean} shouldMergeDefaults - 是否与默认配置合并
   * @param {object|null} defaultConfig - 默认配置对象
   */
  constructor(adapter, shouldMergeDefaults = false, defaultConfig = null) {
    this.adapter = adapter;
    this.shouldMergeDefaults = shouldMergeDefaults;
    this.defaultConfig = defaultConfig;
  }

  /**
   * 从存储获取数据（回调风格）
   * @param {string|string[]|null} keys - 要获取的键，null 表示全部
   * @param {function(object): void} callback - 结果回调
   */
  get(keys, callback) {
    this.adapter.get(keys, (result) => {
      if (!this.shouldMergeDefaults || !this.defaultConfig) {
        callback(result);
        return;
      }

      // 仅对 remote 存储合并默认配置
      if (keys === null) {
        callback({ ...this.defaultConfig, ...result });
      } else if (typeof keys === 'string') {
        callback({ [keys]: result[keys] ?? this.defaultConfig[keys] });
      } else {
        const merged = {};
        keys.forEach(key => {
          merged[key] = result[key] ?? this.defaultConfig[key];
        });
        callback(merged);
      }
    });
  }

  /**
   * 设置存储数据（回调风格）
   * @param {object} items - 要存储的键值对
   * @param {function(): void} callback - 完成回调
   */
  set(items, callback) {
    this.adapter.set(items, callback);
  }

  /**
   * 从存储删除数据（回调风格）
   * @param {string|string[]} keys - 要删除的键
   * @param {function(): void} callback - 完成回调
   */
  remove(keys, callback) {
    this.adapter.remove(keys, callback);
  }

  /**
   * 监听存储变化
   * @param {function(object): void} callback - 变化回调
   * @returns {function} 取消监听的函数
   */
  onChanged(callback) {
    return this.adapter.onChanged(callback);
  }

  /**
   * 从存储获取数据（Promise 风格）
   * @param {string|string[]|null} keys - 要获取的键
   * @returns {Promise<object>}
   */
  getAsync(keys = null) {
    return new Promise((resolve, reject) => {
      this.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * 设置存储数据（Promise 风格）
   * @param {object} items - 要存储的键值对
   * @returns {Promise<void>}
   */
  setAsync(items) {
    return new Promise((resolve, reject) => {
      this.set(items, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 从存储删除数据（Promise 风格）
   * @param {string|string[]} keys - 要删除的键
   * @returns {Promise<void>}
   */
  removeAsync(keys) {
    return new Promise((resolve, reject) => {
      this.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }
}
