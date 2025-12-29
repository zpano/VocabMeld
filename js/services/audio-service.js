/**
 * Sapling 音频播放服务
 * 通过 background service worker 代理 fetch，绕过页面 CSP 限制
 * 在主页面播放，满足浏览器 Autoplay Policy 要求
 */

import { showToast } from '../ui/toast.js';

let currentAudio = null;
let currentBlobUrl = null;

/**
 * Base64 转 Blob
 * @param {string} base64 - Base64 编码的数据
 * @param {string} contentType - MIME 类型
 * @returns {Blob}
 */
function base64ToBlob(base64, contentType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

/**
 * 停止当前播放
 */
export function stopAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = '';
    } catch {}
    currentAudio = null;
  }

  if (currentBlobUrl) {
    try {
      URL.revokeObjectURL(currentBlobUrl);
    } catch {}
    currentBlobUrl = null;
  }
}

/**
 * 播放音频 URL
 * 通过 background 代理 fetch，然后在主页面播放
 * @param {string} url - 音频 URL
 * @returns {Promise<void>}
 */
export async function playAudioUrl(url) {
  if (!url) {
    throw new Error('No audio URL provided');
  }

  // 停止当前播放
  stopAudio();

  try {
    // 通过 background 代理 fetch 音频数据
    const result = await chrome.runtime.sendMessage({ action: 'fetchAudioData', url });

    if (!result?.success) {
      showToast('音频加载失败', { type: 'error' });
      throw new Error(result?.message || 'Fetch failed');
    }

    // 创建 Blob URL
    const blob = base64ToBlob(result.data, result.contentType);
    currentBlobUrl = URL.createObjectURL(blob);

    // 创建 Audio 元素并播放
    currentAudio = new Audio();
    currentAudio.preload = 'auto';
    currentAudio.src = currentBlobUrl;

    // 播放结束后清理
    currentAudio.addEventListener('ended', () => {
      if (currentBlobUrl) {
        try {
          URL.revokeObjectURL(currentBlobUrl);
        } catch {}
        currentBlobUrl = null;
      }
    }, { once: true });

    await currentAudio.play();
  } catch (error) {
    // 清理资源
    stopAudio();

    // 如果是 Autoplay Policy 错误，显示提示
    if (error?.message?.includes('interact')) {
      showToast('请先点击页面以启用音频', { type: 'error' });
    }

    throw error;
  }
}
