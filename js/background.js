/**
 * Sapling 后台脚本
 * 处理扩展级别的事件和消息
 */

import { CACHE_CONFIG, normalizeCacheMaxSize } from './core/config.js';

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) return false;

  try {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (hasDocument) return true;

    const reason = chrome.offscreen?.Reason?.AUDIO_PLAYBACK || 'AUDIO_PLAYBACK';
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [reason],
      justification: 'Play pronunciation audio without being blocked by the page CSP.'
    });
    return true;
  } catch (error) {
    console.warn('[Sapling] Failed to ensure offscreen document:', error);
    return false;
  }
}

async function sendToOffscreen(message) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  }
  throw lastError || new Error('Failed to send message to offscreen document');
}

const MENU_ID_ADD_MEMORIZE = 'vocabmeld-add-memorize';
const MENU_ID_TOGGLE_PAGE = 'vocabmeld-process-page';

// 安装/更新时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Sapling] Extension installed/updated:', details.reason);
  
  // 设置默认配置
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      apiEndpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: '',
      modelName: 'deepseek-chat',
      nativeLanguage: 'zh-CN',
      targetLanguage: 'en',
      difficultyLevel: 'B1',
      intensity: 'medium',
      autoProcess: false,
      showPhonetic: true,
      allowLeftClickPronunciation: true,
      restoreAllSameWordsOnLearned: true,
      pronunciationProvider: 'wiktionary',
      youdaoPronunciationType: 2,
      translationStyle: 'original-translation',
      enabled: true,
      blacklist: [],
      whitelist: [],
      learnedWords: [],
      memorizeList: [],
      cacheMaxSize: CACHE_CONFIG.maxSize,
      totalWords: 0,
      todayWords: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
      cacheHits: 0,
      cacheMisses: 0
    });
  } else {
    chrome.storage.sync.get('cacheMaxSize', (result) => {
      if (result.cacheMaxSize == null) chrome.storage.sync.set({ cacheMaxSize: CACHE_CONFIG.maxSize });
    });
  }
  
  // 创建右键菜单
  createContextMenus();
});

function isPageProcessed(status) {
  if (!status) return false;
  return Boolean(
    status.hasTranslations ||
    status.hasProcessedMarkers ||
    (Number(status.processed) || 0) > 0
  );
}

function getTogglePageMenuTitle(processed) {
  return processed ? '还原当前页面' : '处理当前页面';
}

async function getTabStatus(tabId) {
  if (!tabId) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'getStatus' });
  } catch {
    return null;
  }
}

function updateTogglePageMenuTitle(tabId, processed) {
  chrome.contextMenus.update(
    MENU_ID_TOGGLE_PAGE,
    { title: getTogglePageMenuTitle(processed) },
    () => {
      chrome.contextMenus.refresh?.();
    }
  );
}

async function refreshTogglePageMenuTitle(tabId) {
  const status = await getTabStatus(tabId);
  updateTogglePageMenuTitle(tabId, isPageProcessed(status));
}

async function togglePageProcessing(tabId) {
  const status = await getTabStatus(tabId);
  const processed = isPageProcessed(status);
  const action = processed ? 'restorePage' : 'processPage';
  let ok = true;
  try {
    await chrome.tabs.sendMessage(tabId, { action });
  } catch {
    ok = false;
  }

  // Best-effort update the menu title immediately (actual page state may update shortly after).
  updateTogglePageMenuTitle(tabId, ok ? !processed : false);
  return { success: ok, processedBefore: processed, processedAfter: ok ? !processed : processed };
}

// 创建右键菜单
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID_ADD_MEMORIZE,
      title: '添加到需记忆列表',
      contexts: ['selection']
    });
    
  chrome.contextMenus.create({
      id: MENU_ID_TOGGLE_PAGE,
      title: getTogglePageMenuTitle(false),
      contexts: ['page']
    });
  });
}

if (chrome.contextMenus?.onShown?.addListener) {
  chrome.contextMenus.onShown.addListener((info, tab) => {
    if (!tab?.id) return;
    if (!info?.contexts?.includes?.('page')) return;
    refreshTogglePageMenuTitle(tab.id);
  });
}

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID_ADD_MEMORIZE && info.selectionText) {
    const word = info.selectionText.trim();
    if (word && word.length < 50) {
      chrome.storage.sync.get('memorizeList', (result) => {
        const list = result.memorizeList || [];
        if (!list.some(w => w.word === word)) {
          list.push({ word, addedAt: Date.now() });
          chrome.storage.sync.set({ memorizeList: list }, () => {
            // 通知 content script 处理特定单词
            chrome.tabs.sendMessage(tab.id, { 
              action: 'processSpecificWords', 
              words: [word] 
            }).catch(err => {
              console.log('[Sapling] Content script not ready, word will be processed on next page load');
            });
          });
        }
      });
    }
  }
  
  if (info.menuItemId === MENU_ID_TOGGLE_PAGE && tab?.id) {
    togglePageProcessing(tab.id).catch(() => {});
  }
});

