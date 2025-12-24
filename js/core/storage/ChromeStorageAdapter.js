/**
 * Chrome Storage API 适配器
 * 封装 chrome.storage.sync 或 chrome.storage.local
 */
import { IStorageAdapter } from './IStorageAdapter.js';

export class ChromeStorageAdapter extends IStorageAdapter {
  /**
   * @param {string} area - 存储区域: 'sync' 或 'local'
   */
  constructor(area) {
    super();
    this.area = area;
    this.storageArea = chrome.storage[area];
  }

  /**
   * 从 Chrome 存储获取数据
   * @param {string|string[]|null} keys - 要获取的键
   * @param {function(object): void} callback - 结果回调
   */
  get(keys, callback) {
    this.storageArea.get(keys, callback);
  }

  /**
   * 设置 Chrome 存储数据
   * @param {object} items - 键值对
   * @param {function(): void} callback - 完成回调
   */
  set(items, callback) {
    this.storageArea.set(items, callback);
  }

  /**
   * 从 Chrome 存储删除数据
   * @param {string|string[]} keys - 要删除的键
   * @param {function(): void} callback - 完成回调
   */
  remove(keys, callback) {
    this.storageArea.remove(keys, callback);
  }

  /**
   * 监听此存储区域的变化
   * @param {function(object): void} callback - 变化回调
   * @returns {function} 取消监听的函数
   */
  onChanged(callback) {
    const listener = (changes, areaName) => {
      if (areaName === this.area) {
        callback(changes);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}
