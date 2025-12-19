/**
 * Sapling 单词过滤工具
 * 提取自 content.js
 */

import { CEFR_LEVELS } from '../config/constants.js';

/**
 * 检查单词难度是否兼容用户设置
 * @param {string} wordDifficulty - 单词难度 (A1-C2)
 * @param {string} userDifficulty - 用户难度设置 (A1-C2)
 * @returns {boolean} 是否兼容（单词难度 >= 用户难度）
 */
export function isDifficultyCompatible(wordDifficulty, userDifficulty) {
  const wordIdx = CEFR_LEVELS.indexOf(wordDifficulty);
  const userIdx = CEFR_LEVELS.indexOf(userDifficulty);
  return wordIdx >= userIdx;
}

/**
 * 判断是否为单个英文单词
 * @param {string} text - 文本
 * @returns {boolean}
 */
export function isSingleEnglishWord(text) {
  if (!text) return false;
  const trimmed = text.trim();
  return /^[a-zA-Z]+$/.test(trimmed);
}

/**
 * 判断是否可能是专有名词
 * @param {string} word - 单词
 * @returns {boolean}
 */
export function isLikelyProperNoun(word) {
  if (!word) return false;
  const trimmed = word.trim();
  if (!/^[A-Za-z][A-Za-z''-]*$/.test(trimmed)) return false;
  if (trimmed === trimmed.toUpperCase()) return true; // 缩写词 / 全大写
  if (trimmed === trimmed.toLowerCase()) return false;
  return /^[A-Z]/.test(trimmed);
}

/**
 * 判断是否为非学习词汇（URL、数字、专有名词等）
 * @param {string} word - 单词
 * @returns {boolean}
 */
export function isNonLearningWord(word) {
  if (!word) return true;
  const trimmed = word.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (/https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) return true;
  if (/[0-9]/.test(trimmed)) return true;
  if (/[#@]/.test(trimmed)) return true;
  if (/[\\/]/.test(trimmed)) return true;
  if (isLikelyProperNoun(trimmed)) return true;
  // 禁止明显的域名形式（例如 example.com）
  if (/\.[a-z]{2,}$/.test(lower)) return true;
  return false;
}

/**
 * 判断是否为代码文本
 * @param {string} text - 文本
 * @returns {boolean}
 */
export function isCodeText(text) {
  const codePatterns = [
    /^(const|let|var|function|class|import|export|return|if|else|for|while)\s/,
    /[{}();]\s*$/,
    /^\s*(\/\/|\/\*|\*|#)/,
    /\w+\.\w+\(/,
    /console\./,
    /https?:\/\//
  ];
  return codePatterns.some(pattern => pattern.test(text.trim()));
}
