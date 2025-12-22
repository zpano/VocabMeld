/**
 * Sapling 单词过滤工具
 * 提取自 content.js
 */

import { CEFR_LEVELS } from '../config/constants.js';

/**
 * 规范化 CEFR 等级字符串为标准形式（A1/A2/B1/B2/C1/C2）
 * 允许输入带额外字符，例如 "B2+", "Level: B1", "b1" 等
 * @param {string} level
 * @returns {string|null}
 */
export function normalizeCefrLevel(level) {
  if (!level) return null;
  const upper = String(level).trim().toUpperCase();
  const match = upper.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  return match ? match[1] : null;
}

/**
 * 检查单词难度是否兼容用户设置
 * @param {string} wordDifficulty - 单词难度 (A1-C2)
 * @param {string} userDifficulty - 用户难度设置 (A1-C2)
 * @returns {boolean} 是否兼容（单词难度 >= 用户难度）
 */
export function isDifficultyCompatible(wordDifficulty, userDifficulty) {
  const normalizedWord = normalizeCefrLevel(wordDifficulty);
  const normalizedUser = normalizeCefrLevel(userDifficulty);

  // 边界处理：用户等级无效时默认使用 B1（索引 2）
  const safeUser = normalizedUser || 'B1';
  const userIdx = CEFR_LEVELS.indexOf(safeUser);

  // 单词等级无效时：保守处理为不兼容（避免把低级词当成 B1 放行）
  if (!normalizedWord) return false;
  const wordIdx = CEFR_LEVELS.indexOf(normalizedWord);
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
