/**
 * Sapling 文本替换器模块
 * 使用 Range API 精确替换文本节点
 */

import { SKIP_TAGS, SKIP_CLASSES } from '../config/constants.js';
import { isInAllowedContentEditableRegion } from '../utils/dom-utils.js';
import { normalizePhonetic } from '../utils/phonetic-utils.js';

/**
 * 文本替换器类
 */
class TextReplacer {
  constructor() {
    this.config = null;
  }

  static INLINE_TEXT_TAGS = new Set([
    'A',
    'ABBR',
    'B',
    'BDI',
    'BDO',
    'CITE',
    'DEL',
    'DFN',
    'EM',
    'I',
    'INS',
    'KBD',
    'MARK',
    'Q',
    'S',
    'SAMP',
    'SMALL',
    'SPAN',
    'STRONG',
    'SUB',
    'SUP',
    'TIME',
    'U',
    'VAR'
  ]);

  /**
   * 设置配置
   * @param {object} config - 配置对象
   */
  setConfig(config) {
    this.config = config;
  }

  /**
   * 获取元素内的所有文本节点（带过滤）
   * @param {Element} element - DOM 元素
   * @returns {Text[]}
   */
  getTextNodes(element) {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // 跳过已替换的内容（包含其内部 original/translation spans）
        if (parent.closest?.('.Sapling-translated')) {
          return NodeFilter.FILTER_REJECT;
        }

        if (SKIP_TAGS.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

        const classList = parent.classList;
        if (classList && SKIP_CLASSES.some(cls => cls !== 'Sapling-translated' && classList.contains(cls))) {
          return NodeFilter.FILTER_REJECT;
        }

        try {
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        } catch (e) {}

        if (parent.isContentEditable && !isInAllowedContentEditableRegion(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = node.textContent.trim();
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
   * 获取元素“直接可见”范围内的文本节点（直接文本节点 + 直接内联子元素内的文本节点）
   * 用于处理 div 下裸露文本（div/text()[n]），避免把整个容器子树都作为替换范围。
   * @param {Element} element - DOM 元素
   * @returns {Text[]}
   */
  getDirectTextNodes(element) {
    const nodes = [];
    if (!element) return nodes;

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.trim();
        if (!t) continue;
        nodes.push(child);
        continue;
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child;
        if (!TextReplacer.INLINE_TEXT_TAGS.has(childEl.tagName)) continue;
        if (childEl.closest?.('.Sapling-translated')) continue;
        nodes.push(...this.getTextNodes(childEl));
      }
    }

    return nodes;
  }

  getScopedTextNodes(element, scope = 'all') {
    if (scope === 'direct') return this.getDirectTextNodes(element);
    return this.getTextNodes(element);
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
  createReplacementElement(original, translation, phonetic, difficulty, partOfSpeech = '', shortDefinition = '', sourceLang = '', example = '') {
    const wrapper = document.createElement('span');
    wrapper.className = 'Sapling-translated';
    wrapper.setAttribute('data-original', original);
    wrapper.setAttribute('data-translation', translation);
    const normalizedPhonetic = normalizePhonetic(phonetic);
    wrapper.setAttribute('data-phonetic', normalizedPhonetic);
    wrapper.setAttribute('data-difficulty', difficulty || 'B1');
    wrapper.setAttribute('data-part-of-speech', partOfSpeech || '');
    wrapper.setAttribute('data-short-definition', shortDefinition || '');
    wrapper.setAttribute('data-source-lang', sourceLang || '');
    wrapper.setAttribute('data-example', example || '');

    const style = this.config?.translationStyle || 'original-translation';
    wrapper.setAttribute('data-style', style);
    let innerHTML = '';

    switch (style) {
      case 'translation-only':
        innerHTML = `<span class="Sapling-word">${translation}</span>`;
        break;
      case 'original-translation':
        innerHTML = `<span class="Sapling-original">${original}</span><span class="Sapling-word">(${translation})</span>`;
        break;
      case 'translation-original':
      default:
        innerHTML = `<span class="Sapling-word">${translation}</span><span class="Sapling-original">(${original})</span>`;
        break;
    }

    wrapper.innerHTML = innerHTML;
    return wrapper;
  }

  /**
   * 在元素中查找并替换词汇
   * @param {Element} element - DOM 元素
   * @param {Array} replacements - 替换项 [{ original, translation, phonetic, difficulty, partOfSpeech, shortDefinition, position, sourceLang, example }]
   * @param {object} options - 选项 { scope: 'all' | 'direct' }
   * @returns {number} - 替换数量
   */
  applyReplacements(element, replacements, options = {}) {
    if (!element || !replacements?.length) return 0;

    let count = 0;
    const scope = options.scope || 'all';

    // 按位置排序替换项（从后往前替换，避免位置偏移）
    const sortedReplacements = [...replacements].sort((a, b) => (b.position || 0) - (a.position || 0));

    for (const replacement of sortedReplacements) {
      const { original, translation, phonetic, difficulty, partOfSpeech = '', shortDefinition = '', sourceLang = '', example = '' } = replacement;

      // 跳过原词和翻译相同的情况（英文）
      const isEnglishLike = /^[a-zA-Z]+$/.test(original);
      if (isEnglishLike && original.toLowerCase() === translation.toLowerCase()) {
        continue;
      }

      const lowerOriginal = original.toLowerCase();

      // 每次都重新获取文本节点（因为 DOM 可能已更改）
      const textNodes = this.getScopedTextNodes(element, scope);

      for (let i = 0; i < textNodes.length; i++) {
        const textNode = textNodes[i];

        if (!textNode.parentElement || !element.contains(textNode)) {
          continue;
        }

        const text = textNode.textContent;
        const lowerText = text.toLowerCase();

        if (!lowerText.includes(lowerOriginal)) continue;

        // 使用词边界正则匹配
        const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[^\\w\\u4e00-\\u9fff])${escapedOriginal}([^\\w\\u4e00-\\u9fff]|$)`, 'i');

        let match = regex.exec(text);
        let startIndex = match ? match.index + match[1].length : text.toLowerCase().indexOf(lowerOriginal);

        if (startIndex === -1) continue;

        try {
          const range = document.createRange();
          range.setStart(textNode, startIndex);
          range.setEnd(textNode, startIndex + original.length);

          // 验证范围内容
          const rangeContent = range.toString();
          if (rangeContent.toLowerCase() !== lowerOriginal) continue;

          // 检查是否已被替换
          let parent = textNode.parentElement;
          let isAlreadyReplaced = false;
          while (parent && parent !== element) {
            if (parent.classList?.contains('Sapling-translated')) {
              isAlreadyReplaced = true;
              break;
            }
            parent = parent.parentElement;
          }

          if (isAlreadyReplaced) continue;

          // 创建并插入替换元素
          const wrapper = this.createReplacementElement(original, translation, phonetic, difficulty, partOfSpeech, shortDefinition, sourceLang, example);
          range.deleteContents();
          range.insertNode(wrapper);
          count++;

          break; // 每个替换项只替换一次
        } catch (e) {
          console.error('[Sapling] Replacement error:', e, original);
        }
      }
    }

    return count;
  }

  /**
   * 恢复替换的词汇为原文
   * @param {Element} element - 替换元素
   */
  restoreOriginal(element) {
    if (!element.classList?.contains('Sapling-translated')) return;
    const original = element.getAttribute('data-original');
    const textNode = document.createTextNode(original);
    element.parentNode.replaceChild(textNode, element);
  }

  /**
   * 恢复页面上所有替换的词汇
   * @param {Element} root - 根元素
   */
  restoreAll(root = document.body) {
    root.querySelectorAll('.Sapling-translated').forEach(el => this.restoreOriginal(el));
    root.querySelectorAll('[data-Sapling-processed]').forEach(el => el.removeAttribute('data-Sapling-processed'));

    // Unwrap internal text-run wrappers created for mixed-content containers.
    root.querySelectorAll('[data-Sapling-text-run],[data-Sapling-direct-run]').forEach(el => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }
}

// 导出单例
export const textReplacer = new TextReplacer();
export default textReplacer;
