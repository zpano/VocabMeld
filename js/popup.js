/**
 * VocabMeld Popup 脚本
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM 元素
  const enableToggle = document.getElementById('enableToggle');
  const toggleLabel = document.getElementById('toggleLabel');
  const totalWords = document.getElementById('totalWords');
  const todayWords = document.getElementById('todayWords');
  const learnedCount = document.getElementById('learnedCount');
  const memorizeCount = document.getElementById('memorizeCount');
  const cacheSize = document.getElementById('cacheSize');
  const hitRate = document.getElementById('hitRate');
  const processBtn = document.getElementById('processBtn');
  const settingsBtn = document.getElementById('settingsBtn');

  // 加载配置和统计
  async function loadData() {
    // 加载启用状态
    chrome.storage.sync.get('enabled', (result) => {
      const enabled = result.enabled !== false;
      enableToggle.checked = enabled;
      toggleLabel.textContent = enabled ? '已启用' : '已禁用';
      toggleLabel.className = `toggle-label ${enabled ? 'enabled' : 'disabled'}`;
    });

    // 加载统计数据
    chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
      if (response) {
        totalWords.textContent = formatNumber(response.totalWords);
        todayWords.textContent = formatNumber(response.todayWords);
        learnedCount.textContent = formatNumber(response.learnedCount);
        memorizeCount.textContent = formatNumber(response.memorizeCount);

        const total = response.cacheHits + response.cacheMisses;
        const rate = total > 0 ? Math.round((response.cacheHits / total) * 100) : 0;
        hitRate.textContent = rate + '%';
      }
    });

    // 加载缓存统计
    chrome.runtime.sendMessage({ action: 'getCacheStats' }, (response) => {
      if (response) {
        cacheSize.textContent = `${response.size}/${response.maxSize}`;
      }
    });
  }

  // 格式化数字
  function formatNumber(num) {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  }

  // 切换启用状态
  enableToggle.addEventListener('change', () => {
    const enabled = enableToggle.checked;
    chrome.storage.sync.set({ enabled }, () => {
      toggleLabel.textContent = enabled ? '已启用' : '已禁用';
      toggleLabel.className = `toggle-label ${enabled ? 'enabled' : 'disabled'}`;
      
      // 通知内容脚本
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        const url = tab?.url || '';
        if (!tab?.id || (!url.startsWith('http') && !url.startsWith('file:'))) {
          return;
        }

        // `chrome.tabs.sendMessage` returns a Promise in MV3; catch to avoid
        // "Uncaught (in promise) ... Receiving end does not exist" on pages
        // where content scripts cannot run (e.g. chrome://, Web Store).
        chrome.tabs.sendMessage(tab.id, {
          action: enabled ? 'processPage' : 'restorePage'
        }).catch(() => {});
      });
    });
  });

  // 处理页面按钮
  processBtn.addEventListener('click', async () => {
    processBtn.disabled = true;
    processBtn.innerHTML = `
      <svg class="spinning" viewBox="0 0 24 24" width="18" height="18">
        <path fill="currentColor" d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
      </svg>
      处理中...
    `;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'processPage' }, (response) => {
          setTimeout(() => {
            processBtn.disabled = false;
            processBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
              </svg>
              处理当前页面
            `;
            // 刷新统计
            loadData();
          }, 1000);
        });
      }
    } catch (e) {
      console.error('Error processing page:', e);
      processBtn.disabled = false;
      processBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
        </svg>
        处理当前页面
      `;
    }
  });

  // 设置按钮
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 初始加载
  loadData();

  // 定期刷新
  setInterval(loadData, 5000);
});
