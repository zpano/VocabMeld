/**
 * VocabMeld 内容分段器模块
 * 智能分段页面内容，平衡处理批次大小和上下文相关性
 */

import { SKIP_TAGS, SKIP_CLASSES } from '../config/constants.js';
import { isCodeText } from '../utils/word-filters.js';

/**
 * 内容分段器类
 */
class ContentSegmenter {
  constructor() {
    this.minSegmentLength = 50;   // 最小分段长度
    this.maxSegmentLength = 2000; // 最大分段长度
    this.processedFingerprints = new Set();
  }

  /**
   * 检查节点是否应该跳过
   * @param {Node} node - DOM 节点
   * @returns {boolean}
   */
  shouldSkipNode(node) {
    if (!node) return true;

    // 跳过非元素节点（除了文本节点）
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
      return true;
    }

    // 文本节点检查父元素
    if (node.nodeType === Node.TEXT_NODE) {
      return this.shouldSkipNode(node.parentElement);
    }

    const element = node;

    // 跳过特定标签
    if (SKIP_TAGS.includes(element.tagName)) {
      return true;
    }

    // 跳过特定类名
    const classList = element.classList;
    if (classList && SKIP_CLASSES.some(cls => classList.contains(cls))) {
      return true;
    }

    // 跳过隐藏元素
    try {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }
    } catch (e) {}

    // 跳过可编辑元素
    if (element.isContentEditable) {
      return true;
    }

    // 跳过已处理的元素
    if (element.hasAttribute('data-vocabmeld-processed')) {
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
  generateFingerprint(text, path = '') {
    // 取前100字符作为指纹基础
    const content = text.slice(0, 100).trim();
    let hash = 0;
    const str = content + path;
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
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
        const classes = current.className.toString().split(' ').slice(0, 2).join('.');
        if (classes) selector += `.${classes}`;
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    
    return parts.join('>');
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
    
    // 如果只处理视口内容，获取视口范围
    let viewportTop = 0;
    let viewportBottom = Infinity;
    
    if (viewportOnly) {
      viewportTop = window.scrollY - margin;
      viewportBottom = window.scrollY + window.innerHeight + margin;
    }

    // 获取所有潜在的文本容器
    const containers = this.findTextContainers(root);

    for (const container of containers) {
      // 视口检查
      if (viewportOnly) {
        const rect = container.getBoundingClientRect();
        const elementTop = rect.top + window.scrollY;
        const elementBottom = rect.bottom + window.scrollY;
        
        if (elementBottom < viewportTop || elementTop > viewportBottom) {
          continue;
        }
      }

      // 获取文本内容
      const text = this.getTextContent(container);
      
      if (!text || text.length < this.minSegmentLength) {
        continue;
      }

      // 检查是否为代码
      if (isCodeText(text)) {
        continue;
      }

      // 生成指纹并检查是否已处理
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
    const blockTags = ['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'BLOCKQUOTE'];
    const inlineTextTags = new Set([
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
    
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (this.shouldSkipNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          if (blockTags.includes(node.tagName)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      // 检查是否有“直接可见”的文本内容：
      // - 直接文本节点
      // - 或者直接子节点是内联元素（如 <a><strong>），其文本在子树里
      let directTextLength = 0;
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          directTextLength += child.textContent.trim().length;
          if (directTextLength > 10) break;
          continue;
        }

        if (child.nodeType === Node.ELEMENT_NODE) {
          const childEl = child;
          if (!inlineTextTags.has(childEl.tagName)) continue;
          if (this.shouldSkipNode(childEl)) continue;

          const t = childEl.textContent.trim();
          if (t.length === 0 || isCodeText(t)) continue;

          directTextLength += t.length;
          if (directTextLength > 10) break;
        }
      }
      const hasDirectText = directTextLength > 10;
      
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
        acceptNode: (node) => {
          if (this.shouldSkipNode(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent.trim();
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

    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * 获取视口内的分段
   * @param {number} margin - 视口边缘外的处理范围
   * @returns {Array}
   */
  getViewportSegments(margin = 300) {
    return this.getPageSegments(document.body, { viewportOnly: true, margin });
  }
}

// 导出单例
export const contentSegmenter = new ContentSegmenter();
export default contentSegmenter;
