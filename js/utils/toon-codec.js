/**
 * TOON 格式编解码工具模块
 * 提供 TOON 格式检测、解码和统一的内容解码接口
 */

/**
 * 从 AI 响应中提取纯净的 TOON 内容，并同步修正行数声明
 * - 去除 AI 可能输出的前置废话（如 "Here is the TOON format:"）
 * - 统计实际数据行数并修正 header 中的行数声明
 *
 * @param {string} content - 原始响应内容
 * @returns {string} 提取并修正后的 TOON 内容
 */
function extractAndFixToonContent(content) {
  const lines = content.split('\n');

  // 查找 TOON header 行: [N]{fields}:
  const headerIndex = lines.findIndex(line => /^\[\d+\]\{[^}]+\}:/.test(line.trim()));

  if (headerIndex === -1) {
    return content;
  }

  const headerLine = lines[headerIndex].trim();
  const dataLines = [];

  // 提取后续的数据行（以 2 个空格开头）
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('  ') && line.trim()) {
      dataLines.push(line);
    } else if (line.trim() === '') {
      continue;
    } else {
      break;
    }
  }

  // 修正 header 中的行数声明
  const fixedHeader = headerLine.replace(
    /^\[(\d+)\](\{[^}]+\}:)/,
    `[${dataLines.length}]$2`
  );

  return [fixedHeader, ...dataLines].join('\n');
}

/**
 * 检测内容是否为 TOON 格式
 * @param {string} content - 待检测的内容
 * @returns {boolean} 是否为 TOON 格式
 */
export function isToonFormat(content) {
  if (typeof window.TOON === 'undefined' || typeof window.TOON.isToonFormat !== 'function') {
    return false;
  }

  const extracted = extractAndFixToonContent(content);
  return window.TOON.isToonFormat(extracted);
}

/**
 * 解码 TOON 格式内容
 * @param {string} toonContent - TOON 格式的内容
 * @returns {string} JSON 字符串
 * @throws {Error} 解码失败时抛出异常
 */
export function decodeToon(toonContent) {
  if (typeof window.TOON === 'undefined' || typeof window.TOON.decode !== 'function') {
    throw new Error('TOON 库未加载');
  }

  // 预处理：提取并修正 TOON 内容
  const cleanContent = extractAndFixToonContent(toonContent);

  try {
    const decoded = window.TOON.decode(cleanContent);
    return JSON.stringify(decoded);
  } catch (error) {
    throw new Error(`TOON 解码失败: ${error.message}`);
  }
}

/**
 * 统一的内容解码接口
 * 根据 outputFormat 配置和内容格式自动选择解码方式
 *
 * @param {string} content - 待解码的内容
 * @param {string} outputFormat - 输出格式配置 ('standard' | 'toon')
 * @returns {string} 解码后的 JSON 字符串（或原始内容）
 */
export function decodeContent(content, outputFormat) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // 非 TOON 格式直接返回
  if (outputFormat !== 'toon') {
    return content;
  }

  // 检查 TOON 库是否可用
  if (typeof window.TOON === 'undefined') {
    return content;
  }

  // 预处理一次：提取并修正 TOON 内容
  const cleaned = extractAndFixToonContent(content);

  // 检测并解码
  if (window.TOON.isToonFormat?.(cleaned)) {
    try {
      const decoded = window.TOON.decode(cleaned);
      console.debug('[TOON] 成功解码 TOON 格式响应');
      return JSON.stringify(decoded);
    } catch (error) {
      console.error('[TOON] 解码失败:', error.message);
    }
  }

  return content;
}
