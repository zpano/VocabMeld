/**
 * Sapling Wiktionary 词典集成
 * 提取自 content.js
 */

import { storage } from '../core/storage/StorageService.js';
import { playAudioUrl } from '../services/audio-service.js';

// 词典缓存
const dictionaryCache = new Map();

// 持久化缓存（跨页面刷新生效）
const PERSISTENT_CACHE_STORAGE_KEY = 'Sapling_wiktionary_cache';
const PERSISTENT_CACHE_MAX_SIZE = 800;
let persistentCache = null; // Map<cacheKey, { value: object|null, cachedAt: number }>
let persistentCacheInitPromise = null;
let persistTimer = null;

function canUseChromeStorage() {
  try {
    return !!(globalThis.chrome?.storage?.local?.get && globalThis.chrome?.storage?.local?.set);
  } catch {
    return false;
  }
}

async function ensurePersistentCacheLoaded() {
  if (!canUseChromeStorage()) {
    if (!persistentCache) persistentCache = new Map();
    return;
  }

  if (persistentCache) return;
  if (persistentCacheInitPromise) return persistentCacheInitPromise;

  persistentCacheInitPromise = new Promise((resolve) => {
    storage.local.get(PERSISTENT_CACHE_STORAGE_KEY, (result) => {
      const raw = result?.[PERSISTENT_CACHE_STORAGE_KEY];
      const map = new Map();

      if (Array.isArray(raw)) {
        for (const item of raw) {
          const key = item?.key;
          if (typeof key !== 'string' || !key) continue;
          map.set(key, { value: item?.value ?? null, cachedAt: Number(item?.cachedAt) || 0 });
        }
      }

      // 防御性裁剪
      while (map.size > PERSISTENT_CACHE_MAX_SIZE) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
      }

      persistentCache = map;
      resolve();
    });
  });

  return persistentCacheInitPromise;
}

function schedulePersistPersistentCache() {
  if (!canUseChromeStorage() || !persistentCache) return;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const data = [];
      for (const [key, meta] of persistentCache) {
        data.push({ key, value: meta?.value ?? null, cachedAt: Number(meta?.cachedAt) || 0 });
      }
      storage.local.set({ [PERSISTENT_CACHE_STORAGE_KEY]: data }, () => {});
    } catch {
      // ignore
    }
  }, 400);
}

async function getPersistentCacheValue(cacheKey) {
  await ensurePersistentCacheLoaded();
  if (!persistentCache?.has(cacheKey)) return undefined;

  const meta = persistentCache.get(cacheKey);
  // 轻量 LRU：触碰后移动到末尾（不强制持久化）
  persistentCache.delete(cacheKey);
  persistentCache.set(cacheKey, meta);
  return meta?.value ?? null;
}

async function setPersistentCacheValue(cacheKey, value) {
  await ensurePersistentCacheLoaded();
  if (!persistentCache) persistentCache = new Map();

  if (persistentCache.has(cacheKey)) persistentCache.delete(cacheKey);
  while (persistentCache.size >= PERSISTENT_CACHE_MAX_SIZE) {
    const firstKey = persistentCache.keys().next().value;
    persistentCache.delete(firstKey);
  }
  persistentCache.set(cacheKey, { value: value ?? null, cachedAt: Date.now() });
  schedulePersistPersistentCache();
}

function normalizeKey(word) {
  return (word || '').toLowerCase().trim();
}

function normalizeWikiUrl(url, langCode) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://${langCode}.wiktionary.org${url}`;
  return url;
}

function tryExtractFileTitleFromUrl(url, langCode) {
  try {
    const normalized = normalizeWikiUrl(url, langCode);
    const u = new URL(normalized);

    // /wiki/File:Something.ogg
    if (u.pathname.startsWith('/wiki/')) {
      const rest = u.pathname.slice('/wiki/'.length);
      if (rest.startsWith('File:')) {
        return decodeURIComponent(rest);
      }
    }

    // /w/index.php?title=File:Something.ogg
    const title = u.searchParams.get('title');
    if (title && title.startsWith('File:')) return title;

    return '';
  } catch {
    return '';
  }
}

