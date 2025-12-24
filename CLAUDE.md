# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sapling is a Chrome Extension (Manifest V3) for immersive language learning. It intelligently replaces vocabulary in web pages with translations, allowing users to naturally acquire languages through "Comprehensible Input" (Stephen Krashen's theory).

## Build Commands

```bash
# Generate extension icons (the only build step)
npm run build

# Watch mode for icon generation
npm run watch
```

**No bundler is used.** The extension uses vanilla JavaScript ES6+ with native ES modules. Development involves direct file edits and manual extension reloading via `chrome://extensions/`.

## Testing

No testing framework is configured. Testing is manual through the Chrome extension developer workflow:
1. Edit files directly
2. Visit `chrome://extensions/`
3. Click refresh button on extension card
4. Test on any web page

## Architecture

```
Background Service Worker
    js/background.js        - Extension lifecycle, context menus, message routing

Content Script (Main Entry)
    js/content.js           - Orchestrates DOM processing, translation, user interaction

Services Layer (js/services/)
    ├── api-service.js      - LLM API integration (OpenAI-compatible)
    ├── cache-service.js    - 2000-word LRU cache management
    ├── content-segmenter.js - DOM traversal, text extraction, fingerprint deduplication
    └── text-replacer.js    - DOM text replacement via Range API

Core Modules (js/core/)
    ├── config.js           - Default configuration values
    └── storage/            - Storage abstraction layer 
        ├── IStorageAdapter.js      - Storage adapter interface
        ├── ChromeStorageAdapter.js - Chrome Storage implementation
        ├── StorageNamespace.js     - Storage namespace (callback + Promise APIs)
        └── StorageService.js       - Storage service facade (high-level methods)

Config (js/config/)
    └── constants.js        - CEFR levels, intensity settings, skip tags/classes

Prompts (js/prompts/)
    └── ai-prompts.js       - AI translation prompt templates

UI Components (js/ui/)
    ├── toast.js            - Toast notification system
    ├── tooltip.js          - Hover tooltip for translated words
    ├── pronunciation.js    - Pronunciation audio sources (Wiktionary / Youdao)
    └── wiktionary.js       - Wiktionary dictionary lookup

Utilities (js/utils/)
    ├── language-detector.js - Language detection with segmentit
    ├── text-processor.js    - Text processing utilities
    └── word-filters.js      - Word filtering (CEFR, code detection, proper nouns)

Vendor (vendor/)
    └── segmentit.bundle.js  - Chinese text segmentation library

UI Pages
    ├── popup.js/html/css   - Extension popup (stats, quick actions)
    └── options.js/html/css - Settings page (6-section navigation)

Styles (css/)
    ├── content.css         - Content script styles (tooltips, highlights)
    ├── options.css         - Options page styles
    └── popup.css           - Popup styles
```

## Key Technical Details

- **Chrome Extension APIs**: storage (sync + local), contextMenus, activeTab, scripting, tts
- **ES6 Modules**: Content script uses native ES modules with import/export
- **Storage Architecture**: Layered abstraction (IStorageAdapter → ChromeStorageAdapter → StorageNamespace → StorageService)
  - `storage.remote` (Chrome Storage Sync): Config data with DEFAULT_CONFIG merging, cross-device sync
  - `storage.local` (Chrome Storage Local): Large data (word cache, learned words, memorize list)
- **Message passing**: Background ↔ Content script via `chrome.runtime.sendMessage()`
- **Pronunciation audio**: Can play audio via Wiktionary, Youdao (`https://dict.youdao.com/dictvoice?audio={word}&type={1/2}`; English only), or Google Translate TTS (`https://translate.google.com/translate_tts?ie=UTF-8&q={text}&tl={lang}&client=tw-ob`), routed through an offscreen document to bypass page CSP (Wiktionary File: links are converted to `Special:FilePath` without extra API lookups)
- **Chinese segmentation**: Uses segmentit library for Chinese word boundary detection

## Core Algorithms

**Difficulty Filtering**: Uses CEFR 6-level system (A1 → C2). Words are shown only if >= user's level.

**Replacement Intensity**: Low (4 words/paragraph), Medium (8), High (14).

**Content Processing**: 50-2000 character segments, fingerprint deduplication, viewport-aware prioritization, concurrent 3-segment processing.

**LRU Cache**: 2000-word capacity, evicts least-recently-used, persists across sessions.

**Translation Styles**:
- `translation-only`: Show only translation
- `original-translation`: Original(Translation)
- `translation-original`: Translation(Original)

## Supported Languages

- **Native**: Chinese (Simplified/Traditional), English, Japanese, Korean
- **Target**: English, Chinese, Japanese, Korean, French, German, Spanish
- **AI Providers**: OpenAI, DeepSeek, Moonshot, Groq, Ollama (any OpenAI-compatible API)

## Localization

Uses Chrome Extension i18n API. Messages in `/_locales/{locale}/messages.json`. Default locale: zh_CN.

## Storage Architecture Deep Dive

The storage system uses a 4-layer architecture for flexibility and future extensibility:

### Layer 1: IStorageAdapter (Interface)
- Abstract interface defining storage operations: `get()`, `set()`, `remove()`, `onChanged()`
- Enables swapping backends (Chrome Storage → WebDAV → any storage system)

### Layer 2: ChromeStorageAdapter (Implementation)
- Concrete implementation wrapping `chrome.storage.sync` and `chrome.storage.local`
- Filters change events by storage area
- Provides `onChanged()` that returns unsubscribe function

### Layer 3: StorageNamespace (Low-level API)
- Provides both callback-style and Promise-style APIs (`get/getAsync`, `set/setAsync`, etc.)
- Handles DEFAULT_CONFIG merging for remote storage (keeps defaults in code, not storage)
- One namespace per storage area: `storage.remote` (sync), `storage.local` (local)

### Layer 4: StorageService (High-level Facade)
- Domain-specific methods: `getWhitelist()`, `addToWhitelist()`, `updateStats()`, etc.
- Backward-compatible methods: `get()`, `set()`, `getLocal()`, `setLocal()`, `removeLocal()`
- Exported as singleton: `export const storage = new StorageService()`

## Key Files for Common Tasks

| Task | Files |
|------|-------|
| Modify translation logic | `js/services/api-service.js`, `js/prompts/ai-prompts.js` |
| Change DOM processing | `js/services/content-segmenter.js`, `js/services/text-replacer.js` |
| Update tooltip behavior | `js/ui/tooltip.js`, `css/content.css` |
| Modify word filtering | `js/utils/word-filters.js`, `js/config/constants.js` |
| Change storage behavior | `js/core/storage/StorageService.js`, `js/core/storage/ChromeStorageAdapter.js` |
| Add new storage backend | Create new adapter implementing `js/core/storage/IStorageAdapter.js` |
| Update popup/options UI | `js/popup.js`, `js/options.js`, corresponding HTML/CSS |

# User Custom Rules
1. Use auggie mcp to get code context > built-in tools > shell commands