// 快捷键处理
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translation') {
    if (tab?.id) {
      togglePageProcessing(tab.id).catch(() => {});
    }
  }
});

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'togglePageProcessing') {
    (async () => {
      const tabId = message.tabId;
      if (!tabId) return sendResponse({ success: false, message: 'No tabId provided' });
      const result = await togglePageProcessing(tabId);
      sendResponse(result);
    })();
    return true;
  }

  if (message?.action === 'refreshTogglePageMenuTitle') {
    (async () => {
      const tabId = message.tabId;
      if (!tabId) return sendResponse({ success: false, message: 'No tabId provided' });
      await refreshTogglePageMenuTitle(tabId);
      sendResponse({ success: true });
    })();
    return true;
  }

  // offscreen 消息不在这里处理（避免自发自收导致循环）
  if (message?.action?.startsWith?.('offscreen')) return;

  // 播放外部音频（绕过网页 CSP）
  if (message.action === 'playAudioUrls') {
    (async () => {
      try {
        const ok = await ensureOffscreenDocument();
        if (!ok) throw new Error('Offscreen document not available');

        const urls = Array.isArray(message.urls) ? message.urls : [];
        const result = await sendToOffscreen({ action: 'offscreenPlayAudioUrls', urls });
        sendResponse(result || { success: true });
      } catch (error) {
        sendResponse({ success: false, message: error?.message || String(error) });
      }
    })();
    return true;
  }

  // 语音合成
  if (message.action === 'speak') {
    chrome.tts.speak(message.text, {
      lang: message.lang || 'en-US',
      rate: 0.9,
      pitch: 1.0
    });
    sendResponse({ success: true });
    return true;
  }
  
  // 测试 API 连接
  if (message.action === 'testApi') {
    testApiConnection(message.endpoint, message.apiKey, message.model)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, message: error.message }));
    return true;
  }
  
  // 获取统计数据
  if (message.action === 'getStats') {
    chrome.storage.sync.get([
      'totalWords', 'todayWords', 'lastResetDate',
      'cacheHits', 'cacheMisses', 'learnedWords', 'memorizeList'
    ], (result) => {
      // 检查是否需要重置今日统计
      const today = new Date().toISOString().split('T')[0];
      if (result.lastResetDate !== today) {
        result.todayWords = 0;
        result.lastResetDate = today;
        chrome.storage.sync.set({ todayWords: 0, lastResetDate: today });
      }
      
      sendResponse({
        totalWords: result.totalWords || 0,
        todayWords: result.todayWords || 0,
        learnedCount: (result.learnedWords || []).length,
        memorizeCount: (result.memorizeList || []).length,
        cacheHits: result.cacheHits || 0,
        cacheMisses: result.cacheMisses || 0
      });
    });
    return true;
  }
  
  // 获取缓存统计
  if (message.action === 'getCacheStats') {
    chrome.storage.local.get('vocabmeld_word_cache', (result) => {
      const cache = result.vocabmeld_word_cache || [];
      chrome.storage.sync.get('cacheMaxSize', (cfg) => {
        const maxSize = normalizeCacheMaxSize(cfg.cacheMaxSize, CACHE_CONFIG.maxSize);
        sendResponse({
          size: cache.length,
          maxSize
        });
      });
    });
    return true;
  }
  
  // 清空缓存
  if (message.action === 'clearCache') {
    chrome.storage.local.remove('vocabmeld_word_cache', () => {
      chrome.storage.sync.set({ cacheHits: 0, cacheMisses: 0 }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  // 清空已学会词汇
  if (message.action === 'clearLearnedWords') {
    chrome.storage.sync.set({ learnedWords: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  // 清空需记忆列表
  if (message.action === 'clearMemorizeList') {
    chrome.storage.sync.set({ memorizeList: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// 测试 API 连接
async function testApiConnection(endpoint, apiKey, model) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10
      })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }
    
    const data = await response.json();
    if (data.choices && data.choices[0]) {
      return { success: true, message: '连接成功！' };
    }
    
    throw new Error('Invalid response');
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 扩展图标点击（如果没有 popup）
chrome.action.onClicked.addListener((tab) => {
  // 由于我们有 popup，这个不会被触发
  // 但保留以防万一
});

// 标签页更新时检查是否需要注入脚本
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    // 可以在这里做额外的初始化
  }

  // Keep context menu title in sync with the active tab, even on browsers without `contextMenus.onShown`.
  if (!tab?.active) return;
  if (changeInfo.status === 'loading') {
    updateTogglePageMenuTitle(tabId, false);
  }
  if (changeInfo.status === 'complete') {
    refreshTogglePageMenuTitle(tabId);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!activeInfo?.tabId) return;
  refreshTogglePageMenuTitle(activeInfo.tabId);
});

console.log('[Sapling] Background script loaded');
