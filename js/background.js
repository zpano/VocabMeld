/**
 * VocabMeld 后台脚本
 * 处理扩展级别的事件和消息
 */

// 安装/更新时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[VocabMeld] Extension installed/updated:', details.reason);
  
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
      translationStyle: 'original-translation',
      enabled: true,
      blacklist: [],
      whitelist: [],
      learnedWords: [],
      memorizeList: [],
      totalWords: 0,
      todayWords: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
      cacheHits: 0,
      cacheMisses: 0
    });
  }
  
  // 创建右键菜单
  createContextMenus();
});

// 创建右键菜单
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'vocabmeld-add-memorize',
      title: '添加到需记忆列表',
      contexts: ['selection']
    });
    
    chrome.contextMenus.create({
      id: 'vocabmeld-process-page',
      title: '处理当前页面',
      contexts: ['page']
    });
  });
}

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'vocabmeld-add-memorize' && info.selectionText) {
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
              console.log('[VocabMeld] Content script not ready, word will be processed on next page load');
            });
          });
        }
      });
    }
  }
  
  if (info.menuItemId === 'vocabmeld-process-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'processPage' });
  }
});

// 快捷键处理
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translation') {
    chrome.tabs.sendMessage(tab.id, { action: 'processPage' });
  }
});

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      sendResponse({
        size: cache.length,
        maxSize: 2000
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
});

console.log('[VocabMeld] Background script loaded');
