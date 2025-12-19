/**
 * Sapling Toast 通知组件
 * 提取自 content.js
 */

/**
 * 显示 Toast 通知
 * @param {string} message - 通知消息
 */
export function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'vocabmeld-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('vocabmeld-toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('vocabmeld-toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
