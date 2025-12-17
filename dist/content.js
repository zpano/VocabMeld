// VocabMeld Content Script (Bundled)

(() => {
  // js/config/constants.js
  var SKIP_TAGS = [
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "IFRAME",
    "CODE",
    "PRE",
    "KBD",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "BUTTON"
  ];
  var SKIP_CLASSES = [
    "vocabmeld-translated",
    "vocabmeld-tooltip",
    "hljs",
    "code",
    "syntax"
  ];
  var STOP_WORDS = /* @__PURE__ */ new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "and",
    "but",
    "if",
    "or",
    "because",
    "until",
    "while",
    "this",
    "that",
    "these",
    "those",
    "what",
    "which",
    "who",
    "whom",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "me",
    "him",
    "her",
    "us",
    "them",
    "my",
    "your",
    "his",
    "its",
    "our",
    "their"
  ]);

  // js/utils/language-detector.js
  var languageDetector = null;
  async function initLanguageDetector() {
    try {
      if (typeof LanguageDetector !== "undefined" && LanguageDetector.create) {
        languageDetector = await LanguageDetector.create({
          expectedInputLanguages: ["en", "zh", "ja", "ko", "fr", "de", "es"]
        });
        console.log("[VocabMeld] Native LanguageDetector initialized");
      }
    } catch (error) {
      console.warn("[VocabMeld] LanguageDetector not available, using fallback:", error);
      languageDetector = null;
    }
  }
  async function detectLanguage(text) {
    if (languageDetector) {
      try {
        const results = await languageDetector.detect(text);
        const validResults = results.filter((r) => r.detectedLanguage !== "und");
        if (validResults.length > 0) {
          const topResult = validResults[0];
          let langCode = topResult.detectedLanguage;
          if (langCode.startsWith("zh")) {
            langCode = "zh-CN";
          } else if (langCode.startsWith("ja")) {
            langCode = "ja";
          } else if (langCode.startsWith("ko")) {
            langCode = "ko";
          } else if (langCode.startsWith("en")) {
            langCode = "en";
          }
          return langCode;
        }
      } catch (error) {
        console.warn("[VocabMeld] LanguageDetector error, using fallback:", error);
      }
    }
    return detectLanguageFallback(text);
  }
  function detectLanguageFallback(text) {
    const chineseRegex = /[\u4e00-\u9fff]/g;
    const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/g;
    const koreanRegex = /[\uac00-\ud7af]/g;
    const latinRegex = /[a-zA-Z]/g;
    const chineseCount = (text.match(chineseRegex) || []).length;
    const japaneseCount = (text.match(japaneseRegex) || []).length;
    const koreanCount = (text.match(koreanRegex) || []).length;
    const latinCount = (text.match(latinRegex) || []).length;
    const total = chineseCount + japaneseCount + koreanCount + latinCount || 1;
    if (japaneseCount / total > 0.1) return "ja";
    if (koreanCount / total > 0.1) return "ko";
    if (chineseCount / total > 0.3) return "zh-CN";
    return "en";
  }

  // js/utils/word-filters.js
  function isSingleEnglishWord(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /^[a-zA-Z]+$/.test(trimmed);
  }
  function isLikelyProperNoun(word) {
    if (!word) return false;
    const trimmed = word.trim();
    if (!/^[A-Za-z][A-Za-z''-]*$/.test(trimmed)) return false;
    if (trimmed === trimmed.toUpperCase()) return true;
    if (trimmed === trimmed.toLowerCase()) return false;
    return /^[A-Z]/.test(trimmed);
  }
  function isNonLearningWord(word) {
    if (!word) return true;
    const trimmed = word.trim();
    if (!trimmed) return true;
    const lower = trimmed.toLowerCase();
    if (/https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) return true;
    if (/[0-9]/.test(trimmed)) return true;
    if (/[#@]/.test(trimmed)) return true;
    if (/[\\/]/.test(trimmed)) return true;
    if (isLikelyProperNoun(trimmed)) return true;
    if (/\.[a-z]{2,}$/.test(lower)) return true;
    return false;
  }
  function isCodeText(text) {
    const codePatterns = [
      /^(const|let|var|function|class|import|export|return|if|else|for|while)\s/,
      /[{}();]\s*$/,
      /^\s*(\/\/|\/\*|\*|#)/,
      /\w+\.\w+\(/,
      /console\./,
      /https?:\/\//
    ];
    return codePatterns.some((pattern) => pattern.test(text.trim()));
  }

  // js/ui/wiktionary.js
  var dictionaryCache = /* @__PURE__ */ new Map();
  var PERSISTENT_CACHE_STORAGE_KEY = "vocabmeld_wiktionary_cache";
  var PERSISTENT_CACHE_MAX_SIZE = 800;
  var persistentCache = null;
  var persistentCacheInitPromise = null;
  var persistTimer = null;
  function canUseChromeStorage() {
    try {
      return !!(globalThis.chrome?.storage?.local?.get && globalThis.chrome?.storage?.local?.set);
    } catch {
      return false;
    }
  }
  async function ensurePersistentCacheLoaded() {
    if (!canUseChromeStorage()) {
      if (!persistentCache) persistentCache = /* @__PURE__ */ new Map();
      return;
    }
    if (persistentCache) return;
    if (persistentCacheInitPromise) return persistentCacheInitPromise;
    persistentCacheInitPromise = new Promise((resolve) => {
      chrome.storage.local.get(PERSISTENT_CACHE_STORAGE_KEY, (result) => {
        const raw = result?.[PERSISTENT_CACHE_STORAGE_KEY];
        const map = /* @__PURE__ */ new Map();
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const key = item?.key;
            if (typeof key !== "string" || !key) continue;
            map.set(key, { value: item?.value ?? null, cachedAt: Number(item?.cachedAt) || 0 });
          }
        }
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
        chrome.storage.local.set({ [PERSISTENT_CACHE_STORAGE_KEY]: data }, () => {
        });
      } catch {
      }
    }, 400);
  }
  async function getPersistentCacheValue(cacheKey) {
    await ensurePersistentCacheLoaded();
    if (!persistentCache?.has(cacheKey)) return void 0;
    const meta = persistentCache.get(cacheKey);
    persistentCache.delete(cacheKey);
    persistentCache.set(cacheKey, meta);
    return meta?.value ?? null;
  }
  async function setPersistentCacheValue(cacheKey, value) {
    await ensurePersistentCacheLoaded();
    if (!persistentCache) persistentCache = /* @__PURE__ */ new Map();
    if (persistentCache.has(cacheKey)) persistentCache.delete(cacheKey);
    while (persistentCache.size >= PERSISTENT_CACHE_MAX_SIZE) {
      const firstKey = persistentCache.keys().next().value;
      persistentCache.delete(firstKey);
    }
    persistentCache.set(cacheKey, { value: value ?? null, cachedAt: Date.now() });
    schedulePersistPersistentCache();
  }
  function normalizeKey(word) {
    return (word || "").toLowerCase().trim();
  }
  function normalizeWikiUrl(url, langCode) {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `https://${langCode}.wiktionary.org${url}`;
    return url;
  }
  function tryExtractFileTitleFromUrl(url, langCode) {
    try {
      const normalized = normalizeWikiUrl(url, langCode);
      const u = new URL(normalized);
      if (u.pathname.startsWith("/wiki/")) {
        const rest = u.pathname.slice("/wiki/".length);
        if (rest.startsWith("File:")) {
          return decodeURIComponent(rest);
        }
      }
      const title = u.searchParams.get("title");
      if (title && title.startsWith("File:")) return title;
      return "";
    } catch {
      return "";
    }
  }
  function fileTitleToSpecialFilePathUrl(fileTitle, langCode) {
    if (!fileTitle) return "";
    const filename = String(fileTitle).replace(/^File:/i, "").trim();
    if (!filename) return "";
    return `https://${langCode}.wiktionary.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;
  }
  function getLanguageScopeRoot(doc, langCode) {
    const contentRoot = doc.querySelector(".mw-parser-output") || doc.body;
    const langId = langCode === "en" ? "English" : "";
    if (!langId) return contentRoot;
    const heading = contentRoot.querySelector(`h2#${CSS.escape(langId)}`);
    const headingContainer = heading?.closest?.(".mw-heading");
    if (!headingContainer) return contentRoot;
    const scope = doc.createElement("div");
    let node = headingContainer;
    while (node && node.nextElementSibling) {
      node = node.nextElementSibling;
      if (node.classList?.contains("mw-heading2")) break;
      scope.appendChild(node.cloneNode(true));
    }
    return scope.childElementCount ? scope : contentRoot;
  }
  function extractFormOfTargetWord(scopeRoot) {
    const link = scopeRoot.querySelector(".form-of-definition .form-of-definition-link a[href]") || scopeRoot.querySelector(".form-of-definition-link a[href]");
    if (!link) return "";
    const title = (link.getAttribute("title") || "").replace(/#.*/, "").trim();
    if (title) return title;
    const href = link.getAttribute("href") || "";
    const match = href.match(/\/wiki\/([^#?]+)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]).replace(/_/g, " ").trim();
    } catch {
      return match[1].replace(/_/g, " ").trim();
    }
  }
  function extractAudioCandidateUrls(scopeRoot, langCode) {
    const urls = [];
    const push = (raw) => {
      const normalized = normalizeWikiUrl(raw, langCode);
      if (normalized) urls.push(normalized);
    };
    scopeRoot.querySelectorAll("audio source[src]").forEach((el) => push(el.getAttribute("src")));
    scopeRoot.querySelectorAll("audio[src]").forEach((el) => push(el.getAttribute("src")));
    scopeRoot.querySelectorAll('a[href^="/wiki/File:"], a[href*="title=File:"]').forEach((el) => push(el.getAttribute("href")));
    return [...new Set(urls)];
  }
  function scoreAudioUrl(url) {
    const u = String(url || "");
    let score = 0;
    if (u.includes("upload.wikimedia.org")) score += 50;
    if (u.includes("Special:FilePath")) score += 40;
    if (/\.(mp3)(\?|$)/i.test(u)) score += 20;
    if (/\.(ogg|oga)(\?|$)/i.test(u)) score += 18;
    if (/\.(wav)(\?|$)/i.test(u)) score += 10;
    if (u.includes("/wiki/File:") || u.includes("title=File:")) score -= 30;
    return score;
  }
  async function resolveAudioUrls(candidateUrls, langCode) {
    const ranked = [...candidateUrls].sort((a, b) => scoreAudioUrl(b) - scoreAudioUrl(a));
    const resolved = [];
    for (const url of ranked.slice(0, 4)) {
      if (url.includes("upload.wikimedia.org") || url.includes("Special:FilePath")) {
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
  async function getDictionaryEntry(word, langCode = "en") {
    return await getDictionaryEntryInternal(word, langCode, 0, /* @__PURE__ */ new Set());
  }
  async function getDictionaryEntryInternal(word, langCode, depth, visited) {
    const key = normalizeKey(word);
    if (!key) return null;
    const cacheKey = `${key}_${langCode}`;
    const cached = dictionaryCache.get(cacheKey);
    if (cached !== void 0) return cached;
    const persisted = await getPersistentCacheValue(cacheKey);
    if (persisted !== void 0) {
      dictionaryCache.set(cacheKey, persisted);
      return persisted;
    }
    if (visited.has(cacheKey)) return null;
    visited.add(cacheKey);
    const entry = {
      audioUrl: "",
      audioUrls: [],
      phoneticText: "",
      shortDefinition: "",
      partOfSpeech: "",
      example: ""
    };
    try {
      const url = `https://${langCode}.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&format=json&prop=text&origin=*`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.error || !data.parse || !data.parse.text) {
        console.warn(`[VocabMeld] Word not found: ${word}`);
        dictionaryCache.set(cacheKey, null);
        await setPersistentCacheValue(cacheKey, null);
        return null;
      }
      const htmlString = data.parse.text["*"];
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, "text/html");
      const scopeRoot = getLanguageScopeRoot(doc, langCode);
      const validPOS = ["Noun", "Verb", "Adjective", "Adverb", "Interjection", "Pronoun", "Preposition", "Conjunction"];
      let posHeader = null;
      const headers = scopeRoot.querySelectorAll("h3, h4");
      for (const header of headers) {
        const text = header.textContent.replace(/\[.*?\]/g, "").trim();
        if (validPOS.some((pos) => text.includes(pos))) {
          entry.partOfSpeech = text;
          posHeader = header;
          break;
        }
      }
      const phoneticEl = scopeRoot.querySelector(".IPA");
      if (phoneticEl) entry.phoneticText = phoneticEl.textContent.trim();
      const audioCandidates = extractAudioCandidateUrls(scopeRoot, langCode);
      entry.audioUrls = await resolveAudioUrls(audioCandidates, langCode);
      entry.audioUrl = entry.audioUrls[0] || "";
      if (posHeader) {
        let currentNode = posHeader.parentNode;
        if (!currentNode.classList.contains("mw-heading")) {
          currentNode = posHeader;
        }
        let definitionList = null;
        while (currentNode && currentNode.nextElementSibling) {
          currentNode = currentNode.nextElementSibling;
          if (currentNode.tagName === "OL") {
            definitionList = currentNode;
            break;
          }
          if (["H2", "H3"].includes(currentNode.tagName)) break;
        }
        if (definitionList) {
          const firstLi = definitionList.querySelector("li");
          if (firstLi) {
            const exampleEl = firstLi.querySelector(".h-usage-example, .e-example, .use-with-mention + dl, .h-usage-example");
            if (exampleEl) entry.example = exampleEl.textContent.trim().slice(0, 150);
            const cloneLi = firstLi.cloneNode(true);
            const removeSelectors = [".h-usage-example", ".e-example", "ul", "dl", ".reference"];
            removeSelectors.forEach((sel) => {
              cloneLi.querySelectorAll(sel).forEach((el) => el.remove());
            });
            entry.shortDefinition = cloneLi.textContent.trim().slice(0, 220);
          }
        }
      }
      if (depth < 1 && (!entry.audioUrl || !entry.phoneticText)) {
        const target = extractFormOfTargetWord(scopeRoot);
        if (target && normalizeKey(target) !== key) {
          const derived = await getDictionaryEntryInternal(target, langCode, depth + 1, visited);
          if (derived) {
            if (!entry.phoneticText) entry.phoneticText = derived.phoneticText || "";
            if (!entry.partOfSpeech) entry.partOfSpeech = derived.partOfSpeech || "";
            if (!entry.shortDefinition) entry.shortDefinition = derived.shortDefinition || "";
            if (!entry.example) entry.example = derived.example || "";
            if (!entry.audioUrl) {
              entry.audioUrls = derived.audioUrls || (derived.audioUrl ? [derived.audioUrl] : []);
              entry.audioUrl = entry.audioUrls[0] || derived.audioUrl || "";
            }
          }
        }
      }
      dictionaryCache.set(cacheKey, entry);
      await setPersistentCacheValue(cacheKey, entry);
      return entry;
    } catch (error) {
      console.error("[VocabMeld] Dictionary lookup error:", error);
      dictionaryCache.set(cacheKey, null);
      await setPersistentCacheValue(cacheKey, null);
      return null;
    }
  }
  async function playDictionaryAudio(word, langCode = "en") {
    try {
      const entry = await getDictionaryEntry(word, langCode);
      const urls = entry?.audioUrls?.length ? entry.audioUrls : entry?.audioUrl ? [entry.audioUrl] : [];
      if (!urls.length) {
        throw new Error("No audio");
      }
      const result = await chrome.runtime.sendMessage({ action: "playAudioUrls", urls }).catch((e) => {
        throw e;
      });
      if (result?.success) return;
      throw new Error(result?.message || "Audio play failed");
    } catch (error) {
      console.warn("[VocabMeld] Dictionary audio failed:", error);
      throw error;
    }
  }

  // js/ui/pronunciation.js
  function normalizeYoudaoType(type) {
    return Number(type) === 1 ? 1 : 2;
  }
  function buildYoudaoDictVoiceUrl(word, type = 2) {
    const audio = String(word || "").trim();
    if (!audio) return "";
    const t = normalizeYoudaoType(type);
    return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(audio)}&type=${t}`;
  }
  function toGoogleTtsLangCode(lang) {
    const code = String(lang || "").trim();
    if (!code) return "en";
    const map = {
      en: "en",
      ja: "ja",
      ko: "ko",
      fr: "fr",
      de: "de",
      es: "es",
      ru: "ru",
      "zh-CN": "zh",
      "zh-TW": "zh"
    };
    if (map[code]) return map[code];
    const primary = code.split("-")[0];
    return map[primary] || primary || "en";
  }
  function buildGoogleTranslateTtsUrl(text, lang) {
    const q = String(text || "").trim();
    if (!q) return "";
    const tl = toGoogleTtsLangCode(lang);
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(q)}&tl=${encodeURIComponent(tl)}&client=tw-ob`;
  }
  async function playAudioUrls(urls) {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (!list.length) throw new Error("No audio URLs");
    const result = await chrome.runtime.sendMessage({ action: "playAudioUrls", urls: list }).catch((e) => {
      throw e;
    });
    if (result?.success) return;
    throw new Error(result?.message || "Audio play failed");
  }
  async function playYoudaoDictVoice(word, type = 2) {
    const primaryType = normalizeYoudaoType(type);
    const secondaryType = primaryType === 1 ? 2 : 1;
    const primaryUrl = buildYoudaoDictVoiceUrl(word, primaryType);
    const secondaryUrl = buildYoudaoDictVoiceUrl(word, secondaryType);
    await playAudioUrls([primaryUrl, secondaryUrl]);
  }
  async function playGoogleTranslateTts(text, lang) {
    const url = buildGoogleTranslateTtsUrl(text, lang);
    await playAudioUrls([url]);
  }

  // js/ui/tooltip.js
  var TooltipManager = class {
    constructor() {
      this.tooltip = null;
      this.currentTooltipElement = null;
      this.tooltipHideTimeout = null;
      this.config = null;
    }
    escapeHtml(value) {
      return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    /**
     * 设置配置
     * @param {object} config - 配置对象
     */
    setConfig(config2) {
      this.config = config2;
    }
    /**
     * 创建 Tooltip 元素
     */
    createTooltip() {
      if (this.tooltip) return;
      this.tooltip = document.createElement("div");
      this.tooltip.className = "vocabmeld-tooltip";
      this.tooltip.style.display = "none";
      document.body.appendChild(this.tooltip);
    }
    /**
     * 显示 Tooltip
     * @param {HTMLElement} element - 翻译元素
     */
    async show(element) {
      if (!this.tooltip || !element.classList?.contains("vocabmeld-translated")) return;
      if (this.tooltipHideTimeout) {
        clearTimeout(this.tooltipHideTimeout);
        this.tooltipHideTimeout = null;
      }
      this.currentTooltipElement = element;
      const original = element.getAttribute("data-original") || "";
      const translation = element.getAttribute("data-translation") || "";
      const aiPhonetic = element.getAttribute("data-phonetic") || "";
      const difficulty = element.getAttribute("data-difficulty") || "";
      const aiPartOfSpeech = element.getAttribute("data-part-of-speech") || "";
      const aiShortDefinition = element.getAttribute("data-short-definition") || "";
      const sourceLang = element.getAttribute("data-source-lang") || "";
      const aiExample = element.getAttribute("data-example") || "";
      const learningLanguage = this.config?.targetLanguage || "en";
      let isLearningFromOriginal;
      if (sourceLang) {
        isLearningFromOriginal = sourceLang === learningLanguage;
      } else if (learningLanguage === "en") {
        if (isSingleEnglishWord(original)) isLearningFromOriginal = true;
        else if (isSingleEnglishWord(translation)) isLearningFromOriginal = false;
      }
      if (typeof isLearningFromOriginal !== "boolean") {
        const originalLang = original ? await detectLanguage(original) : "";
        isLearningFromOriginal = originalLang === learningLanguage;
      }
      const learningWord = (isLearningFromOriginal ? original : translation) || "";
      const nativeTranslation = (isLearningFromOriginal ? translation : original) || "";
      const hasDictionaryWord = learningLanguage === "en" && isSingleEnglishWord(learningWord);
      const dictionaryWord = hasDictionaryWord ? learningWord.trim() : "";
      const dictionaryLang = hasDictionaryWord ? "en" : "";
      this.renderTooltipContent({
        learningWord,
        nativeTranslation,
        difficulty,
        phonetic: aiPhonetic,
        originalWord: original,
        partOfSpeech: aiPartOfSpeech,
        shortDefinition: aiShortDefinition,
        wiktionaryExample: null,
        aiExample,
        isLoading: hasDictionaryWord
      });
      const rect = element.getBoundingClientRect();
      this.tooltip.style.left = rect.left + window.scrollX + "px";
      this.tooltip.style.top = rect.bottom + window.scrollY + 5 + "px";
      this.tooltip.style.display = "block";
      if (hasDictionaryWord) {
        const key = dictionaryWord.toLowerCase().trim();
        this.tooltip.dataset.dictWord = key;
        try {
          const entry = await getDictionaryEntry(dictionaryWord, dictionaryLang);
          if (this.tooltip.dataset.dictWord !== key) return;
          const finalPhonetic = entry?.phoneticText || aiPhonetic;
          const finalPartOfSpeech = entry?.partOfSpeech || aiPartOfSpeech;
          let finalDefinition = entry?.shortDefinition || aiShortDefinition;
          if (finalDefinition) {
            finalDefinition = finalDefinition.replace(/\([^)]*[\/\[][^\]\/]*[\/\]][^)]*\)/g, "").replace(/[\/\[][^\]\/]+[\/\]]/g, "").replace(/\s+/g, " ").trim();
          }
          this.renderTooltipContent({
            learningWord,
            nativeTranslation,
            difficulty,
            phonetic: finalPhonetic,
            originalWord: original,
            partOfSpeech: finalPartOfSpeech,
            shortDefinition: finalDefinition,
            wiktionaryExample: entry?.example || null,
            aiExample,
            isLoading: false
          });
        } catch (error) {
          if (this.tooltip.dataset.dictWord === key) {
            this.renderTooltipContent({
              learningWord,
              nativeTranslation,
              difficulty,
              phonetic: aiPhonetic,
              originalWord: original,
              partOfSpeech: aiPartOfSpeech,
              shortDefinition: aiShortDefinition,
              wiktionaryExample: null,
              aiExample,
              isLoading: false
            });
          }
        }
      }
    }
    /**
     * 渲染 Tooltip 内容
     * @param {object} data - 渲染数据
     */
    renderTooltipContent({ learningWord, nativeTranslation, difficulty, phonetic, originalWord, partOfSpeech, shortDefinition, wiktionaryExample, aiExample, isLoading }) {
      const safeLearningWord = this.escapeHtml(learningWord);
      const safeNativeTranslation = this.escapeHtml(nativeTranslation);
      const safePhonetic = this.escapeHtml(phonetic);
      const safeOriginalWord = this.escapeHtml(originalWord);
      const safePartOfSpeech = this.escapeHtml(partOfSpeech);
      const safeShortDefinition = this.escapeHtml(shortDefinition);
      const safeDifficulty = this.escapeHtml(difficulty);
      const safePhoneticHtml = safePhonetic ? `<div class="vocabmeld-tooltip-phonetic">${safePhonetic}</div>` : "";
      const safePosHtml = safePartOfSpeech ? `<span class="vocabmeld-tooltip-pos">${safePartOfSpeech}</span>` : "";
      const safeDefinitionHtml = safeShortDefinition ? `<div class="vocabmeld-tooltip-definition">${safePosHtml}${safeShortDefinition}</div>` : "";
      let safeExamplesHtml = "";
      const examples = [];
      const safeWiktionaryExample = this.escapeHtml(wiktionaryExample);
      const safeAiExample = this.escapeHtml(aiExample);
      if (safeWiktionaryExample) {
        examples.push(`<div class="vocabmeld-tooltip-example">${safeWiktionaryExample}</div>`);
      }
      if (safeAiExample) {
        const alreadyMarked = /\(AI\)\s*$/.test(String(aiExample || ""));
        examples.push(`<div class="vocabmeld-tooltip-example">${safeAiExample}${alreadyMarked ? "" : " (AI)"}</div>`);
      }
      if (isLoading) {
        safeExamplesHtml = `<div class="vocabmeld-tooltip-examples">${examples.join("")}<div class="vocabmeld-tooltip-dict-loading">Loading...</div></div>`;
      } else if (examples.length > 0) {
        safeExamplesHtml = `<div class="vocabmeld-tooltip-examples">${examples.join("")}</div>`;
      }
      this.tooltip.innerHTML = `
      <div class="vocabmeld-tooltip-header">
        <span class="vocabmeld-tooltip-word">${safeLearningWord}${safeNativeTranslation ? ` <span class="vocabmeld-tooltip-translation">(${safeNativeTranslation})</span>` : ""}</span>
        ${safeDifficulty ? `<span class="vocabmeld-tooltip-badge">${safeDifficulty}</span>` : ""}
      </div>
      ${safePhoneticHtml}
      <div class="vocabmeld-tooltip-original">Original: ${safeOriginalWord}</div>
      ${safeDefinitionHtml}
      ${safeExamplesHtml}
      <div class="vocabmeld-tooltip-actions">
        <button class="vocabmeld-action-btn vocabmeld-btn-speak" data-action="speak" title="Pronounce">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
          <span>\u53D1\u97F3</span>
        </button>
        <button class="vocabmeld-action-btn vocabmeld-btn-memorize" data-action="memorize" title="Add to memorize list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          <span>\u8BB0\u5FC6</span>
        </button>
        <button class="vocabmeld-action-btn vocabmeld-btn-learned" data-action="learned" title="\u6807\u8BB0\u4E3A\u5DF2\u5B66\u4F1A">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>\u5DF2\u5B66\u4F1A</span>
        </button>
      </div>
    `;
    }
    /**
     * 隐藏 Tooltip
     * @param {boolean} immediate - 是否立即隐藏
     */
    hide(immediate = false) {
      if (this.tooltipHideTimeout) {
        clearTimeout(this.tooltipHideTimeout);
        this.tooltipHideTimeout = null;
      }
      if (immediate) {
        if (this.tooltip) this.tooltip.style.display = "none";
        this.currentTooltipElement = null;
      } else {
        this.tooltipHideTimeout = setTimeout(() => {
          if (this.tooltip) this.tooltip.style.display = "none";
          this.currentTooltipElement = null;
          this.tooltipHideTimeout = null;
        }, 800);
      }
    }
    /**
     * 取消 Tooltip 隐藏操作
     */
    cancelHide() {
      if (this.tooltipHideTimeout) {
        clearTimeout(this.tooltipHideTimeout);
        this.tooltipHideTimeout = null;
      }
    }
    /**
     * 获取当前 Tooltip 对应的元素
     * @returns {HTMLElement|null}
     */
    getCurrentElement() {
      return this.currentTooltipElement;
    }
    /**
     * 播放单词音频
     * @param {HTMLElement} element - 翻译元素
     */
    async playAudio(element) {
      if (!element) return;
      const original = element.getAttribute("data-original") || "";
      const translation = element.getAttribute("data-translation") || "";
      const sourceLang = element.getAttribute("data-source-lang") || "";
      const learningLanguage = this.config?.targetLanguage || "en";
      let isLearningFromOriginal;
      if (sourceLang) {
        isLearningFromOriginal = sourceLang === learningLanguage;
      } else if (learningLanguage === "en") {
        if (isSingleEnglishWord(original)) isLearningFromOriginal = true;
        else if (isSingleEnglishWord(translation)) isLearningFromOriginal = false;
      }
      if (typeof isLearningFromOriginal !== "boolean") {
        const originalLang = original ? await detectLanguage(original) : "";
        isLearningFromOriginal = originalLang === learningLanguage;
      }
      const learningWord = (isLearningFromOriginal ? original : translation) || "";
      let word = learningWord;
      let lang = learningLanguage;
      if (!word) {
        word = translation || original;
        lang = await detectLanguage(word);
      }
      if (!word) return;
      const provider = this.config?.pronunciationProvider || "wiktionary";
      if (provider === "google") {
        try {
          await playGoogleTranslateTts(word, lang);
          return;
        } catch (e) {
        }
      }
      if (lang === "en") {
        const youdaoType = this.config?.youdaoPronunciationType ?? 2;
        if (provider === "youdao") {
          try {
            await playYoudaoDictVoice(word, youdaoType);
            return;
          } catch (e) {
          }
        }
        try {
          await playDictionaryAudio(word, lang);
          return;
        } catch (e) {
        }
      }
      const ttsLang = lang === "en" ? "en-US" : lang === "zh-CN" ? "zh-CN" : lang === "ja" ? "ja-JP" : lang === "ko" ? "ko-KR" : "en-US";
      chrome.runtime.sendMessage({ action: "speak", text: word, lang: ttsLang }).catch(() => {
      });
    }
  };

  // js/ui/toast.js
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "vocabmeld-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("vocabmeld-toast-show"), 10);
    setTimeout(() => {
      toast.classList.remove("vocabmeld-toast-show");
      setTimeout(() => toast.remove(), 300);
    }, 2e3);
  }

  // js/core/config.js
  var CEFR_LEVELS2 = ["A1", "A2", "B1", "B2", "C1", "C2"];
  var INTENSITY_CONFIG = {
    low: { maxPerParagraph: 4, label: "\u8F83\u5C11" },
    medium: { maxPerParagraph: 8, label: "\u9002\u4E2D" },
    high: { maxPerParagraph: 14, label: "\u8F83\u591A" }
  };
  var API_PRESETS = {
    openai: {
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini"
    },
    deepseek: {
      name: "DeepSeek",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-chat"
    },
    moonshot: {
      name: "Moonshot",
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
      model: "moonshot-v1-8k"
    },
    groq: {
      name: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama-3.1-8b-instant"
    },
    ollama: {
      name: "Ollama (\u672C\u5730)",
      endpoint: "http://localhost:11434/v1/chat/completions",
      model: "qwen2.5:7b"
    }
  };
  var DEFAULT_CONFIG = {
    // API 配置
    apiEndpoint: API_PRESETS.deepseek.endpoint,
    apiKey: "",
    modelName: API_PRESETS.deepseek.model,
    // 学习偏好
    nativeLanguage: "zh-CN",
    targetLanguage: "en",
    difficultyLevel: "B1",
    intensity: "medium",
    // 行为设置
    autoProcess: false,
    showPhonetic: true,
    pronunciationProvider: "wiktionary",
    youdaoPronunciationType: 2,
    enabled: true,
    // 站点规则
    blacklist: [],
    whitelist: [],
    // 统计数据
    totalWords: 0,
    todayWords: 0,
    lastResetDate: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    // 缓存统计
    cacheHits: 0,
    cacheMisses: 0
  };
  var CACHE_CONFIG = {
    maxSize: 2e3,
    storageKey: "vocabmeld_word_cache"
  };
  function isDifficultyCompatible(wordDifficulty, userDifficulty) {
    const wordIdx = CEFR_LEVELS2.indexOf(wordDifficulty);
    const userIdx = CEFR_LEVELS2.indexOf(userDifficulty);
    return wordIdx >= userIdx;
  }

  // js/core/storage.js
  var StorageService = class {
    constructor() {
      this.cache = null;
      this.listeners = /* @__PURE__ */ new Map();
    }
    /**
     * 获取配置值
     * @param {string|string[]|null} keys - 要获取的键，null 则获取所有
     * @returns {Promise<object>}
     */
    async get(keys = null) {
      return new Promise((resolve) => {
        chrome.storage.sync.get(keys, (result) => {
          if (keys === null) {
            resolve({ ...DEFAULT_CONFIG, ...result });
          } else if (typeof keys === "string") {
            resolve({ [keys]: result[keys] ?? DEFAULT_CONFIG[keys] });
          } else {
            const merged = {};
            keys.forEach((key) => {
              merged[key] = result[key] ?? DEFAULT_CONFIG[key];
            });
            resolve(merged);
          }
        });
      });
    }
    /**
     * 设置配置值
     * @param {object} items - 要设置的键值对
     * @returns {Promise<void>}
     */
    async set(items) {
      return new Promise((resolve, reject) => {
        chrome.storage.sync.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    }
    /**
     * 从本地存储获取数据（用于大量数据如缓存）
     * @param {string|string[]|null} keys
     * @returns {Promise<object>}
     */
    async getLocal(keys = null) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => {
          resolve(result);
        });
      });
    }
    /**
     * 设置本地存储数据
     * @param {object} items
     * @returns {Promise<void>}
     */
    async setLocal(items) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    }
    /**
     * 清除本地存储
     * @param {string|string[]} keys
     * @returns {Promise<void>}
     */
    async removeLocal(keys) {
      return new Promise((resolve) => {
        chrome.storage.local.remove(keys, resolve);
      });
    }
    /**
     * 获取完整配置
     * @returns {Promise<object>}
     */
    async getConfig() {
      return this.get(null);
    }
    /**
     * 更新统计数据
     * @param {object} stats - 统计数据更新
     * @returns {Promise<void>}
     */
    async updateStats(stats) {
      const current = await this.get(["totalWords", "todayWords", "lastResetDate", "cacheHits", "cacheMisses"]);
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      if (current.lastResetDate !== today) {
        current.todayWords = 0;
        current.lastResetDate = today;
      }
      const updated = {
        totalWords: current.totalWords + (stats.newWords || 0),
        todayWords: current.todayWords + (stats.newWords || 0),
        lastResetDate: today,
        cacheHits: current.cacheHits + (stats.cacheHits || 0),
        cacheMisses: current.cacheMisses + (stats.cacheMisses || 0)
      };
      await this.set(updated);
      return updated;
    }
    /**
     * 获取白名单（已学会词汇）
     * @returns {Promise<Array>}
     */
    async getWhitelist() {
      const result = await this.get("learnedWords");
      return result.learnedWords || [];
    }
    /**
     * 添加词汇到白名单
     * @param {object} word - { original, word, addedAt }
     * @returns {Promise<void>}
     */
    async addToWhitelist(word) {
      const whitelist = await this.getWhitelist();
      const exists = whitelist.some((w) => w.original === word.original || w.word === word.word);
      if (!exists) {
        whitelist.push({
          original: word.original,
          word: word.word,
          addedAt: Date.now()
        });
        await this.set({ learnedWords: whitelist });
      }
    }
    /**
     * 从白名单移除词汇
     * @param {string} word - 词汇
     * @returns {Promise<void>}
     */
    async removeFromWhitelist(word) {
      const whitelist = await this.getWhitelist();
      const filtered = whitelist.filter((w) => w.original !== word && w.word !== word);
      await this.set({ learnedWords: filtered });
    }
    /**
     * 获取需记忆列表
     * @returns {Promise<Array>}
     */
    async getMemorizeList() {
      const result = await this.get("memorizeList");
      return result.memorizeList || [];
    }
    /**
     * 添加词汇到需记忆列表
     * @param {string} word - 词汇
     * @returns {Promise<void>}
     */
    async addToMemorizeList(word) {
      const list = await this.getMemorizeList();
      const exists = list.some((w) => w.word === word);
      if (!exists) {
        list.push({
          word,
          addedAt: Date.now()
        });
        await this.set({ memorizeList: list });
      }
    }
    /**
     * 从需记忆列表移除词汇
     * @param {string} word - 词汇
     * @returns {Promise<void>}
     */
    async removeFromMemorizeList(word) {
      const list = await this.getMemorizeList();
      const filtered = list.filter((w) => w.word !== word);
      await this.set({ memorizeList: filtered });
    }
    /**
     * 检查站点是否在黑名单
     * @param {string} hostname - 站点域名
     * @returns {Promise<boolean>}
     */
    async isBlacklisted(hostname) {
      const { blacklist } = await this.get("blacklist");
      return (blacklist || []).some((domain) => hostname.includes(domain));
    }
    /**
     * 检查站点是否在白名单
     * @param {string} hostname - 站点域名
     * @returns {Promise<boolean>}
     */
    async isWhitelisted(hostname) {
      const { whitelist } = await this.get("whitelist");
      return (whitelist || []).some((domain) => hostname.includes(domain));
    }
    /**
     * 添加存储变化监听器
     * @param {function} callback - 回调函数
     * @returns {function} - 取消监听的函数
     */
    addChangeListener(callback) {
      const listener = (changes, areaName) => {
        if (areaName === "sync" || areaName === "local") {
          callback(changes, areaName);
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  };
  var storage = new StorageService();

  // js/services/cache-service.js
  var CacheService = class {
    constructor() {
      this.cache = /* @__PURE__ */ new Map();
      this.maxSize = CACHE_CONFIG.maxSize;
      this.initialized = false;
      this.initPromise = null;
    }
    /**
     * 初始化缓存（从存储加载）
     * @returns {Promise<void>}
     */
    async init() {
      if (this.initialized) return;
      if (this.initPromise) return this.initPromise;
      this.initPromise = (async () => {
        try {
          const data = await storage.getLocal(CACHE_CONFIG.storageKey);
          const cached = data[CACHE_CONFIG.storageKey];
          if (cached && Array.isArray(cached)) {
            cached.forEach((item) => {
              this.cache.set(item.key, {
                translation: item.translation,
                phonetic: item.phonetic,
                difficulty: item.difficulty,
                partOfSpeech: item.partOfSpeech || "",
                shortDefinition: item.shortDefinition || "",
                example: item.example || "",
                timestamp: item.timestamp
              });
            });
          }
          this.initialized = true;
          console.log(`[VocabMeld] Cache initialized with ${this.cache.size} items`);
        } catch (error) {
          console.error("[VocabMeld] Failed to initialize cache:", error);
          this.initialized = true;
        }
      })();
      return this.initPromise;
    }
    /**
     * 生成缓存键
     * @param {string} word - 原词
     * @param {string} sourceLang - 源语言
     * @param {string} targetLang - 目标语言
     * @returns {string}
     */
    generateKey(word, sourceLang, targetLang) {
      return `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
    }
    /**
     * 获取缓存项
     * @param {string} word - 原词
     * @param {string} sourceLang - 源语言
     * @param {string} targetLang - 目标语言
     * @returns {object|null}
     */
    get(word, sourceLang, targetLang) {
      const key = this.generateKey(word, sourceLang, targetLang);
      const item = this.cache.get(key);
      if (item) {
        this.cache.delete(key);
        this.cache.set(key, item);
        return item;
      }
      return null;
    }
    /**
     * 设置缓存项
     * @param {string} word - 原词
     * @param {string} sourceLang - 源语言
     * @param {string} targetLang - 目标语言
     * @param {object} data - { translation, phonetic, difficulty }
     * @returns {Promise<void>}
     */
    async set(word, sourceLang, targetLang, data) {
      const key = this.generateKey(word, sourceLang, targetLang);
      if (this.cache.has(key)) {
        this.cache.delete(key);
      }
      while (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(key, {
        translation: data.translation,
        phonetic: data.phonetic || "",
        difficulty: data.difficulty || "B1",
        partOfSpeech: data.partOfSpeech || "",
        shortDefinition: data.shortDefinition || "",
        example: data.example || "",
        timestamp: Date.now()
      });
      this.persist();
    }
    /**
     * 批量设置缓存
     * @param {Array} items - [{ word, sourceLang, targetLang, translation, phonetic, difficulty }]
     * @returns {Promise<void>}
     */
    async setMany(items) {
      for (const item of items) {
        const key = this.generateKey(item.word, item.sourceLang, item.targetLang);
        if (this.cache.has(key)) {
          this.cache.delete(key);
        }
        while (this.cache.size >= this.maxSize) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        this.cache.set(key, {
          translation: item.translation,
          phonetic: item.phonetic || "",
          difficulty: item.difficulty || "B1",
          partOfSpeech: item.partOfSpeech || "",
          shortDefinition: item.shortDefinition || "",
          example: item.example || "",
          timestamp: Date.now()
        });
      }
      await this.persist();
    }
    /**
     * 检查缓存中的词汇
     * @param {string[]} words - 词汇列表
     * @param {string} sourceLang - 源语言
     * @param {string} targetLang - 目标语言
     * @returns {{ cached: Map, uncached: string[] }}
     */
    checkWords(words, sourceLang, targetLang) {
      const cached = /* @__PURE__ */ new Map();
      const uncached = [];
      for (const word of words) {
        const item = this.get(word, sourceLang, targetLang);
        if (item) {
          cached.set(word, item);
        } else {
          uncached.push(word);
        }
      }
      return { cached, uncached };
    }
    /**
     * 持久化缓存到存储
     * @returns {Promise<void>}
     */
    async persist() {
      try {
        const data = [];
        for (const [key, value] of this.cache) {
          data.push({
            key,
            ...value
          });
        }
        await storage.setLocal({
          [CACHE_CONFIG.storageKey]: data
        });
      } catch (error) {
        console.error("[VocabMeld] Failed to persist cache:", error);
      }
    }
    /**
     * 清空缓存
     * @returns {Promise<void>}
     */
    async clear() {
      this.cache.clear();
      await storage.removeLocal(CACHE_CONFIG.storageKey);
      console.log("[VocabMeld] Cache cleared");
    }
    /**
     * 获取缓存统计
     * @returns {object}
     */
    getStats() {
      return {
        size: this.cache.size,
        maxSize: this.maxSize
      };
    }
    /**
     * 获取所有缓存词汇
     * @returns {Array}
     */
    getAllWords() {
      const words = [];
      for (const [key, value] of this.cache) {
        const [word, sourceLang, targetLang] = key.split(":");
        words.push({
          original: word,
          translation: value.translation,
          phonetic: value.phonetic,
          difficulty: value.difficulty,
          example: value.example || "",
          sourceLang,
          targetLang
        });
      }
      return words;
    }
  };
  var cacheService = new CacheService();

  // js/prompts/ai-prompts.js
  function buildVocabularySelectionPrompt({
    sourceLang,
    targetLang,
    nativeLanguage,
    learningLanguage,
    aiTargetCount,
    aiMaxCount
  }) {
    const isLearningFromSource = sourceLang === learningLanguage;
    const learningWordField = isLearningFromSource ? "original" : "translation";
    return `You are a professional language learning assistant. Your task is to analyze text and select valuable words for translation to help users learn new vocabulary.

## Your Mission:
Select ${aiTargetCount}-${aiMaxCount} words with high learning value from the provided text.

## Translation Context:
- Source language: ${sourceLang}
- Target language: ${targetLang}
- User's native language: ${nativeLanguage}
- User's learning language: ${learningLanguage}
- **The word user is learning will be in the "${learningWordField}" field**

## Selection Rules (MUST FOLLOW):
1. Select ONLY ${aiTargetCount}-${aiMaxCount} words total
2. NEVER translate: proper nouns, person names, place names, brand names, numbers, code snippets, URLs
3. SKIP: words already in the target language
4. Prioritize: common useful vocabulary with mixed difficulty levels
5. Translation style: context-aware, single best meaning (not multiple definitions)
6. **CRITICAL PHONETIC RULE**: The "phonetic" field MUST be the pronunciation of the "${learningWordField}" field (the ${learningLanguage} word), NOT the ${isLearningFromSource ? targetLang : sourceLang} word!

${getCommonSections(nativeLanguage, learningLanguage, isLearningFromSource)}

## Example Output (JSON ONLY):
${isLearningFromSource ? `[
  {
    "original": "affiliated",
    "translation": "\u96B6\u5C5E\u7684",
    "phonetic": "/\u0259\u02C8f\u026Alie\u026At\u026Ad/",
    "difficulty": "B2",
    "partOfSpeech": "adjective",
    "shortDefinition": "officially connected or associated with an organization",
    "example": "The hospital is affiliated with the university medical school."
  },
  {
    "original": "technology",
    "translation": "\u6280\u672F",
    "phonetic": "/tek\u02C8n\u0252l\u0259d\u0292i/",
    "difficulty": "A2",
    "partOfSpeech": "noun",
    "shortDefinition": "the application of scientific knowledge for practical purposes",
    "example": "Modern technology has transformed the way we communicate."
  }
]` : `[
  {
    "original": "\u827A\u672F\u5BB6",
    "translation": "artist",
    "phonetic": "/\u02C8\u0251\u02D0t\u026Ast/",
    "difficulty": "B2",
    "partOfSpeech": "noun",
    "shortDefinition": "a person who creates art, especially paintings or drawings",
    "example": "The artist spent years perfecting her technique."
  },
  {
    "original": "\u6280\u672F",
    "translation": "technology",
    "phonetic": "/tek\u02C8n\u0252l\u0259d\u0292i/",
    "difficulty": "A2",
    "partOfSpeech": "noun",
    "shortDefinition": "the application of scientific knowledge for practical purposes",
    "example": "Technology continues to advance at a rapid pace."
  }
]`}`;
  }
  function buildSpecificWordsPrompt({
    sourceLang,
    targetLang,
    nativeLanguage,
    learningLanguage
  }) {
    const isLearningFromSource = sourceLang === learningLanguage;
    const learningWordField = isLearningFromSource ? "original" : "translation";
    return `You are a language learning assistant. Translate the specific words provided by the user.

## Rules:
1. Translate every provided word; do not skip any
2. If a word is in ${sourceLang}, translate it to ${targetLang}; otherwise translate it the other way
3. **CRITICAL PHONETIC RULE**: The "phonetic" field MUST be the pronunciation of the "${learningWordField}" field (the ${learningLanguage} word), NOT the ${isLearningFromSource ? targetLang : sourceLang} word!

${getCommonSections(nativeLanguage, learningLanguage, isLearningFromSource)}

## Example Output (JSON ONLY):
${isLearningFromSource ? `[
  {
    "original": "affiliated",
    "translation": "\u96B6\u5C5E\u7684",
    "phonetic": "/\u0259\u02C8f\u026Alie\u026At\u026Ad/",
    "difficulty": "B2",
    "partOfSpeech": "adjective",
    "shortDefinition": "officially connected or associated with an organization",
    "example": "The hospital is affiliated with the university medical school."
  }
]` : `[
  {
    "original": "\u6280\u672F",
    "translation": "technology",
    "phonetic": "/tek\u02C8n\u0252l\u0259d\u0292i/",
    "difficulty": "A2",
    "partOfSpeech": "noun",
    "shortDefinition": "the application of scientific knowledge for practical purposes",
    "example": "Technology continues to advance at a rapid pace."
  }
]`}

## Output:
Return only the JSON array and nothing else.`;
  }
  function getCommonSections(nativeLanguage, learningLanguage, isLearningFromSource) {
    const learningWordField = isLearningFromSource ? "original" : "translation";
    return `## CEFR Difficulty Levels:
A1 \u2192 A2 \u2192 B1 \u2192 B2 \u2192 C1 \u2192 C2

## Phonetic Format Rules:
- For English: use IPA like "/\u0259\u02C8f\u026Alie\u026At\u026Ad/" or "/tek\u02C8n\u0252l\u0259d\u0292i/"
- For Chinese: use pinyin with tones like "l\xEDng g\u01CEn"
- For Japanese: use romaji like "ko-n-ni-chi-wa"
- For Korean: use romanization like "an-nyeong"
- **IMPORTANT: The phonetic MUST be the pronunciation of the "${learningWordField}" field (${learningLanguage}), NOT the other field!**

## Required Output Fields:
- **original**: the original word from the text
- **translation**: the translated word in target language
- **phonetic**: pronunciation of the ${learningLanguage} word (from the "${learningWordField}" field)
- **difficulty**: CEFR level (A1/A2/B1/B2/C1/C2)
- **partOfSpeech**: grammatical category in learning language (${learningLanguage}) - e.g., "noun", "verb", "adjective"
- **shortDefinition**: brief definition in learning language (${learningLanguage}) - keep it concise (1-2 sentences max)
- **example**: a natural example sentence in learning language (${learningLanguage}) using the word in context`;
  }

  // js/utils/text-processor.js
  function segmentText(text, lang) {
    if (!text || typeof text !== "string") return [];
    if (lang === "Chinese") {
      try {
        const segment = new window.Segment();
        segment.useDefault();
        const words = segment.doSegment(text, {
          simple: true,
          stripPunctuation: true
        });
        return words.filter((w) => w && w.trim().length > 0 && /[\u4e00-\u9fff]/.test(w));
      } catch (error) {
        console.error("\u4E2D\u6587\u5206\u8BCD\u5931\u8D25\uFF0C\u4F7F\u7528\u964D\u7EA7\u65B9\u6848:", error);
        return text.match(/[\u4e00-\u9fff]+/g) || [];
      }
    }
    if (lang === "English") {
      return text.replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w && w.length > 0 && /[a-zA-Z]/.test(w));
    }
    if (lang === "Japanese") {
      return text.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+/g) || [];
    }
    if (lang === "Korean") {
      return text.match(/[\uac00-\ud7af]+/g) || [];
    }
    return text.split(/\s+/).filter((w) => w && w.trim().length > 0);
  }
  function reconstructTextWithWords(text, targetWords) {
    const targetWordSet = new Set(targetWords.map((w) => w.toLowerCase()));
    const lowerText = text.toLowerCase();
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const relevantSentences = sentences.filter((sentence) => {
      const lowerSentence = sentence.toLowerCase();
      const words = sentence.match(/\b[a-zA-Z]{5,}\b/g) || [];
      const hasEnglishMatch = words.some((word) => targetWordSet.has(word.toLowerCase()));
      const hasChineseMatch = Array.from(targetWordSet).some((word) => {
        if (/[\u4e00-\u9fff]/.test(word)) {
          return lowerSentence.includes(word);
        }
        return false;
      });
      return hasEnglishMatch || hasChineseMatch;
    });
    return relevantSentences.join(". ").trim() + (relevantSentences.length > 0 ? "." : "");
  }
  function filterWords(words) {
    return words.filter((word) => {
      const lower = word.toLowerCase();
      if (/^[a-zA-Z]+$/.test(word)) {
        return !STOP_WORDS.has(lower) && word.length >= 5;
      }
      if (/[\u4e00-\u9fff]/.test(word)) {
        return word.length >= 2;
      }
      return true;
    });
  }

  // js/services/api-service.js
  var ApiService = class {
    constructor() {
      this.config = null;
    }
    /**
     * 设置配置
     * @param {object} config - 配置对象
     */
    setConfig(config2) {
      this.config = config2;
    }
    /**
     * 解析 API 响应（统一 JSON 解析逻辑）
     * @param {string} content - API 返回内容
     * @returns {Array}
     */
    parseApiResponse(content) {
      try {
        let parsed = JSON.parse(content);
        if (Array.isArray(parsed)) return parsed;
        if (parsed.results && Array.isArray(parsed.results)) {
          return parsed.results;
        }
        if (parsed.words && Array.isArray(parsed.words)) {
          return parsed.words;
        }
        return [];
      } catch (e) {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[0]);
          } catch (e2) {
            console.error("[VocabMeld] Failed to parse API response:", e2);
          }
        }
        return [];
      }
    }
    /**
     * 更新缓存（统一 LRU 管理）
     * @param {Array} results - AI 返回的结果
     * @param {string} sourceLang - 源语言
     * @param {string} targetLang - 目标语言
     */
    async updateCache(results, sourceLang, targetLang) {
      const cacheItems = [];
      for (const item of results) {
        const word = item.original || "";
        if (isNonLearningWord(word)) continue;
        const isChinese = /[\u4e00-\u9fff]/.test(word);
        if (isChinese && word.length < 2) continue;
        const isEnglish = /^[a-zA-Z]+$/.test(word);
        if (isEnglish && word.length < 5) continue;
        cacheItems.push({
          word,
          sourceLang,
          targetLang,
          translation: item.translation,
          phonetic: item.phonetic || "",
          difficulty: item.difficulty || "B1",
          partOfSpeech: item.partOfSpeech || "",
          shortDefinition: item.shortDefinition || "",
          example: item.example || ""
        });
      }
      if (cacheItems.length > 0) {
        await cacheService.setMany(cacheItems);
      }
    }
    /**
     * 翻译文本（支持立即返回缓存 + 异步 API）
     * @param {string} text - 要翻译的文本
     * @param {object} config - 配置对象
     * @param {object} cacheMap - 外部传入的缓存 Map（content.js 的 wordCache）
     * @param {function} updateStatsCallback - 更新统计的回调函数
     * @param {function} saveCacheCallback - 保存缓存的回调函数
     * @returns {Promise<{immediate: Array, async: Promise|null}>}
     */
    async translateText(text, config2, cacheMap, updateStatsCallback, saveCacheCallback) {
      if (!config2.apiKey || !config2.apiEndpoint) {
        throw new Error("API \u672A\u914D\u7F6E");
      }
      const sourceLang = await detectLanguage(text);
      const targetLang = sourceLang === config2.nativeLanguage ? config2.targetLanguage : config2.nativeLanguage;
      const maxReplacements = INTENSITY_CONFIG[config2.intensity]?.maxPerParagraph || 8;
      const segmentedWords = segmentText(text, sourceLang);
      const allWords = filterWords(segmentedWords);
      const cached = [];
      const uncached = [];
      const cachedWordsSet = /* @__PURE__ */ new Set();
      for (const word of allWords) {
        const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
        if (cacheMap.has(key)) {
          const lowerWord = word.toLowerCase();
          if (!cachedWordsSet.has(lowerWord)) {
            cached.push({ word, ...cacheMap.get(key) });
            cachedWordsSet.add(lowerWord);
          }
        } else {
          uncached.push(word);
        }
      }
      const lowerText = text.toLowerCase();
      for (const [key, value] of cacheMap) {
        const [cachedWord, cachedSourceLang, cachedTargetLang] = key.split(":");
        if (cachedSourceLang === sourceLang && cachedTargetLang === targetLang && /[\u4e00-\u9fff]/.test(cachedWord) && cachedWord.length >= 2) {
          const lowerCachedWord = cachedWord.toLowerCase();
          if (!cachedWordsSet.has(lowerCachedWord)) {
            if (lowerText.includes(lowerCachedWord)) {
              const idx = text.toLowerCase().indexOf(lowerCachedWord);
              if (idx >= 0) {
                cached.push({
                  word: text.substring(idx, idx + cachedWord.length),
                  ...value
                });
                cachedWordsSet.add(lowerCachedWord);
              }
            }
          }
        }
      }
      const filteredCached = cached.filter((c) => isDifficultyCompatible(c.difficulty || "B1", config2.difficultyLevel)).map((c) => {
        const idx = text.toLowerCase().indexOf(c.word.toLowerCase());
        return {
          original: c.word,
          translation: c.translation,
          phonetic: c.phonetic,
          difficulty: c.difficulty,
          partOfSpeech: c.partOfSpeech || "",
          shortDefinition: c.shortDefinition || "",
          example: c.example || "",
          position: idx >= 0 ? idx : 0,
          fromCache: true,
          sourceLang
        };
      });
      const immediateResults = filteredCached.slice(0, maxReplacements);
      if (immediateResults.length > 0) {
        updateStatsCallback({ cacheHits: immediateResults.length, cacheMisses: 0 });
      }
      if (uncached.length === 0) {
        return { immediate: immediateResults, async: null };
      }
      const filteredText = reconstructTextWithWords(text, uncached);
      const cacheSatisfied = immediateResults.length >= maxReplacements;
      const textTooShort = filteredText.trim().length < 50;
      if (textTooShort) {
        return { immediate: immediateResults, async: null };
      }
      const remainingSlots = maxReplacements - immediateResults.length;
      const maxAsyncReplacements = cacheSatisfied ? 1 : remainingSlots;
      if (maxAsyncReplacements <= 0) {
        return { immediate: immediateResults, async: null };
      }
      const aiTargetCount = cacheSatisfied ? 1 : Math.max(maxAsyncReplacements, Math.ceil(maxReplacements * 1.5));
      const aiMaxCount = maxReplacements * 2;
      const asyncPromise = (async () => {
        try {
          const systemPrompt = buildVocabularySelectionPrompt({
            sourceLang,
            targetLang,
            nativeLanguage: config2.nativeLanguage,
            learningLanguage: config2.targetLanguage,
            aiTargetCount,
            aiMaxCount
          });
          const userPrompt = `${filteredText}`;
          const response = await fetch(config2.apiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${config2.apiKey}`
            },
            body: JSON.stringify({
              model: config2.modelName,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              temperature: 0,
              max_tokens: 4096
            })
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `API Error: ${response.status}`);
          }
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "[]";
          let allResults = this.parseApiResponse(content);
          for (const item of allResults) {
            const word = item.original || "";
            if (isNonLearningWord(word)) continue;
            const isChinese = /[\u4e00-\u9fff]/.test(word);
            if (isChinese && word.length < 2) continue;
            const isEnglish = /^[a-zA-Z]+$/.test(word);
            if (isEnglish && word.length < 5) continue;
            const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
            if (cacheMap.has(key)) {
              cacheMap.delete(key);
            }
            while (cacheMap.size >= CACHE_CONFIG.maxSize) {
              const firstKey = cacheMap.keys().next().value;
              cacheMap.delete(firstKey);
            }
            cacheMap.set(key, {
              translation: item.translation,
              phonetic: item.phonetic || "",
              difficulty: item.difficulty || "B1",
              partOfSpeech: item.partOfSpeech || "",
              shortDefinition: item.shortDefinition || "",
              example: item.example || ""
            });
          }
          await saveCacheCallback();
          const filteredResults = allResults.filter((item) => {
            const word = item.original || "";
            if (isNonLearningWord(word)) return false;
            if (!isDifficultyCompatible(item.difficulty || "B1", config2.difficultyLevel)) return false;
            const isEnglish = /^[a-zA-Z]+$/.test(word);
            if (isEnglish && word.length < 5) return false;
            return true;
          });
          updateStatsCallback({ newWords: filteredResults.length, cacheHits: cached.length, cacheMisses: 1 });
          const correctedResults = filteredResults.map((result) => {
            const originalIndex = text.toLowerCase().indexOf(result.original.toLowerCase());
            return {
              ...result,
              position: originalIndex >= 0 ? originalIndex : result.position,
              sourceLang
            };
          });
          const immediateWords = new Set(immediateResults.map((r) => r.original.toLowerCase()));
          const cachedResults = cached.filter(
            (c) => !immediateWords.has(c.word.toLowerCase()) && !correctedResults.some((r) => r.original.toLowerCase() === c.word.toLowerCase()) && isDifficultyCompatible(c.difficulty || "B1", config2.difficultyLevel) && !isNonLearningWord(c.word)
          ).map((c) => {
            const idx = text.toLowerCase().indexOf(c.word.toLowerCase());
            return {
              original: c.word,
              translation: c.translation,
              phonetic: c.phonetic,
              difficulty: c.difficulty,
              partOfSpeech: c.partOfSpeech || "",
              shortDefinition: c.shortDefinition || "",
              example: c.example || "",
              position: idx,
              fromCache: true,
              sourceLang
            };
          });
          const mergedResults = [...cachedResults, ...correctedResults];
          return mergedResults.slice(0, maxAsyncReplacements);
        } catch (error) {
          console.error("[VocabMeld] Async translation error:", error);
          return [];
        }
      })();
      return { immediate: immediateResults, async: asyncPromise };
    }
    /**
     * 翻译特定单词（用于记忆列表）
     * @param {string[]} targetWords - 要翻译的单词数组
     * @param {object} config - 配置对象
     * @param {object} cacheMap - 外部传入的缓存 Map
     * @param {function} updateStatsCallback - 更新统计的回调函数
     * @param {function} saveCacheCallback - 保存缓存的回调函数
     * @returns {Promise<Array>} 翻译结果
     */
    async translateSpecificWords(targetWords, config2, cacheMap, updateStatsCallback, saveCacheCallback) {
      if (!config2.apiKey || !config2.apiEndpoint || !targetWords?.length) {
        return [];
      }
      const sourceLang = await detectLanguage(targetWords.join(" "));
      const targetLang = sourceLang === config2.nativeLanguage ? config2.targetLanguage : config2.nativeLanguage;
      const uncached = [];
      const cached = [];
      for (const word of targetWords) {
        const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
        if (cacheMap.has(key)) {
          const cachedItem = cacheMap.get(key);
          cacheMap.delete(key);
          cacheMap.set(key, cachedItem);
          cached.push({ word, ...cachedItem });
        } else {
          uncached.push(word);
        }
      }
      let allResults = cached.map((c) => ({
        original: c.word,
        translation: c.translation,
        phonetic: c.phonetic,
        difficulty: c.difficulty,
        partOfSpeech: c.partOfSpeech || "",
        shortDefinition: c.shortDefinition || "",
        example: c.example || "",
        sourceLang
      }));
      if (uncached.length > 0) {
        try {
          const systemPrompt = buildSpecificWordsPrompt({
            sourceLang,
            targetLang,
            nativeLanguage: config2.nativeLanguage,
            learningLanguage: config2.targetLanguage
          });
          const userPrompt = uncached.join(", ");
          const response = await fetch(config2.apiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${config2.apiKey}`
            },
            body: JSON.stringify({
              model: config2.modelName,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              temperature: 0,
              max_tokens: 4096
            })
          });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `API Error: ${response.status}`);
          }
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "[]";
          let apiResults = this.parseApiResponse(content);
          for (const item of apiResults) {
            const word = item.original || "";
            if (isNonLearningWord(word)) continue;
            const isChinese = /[\u4e00-\u9fff]/.test(word);
            if (isChinese && word.length < 2) continue;
            const isEnglish = /^[a-zA-Z]+$/.test(word);
            if (isEnglish && word.length < 5) continue;
            const key = `${word.toLowerCase()}:${sourceLang}:${targetLang}`;
            if (cacheMap.has(key)) {
              cacheMap.delete(key);
            }
            while (cacheMap.size >= CACHE_CONFIG.maxSize) {
              const firstKey = cacheMap.keys().next().value;
              cacheMap.delete(firstKey);
            }
            cacheMap.set(key, {
              translation: item.translation,
              phonetic: item.phonetic || "",
              difficulty: item.difficulty || "B1",
              partOfSpeech: item.partOfSpeech || "",
              shortDefinition: item.shortDefinition || "",
              example: item.example || ""
            });
          }
          await saveCacheCallback();
          const apiResultsWithLang = apiResults.map((item) => ({
            ...item,
            sourceLang
          }));
          allResults = [...allResults, ...apiResultsWithLang];
          updateStatsCallback({ newWords: apiResults.length, cacheHits: cached.length, cacheMisses: 1 });
        } catch (error) {
          console.error("[VocabMeld] translateSpecificWords error:", error);
        }
      }
      return allResults.filter(
        (item) => targetWords.some((w) => w.toLowerCase() === item.original.toLowerCase()) && !isNonLearningWord(item.original)
      );
    }
  };
  var apiService = new ApiService();

  // js/services/content-segmenter.js
  var ContentSegmenter = class {
    constructor() {
      this.minSegmentLength = 50;
      this.maxSegmentLength = 2e3;
      this.processedFingerprints = /* @__PURE__ */ new Set();
    }
    /**
     * 检查节点是否应该跳过
     * @param {Node} node - DOM 节点
     * @returns {boolean}
     */
    shouldSkipNode(node) {
      if (!node) return true;
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
        return true;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        return this.shouldSkipNode(node.parentElement);
      }
      const element = node;
      if (SKIP_TAGS.includes(element.tagName)) {
        return true;
      }
      const classList = element.className?.toString() || "";
      if (SKIP_CLASSES.some((cls) => classList.includes(cls))) {
        return true;
      }
      try {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") {
          return true;
        }
      } catch (e) {
      }
      if (element.isContentEditable) {
        return true;
      }
      if (element.hasAttribute("data-vocabmeld-processed")) {
        return true;
      }
      return false;
    }
    /**
     * 生成内容指纹
     * @param {string} text - 文本内容
     * @param {string} path - DOM 路径
     * @returns {string}
     */
    generateFingerprint(text, path = "") {
      const content = text.slice(0, 100).trim();
      let hash = 0;
      const str = content + path;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      return hash.toString(36);
    }
    /**
     * 获取元素的 DOM 路径
     * @param {Element} element - DOM 元素
     * @returns {string}
     */
    getElementPath(element) {
      const parts = [];
      let current = element;
      while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector += `#${current.id}`;
        } else if (current.className) {
          const classes = current.className.toString().split(" ").slice(0, 2).join(".");
          if (classes) selector += `.${classes}`;
        }
        parts.unshift(selector);
        current = current.parentElement;
      }
      return parts.join(">");
    }
    /**
     * 检查指纹是否已处理
     * @param {string} fingerprint - 内容指纹
     * @returns {boolean}
     */
    isProcessed(fingerprint) {
      return this.processedFingerprints.has(fingerprint);
    }
    /**
     * 标记指纹为已处理
     * @param {string} fingerprint - 内容指纹
     */
    markProcessed(fingerprint) {
      this.processedFingerprints.add(fingerprint);
    }
    /**
     * 清除已处理的指纹
     */
    clearProcessed() {
      this.processedFingerprints.clear();
    }
    /**
     * 获取已处理的指纹数量
     * @returns {number}
     */
    getProcessedCount() {
      return this.processedFingerprints.size;
    }
    /**
     * 获取页面分段
     * @param {Element} root - 根元素
     * @param {object} options - 选项
     * @returns {Array} - 分段数组
     */
    getPageSegments(root = document.body, options = {}) {
      const { viewportOnly = false, margin = 300 } = options;
      const segments = [];
      let viewportTop = 0;
      let viewportBottom = Infinity;
      if (viewportOnly) {
        viewportTop = window.scrollY - margin;
        viewportBottom = window.scrollY + window.innerHeight + margin;
      }
      const containers = this.findTextContainers(root);
      for (const container of containers) {
        if (viewportOnly) {
          const rect = container.getBoundingClientRect();
          const elementTop = rect.top + window.scrollY;
          const elementBottom = rect.bottom + window.scrollY;
          if (elementBottom < viewportTop || elementTop > viewportBottom) {
            continue;
          }
        }
        const text = this.getTextContent(container);
        if (!text || text.length < this.minSegmentLength) {
          continue;
        }
        if (isCodeText(text)) {
          continue;
        }
        const path = this.getElementPath(container);
        const fingerprint = this.generateFingerprint(text, path);
        if (this.isProcessed(fingerprint)) {
          continue;
        }
        segments.push({
          element: container,
          text: text.slice(0, this.maxSegmentLength),
          fingerprint,
          path
        });
      }
      return segments;
    }
    /**
     * 查找文本容器元素
     * @param {Element} root - 根元素
     * @returns {Element[]}
     */
    findTextContainers(root) {
      const containers = [];
      const blockTags = ["P", "DIV", "ARTICLE", "SECTION", "LI", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "SPAN", "BLOCKQUOTE"];
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node2) => {
            if (this.shouldSkipNode(node2)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (blockTags.includes(node2.tagName)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      let node;
      while (node = walker.nextNode()) {
        const hasDirectText = Array.from(node.childNodes).some(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 10
        );
        if (hasDirectText) {
          containers.push(node);
        }
      }
      return containers;
    }
    /**
     * 获取元素的纯文本内容（排除子元素中的代码等）
     * @param {Element} element - DOM 元素
     * @returns {string}
     */
    getTextContent(element) {
      const texts = [];
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node2) => {
            if (this.shouldSkipNode(node2.parentElement)) {
              return NodeFilter.FILTER_REJECT;
            }
            const text = node2.textContent.trim();
            if (text.length > 0 && !isCodeText(text)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );
      let node;
      while (node = walker.nextNode()) {
        texts.push(node.textContent);
      }
      return texts.join(" ").replace(/\s+/g, " ").trim();
    }
    /**
     * 获取视口内的分段
     * @param {number} margin - 视口边缘外的处理范围
     * @returns {Array}
     */
    getViewportSegments(margin = 300) {
      return this.getPageSegments(document.body, { viewportOnly: true, margin });
    }
  };
  var contentSegmenter = new ContentSegmenter();

  // js/services/text-replacer.js
  var TextReplacer = class {
    constructor() {
      this.config = null;
    }
    /**
     * 设置配置
     * @param {object} config - 配置对象
     */
    setConfig(config2) {
      this.config = config2;
    }
    /**
     * 获取元素内的所有文本节点（带过滤）
     * @param {Element} element - DOM 元素
     * @returns {Text[]}
     */
    getTextNodes(element) {
      const nodes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node2) => {
          const parent = node2.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.classList?.contains("vocabmeld-translated")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (SKIP_TAGS.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          const classList = parent.className?.toString() || "";
          if (SKIP_CLASSES.some((cls) => classList.includes(cls) && cls !== "vocabmeld-translated")) {
            return NodeFilter.FILTER_REJECT;
          }
          try {
            const style = window.getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
          } catch (e) {
          }
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          const text = node2.textContent.trim();
          if (text.length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while (node = walker.nextNode()) {
        nodes.push(node);
      }
      return nodes;
    }
    /**
     * 创建替换元素
     * @param {string} original - 原词
     * @param {string} translation - 翻译
     * @param {string} phonetic - 音标
     * @param {string} difficulty - 难度
     * @param {string} partOfSpeech - 词性
     * @param {string} shortDefinition - 简短定义
     * @param {string} sourceLang - 源语言
     * @param {string} example - 例句
     * @returns {HTMLElement}
     */
    createReplacementElement(original, translation, phonetic, difficulty, partOfSpeech = "", shortDefinition = "", sourceLang = "", example = "") {
      const wrapper = document.createElement("span");
      wrapper.className = "vocabmeld-translated";
      wrapper.setAttribute("data-original", original);
      wrapper.setAttribute("data-translation", translation);
      wrapper.setAttribute("data-phonetic", phonetic || "");
      wrapper.setAttribute("data-difficulty", difficulty || "B1");
      wrapper.setAttribute("data-part-of-speech", partOfSpeech || "");
      wrapper.setAttribute("data-short-definition", shortDefinition || "");
      wrapper.setAttribute("data-source-lang", sourceLang || "");
      wrapper.setAttribute("data-example", example || "");
      const style = this.config?.translationStyle || "original-translation";
      wrapper.setAttribute("data-style", style);
      let innerHTML = "";
      switch (style) {
        case "translation-only":
          innerHTML = `<span class="vocabmeld-word">${translation}</span>`;
          break;
        case "original-translation":
          innerHTML = `<span class="vocabmeld-original">${original}</span><span class="vocabmeld-word">(${translation})</span>`;
          break;
        case "translation-original":
        default:
          innerHTML = `<span class="vocabmeld-word">${translation}</span><span class="vocabmeld-original">(${original})</span>`;
          break;
      }
      wrapper.innerHTML = innerHTML;
      return wrapper;
    }
    /**
     * 在元素中查找并替换词汇
     * @param {Element} element - DOM 元素
     * @param {Array} replacements - 替换项 [{ original, translation, phonetic, difficulty, partOfSpeech, shortDefinition, position, sourceLang, example }]
     * @returns {number} - 替换数量
     */
    applyReplacements(element, replacements) {
      if (!element || !replacements?.length) return 0;
      let count = 0;
      const sortedReplacements = [...replacements].sort((a, b) => (b.position || 0) - (a.position || 0));
      for (const replacement of sortedReplacements) {
        const { original, translation, phonetic, difficulty, partOfSpeech = "", shortDefinition = "", sourceLang = "", example = "" } = replacement;
        const isEnglishLike = /^[a-zA-Z]+$/.test(original);
        if (isEnglishLike && original.toLowerCase() === translation.toLowerCase()) {
          continue;
        }
        const lowerOriginal = original.toLowerCase();
        const textNodes = this.getTextNodes(element);
        for (let i = 0; i < textNodes.length; i++) {
          const textNode = textNodes[i];
          if (!textNode.parentElement || !element.contains(textNode)) {
            continue;
          }
          const text = textNode.textContent;
          const lowerText = text.toLowerCase();
          if (!lowerText.includes(lowerOriginal)) continue;
          const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(`(^|[^\\w\\u4e00-\\u9fff])${escapedOriginal}([^\\w\\u4e00-\\u9fff]|$)`, "i");
          let match = regex.exec(text);
          let startIndex = match ? match.index + match[1].length : text.toLowerCase().indexOf(lowerOriginal);
          if (startIndex === -1) continue;
          try {
            const range = document.createRange();
            range.setStart(textNode, startIndex);
            range.setEnd(textNode, startIndex + original.length);
            const rangeContent = range.toString();
            if (rangeContent.toLowerCase() !== lowerOriginal) continue;
            let parent = textNode.parentElement;
            let isAlreadyReplaced = false;
            while (parent && parent !== element) {
              if (parent.classList?.contains("vocabmeld-translated")) {
                isAlreadyReplaced = true;
                break;
              }
              parent = parent.parentElement;
            }
            if (isAlreadyReplaced) continue;
            const wrapper = this.createReplacementElement(original, translation, phonetic, difficulty, partOfSpeech, shortDefinition, sourceLang, example);
            range.deleteContents();
            range.insertNode(wrapper);
            count++;
            break;
          } catch (e) {
            console.error("[VocabMeld] Replacement error:", e, original);
          }
        }
      }
      if (count > 0) element.setAttribute("data-vocabmeld-processed", "true");
      return count;
    }
    /**
     * 恢复替换的词汇为原文
     * @param {Element} element - 替换元素
     */
    restoreOriginal(element) {
      if (!element.classList?.contains("vocabmeld-translated")) return;
      const original = element.getAttribute("data-original");
      const textNode = document.createTextNode(original);
      element.parentNode.replaceChild(textNode, element);
    }
    /**
     * 恢复页面上所有替换的词汇
     * @param {Element} root - 根元素
     */
    restoreAll(root = document.body) {
      root.querySelectorAll(".vocabmeld-translated").forEach((el) => this.restoreOriginal(el));
      root.querySelectorAll("[data-vocabmeld-processed]").forEach((el) => {
        el.removeAttribute("data-vocabmeld-processed");
      });
    }
  };
  var textReplacer = new TextReplacer();

  // js/content.js
  var config = null;
  var isProcessing = false;
  var wordCache = /* @__PURE__ */ new Map();
  var tooltipManager = new TooltipManager();
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(null, (result) => {
        config = {
          apiEndpoint: result.apiEndpoint || "https://api.deepseek.com/chat/completions",
          apiKey: result.apiKey || "",
          modelName: result.modelName || "deepseek-chat",
          nativeLanguage: result.nativeLanguage || "zh-CN",
          targetLanguage: result.targetLanguage || "en",
          difficultyLevel: result.difficultyLevel || "B1",
          intensity: result.intensity || "medium",
          autoProcess: result.autoProcess ?? false,
          showPhonetic: result.showPhonetic ?? true,
          pronunciationProvider: result.pronunciationProvider || "wiktionary",
          youdaoPronunciationType: Number(result.youdaoPronunciationType) === 1 ? 1 : 2,
          translationStyle: result.translationStyle || "original-translation",
          enabled: result.enabled ?? true,
          blacklist: result.blacklist || [],
          whitelist: result.whitelist || [],
          learnedWords: result.learnedWords || [],
          memorizeList: result.memorizeList || []
        };
        tooltipManager.setConfig(config);
        textReplacer.setConfig(config);
        resolve(config);
      });
    });
  }
  async function loadWordCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get("vocabmeld_word_cache", (result) => {
        const cached = result.vocabmeld_word_cache;
        if (cached && Array.isArray(cached)) {
          cached.forEach((item) => {
            wordCache.set(item.key, {
              translation: item.translation,
              phonetic: item.phonetic,
              difficulty: item.difficulty,
              partOfSpeech: item.partOfSpeech || "",
              shortDefinition: item.shortDefinition || "",
              example: item.example || ""
            });
          });
        }
        resolve(wordCache);
      });
    });
  }
  async function saveWordCache() {
    const data = [];
    for (const [key, value] of wordCache) {
      data.push({ key, ...value });
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ vocabmeld_word_cache: data }, () => {
        if (chrome.runtime.lastError) {
          if (isContextInvalidated(chrome.runtime.lastError)) {
            return resolve();
          }
          console.error("[VocabMeld] Failed to save cache:", chrome.runtime.lastError);
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }
  function isContextInvalidated(error) {
    const message = error && error.message || String(error || "");
    return message.includes("Extension context invalidated");
  }
  async function updateStats(stats) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(["totalWords", "todayWords", "lastResetDate", "cacheHits", "cacheMisses"], (current) => {
        if (chrome.runtime.lastError) {
          if (!isContextInvalidated(chrome.runtime.lastError)) {
            console.warn("[VocabMeld] Stats read failed:", chrome.runtime.lastError);
          }
          return resolve(null);
        }
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        if (current.lastResetDate !== today) {
          current.todayWords = 0;
          current.lastResetDate = today;
        }
        const updated = {
          totalWords: (current.totalWords || 0) + (stats.newWords || 0),
          todayWords: (current.todayWords || 0) + (stats.newWords || 0),
          lastResetDate: today,
          cacheHits: (current.cacheHits || 0) + (stats.cacheHits || 0),
          cacheMisses: (current.cacheMisses || 0) + (stats.cacheMisses || 0)
        };
        chrome.storage.sync.set(updated, () => {
          if (chrome.runtime.lastError) {
            if (!isContextInvalidated(chrome.runtime.lastError)) {
              console.warn("[VocabMeld] Stats write failed:", chrome.runtime.lastError);
            }
            return resolve(null);
          }
          resolve(updated);
        });
      });
    });
  }
  async function addToWhitelist(original, translation, difficulty) {
    const whitelist = config.learnedWords || [];
    const exists = whitelist.some((w) => w.original === original || w.word === translation);
    if (!exists) {
      whitelist.push({
        original,
        word: translation,
        addedAt: Date.now(),
        difficulty: difficulty || "B1"
      });
      config.learnedWords = whitelist;
      await new Promise((resolve) => chrome.storage.sync.set({ learnedWords: whitelist }, resolve));
    }
  }
  async function addToMemorizeList(word) {
    if (!word || !word.trim()) {
      console.warn("[VocabMeld] Invalid word for memorize list:", word);
      return;
    }
    const trimmedWord = word.trim();
    const list = config.memorizeList || [];
    const exists = list.some((w) => w.word === trimmedWord);
    if (!exists) {
      list.push({ word: trimmedWord, addedAt: Date.now() });
      config.memorizeList = list;
      await new Promise((resolve) => chrome.storage.sync.set({ memorizeList: list }, resolve));
      if (!config) {
        await loadConfig();
      }
      if (!config.enabled) {
        showToast(`"${trimmedWord}" \u5DF2\u6DFB\u52A0\u5230\u8BB0\u5FC6\u5217\u8868`);
        return;
      }
      try {
        const count = await processSpecificWords([trimmedWord]);
        if (count > 0) {
          showToast(`"${trimmedWord}" \u5DF2\u6DFB\u52A0\u5230\u8BB0\u5FC6\u5217\u8868\u5E76\u7FFB\u8BD1`);
        } else {
          try {
            await translateSpecificWords([trimmedWord]);
            showToast(`"${trimmedWord}" \u5DF2\u6DFB\u52A0\u5230\u8BB0\u5FC6\u5217\u8868`);
          } catch (error) {
            console.error("[VocabMeld] Error translating word:", trimmedWord, error);
            showToast(`"${trimmedWord}" \u5DF2\u6DFB\u52A0\u5230\u8BB0\u5FC6\u5217\u8868`);
          }
        }
      } catch (error) {
        console.error("[VocabMeld] Error processing word:", trimmedWord, error);
        showToast(`"${trimmedWord}" \u5DF2\u6DFB\u52A0\u5230\u8BB0\u5FC6\u5217\u8868`);
      }
    } else {
      showToast(`"${trimmedWord}" \u5DF2\u5728\u8BB0\u5FC6\u5217\u8868\u4E2D`);
    }
  }
  function getPageSegments(viewportOnly = false, margin = 300) {
    return contentSegmenter.getPageSegments(document.body, { viewportOnly, margin });
  }
  function getTextContent(element) {
    return contentSegmenter.getTextContent(element);
  }
  function getElementPath(element) {
    return contentSegmenter.getElementPath(element);
  }
  function generateFingerprint(text, path = "") {
    return contentSegmenter.generateFingerprint(text, path);
  }
  function applyReplacements(element, replacements) {
    return textReplacer.applyReplacements(element, replacements);
  }
  function restoreOriginal(element) {
    return textReplacer.restoreOriginal(element);
  }
  function restoreAll() {
    textReplacer.restoreAll();
    contentSegmenter.clearProcessed();
  }
  async function translateText(text) {
    if (wordCache.size === 0) {
      await loadWordCache();
    }
    return await apiService.translateText(text, config, wordCache, updateStats, saveWordCache);
  }
  async function translateSpecificWords(targetWords) {
    if (wordCache.size === 0) {
      await loadWordCache();
    }
    return await apiService.translateSpecificWords(targetWords, config, wordCache, updateStats, saveWordCache);
  }
  async function processSpecificWords(targetWords) {
    if (!config?.enabled || !targetWords?.length) {
      return 0;
    }
    const targetWordSet = new Set(targetWords.map((w) => w.toLowerCase()));
    let processed = 0;
    const alreadyTranslated = [];
    document.querySelectorAll(".vocabmeld-translated").forEach((el) => {
      const original = el.getAttribute("data-original");
      if (original && targetWordSet.has(original.toLowerCase())) {
        alreadyTranslated.push(original.toLowerCase());
      }
    });
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node2) => {
        const parent = node2.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        const classList = parent.className?.toString() || "";
        if (SKIP_CLASSES.some((cls) => classList.includes(cls) && cls !== "vocabmeld-translated")) {
          return NodeFilter.FILTER_REJECT;
        }
        try {
          const style = window.getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
        } catch (e) {
        }
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        const text = node2.textContent.trim();
        if (text.length === 0) return NodeFilter.FILTER_REJECT;
        if (isCodeText(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent;
      const words = text.match(/\b[a-zA-Z]{5,}\b/g) || [];
      const chineseWords = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
      const allWords = [...words, ...chineseWords];
      const containsTarget = allWords.some((word) => {
        const lowerWord = word.toLowerCase();
        return targetWordSet.has(lowerWord) && !alreadyTranslated.includes(lowerWord);
      });
      if (containsTarget) {
        textNodes.push(node);
      }
    }
    if (textNodes.length === 0) {
      return 0;
    }
    const segments = [];
    for (const textNode of textNodes) {
      const container = textNode.parentElement;
      if (!container) continue;
      const containerText = getTextContent(container);
      let contextText = containerText;
      if (contextText.length < 30) {
        const grandParent = container.parentElement;
        if (grandParent) {
          contextText = getTextContent(grandParent);
        }
      }
      if (contextText.length >= 10) {
        const path = getElementPath(container);
        const fingerprint = generateFingerprint(contextText, path);
        const isProcessed = container.hasAttribute("data-vocabmeld-processed") || container.closest("[data-vocabmeld-processed]");
        segments.push({
          element: container,
          text: contextText,
          fingerprint,
          isProcessed: !!isProcessed
        });
      }
    }
    const uniqueSegments = segments.filter(
      (segment, index, self) => index === self.findIndex((s) => s.fingerprint === segment.fingerprint)
    );
    const translations = await translateSpecificWords(targetWords);
    if (translations.length === 0) {
      return 0;
    }
    for (const segment of uniqueSegments) {
      const replacements = translations.map((translation) => {
        const position = segment.text.toLowerCase().indexOf(translation.original.toLowerCase());
        return {
          original: translation.original,
          translation: translation.translation,
          phonetic: translation.phonetic,
          difficulty: translation.difficulty,
          partOfSpeech: translation.partOfSpeech || "",
          shortDefinition: translation.shortDefinition || "",
          position: position >= 0 ? position : 0
        };
      }).filter((r) => r.position >= 0 || segment.text.toLowerCase().includes(r.original.toLowerCase()));
      if (replacements.length === 0) continue;
      const count = applyReplacements(segment.element, replacements);
      processed += count;
    }
    return processed;
  }
  async function processPage(viewportOnly = false) {
    if (isProcessing) return { processed: 0, skipped: true };
    if (!config?.enabled) return { processed: 0, disabled: true };
    const hostname = window.location.hostname;
    if (config.blacklist?.some((domain) => hostname.includes(domain))) {
      return { processed: 0, blacklisted: true };
    }
    if (wordCache.size === 0) {
      await loadWordCache();
    }
    isProcessing = true;
    let processed = 0, errors = 0;
    try {
      const memorizeWords = (config.memorizeList || []).map((w) => w.word).filter((w) => w && w.trim());
      if (memorizeWords.length > 0 && !viewportOnly) {
        try {
          const memorizeCount = await processSpecificWords(memorizeWords);
          processed += memorizeCount;
        } catch (e) {
          console.error("[VocabMeld] Error processing memorize list:", e);
          errors++;
        }
      }
      const segments = getPageSegments(viewportOnly);
      const whitelistWords = new Set((config.learnedWords || []).map((w) => w.original.toLowerCase()));
      const validSegments = [];
      for (const segment of segments) {
        let text = segment.text;
        for (const word of whitelistWords) {
          const regex = new RegExp(`\\b${word}\\b`, "gi");
          text = text.replace(regex, "");
        }
        if (text.trim().length >= 30) {
          validSegments.push({ ...segment, filteredText: text });
        }
      }
      const MAX_CONCURRENT = 3;
      async function processSegment(segment) {
        const el = segment.element;
        try {
          el.classList.add("vocabmeld-processing");
          const result = await translateText(segment.filteredText);
          let immediateCount = 0;
          if (result.immediate?.length) {
            const filtered = result.immediate.filter((r) => !whitelistWords.has(r.original.toLowerCase()));
            immediateCount = applyReplacements(el, filtered);
            contentSegmenter.markProcessed(segment.fingerprint);
          }
          if (result.async) {
            result.async.then(async (asyncReplacements) => {
              try {
                if (asyncReplacements?.length) {
                  const alreadyReplaced = /* @__PURE__ */ new Set();
                  el.querySelectorAll(".vocabmeld-translated").forEach((transEl) => {
                    const original = transEl.getAttribute("data-original");
                    if (original) {
                      alreadyReplaced.add(original.toLowerCase());
                    }
                  });
                  const filtered = asyncReplacements.filter(
                    (r) => !whitelistWords.has(r.original.toLowerCase()) && !alreadyReplaced.has(r.original.toLowerCase())
                  );
                  if (filtered.length > 0) {
                    applyReplacements(el, filtered);
                  }
                }
              } finally {
                el.classList.remove("vocabmeld-processing");
              }
            }).catch((error) => {
              console.error("[VocabMeld] Async translation error:", error);
              el.classList.remove("vocabmeld-processing");
            });
          } else {
            el.classList.remove("vocabmeld-processing");
          }
          return { count: immediateCount, error: false };
        } catch (e) {
          console.error("[VocabMeld] Segment error:", e);
          el.classList.remove("vocabmeld-processing");
          return { count: 0, error: true };
        }
      }
      for (let i = 0; i < validSegments.length; i += MAX_CONCURRENT) {
        const batch = validSegments.slice(i, i + MAX_CONCURRENT);
        const results = await Promise.all(batch.map(processSegment));
        for (const result of results) {
          processed += result.count;
          if (result.error) errors++;
        }
      }
      return { processed, errors };
    } finally {
      isProcessing = false;
    }
  }
  function setupEventListeners() {
    document.addEventListener("mouseover", (e) => {
      const target = e.target.closest(".vocabmeld-translated");
      if (target) {
        tooltipManager.show(target);
      }
      if (e.target.closest(".vocabmeld-tooltip")) {
        tooltipManager.cancelHide();
      }
    });
    document.addEventListener("mouseout", (e) => {
      const target = e.target.closest(".vocabmeld-translated");
      const relatedTarget = e.relatedTarget;
      if (target && !relatedTarget?.closest(".vocabmeld-translated") && !relatedTarget?.closest(".vocabmeld-tooltip")) {
        tooltipManager.hide();
      }
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest(".vocabmeld-tooltip") && !e.relatedTarget?.closest(".vocabmeld-tooltip") && !e.relatedTarget?.closest(".vocabmeld-translated")) {
        tooltipManager.hide();
      }
    });
    document.addEventListener("click", async (e) => {
      const actionBtn = e.target.closest(".vocabmeld-action-btn");
      const currentElement = tooltipManager.getCurrentElement();
      if (actionBtn && currentElement) {
        e.preventDefault();
        e.stopPropagation();
        const action = actionBtn.getAttribute("data-action");
        const original = currentElement.getAttribute("data-original");
        const translation = currentElement.getAttribute("data-translation");
        const difficulty = currentElement.getAttribute("data-difficulty") || "B1";
        switch (action) {
          case "speak":
            await tooltipManager.playAudio(currentElement);
            break;
          case "memorize":
            await addToMemorizeList(original);
            showToast(`"${original}" \u5DF2\u6DFB\u52A0\u5230\u8BB0\u5FC6\u5217\u8868`);
            break;
          case "learned":
            await addToWhitelist(original, translation, difficulty);
            restoreOriginal(currentElement);
            tooltipManager.hide(true);
            showToast(`"${original}" \u5DF2\u6807\u8BB0\u4E3A\u5DF2\u5B66\u4F1A`);
            break;
        }
      }
    });
    const handleScroll = debounce(() => {
      if (config?.autoProcess && config?.enabled) {
        processPage(true);
      }
    }, 500);
    window.addEventListener("scroll", handleScroll, { passive: true });
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync") {
        loadConfig().then(() => {
          if (changes.enabled?.newValue === false) {
            restoreAll();
          }
          if (changes.difficultyLevel || changes.intensity || changes.translationStyle) {
            restoreAll();
            if (config.enabled) {
              processPage();
            }
          }
          if (changes.memorizeList) {
            const oldList = changes.memorizeList.oldValue || [];
            const newList = changes.memorizeList.newValue || [];
            const oldWords = new Set(oldList.map((w) => w.word.toLowerCase()));
            const newWords = newList.filter((w) => !oldWords.has(w.word.toLowerCase())).map((w) => w.word);
            if (newWords.length > 0 && config.enabled) {
              setTimeout(() => {
                processSpecificWords(newWords);
              }, 200);
            }
          }
        });
      }
    });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "processPage") {
        processPage().then(sendResponse);
        return true;
      }
      if (message.action === "restorePage") {
        restoreAll();
        sendResponse({ success: true });
      }
      if (message.action === "processSpecificWords") {
        const words = message.words || [];
        if (words.length > 0) {
          processSpecificWords(words).then((count) => {
            sendResponse({ success: true, count });
          }).catch((error) => {
            console.error("[VocabMeld] Error processing specific words:", error);
            sendResponse({ success: false, error: error.message });
          });
          return true;
        } else {
          sendResponse({ success: false, error: "No words provided" });
        }
      }
      if (message.action === "getStatus") {
        sendResponse({
          processed: contentSegmenter.getProcessedCount(),
          isProcessing,
          enabled: config?.enabled
        });
      }
    });
  }
  function debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
  async function init() {
    await loadConfig();
    await loadWordCache();
    await initLanguageDetector();
    tooltipManager.createTooltip();
    setupEventListeners();
    if (config.autoProcess && config.enabled && config.apiKey) {
      setTimeout(() => processPage(), 1e3);
    }
    console.log("[VocabMeld] \u521D\u59CB\u5316\u5B8C\u6210 (\u6A21\u5757\u5316\u91CD\u6784\u7248)");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
//# sourceMappingURL=content.js.map