function fileTitleToSpecialFilePathUrl(fileTitle, langCode) {
  if (!fileTitle) return '';
  // MediaWiki: Special:FilePath expects a filename (without "File:" prefix).
  const filename = String(fileTitle).replace(/^File:/i, '').trim();
  if (!filename) return '';
  return `https://${langCode}.wiktionary.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;
}

function getLanguageScopeRoot(doc, langCode) {
  const contentRoot = doc.querySelector('.mw-parser-output') || doc.body;

  // 目前主要用于英语：优先只在 English 语言段落里提取发音/音频，避免抓到其它语言。
  const langId = langCode === 'en' ? 'English' : '';
  if (!langId) return contentRoot;

  const heading = contentRoot.querySelector(`h2#${CSS.escape(langId)}`);
  const headingContainer = heading?.closest?.('.mw-heading');
  if (!headingContainer) return contentRoot;

  const scope = doc.createElement('div');
  let node = headingContainer;
  while (node && node.nextElementSibling) {
    node = node.nextElementSibling;
    if (node.classList?.contains('mw-heading2')) break;
    scope.appendChild(node.cloneNode(true));
  }
  return scope.childElementCount ? scope : contentRoot;
}

function extractFormOfTargetWord(scopeRoot) {
  const link =
    scopeRoot.querySelector('.form-of-definition .form-of-definition-link a[href]') ||
    scopeRoot.querySelector('.form-of-definition-link a[href]');

  if (!link) return '';

  const title = (link.getAttribute('title') || '').replace(/#.*/, '').trim();
  if (title) return title;

  const href = link.getAttribute('href') || '';
  const match = href.match(/\/wiki\/([^#?]+)/);
  if (!match) return '';

  try {
    return decodeURIComponent(match[1]).replace(/_/g, ' ').trim();
  } catch {
    return match[1].replace(/_/g, ' ').trim();
  }
}

function extractAudioCandidateUrls(scopeRoot, langCode) {
  const urls = [];
  const push = (raw) => {
    const normalized = normalizeWikiUrl(raw, langCode);
    if (normalized) urls.push(normalized);
  };

  // MediaWiki 可能用 <audio src> 或 <audio><source src>
  scopeRoot.querySelectorAll('audio source[src]').forEach((el) => push(el.getAttribute('src')));
  scopeRoot.querySelectorAll('audio[src]').forEach((el) => push(el.getAttribute('src')));

  // 有些页面可能只给 File: 链接（作为降级）
  scopeRoot
    .querySelectorAll('a[href^="/wiki/File:"], a[href*="title=File:"]')
    .forEach((el) => push(el.getAttribute('href')));

  // 去重
  return [...new Set(urls)];
}

function scoreAudioUrl(url) {
  const u = String(url || '');
  let score = 0;
  if (u.includes('upload.wikimedia.org')) score += 50;
  if (u.includes('Special:FilePath')) score += 40;
  if (/\.(mp3)(\?|$)/i.test(u)) score += 20;
  if (/\.(ogg|oga)(\?|$)/i.test(u)) score += 18;
  if (/\.(wav)(\?|$)/i.test(u)) score += 10;
  if (u.includes('/wiki/File:') || u.includes('title=File:')) score -= 30; // 文件页通常不是可播放音频
  return score;
}

async function resolveAudioUrls(candidateUrls, langCode) {
  const ranked = [...candidateUrls].sort((a, b) => scoreAudioUrl(b) - scoreAudioUrl(a));
  const resolved = [];

  // 限制解析数量，避免过多请求
  for (const url of ranked.slice(0, 4)) {
    if (url.includes('upload.wikimedia.org') || url.includes('Special:FilePath')) {
      resolved.push(url);
      continue;
    }

    const fileTitle = tryExtractFileTitleFromUrl(url, langCode);
    if (fileTitle) {
      const filePathUrl = fileTitleToSpecialFilePathUrl(fileTitle, langCode);
      if (filePathUrl) resolved.push(filePathUrl);
    }
  }

  return [...new Set(resolved)];
}

/**
 * 从 Wiktionary 获取词典条目
 * @param {string} word - 单词
 * @param {string} langCode - 语言代码 (default: 'en')
 * @returns {Promise<object|null>} 词典条目或 null
 */
export async function getDictionaryEntry(word, langCode = 'en') {
  return await getDictionaryEntryInternal(word, langCode, 0, new Set());
}

async function getDictionaryEntryInternal(word, langCode, depth, visited) {
  const key = normalizeKey(word);
  if (!key) return null;

  const cacheKey = `${key}_${langCode}`;
  const cached = dictionaryCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // 读取跨刷新持久化缓存
  const persisted = await getPersistentCacheValue(cacheKey);
  if (persisted !== undefined) {
    dictionaryCache.set(cacheKey, persisted);
    return persisted;
  }

  if (visited.has(cacheKey)) return null;
  visited.add(cacheKey);

  // 初始化返回结构
  const entry = {
    audioUrl: '',
    audioUrls: [],
    phoneticText: '',
    shortDefinition: '',
    partOfSpeech: '',
    example: ''
  };

  try {
    // 构建 Parse API URL (origin=* 解决 CORS)
    const url = `https://${langCode}.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&format=json&prop=text&origin=*`;

    const response = await fetch(url);
    const data = await response.json();

    // 检查错误或缺失页面
    if (data.error || !data.parse || !data.parse.text) {
      console.warn(`[Sapling] Word not found: ${word}`);
      dictionaryCache.set(cacheKey, null);
      await setPersistentCacheValue(cacheKey, null);
      return null;
    }

    // 解析 HTML 内容
    const htmlString = data.parse.text['*'];
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const scopeRoot = getLanguageScopeRoot(doc, langCode);

    // A. 提取词性
    const validPOS = ['Noun', 'Verb', 'Adjective', 'Adverb', 'Interjection', 'Pronoun', 'Preposition', 'Conjunction'];
    let posHeader = null;

    const headers = scopeRoot.querySelectorAll('h3, h4');
    for (const header of headers) {
      const text = header.textContent.replace(/\[.*?\]/g, '').trim();
      if (validPOS.some(pos => text.includes(pos))) {
        entry.partOfSpeech = text;
        posHeader = header;
        break;
      }
    }

    // B. 提取音标 (IPA)
    const phoneticEl = scopeRoot.querySelector('.IPA');
    if (phoneticEl) entry.phoneticText = phoneticEl.textContent.trim();

    // C. 提取音频（支持 mp3/ogg/wav；并尽量解析成可直接播放的 upload.wikimedia URL）
    const audioCandidates = extractAudioCandidateUrls(scopeRoot, langCode);
    entry.audioUrls = await resolveAudioUrls(audioCandidates, langCode);
    entry.audioUrl = entry.audioUrls[0] || '';

    // D. 提取定义和例句
    if (posHeader) {
      let currentNode = posHeader.parentNode;
      if (!currentNode.classList.contains('mw-heading')) {
        currentNode = posHeader;
      }

      let definitionList = null;
      while (currentNode && currentNode.nextElementSibling) {
        currentNode = currentNode.nextElementSibling;
        if (currentNode.tagName === 'OL') {
          definitionList = currentNode;
          break;
        }
        if (['H2', 'H3'].includes(currentNode.tagName)) break;
      }

      if (definitionList) {
        const firstLi = definitionList.querySelector('li');
        if (firstLi) {
          const exampleEl = firstLi.querySelector('.h-usage-example, .e-example, .use-with-mention + dl, .h-usage-example');
          if (exampleEl) entry.example = exampleEl.textContent.trim().slice(0, 150);

          const cloneLi = firstLi.cloneNode(true);
          const removeSelectors = ['.h-usage-example', '.e-example', 'ul', 'dl', '.reference'];
          removeSelectors.forEach(sel => {
            cloneLi.querySelectorAll(sel).forEach(el => el.remove());
          });
          entry.shortDefinition = cloneLi.textContent.trim().slice(0, 220);
        }
      }
    }

    // E. “Alternative form/spelling of …” 等页面通常没有发音，尝试追溯到目标词条
    if (depth < 1 && (!entry.audioUrl || !entry.phoneticText)) {
      const target = extractFormOfTargetWord(scopeRoot);
      if (target && normalizeKey(target) !== key) {
        const derived = await getDictionaryEntryInternal(target, langCode, depth + 1, visited);
        if (derived) {
          if (!entry.phoneticText) entry.phoneticText = derived.phoneticText || '';
          if (!entry.partOfSpeech) entry.partOfSpeech = derived.partOfSpeech || '';
          if (!entry.shortDefinition) entry.shortDefinition = derived.shortDefinition || '';
          if (!entry.example) entry.example = derived.example || '';
          if (!entry.audioUrl) {
            entry.audioUrls = derived.audioUrls || (derived.audioUrl ? [derived.audioUrl] : []);
            entry.audioUrl = entry.audioUrls[0] || derived.audioUrl || '';
          }
        }
      }
    }

    dictionaryCache.set(cacheKey, entry);
    await setPersistentCacheValue(cacheKey, entry);
    return entry;
  } catch (error) {
    console.error('[Sapling] Dictionary lookup error:', error);
    dictionaryCache.set(cacheKey, null);
    await setPersistentCacheValue(cacheKey, null);
    return null;
  }
}

/**
 * 播放词典音频
 * @param {string} word - 单词
 * @param {string} langCode - 语言代码
 * @returns {Promise<void>}
 */
export async function playDictionaryAudio(word, langCode = 'en') {
  try {
    const entry = await getDictionaryEntry(word, langCode);
    const url = entry?.audioUrl || (entry?.audioUrls?.length ? entry.audioUrls[0] : '');
    if (!url) {
      throw new Error('No audio');
    }

    await playAudioUrl(url);
  } catch (error) {
    console.warn('[Sapling] Dictionary audio failed:', error);
    throw error;
  }
}
