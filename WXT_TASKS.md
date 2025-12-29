# WXT 迁移任务清单

> 基于 WXT_RESEARCH.md 调研报告拆分的具体执行任务
> 预计总工时：~38h (5 工作日)

---

## 阶段 1: 基础迁移 [P0] (~8h)

### 1.1 项目初始化 (~2h)
- [ ] 使用 `pnpm create wxt@latest sapling-wxt` 初始化 WXT 项目
- [ ] 配置 `pnpm install` 安装依赖
- [ ] 配置 TypeScript (可选择保留 JavaScript 或渐进式迁移)
- [ ] 配置 ESLint/Prettier 保持代码风格一致

### 1.2 静态资源迁移 (~2h)
- [ ] 迁移 `icons/` → `public/icons/`
- [ ] 迁移 `css/` → `public/css/` 或 `assets/`
- [ ] 迁移 `_locales/` → `public/_locales/`
- [ ] 迁移 `wordlist/` → `public/wordlist/`
- [ ] 迁移 `vendor/segmentit.bundle.js` → `public/vendor/` 或 npm 包

### 1.3 Manifest 迁移 (~2h)
- [ ] 创建 `wxt.config.ts` 配置文件
- [ ] 迁移 `name`, `description`, `version` 等基础信息
- [ ] 迁移 `permissions`: storage, activeTab, scripting, contextMenus
- [ ] 迁移 `host_permissions`: `<all_urls>`
- [ ] 迁移 `commands` 快捷键配置
- [ ] 迁移 `web_accessible_resources` (audio-player.html 等)
- [ ] 配置 `default_locale: 'zh_CN'`
- [ ] 验证 MV3 兼容性

### 1.4 目录结构调整 (~2h)
- [ ] 创建 `entrypoints/` 目录结构
- [ ] 创建 `entrypoints/background.ts`
- [ ] 创建 `entrypoints/content.ts`
- [ ] 创建 `entrypoints/popup/` 目录
- [ ] 创建 `entrypoints/options/` 目录
- [ ] 配置路径别名 (`~/` 或 `@/`)

---

## 阶段 2: 入口点迁移 [P0] (~16h)

### 2.1 Background Script 迁移 (~4h)
- [ ] 创建 `entrypoints/background.ts` 入口文件
- [ ] 添加 `defineBackground()` 导出
- [ ] 迁移 `chrome.runtime.onInstalled` 逻辑
- [ ] 迁移 `chrome.contextMenus` 上下文菜单创建 (原 L120-167)
- [ ] 迁移 `chrome.commands` 快捷键监听 (原 L174-180)
- [ ] 迁移消息路由逻辑
- [ ] 将 `chrome.` 替换为 `browser.` (或保留，WXT 自动处理)
- [ ] 验证 background service worker 功能

### 2.2 Content Script 迁移 (~8h)
- [ ] 创建 `entrypoints/content.ts` 入口文件
- [ ] 添加 `defineContentScript()` 导出
- [ ] 配置 `matches: ['<all_urls>']`
- [ ] 配置 `runAt: 'document_idle'`
- [ ] 迁移 DOM 处理逻辑
- [ ] 迁移翻译替换逻辑
- [ ] 迁移用户交互逻辑
- [ ] 迁移 `chrome.runtime.onMessage` 消息监听
- [ ] 配置 CSS 注入 (content.css)
- [ ] 验证内容脚本注入和功能

### 2.3 Popup 页面迁移 (~2h)
- [ ] 创建 `entrypoints/popup/index.html`
- [ ] 迁移 `popup.html` 内容
- [ ] 迁移 `popup.js` → `entrypoints/popup/main.ts`
- [ ] 迁移 `popup.css` 样式
- [ ] 更新资源引用路径
- [ ] 迁移 `chrome.tabs`, `chrome.runtime` 调用
- [ ] 验证 popup 功能

### 2.4 Options 页面迁移 (~2h)
- [ ] 创建 `entrypoints/options/index.html`
- [ ] 迁移 `options.html` 内容
- [ ] 迁移 `options.js` → `entrypoints/options/main.ts`
- [ ] 迁移 `options.css` 样式
- [ ] 更新资源引用路径
- [ ] 验证 6-section 导航功能
- [ ] 验证选项保存/加载功能

---

## 阶段 3: 服务层迁移 [P1] (~8h)

