/**
 * Sapling 语言检测工具
 * 提取自 content.js
 */

let languageDetector = null;

/**
 * 初始化 Native LanguageDetector（如果可用）
 */
export async function initLanguageDetector() {
  try {
    // 检查浏览器是否支持 LanguageDetector API
    if (typeof LanguageDetector !== 'undefined' && LanguageDetector.create) {
      languageDetector = await LanguageDetector.create({
        expectedInputLanguages: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es']
      });
      console.log('[Sapling] Native LanguageDetector initialized');
    }
  } catch (error) {
    console.warn('[Sapling] LanguageDetector not available, using fallback:', error);
    languageDetector = null;
  }
}

/**
 * 检测文本语言（优先使用 Native API，降级到正则匹配）
 * @param {string} text - 要检测的文本
 * @returns {Promise<string>|string} 语言代码 (e.g., 'en', 'zh-CN', 'ja', 'ko')
 */
export async function detectLanguage(text) {
  // 尝试使用 Native LanguageDetector
  if (languageDetector) {
    try {
      const results = await languageDetector.detect(text);

      // 获取最高置信度的结果（排除 'und' - undetermined）
      const validResults = results.filter(r => r.detectedLanguage !== 'und');

      if (validResults.length > 0) {
        const topResult = validResults[0];
        let langCode = topResult.detectedLanguage;

        // 标准化语言代码
        if (langCode.startsWith('zh')) {
          langCode = 'zh-CN';
        } else if (langCode.startsWith('ja')) {
          langCode = 'ja';
        } else if (langCode.startsWith('ko')) {
          langCode = 'ko';
        } else if (langCode.startsWith('en')) {
          langCode = 'en';
        }

        return langCode;
      }
    } catch (error) {
      console.warn('[Sapling] LanguageDetector error, using fallback:', error);
      // 降级到 fallback
    }
  }

  // Fallback: 基于正则的检测
  return detectLanguageFallback(text);
}

/**
 * 基于字符频率分析的降级语言检测
 * @param {string} text - 要检测的文本
 * @returns {string} 语言代码
 */
export function detectLanguageFallback(text) {
  const chineseRegex = /[\u4e00-\u9fff]/g;
  const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff]/g;
  const koreanRegex = /[\uac00-\ud7af]/g;
  const latinRegex = /[a-zA-Z]/g;

  const chineseCount = (text.match(chineseRegex) || []).length;
  const japaneseCount = (text.match(japaneseRegex) || []).length;
  const koreanCount = (text.match(koreanRegex) || []).length;
  const latinCount = (text.match(latinRegex) || []).length;
  const total = chineseCount + japaneseCount + koreanCount + latinCount || 1;

  if (japaneseCount / total > 0.1) return 'ja';
  if (koreanCount / total > 0.1) return 'ko';
  if (chineseCount / total > 0.3) return 'zh-CN';
  return 'en';
}
