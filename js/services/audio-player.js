/**
 * Sapling 隐藏 iframe 音频播放器
 * 用于绕过页面 CSP 限制播放外部音频
 * 支持 Chrome 和 Firefox 统一方案
 */

let currentAudio = null;
let currentObjectUrl = null;

function stopCurrent() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = '';
    } catch {}
  }
  currentAudio = null;

  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch {}
  }
  currentObjectUrl = null;
}

function guessMimeType(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('.mp3')) return 'audio/mpeg';
  if (u.includes('.ogg') || u.includes('.oga')) return 'audio/ogg';
  if (u.includes('.wav')) return 'audio/wav';
  return '';
}

async function playFromUrl(url) {
  stopCurrent();

  const audio = new Audio();
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  audio.src = url;
  currentAudio = audio;

  await audio.play();
}

async function playViaFetch(url) {
  stopCurrent();

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  const type = response.headers.get('content-type') || guessMimeType(url) || 'audio/mpeg';

  const blob = new Blob([buffer], { type });
  const objectUrl = URL.createObjectURL(blob);
  currentObjectUrl = objectUrl;

  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = objectUrl;
  currentAudio = audio;

  audio.addEventListener(
    'ended',
    () => {
      if (currentObjectUrl) {
        try {
          URL.revokeObjectURL(currentObjectUrl);
        } catch {}
        currentObjectUrl = null;
      }
    },
    { once: true }
  );

  await audio.play();
}

async function playAudioUrls(urls) {
  let lastError = null;

  for (const url of urls) {
    // 尝试直接播放
    try {
      await playFromUrl(url);
      return;
    } catch (e) {
      lastError = e;
    }

    // 尝试通过 fetch 获取后播放（绕过 CORS）
    try {
      await playViaFetch(url);
      return;
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('All audio sources failed');
}

// 监听来自 Content Script 的消息
window.addEventListener('message', async (event) => {
  const { type, urls, requestId } = event.data || {};

  // 停止播放
  if (type === 'SAPLING_STOP_AUDIO') {
    stopCurrent();
    event.source?.postMessage({ type: 'SAPLING_AUDIO_RESULT', requestId, success: true }, '*');
    return;
  }

  // 播放音频
  if (type !== 'SAPLING_PLAY_AUDIO') return;

  try {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (!list.length) throw new Error('No audio URLs');

    await playAudioUrls(list);
    event.source?.postMessage({ type: 'SAPLING_AUDIO_RESULT', requestId, success: true }, '*');
  } catch (error) {
    event.source?.postMessage({
      type: 'SAPLING_AUDIO_RESULT',
      requestId,
      success: false,
      error: error?.message || String(error)
    }, '*');
  }
});

console.log('[Sapling] Audio iframe player loaded');