### 3.1 Services 目录迁移 (~3h)
- [ ] 迁移 `js/services/api-service.js` (LLM API 集成)
- [ ] 迁移 `js/services/cache-service.js` (LRU 缓存)
- [ ] 迁移 `js/services/content-segmenter.js` (DOM 遍历)
- [ ] 迁移 `js/services/text-replacer.js` (文本替换)
- [ ] 迁移 `js/services/audio-iframe-player.js` (iframe 音频播放)
- [ ] 迁移 `js/services/audio-player.html/js` (音频播放器页面)
- [ ] 更新所有 import 路径

### 3.2 Core 目录迁移 (~2h)
- [ ] 迁移 `js/core/config.js`
- [ ] 迁移 `js/core/storage/IStorageAdapter.js`
- [ ] 迁移 `js/core/storage/ChromeStorageAdapter.js`
- [ ] 迁移 `js/core/storage/StorageNamespace.js`
- [ ] 迁移 `js/core/storage/StorageService.js`
- [ ] 考虑是否使用 WXT 内置的 `wxt/storage`

### 3.3 Utils 目录迁移 (~1h)
- [ ] 迁移 `js/utils/language-detector.js`
- [ ] 迁移 `js/utils/text-processor.js`
- [ ] 迁移 `js/utils/word-filters.js`
- [ ] 处理 `segmentit` 库导入

### 3.4 UI 目录迁移 (~1h)
- [ ] 迁移 `js/ui/toast.js`
- [ ] 迁移 `js/ui/tooltip.js`
- [ ] 迁移 `js/ui/pronunciation.js`
- [ ] 迁移 `js/ui/wiktionary.js`

### 3.5 Config/Prompts 目录迁移 (~1h)
- [ ] 迁移 `js/config/constants.js`
- [ ] 迁移 `js/prompts/ai-prompts.js`

---

## 阶段 4: 跨浏览器适配 [P1] (~4h)

### 4.1 已完成项 ✅
- [x] Offscreen Document 替代方案 (隐藏 iframe 方案)
- [x] TTS API 替代方案 (Google Translate TTS)
- [x] 移除 `tts` 和 `offscreen` 权限

### 4.2 Firefox 兼容性测试 (~4h)
- [ ] 使用 `pnpm dev:firefox` 启动 Firefox 开发模式
- [ ] 测试扩展安装和加载
- [ ] 测试 content script 注入
- [ ] 测试 DOM 翻译替换功能
- [ ] 测试 tooltip 显示
- [ ] 测试音频播放 (iframe 方案)
- [ ] 测试 popup 功能
- [ ] 测试 options 页面
- [ ] 测试存储同步功能
- [ ] 修复 Firefox 特定 bug

---

## 阶段 5: 测试与发布 [P2] (~4h)

### 5.1 Chrome 测试 (~1h)
- [ ] 端到端功能测试
- [ ] 性能测试 (HMR 开发体验)
- [ ] 构建生产包 `pnpm build`
- [ ] 验证生产包功能

### 5.2 Firefox 测试 (~1h)
- [ ] 端到端功能测试
- [ ] 构建 Firefox 包 `pnpm build:firefox`
- [ ] 验证 Firefox 包功能

### 5.3 发布准备 (~2h)
- [ ] 生成 Chrome 发布包 `pnpm zip`
- [ ] 生成 Firefox 发布包 `pnpm zip:firefox`
- [ ] 生成 Firefox 源码包 (AMO 审核需要)
- [ ] 更新版本号
- [ ] 更新 CHANGELOG
- [ ] 提交 Chrome Web Store
- [ ] 提交 Firefox AMO

---

## 已知风险与注意事项

### 构建相关
- [ ] 验证 `segmentit` 库打包兼容性 (可能需要 `vite-plugin-commonjs`)
- [ ] 确保 HMR 在复杂 DOM 操作时正常工作
- [ ] 类型定义：添加 `@types/chrome` 或使用 `any`

### 运行时相关
- [ ] 确认 Firefox sync 存储配额差异 (保持大数据使用 local)

### 发布相关
- [ ] 使用 Google 扩展测试工具验证权限警告变化

---

## 工作量估算

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| 1 | 基础迁移 | 8h |
| 2 | 入口点迁移 | 16h |
| 3 | 服务层迁移 | 8h |
| 4 | 跨浏览器适配 | 4h |
| 5 | 测试与发布 | 4h |
| **总计** | | **~40h (5 工作日)** |

---

## 参考资源

- [WXT 官方文档](https://wxt.dev/)
- [WXT 迁移指南](https://wxt.dev/guide/resources/migrate)
- [WXT GitHub 仓库](https://github.com/wxt-dev/wxt)
- [Firefox MV3 迁移指南](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
