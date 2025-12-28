/**
 * Sapling 内容分段器模块
 * 智能分段页面内容，平衡处理批次大小和上下文相关性
 */

import { SKIP_TAGS, SKIP_CLASSES } from '../config/constants.js';
import { isCodeText } from '../utils/word-filters.js';
import { isInAllowedContentEditableRegion } from '../utils/dom-utils.js';

// 典型 UI/导航容器选择器，避免替换站点导航/菜单导致布局错乱
const UI_CONTAINER_SELECTOR = [
  'header',
  'nav',
  'aside',
  'footer',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="tablist"]',
  '[role="tab"]',
  '[role="toolbar"]',
  '[role="button"]',
  'button',
  'select',
  'option',
  '.nav',
  '.navbar',
  '.nav-bar',
  '.navigation',
  '.menu',
  '.menubar',
  '.tabs',
  '.tab',
  '.tabbar',
  '.dropdown',
  '.filter',
  '.breadcrumb',
  '.pagination'
].join(',');

// 具有特征类名的 UI 容器（包含匹配，兼容站点自定义类，如 channel-tabs/nav-tabs）
const UI_CLASS_SUBSTRINGS = ['nav', 'menu', 'tab', 'dropdown', 'filter', 'breadcrumb', 'pagination', 'toolbar', 'header'];

function isUiContainer(element) {
  if (!element?.closest) return false;
  try {
    if (element.closest(UI_CONTAINER_SELECTOR)) return true;
    // 导航列表项
    if (element.tagName === 'LI' && element.closest('nav,[role="navigation"],.nav,.navbar,.menu,.menubar,.tabs,.tabbar')) {
      return true;
    }
    const cls = element.className || '';
    if (typeof cls === 'string') {
      const lower = cls.toLowerCase();
      if (UI_CLASS_SUBSTRINGS.some(sub => lower.includes(sub))) return true;
    }
  } catch (e) {}
  return false;
}

/**
 * 内容分段器类
 */
class ContentSegmenter {
  constructor() {
    this.minSegmentLength = 50;   // 最小分段长度
    this.maxSegmentLength = 2000; // 最大分段长度
    this.processedFingerprints = new Set();  // 已完成处理
    this.pendingFingerprints = new Set();    // 正在处理中
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

    // 跳过典型 UI 区域（导航/菜单/工具栏等），避免替换导致站点布局错乱
    if (isUiContainer(element)) return true;

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
    if (element.isContentEditable && !isInAllowedContentEditableRegion(element)) {
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
    // 直接使用路径作为指纹，不依赖文本内容
    // 这样即使文本被替换后再获取，fingerprint 也保持不变
    // path 已包含元素路径和 chunk 索引（如 "BODY>DIV[2]>P[1]::chunk0"）
    if (path) {
      return path;
    }
    // 仅当 path 为空时使用文本哈希作为后备
    const content = text.slice(0, 100).trim();
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
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
    // 使用 Chrome DevTools 的 XPath 实现
    return this._xPath(element, false);
  }

  /**
   * 生成元素的 XPath（基于 Chrome DevTools 实现）
   * @param {Node} node
   * @param {boolean} optimized - 是否优化（遇到 id 时停止）
   * @returns {string}
   */
  _xPath(node, optimized = false) {
    if (node.nodeType === Node.DOCUMENT_NODE) {
      return '/';
    }

    const steps = [];
    let contextNode = node;
    while (contextNode) {
      const step = this._xPathValue(contextNode, optimized);
      if (!step) break;
      steps.push(step);
      if (step.optimized) break;
      contextNode = contextNode.parentNode;
    }

    steps.reverse();
    return (steps.length && steps[0].optimized ? '' : '/') + steps.map(s => s.value).join('/');
  }

  /**
   * 获取单个节点的 XPath 值
   */
  _xPathValue(node, optimized) {
    let ownValue;
    const ownIndex = this._xPathIndex(node);
    if (ownIndex === -1) return null;

    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        if (optimized && node.getAttribute('id')) {
          return { value: '//*[@id="' + node.getAttribute('id') + '"]', optimized: true };
        }
        ownValue = node.localName;
        break;
      case Node.DOCUMENT_NODE:
        ownValue = '';
        break;
      default:
        ownValue = '';
        break;
    }

    if (ownIndex > 0) {
      ownValue += '[' + ownIndex + ']';
    }

    return { value: ownValue, optimized: node.nodeType === Node.DOCUMENT_NODE };
  }

