# WXT 框架重构调研报告

## 一、WXT 框架概述

[WXT](https://wxt.dev/) 是下一代 Web Extension 框架，提供以下核心特性：

- **热模块替换 (HMR)**：开发时自动刷新，无需手动重载扩展
- **文件式入口点**：通过 `entrypoints/` 目录自动发现和配置入口
- **多浏览器支持**：统一构建 Chrome、Firefox、Safari、Edge、Opera
- **TypeScript 原生支持**：开箱即用的类型支持
- **Vite 构建**：基于 Vite，支持现代 JavaScript 特性和快速构建
- **自动发布**：支持自动化发布到各浏览器商店

### 1.1 目录结构对比

| 当前项目 | WXT 项目 |
|---------|----------|
| `js/background.js` | `entrypoints/background.ts` |
| `js/content.js` | `entrypoints/content.ts` |
| `popup.html/js` | `entrypoints/popup/index.html` |
| `options.html/js` | `entrypoints/options/index.html` |
| `offscreen.html/js` | `entrypoints/offscreen/index.html` |
| `manifest.json` | `wxt.config.ts` |
| `vendor/` | 直接 npm 导入或 `public/` |
| `_locales/` | `public/_locales/` |

### 1.2 WXT 入口点示例

```typescript
// entrypoints/background.ts
export default defineBackground(() => {
  console.log('Background script loaded');
  browser.runtime.onInstalled.addListener(() => {
    // 初始化逻辑
  });
});

// entrypoints/content.ts
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main(ctx) {
    console.log('Content script loaded');
  },
});
```

---

## 二、当前项目 Chrome API 使用分析

### 2.1 API 兼容性矩阵

| API | Chrome | Firefox | 备注 |
|-----|--------|---------|------|
| `chrome.storage` | ✅ | ✅ | 完全兼容 |
| `chrome.runtime` | ✅ | ✅ | 完全兼容 |
| `chrome.tabs` | ✅ | ✅ | 完全兼容 |
| `chrome.contextMenus` | ✅ | ✅ | 完全兼容 |
| `chrome.commands` | ✅ | ✅ | 完全兼容 |
| `chrome.action` | ✅ | ✅ | 完全兼容 |
| `chrome.scripting` | ✅ | ✅ | 完全兼容 |
| ~~`chrome.offscreen`~~ | - | - | **已移除**，改用 iframe 方案 |
| ~~`chrome.tts`~~ | - | - | **已移除**，改用 Google Translate TTS |

### 2.2 关键代码位置

| 文件 | Chrome API | 行数 |
|------|------------|------|
| `js/background.js` | `chrome.contextMenus` | 120-167 |
| `js/background.js` | `chrome.commands` | 174-180 |
| `js/services/audio-iframe-player.js` | iframe 音频播放 | 全文件 |
| `js/content.js` | `chrome.runtime.onMessage` | 多处 |
| `js/popup.js` | `chrome.tabs`, `chrome.runtime` | 多处 |
| `js/core/storage/` | `chrome.storage` | 多处 |

---

## 三、重构困难度评估

### 3.1 难度等级：中等偏高 (3.5/5)

### 3.2 低难度任务 (约 40% 工作量)

1. **目录结构重组**
   - 将 `js/background.js` → `entrypoints/background.ts`
   - 将 `js/content.js` → `entrypoints/content.ts`
   - 将 `popup.*` → `entrypoints/popup/`
   - 将 `options.*` → `entrypoints/options/`
   - 将 `_locales/` → `public/_locales/`

2. **manifest.json → wxt.config.ts**
   ```typescript
   // wxt.config.ts
   export default defineConfig({
     manifest: {
       name: '__MSG_extensionName__',
       description: '__MSG_extensionDescription__',
       default_locale: 'zh_CN',
       permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
       host_permissions: ['<all_urls>'],
       commands: {
         'toggle-translation': {
           suggested_key: { default: 'Alt+T' },
           description: '__MSG_commandToggleTranslation__'
         }
       }
     },
     // Firefox 默认使用 MV2，Chrome 使用 MV3
   });
   ```

3. **全局变量切换**
   - `chrome.` → `browser.`（WXT 自动处理）

4. **添加入口点导出**
   - 所有入口点文件添加 `defineBackground`/`defineContentScript` 默认导出

### 3.3 中等难度任务 (约 30% 工作量)

1. **ES 模块重构**
   - 当前项目使用原生 ES6 模块，WXT 也支持，但需要调整导入路径
   - 使用 `~/` 或 `@/` 路径别名替代相对路径

2. **第三方库处理 (segmentit)**
   ```typescript
   // 方案 A: 直接 npm 导入（推荐）
   import Segmentit from 'segmentit';

   // 方案 B: 放入 public/ 目录
   // public/vendor/segmentit.bundle.js
   // 在 HTML 中引入或动态加载
   ```

3. **存储层适配**
   - 当前使用自定义 `StorageService` 抽象层
   - 可继续使用，或迁移到 WXT 的 `wxt/storage` 工具

4. **类型定义添加**
   - 当前项目为纯 JavaScript，迁移时可选择添加 TypeScript 类型

### 3.4 高难度任务 (约 30% 工作量) ✅ 已解决

#### 3.4.1 Offscreen Document 替代方案 ✅ 已完成

**原问题**：Firefox 不支持 `chrome.offscreen` API

**解决方案**：已采用 **隐藏 iframe 方案**（见第十节），统一 Chrome 和 Firefox 代码路径。

相关文件：
- `audio-player.html` — iframe 音频播放页面
- `audio-player.js` — iframe 内音频播放逻辑
- `js/services/audio-iframe-player.js` — iframe 播放器服务类

#### 3.4.2 TTS API 替代方案 ✅ 已完成

**原问题**：Firefox 不支持 `chrome.tts` API

**解决方案**：已移除 Chrome TTS，改用 **Google Translate TTS** 作为最终后备方案。

发音降级策略：
1. Google TTS（如 provider=google）
2. Youdao（仅英语，如 provider=youdao）
3. Wiktionary（仅英语）
4. Google Translate TTS（所有语言，最终后备）

#### 3.4.3 入口点过滤

~~对于 Firefox 不支持的功能，使用 `include`/`exclude` 过滤~~ — **已不需要**，所有功能现在都跨浏览器兼容。

---

## 四、可能遇到的问题

### 4.1 构建相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `segmentit` 打包失败 | 库可能有 CommonJS/ESM 兼容问题 | 使用 `vite-plugin-commonjs` 或预打包 |
| 类型错误 | 迁移到 TS 时类型缺失 | 添加 `@types/chrome`，或使用 `any` |
| HMR 不工作 | content script 特殊性 | WXT 已处理，但复杂 DOM 操作可能需手动刷新 |

### 4.2 运行时相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| ~~Firefox 音频播放失败~~ | ~~CSP 限制~~ | ✅ 已通过 iframe 方案解决 |
| ~~Firefox TTS 无声音~~ | ~~API 不存在~~ | ✅ 已改用 Google Translate TTS |
| 存储配额差异 | Firefox sync 配额更小 | 保持使用 local 存储大数据 |

### 4.3 发布相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| Firefox 源码审核 | AMO 要求上传源码 | `wxt zip -b firefox` 自动生成 |
| 权限警告变化 | manifest 差异 | 使用 [Google 测试工具](https://nickcis.github.io/update-testing/) 验证 |

---

## 五、重构步骤建议

### 阶段 1: 基础迁移 (1-2 天)

1. 初始化 WXT 项目
   ```bash
   pnpm create wxt@latest sapling-wxt
   cd sapling-wxt
   pnpm install
   ```

2. 迁移静态资源
   - `icons/` → `public/icons/`
   - `css/` → `assets/` 或 `public/css/`
   - `_locales/` → `public/_locales/`
   - `wordlist/` → `public/wordlist/`

3. 迁移 `manifest.json` 到 `wxt.config.ts`

### 阶段 2: 入口点迁移 (2-3 天)

1. 迁移 background script
2. 迁移 content script
3. 迁移 popup 页面
4. 迁移 options 页面
5. 迁移 offscreen document（仅 Chrome）

### 阶段 3: 服务层迁移 (1-2 天)

1. 迁移 `js/services/`
2. 迁移 `js/core/`
3. 迁移 `js/utils/`
4. 迁移 `js/ui/`
5. 迁移 `js/config/`
6. 迁移 `js/prompts/`

### 阶段 4: 跨浏览器适配 (1-2 天) ✅ 大幅简化

1. ~~实现 Offscreen Document 替代方案~~ ✅ 已完成（iframe 方案）
2. ~~实现 TTS API 替代方案~~ ✅ 已完成（Google Translate TTS）
3. 测试 Firefox 兼容性
4. 修复浏览器特定 bug

### 阶段 5: 测试与发布 (1-2 天)

1. Chrome 端到端测试
2. Firefox 端到端测试
3. 构建发布包
4. 提交审核

---

## 六、工作量估算

| 任务 | 预计时间 | 优先级 |
|------|----------|--------|
| 项目初始化 | 2h | P0 |
| 目录结构迁移 | 4h | P0 |
| manifest → config | 2h | P0 |
| Background script | 4h | P0 |
| Content script | 8h | P0 |
| Popup/Options | 4h | P0 |
| 服务层迁移 | 8h | P1 |
| ~~Offscreen 替代方案~~ | ~~8h~~ | ✅ 已完成 |
| ~~TTS 替代方案~~ | ~~4h~~ | ✅ 已完成 |
| Firefox 测试调试 | 4h | P1 |
| 文档更新 | 2h | P2 |
| **总计** | **~38h (5 工作日)** | |

---

## 七、风险与建议

### 7.1 主要风险

1. ~~**Offscreen Document 替代方案复杂度高**~~ ✅ 已解决
   - ~~风险：Firefox 下音频播放可能无法完美复现 Chrome 行为~~
   - 解决：已采用 iframe 方案，统一 Chrome/Firefox 代码

2. **segmentit 库兼容性**
   - 风险：该库可能有浏览器特定代码
   - 缓解：预先测试库在 Firefox 中的表现

3. ~~**用户体验差异**~~ ✅ 已解决
   - ~~风险：Firefox 用户可能体验到功能缺失（如 TTS 音色不同）~~
   - 解决：已统一使用 Google Translate TTS，体验一致

### 7.2 建议

1. **渐进式迁移**：先完成 Chrome 版本的 WXT 迁移，确认功能正常后再处理 Firefox 适配

2. **保留回退选项**：保留原项目代码，便于对比和回退

3. **功能降级策略**：对于 Firefox 不支持的功能，提供优雅降级而非完全禁用

4. **自动化测试**：利用 WXT 的 Vitest 集成添加单元测试，减少回归风险

---

## 八、参考资源

- [WXT 官方文档](https://wxt.dev/)
- [WXT 迁移指南](https://wxt.dev/guide/resources/migrate)
- [WXT GitHub 仓库](https://github.com/wxt-dev/wxt)
- [Firefox MV3 迁移指南](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [W3C WebExtensions Offscreen 提案](https://github.com/w3c/webextensions/issues/170)
- [Chrome 扩展更新测试工具](https://nickcis.github.io/update-testing/)

---

## 九、结论

使用 WXT 重构 Sapling 扩展是**可行的**，且难度已大幅降低：

1. ~~**最大挑战**：`chrome.offscreen` API 的 Firefox 替代方案~~ ✅ 已解决（iframe 方案）
2. ~~**次要挑战**：`chrome.tts` API 的跨浏览器兼容~~ ✅ 已解决（Google Translate TTS）
3. **工作量**：预计 **5 个工作日**完成完整迁移（原估算 7-8 天）
4. **收益**：
   - 支持 Firefox 用户群
   - 更好的开发体验（HMR）
   - 更现代的构建工具链
   - 更易维护的代码结构

**建议**：由于跨浏览器兼容性障碍已清除，现在是进行 WXT 迁移的好时机。

---

## 十、统一 CSP 绕过方案：隐藏 iframe 音频播放器

### 10.1 方案概述

经过调研，发现一种**统一的跨浏览器方案**，可以避免为 Chrome 和 Firefox 维护两套不同的代码：

**核心原理**：使用 `web_accessible_resources` + 隐藏 iframe

```
页面 CSP 限制 → Content Script 受限
              ↓
扩展内部 iframe (chrome-extension://xxx/audio-player.html)
              ↓
iframe 内是扩展上下文 → 不受页面 CSP 限制 → 可自由播放音频
```

### 10.2 架构图

```
┌─────────────────────────────────────────────────────────┐
│ 网页 (受 CSP 限制)                                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Content Script                                       │ │
│  │  - 创建隐藏 iframe                                    │ │
│  │  - 通过 postMessage 发送播放指令                      │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ <iframe src="chrome-extension://xxx/audio.html">    │ │
│  │   (扩展上下文，不受页面 CSP 限制)                      │ │
│  │   - 监听 postMessage                                 │ │
│  │   - 使用 Audio API 播放                              │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 10.3 方案对比

| 维度 | Offscreen Document | 隐藏 iframe |
|------|-------------------|-------------|
| Chrome 支持 | ✅ | ✅ |
| Firefox 支持 | ❌ | ✅ |
| 代码统一 | 需要两套 | **一套代码** |
| 复杂度 | 中 | 低 |
| 性能 | 略优 | 略劣（多一个 iframe） |
| 维护成本 | 高 | **低** |

### 10.4 实现代码

#### 10.4.1 音频播放器页面

```html
<!-- audio-player.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Sapling Audio Player</title>
</head>
<body>
  <script src="audio-player.js"></script>
</body>
</html>
```

```javascript
// audio-player.js
let currentAudio = null;
let currentObjectUrl = null;

function stopCurrent() {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.src = ''; } catch {}
  }
  currentAudio = null;
  if (currentObjectUrl) {
    try { URL.revokeObjectURL(currentObjectUrl); } catch {}
  }
  currentObjectUrl = null;
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
  const blob = new Blob([buffer], { type: response.headers.get('content-type') || 'audio/mpeg' });
  const objectUrl = URL.createObjectURL(blob);
  currentObjectUrl = objectUrl;
  const audio = new Audio(objectUrl);
  audio.preload = 'auto';
  currentAudio = audio;
  audio.addEventListener('ended', () => {
    if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch {} currentObjectUrl = null; }
  }, { once: true });
  await audio.play();
}

async function playAudioUrls(urls) {
  let lastError = null;
  for (const url of urls) {
    try { await playFromUrl(url); return; } catch (e) { lastError = e; }
    try { await playViaFetch(url); return; } catch (e) { lastError = e; }
  }
  throw lastError || new Error('All audio sources failed');
}

window.addEventListener('message', async (event) => {
  const { type, urls, requestId } = event.data || {};

  if (type === 'SAPLING_STOP_AUDIO') {
    stopCurrent();
    event.source?.postMessage({ type: 'SAPLING_AUDIO_RESULT', requestId, success: true }, '*');
    return;
  }

  if (type !== 'SAPLING_PLAY_AUDIO') return;

  try {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (!list.length) throw new Error('No audio URLs');
    await playAudioUrls(list);
    event.source?.postMessage({ type: 'SAPLING_AUDIO_RESULT', requestId, success: true }, '*');
  } catch (error) {
    event.source?.postMessage({ type: 'SAPLING_AUDIO_RESULT', requestId, success: false, error: error?.message || String(error) }, '*');
  }
});
```

#### 10.4.2 AudioIframePlayer 服务类

```javascript
// js/services/audio-iframe-player.js
class AudioIframePlayer {
  constructor() {
    this.iframe = null;
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    this.messageHandler = null;
  }

  async ensureIframe() {
    if (this.iframe && document.contains(this.iframe)) return;

    // 创建隐藏 iframe
    this.iframe = document.createElement('iframe');
    this.iframe.src = chrome.runtime.getURL('audio-player.html');
    this.iframe.style.cssText = 'display:none;width:0;height:0;border:none;position:fixed;top:-9999px;left:-9999px;';
    this.iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.iframe);

    // 监听来自 iframe 的响应
    if (!this.messageHandler) {
      this.messageHandler = (event) => {
        if (event.data?.type !== 'SAPLING_AUDIO_RESULT') return;
        const { requestId, success, error } = event.data;
        const resolver = this.pendingRequests.get(requestId);
        if (resolver) {
          this.pendingRequests.delete(requestId);
          if (success) resolver.resolve();
          else resolver.reject(new Error(error || 'Audio play failed'));
        }
      };
      window.addEventListener('message', this.messageHandler);
    }

    // 等待 iframe 加载完成
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('iframe load timeout')), 5000);
      this.iframe.onload = () => { clearTimeout(timeout); resolve(); };
      this.iframe.onerror = () => { clearTimeout(timeout); reject(new Error('iframe load error')); };
    });
  }

  async play(urls) {
    await this.ensureIframe();
    const requestId = ++this.requestIdCounter;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      this.iframe.contentWindow.postMessage({
        type: 'SAPLING_PLAY_AUDIO',
        urls: Array.isArray(urls) ? urls : [urls],
        requestId
      }, '*');

      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Audio playback timeout'));
        }
      }, 15000);
    });
  }

  stop() {
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage({ type: 'SAPLING_STOP_AUDIO' }, '*');
    }
  }

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
    this.pendingRequests.clear();
  }
}

export const audioIframePlayer = new AudioIframePlayer();
```

#### 10.4.3 manifest.json 配置

```json
{
  "web_accessible_resources": [
    {
      "resources": ["audio-player.html", "audio-player.js", "icons/*", "css/*", "wordlist/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

### 10.5 迁移优势 ✅ 已实施

采用此方案后：

1. ✅ **已删除 offscreen.html 和 js/offscreen-audio.js**
2. ✅ **已删除 background.js 中的音频处理和 TTS 逻辑**
3. ✅ **已移除 `tts` 和 `offscreen` 权限**
4. **统一 Chrome/Firefox 代码路径** — 一套代码搞定
5. **减少 background ↔ content 消息传递** — 性能更好

### 10.6 参考资源

- [Browser Extension Special Techniques — Using iframes to bypass CSP](https://medium.com/@will.bryant.will/browser-extension-special-techniques-part-1-using-iframes-to-bypass-csp-restrictions-2b8cdf1737c5)
- [Chrome extension for bypassing content security policy](https://www.keyvalue.systems/blog/chrome-extension-for-bypassing-content-security-policy/)
