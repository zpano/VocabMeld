/**
 * Sapling AudioIframePlayer
 * 通过隐藏 iframe 绕过页面 CSP 限制播放外部音频
 * 统一 Chrome 和 Firefox 方案，替代 offscreen document
 */

class AudioIframePlayer {
  constructor() {
    this.iframe = null;
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    this.messageHandler = null;
    this.iframeReady = false;
    this.initPromise = null;
  }

  /**
   * 确保 iframe 已创建并加载完成
   */
  async ensureIframe() {
    // 已经初始化完成
    if (this.iframe && document.contains(this.iframe) && this.iframeReady) {
      return;
    }

    // 正在初始化中，等待完成
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._createIframe();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async _createIframe() {
    // 清理旧的 iframe
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
      this.iframeReady = false;
    }

    // 创建隐藏 iframe
    this.iframe = document.createElement('iframe');
    this.iframe.src = chrome.runtime.getURL('js/services/audio-player.html');
    this.iframe.style.cssText = 'display:none;width:0;height:0;border:none;position:fixed;top:-9999px;left:-9999px;pointer-events:none;';
    this.iframe.setAttribute('aria-hidden', 'true');
    this.iframe.setAttribute('tabindex', '-1');
    this.iframe.id = 'sapling-audio-iframe';

    // 注册消息监听器（只注册一次）
    if (!this.messageHandler) {
      this.messageHandler = (event) => {
        if (event.data?.type !== 'SAPLING_AUDIO_RESULT') return;

        const { requestId, success, error } = event.data;
        const resolver = this.pendingRequests.get(requestId);

        if (resolver) {
          this.pendingRequests.delete(requestId);
          if (success) {
            resolver.resolve();
          } else {
            resolver.reject(new Error(error || 'Audio play failed'));
          }
        }
      };
      window.addEventListener('message', this.messageHandler);
    }

    // 添加到 DOM
    document.body.appendChild(this.iframe);

    // 等待 iframe 加载完成
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Audio iframe load timeout'));
      }, 5000);

      this.iframe.onload = () => {
        clearTimeout(timeout);
        this.iframeReady = true;
        resolve();
      };

      this.iframe.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Audio iframe load error'));
      };
    });
  }

  /**
   * 播放音频
   * @param {string|string[]} urls - 音频 URL 或 URL 数组
   * @returns {Promise<void>}
   */
  async play(urls) {
    await this.ensureIframe();

    const requestId = ++this.requestIdCounter;
    const urlList = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean);

    if (!urlList.length) {
      throw new Error('No audio URLs provided');
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      try {
        this.iframe.contentWindow.postMessage({
          type: 'SAPLING_PLAY_AUDIO',
          urls: urlList,
          requestId
        }, '*');
      } catch (e) {
        this.pendingRequests.delete(requestId);
        reject(new Error('Failed to send message to audio iframe'));
        return;
      }

      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Audio playback timeout'));
        }
      }, 15000);
    });
  }

  /**
   * 停止当前播放
   */
  stop() {
    if (this.iframe?.contentWindow) {
      try {
        this.iframe.contentWindow.postMessage({ type: 'SAPLING_STOP_AUDIO' }, '*');
      } catch {}
    }
  }

  /**
   * 销毁播放器
   */
  destroy() {
    this.stop();

    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }

    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }

    this.iframeReady = false;
    this.initPromise = null;
    this.pendingRequests.clear();
  }
}

// 导出单例
export const audioIframePlayer = new AudioIframePlayer();
