/**
 * Sapling Tooltip 管理器
 * 提取自 content.js
 */

import { getDictionaryEntry, playDictionaryAudio } from './wiktionary.js';
import { playGoogleTranslateTts, playYoudaoDictVoice } from './pronunciation.js';
import { detectLanguage } from '../utils/language-detector.js';
import { isSingleEnglishWord } from '../utils/word-filters.js';
import { normalizePhonetic } from '../utils/phonetic-utils.js';

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

  /**
   * 将 tooltip 定位到屏幕内（避免溢出/被遮挡）
   * Tooltip 采用 fixed 定位，坐标基于 viewport
   * @param {DOMRect} targetRect
   */
  positionTooltip(targetRect) {
    if (!this.tooltip || !targetRect) return;

    const margin = 8;
    const gap = 8;

    // 先把 tooltip 放到屏幕外，确保测量到正确尺寸
    this.tooltip.style.left = '-9999px';
    this.tooltip.style.top = '-9999px';
    this.tooltip.style.display = 'block';

    const tooltipRect = this.tooltip.getBoundingClientRect();
    const width = tooltipRect.width || 0;
    const height = tooltipRect.height || 0;

    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;

    // 默认在目标元素下方；若下方放不下则翻到上方
    let top = targetRect.bottom + gap;
    if (top + height + margin > vh) {
      top = targetRect.top - height - gap;
    }
    top = Math.min(vh - height - margin, Math.max(margin, top));

    // 默认左对齐；左右都做 clamp
    let left = targetRect.left;
    left = Math.min(vw - width - margin, Math.max(margin, left));

    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
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
    this.tooltip.className = 'Sapling-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);
  }

  /**
   * 显示 Tooltip
   * @param {HTMLElement} element - 翻译元素
   */
  async show(element) {
    if (!this.tooltip || !element.classList?.contains('Sapling-translated')) return;

    // 取消待处理的隐藏操作
    if (this.tooltipHideTimeout) {
      clearTimeout(this.tooltipHideTimeout);
      this.tooltipHideTimeout = null;
    }

    this.currentTooltipElement = element;
    const original = element.getAttribute('data-original') || '';
    const translation = element.getAttribute('data-translation') || '';
    const aiPhoneticRaw = element.getAttribute('data-phonetic') || '';
    const aiPhonetic = normalizePhonetic(aiPhoneticRaw);
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

    // 定位 tooltip（fixed，避免溢出）
    this.positionTooltip(element.getBoundingClientRect());

    // 如果有字典词，异步获取 Wiktionary 数据并更新
    if (hasDictionaryWord) {
      const key = dictionaryWord.toLowerCase().trim();
      this.tooltip.dataset.dictWord = key;

      try {
        const entry = await getDictionaryEntry(dictionaryWord, dictionaryLang);

        // 检查是否仍然是同一个词
        if (this.tooltip.dataset.dictWord !== key) return;

        // 使用 Wiktionary 数据优先（英语学习时更可靠），AI 为备选
        const finalPhonetic = normalizePhonetic(entry?.phoneticText || aiPhoneticRaw);
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
        if (this.currentTooltipElement === element) {
          this.positionTooltip(element.getBoundingClientRect());
        }
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
          if (this.currentTooltipElement === element) {
            this.positionTooltip(element.getBoundingClientRect());
          }
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
    const normalizedPhonetic = normalizePhonetic(phonetic);
    const safePhonetic = this.escapeHtml(normalizedPhonetic);
    const safeOriginalWord = this.escapeHtml(originalWord);
    const safePartOfSpeech = this.escapeHtml(partOfSpeech);
    const safeShortDefinition = this.escapeHtml(shortDefinition);
    const safeDifficulty = this.escapeHtml(difficulty);

    const speakIconButtonHtml = `
      <button class="Sapling-phonetic-speak-btn" data-action="speak" title="发音" aria-label="发音">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
        </svg>
      </button>
    `;

    const safePhoneticHtml = safePhonetic
      ? `<div class="Sapling-tooltip-phonetic-row"><div class="Sapling-tooltip-phonetic">${safePhonetic}</div>${speakIconButtonHtml}</div>`
      : `<div class="Sapling-tooltip-phonetic-row Sapling-tooltip-phonetic-row--empty">${speakIconButtonHtml}</div>`;

    const safePosHtml = safePartOfSpeech
      ? `<span class="Sapling-tooltip-pos">${safePartOfSpeech}</span>`
      : '';

    const safeDefinitionHtml = safeShortDefinition
      ? `<div class="Sapling-tooltip-definition">${safePosHtml}${safeShortDefinition}</div>`
      : '';

    let safeExamplesHtml = '';
    const examples = [];
    const safeWiktionaryExample = this.escapeHtml(wiktionaryExample);
    const safeAiExample = this.escapeHtml(aiExample);

    if (safeWiktionaryExample) {
      examples.push(`<div class="Sapling-tooltip-example">${safeWiktionaryExample}</div>`);
    }

    if (safeAiExample) {
      const alreadyMarked = /\(AI\)\s*$/.test(String(aiExample || ''));
      examples.push(`<div class="Sapling-tooltip-example">${safeAiExample}${alreadyMarked ? '' : ' (AI)'}</div>`);
    }

    if (isLoading) {
      safeExamplesHtml = `<div class="Sapling-tooltip-examples">${examples.join('')}<div class="Sapling-tooltip-dict-loading">Loading...</div></div>`;
    } else if (examples.length > 0) {
      safeExamplesHtml = `<div class="Sapling-tooltip-examples">${examples.join('')}</div>`;
    }

    this.tooltip.innerHTML = `
      <div class="Sapling-tooltip-header">
        <span class="Sapling-tooltip-word">${safeLearningWord}${safeNativeTranslation ? ` <span class="Sapling-tooltip-translation">(${safeNativeTranslation})</span>` : ''}</span>
        ${safeDifficulty ? `<span class="Sapling-tooltip-badge">${safeDifficulty}</span>` : ''}
      </div>
      ${safePhoneticHtml}
      <div class="Sapling-tooltip-original">Original: ${safeOriginalWord}</div>
      ${safeDefinitionHtml}
      ${safeExamplesHtml}
      <div class="Sapling-tooltip-actions">
        <button class="Sapling-action-btn Sapling-btn-memorize" data-action="memorize" title="Add to memorize list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14"></path>
          </svg>
          <span>记忆</span>
        </button>
        <button class="Sapling-action-btn Sapling-btn-learned" data-action="learned" title="标记为已学会">
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
      }, 150);
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
        // Wiktionary 失败，降级到 Google Translate TTS
      }
    }

    // 非英语或上述方案都失败，尝试 Google Translate TTS
    try {
      await playGoogleTranslateTts(word, lang);
    } catch (e) {
      // 所有方案都失败，静默忽略
    }
  }
}
