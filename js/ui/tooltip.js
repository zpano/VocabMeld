/**
 * Sapling Tooltip 管理器
 * 提取自 content.js
 */

import { getDictionaryEntry, playDictionaryAudio } from './wiktionary.js';
import { playGoogleTranslateTts, playYoudaoDictVoice } from './pronunciation.js';
import { detectLanguage } from '../utils/language-detector.js';
import { isSingleEnglishWord } from '../utils/word-filters.js';

/**
 * Tooltip 管理类
 */
export class TooltipManager {
  constructor() {
    this.tooltip = null;
    this.currentTooltipElement = null;
    this.tooltipHideTimeout = null;
    this.config = null;
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 设置配置
   * @param {object} config - 配置对象
   */
  setConfig(config) {
    this.config = config;
  }

  /**
   * 创建 Tooltip 元素
   */
  createTooltip() {
    if (this.tooltip) return;

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'vocabmeld-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);
  }

  /**
   * 显示 Tooltip
   * @param {HTMLElement} element - 翻译元素
   */
  async show(element) {
    if (!this.tooltip || !element.classList?.contains('vocabmeld-translated')) return;

    // 取消待处理的隐藏操作
    if (this.tooltipHideTimeout) {
      clearTimeout(this.tooltipHideTimeout);
      this.tooltipHideTimeout = null;
    }

    this.currentTooltipElement = element;
    const original = element.getAttribute('data-original') || '';
    const translation = element.getAttribute('data-translation') || '';
    const aiPhonetic = element.getAttribute('data-phonetic') || '';
    const difficulty = element.getAttribute('data-difficulty') || '';
    const aiPartOfSpeech = element.getAttribute('data-part-of-speech') || '';
    const aiShortDefinition = element.getAttribute('data-short-definition') || '';
    const sourceLang = element.getAttribute('data-source-lang') || '';
    const aiExample = element.getAttribute('data-example') || '';

    // 获取学习语言
    const learningLanguage = this.config?.targetLanguage || 'en';

    // 判断学习语言的词汇在哪个字段
    // 优先使用 sourceLang；sourceLang 为空时用启发式/检测降级
    let isLearningFromOriginal;
    if (sourceLang) {
      isLearningFromOriginal = sourceLang === learningLanguage;
    } else if (learningLanguage === 'en') {
      if (isSingleEnglishWord(original)) isLearningFromOriginal = true;
      else if (isSingleEnglishWord(translation)) isLearningFromOriginal = false;
    }

    if (typeof isLearningFromOriginal !== 'boolean') {
      const originalLang = original ? await detectLanguage(original) : '';
      isLearningFromOriginal = originalLang === learningLanguage;
    }

    const learningWord = (isLearningFromOriginal ? original : translation) || '';
    const nativeTranslation = (isLearningFromOriginal ? translation : original) || '';

    // 字典查询：仅对学习语言为英语的单词做 Wiktionary 查询
    const hasDictionaryWord = learningLanguage === 'en' && isSingleEnglishWord(learningWord);
    const dictionaryWord = hasDictionaryWord ? learningWord.trim() : '';
    const dictionaryLang = hasDictionaryWord ? 'en' : '';

    // 先用 AI 数据渲染初始内容
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

    // 定位 tooltip
    const rect = element.getBoundingClientRect();
    this.tooltip.style.left = rect.left + window.scrollX + 'px';
    this.tooltip.style.top = rect.bottom + window.scrollY + 5 + 'px';
    this.tooltip.style.display = 'block';

    // 如果有字典词，异步获取 Wiktionary 数据并更新
    if (hasDictionaryWord) {
      const key = dictionaryWord.toLowerCase().trim();
      this.tooltip.dataset.dictWord = key;

      try {
        const entry = await getDictionaryEntry(dictionaryWord, dictionaryLang);

        // 检查是否仍然是同一个词
        if (this.tooltip.dataset.dictWord !== key) return;

        // 使用 Wiktionary 数据优先（英语学习时更可靠），AI 为备选
        const finalPhonetic = entry?.phoneticText || aiPhonetic;
        const finalPartOfSpeech = entry?.partOfSpeech || aiPartOfSpeech;

        let finalDefinition = entry?.shortDefinition || aiShortDefinition;
        if (finalDefinition) {
          finalDefinition = finalDefinition
            .replace(/\([^)]*[\/\[][^\]\/]*[\/\]][^)]*\)/g, '')
            .replace(/[\/\[][^\]\/]+[\/\]]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
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
        // Wiktionary 失败，保持 AI 数据
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

    const safePhoneticHtml = safePhonetic
      ? `<div class="vocabmeld-tooltip-phonetic">${safePhonetic}</div>`
      : '';

    const safePosHtml = safePartOfSpeech
      ? `<span class="vocabmeld-tooltip-pos">${safePartOfSpeech}</span>`
      : '';

    const safeDefinitionHtml = safeShortDefinition
      ? `<div class="vocabmeld-tooltip-definition">${safePosHtml}${safeShortDefinition}</div>`
      : '';

    let safeExamplesHtml = '';
    const examples = [];
    const safeWiktionaryExample = this.escapeHtml(wiktionaryExample);
    const safeAiExample = this.escapeHtml(aiExample);

    if (safeWiktionaryExample) {
      examples.push(`<div class="vocabmeld-tooltip-example">${safeWiktionaryExample}</div>`);
    }

    if (safeAiExample) {
      const alreadyMarked = /\(AI\)\s*$/.test(String(aiExample || ''));
      examples.push(`<div class="vocabmeld-tooltip-example">${safeAiExample}${alreadyMarked ? '' : ' (AI)'}</div>`);
    }

    if (isLoading) {
      safeExamplesHtml = `<div class="vocabmeld-tooltip-examples">${examples.join('')}<div class="vocabmeld-tooltip-dict-loading">Loading...</div></div>`;
    } else if (examples.length > 0) {
      safeExamplesHtml = `<div class="vocabmeld-tooltip-examples">${examples.join('')}</div>`;
    }

    this.tooltip.innerHTML = `
      <div class="vocabmeld-tooltip-header">
        <span class="vocabmeld-tooltip-word">${safeLearningWord}${safeNativeTranslation ? ` <span class="vocabmeld-tooltip-translation">(${safeNativeTranslation})</span>` : ''}</span>
        ${safeDifficulty ? `<span class="vocabmeld-tooltip-badge">${safeDifficulty}</span>` : ''}
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
          <span>发音</span>
        </button>
        <button class="vocabmeld-action-btn vocabmeld-btn-memorize" data-action="memorize" title="Add to memorize list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          <span>记忆</span>
        </button>
        <button class="vocabmeld-action-btn vocabmeld-btn-learned" data-action="learned" title="标记为已学会">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>已学会</span>
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
      if (this.tooltip) this.tooltip.style.display = 'none';
      this.currentTooltipElement = null;
    } else {
      // 延迟隐藏，给用户时间移动到 tooltip
      this.tooltipHideTimeout = setTimeout(() => {
        if (this.tooltip) this.tooltip.style.display = 'none';
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

    const original = element.getAttribute('data-original') || '';
    const translation = element.getAttribute('data-translation') || '';
    const sourceLang = element.getAttribute('data-source-lang') || '';

    // 获取学习语言
    const learningLanguage = this.config?.targetLanguage || 'en';

    let isLearningFromOriginal;
    if (sourceLang) {
      isLearningFromOriginal = sourceLang === learningLanguage;
    } else if (learningLanguage === 'en') {
      if (isSingleEnglishWord(original)) isLearningFromOriginal = true;
      else if (isSingleEnglishWord(translation)) isLearningFromOriginal = false;
    }

    if (typeof isLearningFromOriginal !== 'boolean') {
      const originalLang = original ? await detectLanguage(original) : '';
      isLearningFromOriginal = originalLang === learningLanguage;
    }

    const learningWord = (isLearningFromOriginal ? original : translation) || '';

    // 确定要播放的词和语言
    let word = learningWord;
    let lang = learningLanguage;

    if (!word) {
      // 降级处理
      word = translation || original;
      lang = await detectLanguage(word);
    }

    if (!word) return;

    const provider = this.config?.pronunciationProvider || 'wiktionary';

    if (provider === 'google') {
      try {
        await playGoogleTranslateTts(word, lang);
        return;
      } catch (e) {
        // 降级到字典或 TTS
      }
    }

    if (lang === 'en') {
      const youdaoType = this.config?.youdaoPronunciationType ?? 2;

      if (provider === 'youdao') {
        try {
          await playYoudaoDictVoice(word, youdaoType);
          return;
        } catch (e) {
          // 降级到 Wiktionary 或 TTS
        }
      }

      try {
        await playDictionaryAudio(word, lang);
        return;
      } catch (e) {
        // 降级到 TTS
      }
    }

    // 使用 Chrome TTS
    const ttsLang = lang === 'en' ? 'en-US' :
                    lang === 'zh-CN' ? 'zh-CN' :
                    lang === 'ja' ? 'ja-JP' :
                    lang === 'ko' ? 'ko-KR' : 'en-US';

    chrome.runtime.sendMessage({ action: 'speak', text: word, lang: ttsLang }).catch(() => {});
  }
}
