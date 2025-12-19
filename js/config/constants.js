/**
 * Sapling 配置常量
 * 集中管理所有魔法数字和配置常量
 */

/**
 * CEFR 难度级别（从易到难）
 */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * 替换强度配置
 */
export const INTENSITY_CONFIG = {
  low: { maxPerParagraph: 4 },
  medium: { maxPerParagraph: 8 },
  high: { maxPerParagraph: 14 }
};

/**
 * 需要跳过处理的 HTML 标签
 */
export const SKIP_TAGS = [
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'CODE',
  'PRE',
  'KBD',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON'
];

/**
 * 需要跳过处理的 CSS 类名
 */
export const SKIP_CLASSES = [
  'vocabmeld-translated',
  'vocabmeld-tooltip',
  'hljs',
  'code',
  'syntax'
];

/**
 * 默认跳过 contenteditable，但允许在特定区域内处理（例如只读/预览编辑器）
 * 注意：在可编辑区域插入 span 可能影响编辑体验，谨慎添加选择器。
 */
export const ALLOW_CONTENTEDITABLE_SELECTORS = [
  '#tinymce-editor'
];

/**
 * 英文停用词列表（用于过滤）
 */
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but',
  'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these',
  'those', 'what', 'which', 'who', 'whom', 'i', 'you', 'he', 'she',
  'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'its', 'our', 'their'
]);
