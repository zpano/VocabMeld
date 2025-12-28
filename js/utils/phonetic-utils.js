/**
 * 音标辅助工具
 * 目前用于修复 Wiktionary/AI 返回的倒置 R（ɹ）显示问题
 */
export function normalizePhonetic(phonetic) {
  const raw = typeof phonetic === 'string' ? phonetic : String(phonetic ?? '');
  if (!raw) return '';
  return raw.replace(/\u0279/g, 'r'); // ɹ -> r
}

