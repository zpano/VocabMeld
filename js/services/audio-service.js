/**
 * Sapling 音频播放服务
 * 使用 Web Audio API 绕过页面 CSP media-src 限制
 * AudioContext.decodeAudioData() 直接解码 ArrayBuffer，不需要 blob: URL
 */

import { showToast } from '../ui/toast.js';

// Web Audio API 状态
let audioContext = null;
let currentSource = null;

/**
 * 获取或创建 AudioContext（单例）
 * @returns {AudioContext}
 */
function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

/**
 * Base64 转 ArrayBuffer
 * @param {string} base64 - Base64 编码的数据
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 停止当前播放
 */
export function stopAudio() {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // AudioBufferSourceNode.stop() 可能抛出异常（如果已停止）
    }
    currentSource.disconnect();
    currentSource = null;
  }
}

/**
 * 播放音频 URL
 * 通过 background 代理 fetch，使用 Web Audio API 播放
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

    // 获取 AudioContext
    const ctx = getAudioContext();

    // 如果 AudioContext 被暂停（Autoplay Policy），尝试恢复
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Base64 转 ArrayBuffer
    const arrayBuffer = base64ToArrayBuffer(result.data);

    // 解码音频数据
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    // 创建 AudioBufferSourceNode（一次性使用）
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // 保存引用以支持 stopAudio()
    currentSource = source;

    // 播放结束后清理引用
    source.onended = () => {
      if (currentSource === source) {
        currentSource = null;
      }
    };

    // 开始播放
    source.start(0);

  } catch (error) {
    // 清理资源
    stopAudio();

    // 处理不同类型的错误
    if (error?.name === 'NotAllowedError' || error?.message?.includes('interact')) {
      showToast('请先点击页面以启用音频', { type: 'error' });
    } else if (error?.name === 'EncodingError') {
      showToast('音频格式不支持', { type: 'error' });
    }

    throw error;
  }
}
