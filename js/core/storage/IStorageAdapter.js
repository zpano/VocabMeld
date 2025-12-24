/**
 * Storage Adapter 接口
 * 定义存储后端实现的契约（Chrome Storage、WebDAV 等）
 */
export class IStorageAdapter {
  /**
   * 从存储中获取数据
   * @param {string|string[]|null} keys - 要获取的键，null 表示获取全部
   * @param {function(object): void} callback - 回调函数，接收结果对象
   */
  get(keys, callback) {
    throw new Error('IStorageAdapter.get() must be implemented');
  }

  /**
   * 设置存储数据
   * @param {object} items - 要存储的键值对
   * @param {function(): void} callback - 完成回调
   */
  set(items, callback) {
    throw new Error('IStorageAdapter.set() must be implemented');
  }

  /**
   * 从存储中删除数据
   * @param {string|string[]} keys - 要删除的键
   * @param {function(): void} callback - 完成回调
   */
  remove(keys, callback) {
    throw new Error('IStorageAdapter.remove() must be implemented');
  }

  /**
   * 监听存储变化
   * @param {function(object): void} callback - 变化回调，接收 changes 对象
   * @returns {function} 取消监听的函数
   */
  onChanged(callback) {
    throw new Error('IStorageAdapter.onChanged() must be implemented');
  }
}
