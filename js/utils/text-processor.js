/**
 * VocabMeld 文本处理工具
 * 提取自 content.js
 */

import { STOP_WORDS } from '../config/constants.js';

/**
 * 对文本进行分词
 * @param {string} text - 要分词的文本
 * @param {string} lang - 语言类型 (Chinese/English/Japanese/Korean)
 * @returns {Array<string>} 分词结果
 */
export function segmentText(text, lang) {
  if (!text || typeof text !== 'string') return [];

  const normalizedLang = (lang || '').toString();
  const isChineseLang = normalizedLang === 'Chinese' || normalizedLang.startsWith('zh');
  const isEnglishLang = normalizedLang === 'English' || normalizedLang === 'en';
  const isJapaneseLang = normalizedLang === 'Japanese' || normalizedLang === 'ja';
  const isKoreanLang = normalizedLang === 'Korean' || normalizedLang === 'ko';

  // 中文分词
  if (isChineseLang) {
    try {
      // segmentit 在浏览器环境下会暴露为 window.Segmentit（或旧的 window.Segment）。
      const segmentit = window.Segmentit || window.Segment;
      if (!segmentit) {
        throw new Error('segmentit not loaded');
      }

      const SegmentConstructor =
        (typeof segmentit === 'function' && segmentit) ||
        (typeof segmentit.Segment === 'function' && segmentit.Segment) ||
        (typeof segmentit.default === 'function' && segmentit.default);

      if (!SegmentConstructor) {
        throw new TypeError('segmentit Segment constructor not found');
      }

      const segment = new SegmentConstructor();
      if (typeof segment.useDefault === 'function') {
        segment.useDefault();
      } else if (typeof segmentit.useDefault === 'function') {
        segmentit.useDefault(segment);
      }

      const words = segment.doSegment(text, {
        simple: true,
        stripPunctuation: true
      });

      // 过滤掉空字符串和纯标点符号
      return words.filter(w => w && w.trim().length > 0 && /[\u4e00-\u9fff]/.test(w));
    } catch (error) {
      console.error('中文分词失败，使用降级方案:', error);
      // 降级方案：简单的字符切分
      return text.match(/[\u4e00-\u9fff]+/g) || [];
    }
  }

  // 英文分词：按空格分词，去除所有标点符号
  if (isEnglishLang) {
    return text
      .replace(/[^\w\s]/g, ' ') // 移除所有标点符号
      .split(/\s+/) // 按空格分词
      .filter(w => w && w.length > 0 && /[a-zA-Z]/.test(w)); // 过滤空词和纯数字
  }

  // 日文和韩文暂时使用简单分词
  if (isJapaneseLang) {
    return text.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+/g) || [];
  }

  if (isKoreanLang) {
    return text.match(/[\uac00-\ud7af]+/g) || [];
  }

  // 默认按空格分词
  return text.split(/\s+/).filter(w => w && w.trim().length > 0);
}

/**
 * 重建文本，只保留指定的词汇（用于发送给 AI）
 * @param {string} text - 原始文本
 * @param {string[]} targetWords - 要保留的词汇
 * @returns {string} 过滤后的文本
 */
export function reconstructTextWithWords(text, targetWords) {
  const targetWordSet = new Set(targetWords.map(w => w.toLowerCase()));
  const lowerText = text.toLowerCase();
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

  const relevantSentences = sentences.filter(sentence => {
    const lowerSentence = sentence.toLowerCase();
    // 检查英文单词
    const words = sentence.match(/\b[a-zA-Z]{5,}\b/g) || [];
    const hasEnglishMatch = words.some(word => targetWordSet.has(word.toLowerCase()));

    // 检查中文短语（直接检查是否包含目标词汇）
    const hasChineseMatch = Array.from(targetWordSet).some(word => {
      // 只检查中文词汇
      if (/[\u4e00-\u9fff]/.test(word)) {
        return lowerSentence.includes(word);
      }
      return false;
    });

    return hasEnglishMatch || hasChineseMatch;
  });

  return relevantSentences.join('. ').trim() + (relevantSentences.length > 0 ? '.' : '');
}

/**
 * 过滤停用词和过短的词
 * @param {Array<string>} words - 词汇数组
 * @returns {Array<string>} 过滤后的词汇
 */
export function filterWords(words) {
  return words.filter(word => {
    const lower = word.toLowerCase();
    // 英文：过滤停用词和短词（<5字符）
    if (/^[a-zA-Z]+$/.test(word)) {
      return !STOP_WORDS.has(lower) && word.length >= 5;
    }
    // 中文：过滤单字（只保留2字以上）
    if (/[\u4e00-\u9fff]/.test(word)) {
      return word.length >= 2;
    }
    // 其他语言：保留
    return true;
  });
}