  /**
   * 获取节点在同类型兄弟中的索引
   */
  _xPathIndex(node) {
    const siblings = node.parentNode ? node.parentNode.children : null;
    if (!siblings) return 0;

    let hasSameNamedElements = false;
    for (let i = 0; i < siblings.length; ++i) {
      if (siblings[i] !== node &&
          siblings[i].nodeType === Node.ELEMENT_NODE &&
          node.nodeType === Node.ELEMENT_NODE &&
          siblings[i].localName === node.localName) {
        hasSameNamedElements = true;
        break;
      }
    }

    if (!hasSameNamedElements) return 0;

    let ownIndex = 1;
    for (let i = 0; i < siblings.length; ++i) {
      if (siblings[i].nodeType === Node.ELEMENT_NODE &&
          siblings[i].localName === node.localName) {
        if (siblings[i] === node) return ownIndex;
        ++ownIndex;
      }
    }
    return -1;
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
   * 检查指纹是否正在处理中
   * @param {string} fingerprint - 内容指纹
   * @returns {boolean}
   */
  isPending(fingerprint) {
    return this.pendingFingerprints.has(fingerprint);
  }

  /**
   * 检查指纹是否已处理或正在处理中
   * @param {string} fingerprint - 内容指纹
   * @returns {boolean}
   */
  isProcessedOrPending(fingerprint) {
    return this.processedFingerprints.has(fingerprint) || this.pendingFingerprints.has(fingerprint);
  }

  /**
   * 标记指纹为正在处理中
   * @param {string} fingerprint - 内容指纹
   */
  markPending(fingerprint) {
    this.pendingFingerprints.add(fingerprint);
  }

  /**
   * 取消正在处理中的标记
   * @param {string} fingerprint - 内容指纹
   */
  unmarkPending(fingerprint) {
    this.pendingFingerprints.delete(fingerprint);
  }

  /**
   * 标记指纹为已处理（同时移除 pending 状态）
   * @param {string} fingerprint - 内容指纹
   */
  markProcessed(fingerprint) {
    this.pendingFingerprints.delete(fingerprint);
    this.processedFingerprints.add(fingerprint);
  }

  /**
   * 清除已处理的指纹
   */
  clearProcessed() {
    this.processedFingerprints.clear();
    this.pendingFingerprints.clear();
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
    const CHUNK_OVERLAP = 200;

    const toChunks = (text) => {
      if (!text) return [];
      const normalized = String(text);
      if (normalized.length <= this.maxSegmentLength) {
        return [{ chunkIndex: 0, text: normalized }];
      }

      const chunks = [];
      const step = Math.max(1, this.maxSegmentLength - CHUNK_OVERLAP);
      for (let start = 0, idx = 0; start < normalized.length; start += step, idx++) {
        const chunk = normalized.slice(start, start + this.maxSegmentLength);
        if (!chunk.trim()) continue;
        chunks.push({ chunkIndex: idx, text: chunk });
      }
      return chunks;
    };
    
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

      const hasBlockElementChild = Array.from(container.children).some(child => {
        if (!child?.tagName) return false;
        if (child.tagName === 'BR') return false;
        return !inlineTextTags.has(child.tagName);
      });

      const directText = this.getDirectTextContent(container);

      // Mixed-content container: has block children but also meaningful direct text.
      // Split direct text into multiple small run elements so each run can be processed independently.
      if (hasBlockElementChild && directText.length > 10) {
        // 正常路径：包装直接文本为独立 run 元素（使用 display: contents 避免布局重算）
        const runElements = this.wrapDirectTextRuns(container);

        for (const runEl of runElements) {
          const runText = this.getTextContent(runEl);
          if (!runText || runText.length < this.minSegmentLength) continue;
          if (isCodeText(runText)) continue;

          const path = this.getElementPath(runEl);
          for (const chunk of toChunks(runText)) {
            const chunkPath = `${path}::chunk${chunk.chunkIndex}`;
            const fingerprint = this.generateFingerprint(chunk.text, chunkPath);
            if (this.isProcessed(fingerprint)) continue;

            segments.push({
              element: runEl,
              text: chunk.text,
              fingerprint,
              path: chunkPath,
              scope: 'all'
            });
          }
        }

        continue;
      }

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
      for (const chunk of toChunks(text)) {
        const chunkPath = `${path}::chunk${chunk.chunkIndex}`;
        const fingerprint = this.generateFingerprint(chunk.text, chunkPath);
        if (this.isProcessed(fingerprint)) continue;

        segments.push({
          element: container,
          text: chunk.text,
          fingerprint,
          path: chunkPath,
          scope: 'all'
        });
      }
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
   * 获取元素的“直接可见”文本（只收集直接文本节点 + 直接内联子元素的文本）
   * 主要用于处理 div 下裸露文本（例如 div/text()[n]），同时避免把整个容器子树当作一个段落。
   * @param {Element} element - DOM 元素
   * @returns {string}
   */
  getDirectTextContent(element) {
    if (!element) return '';

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

    const texts = [];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.trim();
        if (!t || isCodeText(t)) continue;
        texts.push(child.textContent);
        continue;
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child;
        if (!inlineTextTags.has(childEl.tagName)) continue;
        if (this.shouldSkipNode(childEl)) continue;

        // 如果是已替换的元素，使用原始文本
        if (childEl.classList?.contains('Sapling-translated')) {
          const original = childEl.getAttribute('data-original');
          if (original) {
            texts.push(original);
          }
          continue;
        }

        const t = childEl.textContent.trim();
        if (!t || isCodeText(t)) continue;
        texts.push(childEl.textContent);
      }
    }

    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * 将容器的“直接文本段”（由直接文本节点/直接内联元素组成，并被块级子元素隔开）
   * 包装成多个内部 <span>，并返回这些 span。
   * 适用于“块级元素之间夹杂裸文本/BR”的结构（不依赖站点/编辑器特定标记）。
   * @param {Element} element
   * @returns {Element[]}
   */
  wrapDirectTextRuns(element) {
    const results = [];
    if (!element) return results;

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

    const flush = (nodes) => {
      if (!nodes.length) return;

      const combined = nodes
        .map(n => n.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (combined.length <= 10) return;

      const span = document.createElement('span');
      span.setAttribute('data-Sapling-text-run', 'true');
      span.style.display = 'contents';  // 不创建盒子，避免触发布局重算

      element.insertBefore(span, nodes[0]);
      for (const n of nodes) {
        span.appendChild(n);
      }
      results.push(span);
    };

    let runNodes = [];

    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.trim();
        if (!t || isCodeText(t)) {
          continue;
        }
        runNodes.push(child);
        continue;
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child;

        // 已经包装过的 run：作为分隔点，避免嵌套
        if (childEl.hasAttribute?.('data-Sapling-text-run') || childEl.hasAttribute?.('data-Sapling-direct-run')) {
          flush(runNodes);
          runNodes = [];
          continue;
        }

        // <br> 视作 run 内部元素（保留换行）
        if (childEl.tagName === 'BR') {
          runNodes.push(childEl);
          continue;
        }

        // 直接内联元素：作为 run 的一部分
        if (inlineTextTags.has(childEl.tagName) && !this.shouldSkipNode(childEl)) {
          if (!childEl.closest?.('.Sapling-translated')) {
            const t = childEl.textContent.trim();
            if (t && !isCodeText(t)) {
              runNodes.push(childEl);
              continue;
            }
          }
        }

        // 其它元素（块级 / 非内联）作为分隔点
        flush(runNodes);
        runNodes = [];
      }
    }

    flush(runNodes);
    return results;
  }

  /**
   * 获取元素的纯文本内容（排除子元素中的代码等）
   * @param {Element} element - DOM 元素
   * @returns {string}
   */
  getTextContent(element) {
    // 克隆元素，将已替换的词汇恢复为原始文本
    // 这样可以保持 fingerprint 一致，避免重复处理
    const clone = element.cloneNode(true);
    clone.querySelectorAll('.Sapling-translated').forEach(el => {
      const original = el.getAttribute('data-original');
      if (original) {
        // 用原始文本替换整个 span
        el.replaceWith(document.createTextNode(original));
      }
    });

    const texts = [];

    const walker = document.createTreeWalker(
      clone,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

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
